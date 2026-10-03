package com.transport.system.security

import com.transport.system.models.{AdminCreateFlightRequest, FlightClassRequest}
import java.sql.{Connection, Date, DriverManager, SQLException, Time}
import java.time.{LocalDate, LocalTime}
import java.time.format.DateTimeFormatter
import java.util.Locale

enum FlightWriteError {
  case InvalidData, CodeAlreadyExists, InvalidAirport
}

object FlightRepository {
  private val flightCode = "^[A-Z0-9]{2}[0-9]{1,4}$".r
  private val supportedClasses = Set("ECONOMY", "PRIMERA")

  private def connection(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  private def parseDate(value: String): Option[LocalDate] =
    try Some(LocalDate.parse(Option(value).getOrElse(""))) catch { case _: Exception => None }

  private def parseTime(value: String): Option[LocalTime] =
    try Some(LocalTime.parse(Option(value).getOrElse(""), DateTimeFormatter.ofPattern("HH:mm", Locale.ROOT)))
    catch { case _: Exception => None }

  private def normalizeClasses(classes: List[FlightClassRequest]): Option[List[(String, Int, BigDecimal)]] = {
    val entries = Option(classes).getOrElse(Nil)
    if (entries.exists(_ == null)) return None
    val normalized = entries.map { item =>
      (Option(item.className).getOrElse("").trim.toUpperCase(Locale.ROOT), item.capacity, item.price)
    }
    Option.when(normalized.nonEmpty && normalized.map(_._1).distinct.size == normalized.size &&
      normalized.forall { case (name, capacity, price) =>
        supportedClasses.contains(name) && capacity > 0 && price != null && price > 0 &&
          price <= BigDecimal("9999999999.99") && price.bigDecimal.stripTrailingZeros.scale <= 2
      })(normalized)
  }

  private def valid(input: AdminCreateFlightRequest): Option[(String, LocalDate, LocalDate, LocalTime, LocalTime,
    List[Int], List[(String, Int, BigDecimal)])] = {
    if (input == null) return None
    val code = Option(input.code).getOrElse("").trim.toUpperCase(Locale.ROOT)
    val start = parseDate(input.startDate)
    val end = parseDate(input.endDate)
    val departure = parseTime(input.departureTime)
    val arrival = parseTime(input.arrivalTime)
    val requestedDays = Option(input.operatingDays).getOrElse(Nil)
    val days = requestedDays.distinct.sorted
    val classes = normalizeClasses(input.classes)
    Option.when(
      flightCode.matches(code) && input.originAirportId > 0 && input.destinationAirportId > 0 &&
        input.originAirportId != input.destinationAirportId && input.arrivalDayOffset >= 0 && input.arrivalDayOffset <= 1 &&
        start.exists(from => end.exists(to => !from.isAfter(to))) &&
        departure.isDefined && arrival.isDefined &&
        (input.arrivalDayOffset == 1 || arrival.exists(time => departure.exists(time.isAfter))) &&
        days.nonEmpty && days.size == requestedDays.size && days.forall(day => day >= 1 && day <= 7) && classes.isDefined
    )((code, start.get, end.get, departure.get, arrival.get, days, classes.get))
  }

  private def drain(call: java.sql.CallableStatement): Unit = {
    var hasResult = call.execute()
    while (hasResult || call.getUpdateCount != -1) {
      if (hasResult) {
        val result = call.getResultSet
        if (result != null) result.close()
      }
      hasResult = call.getMoreResults()
    }
  }

  def create(actorId: Long, input: AdminCreateFlightRequest): Either[FlightWriteError, Long] = {
    val normalized = valid(input)
    if (normalized.isEmpty) return Left(FlightWriteError.InvalidData)
    val (code, start, end, departure, arrival, days, classes) = normalized.get
    val conn = connection()
    try {
      conn.setAutoCommit(false)
      val insertFlight = conn.prepareStatement(
        "INSERT INTO vuelo (codigo,aeropuerto_origen_id,aeropuerto_destino_id,hora_partida,hora_llegada," +
          "dias_desfase_llegada,fecha_desde,fecha_hasta,creado_por_id) VALUES (?,?,?,?,?,?,?,?,?)",
        java.sql.Statement.RETURN_GENERATED_KEYS)
      val flightId = try {
        insertFlight.setString(1, code)
        insertFlight.setLong(2, input.originAirportId)
        insertFlight.setLong(3, input.destinationAirportId)
        insertFlight.setTime(4, Time.valueOf(departure))
        insertFlight.setTime(5, Time.valueOf(arrival))
        insertFlight.setInt(6, input.arrivalDayOffset)
        insertFlight.setDate(7, Date.valueOf(start))
        insertFlight.setDate(8, Date.valueOf(end))
        insertFlight.setLong(9, actorId)
        insertFlight.executeUpdate()
        val keys = insertFlight.getGeneratedKeys
        try { if (keys.next()) keys.getLong(1) else throw new SQLException("Flight insert did not return an id") }
        finally keys.close()
      } finally insertFlight.close()

      val insertDay = conn.prepareStatement("INSERT INTO vuelo_dia_operacion (vuelo_id,dia_semana) VALUES (?,?)")
      try days.foreach { day => insertDay.setLong(1, flightId); insertDay.setInt(2, day); insertDay.addBatch() }
      finally { insertDay.executeBatch(); insertDay.close() }

      val insertClass = conn.prepareStatement("INSERT INTO vuelo_clase (vuelo_id,clase,capacidad,precio) VALUES (?,?,?,?)")
      try classes.foreach { case (name, capacity, price) =>
        insertClass.setLong(1, flightId)
        insertClass.setString(2, name)
        insertClass.setInt(3, capacity)
        insertClass.setBigDecimal(4, price.bigDecimal)
        insertClass.addBatch()
      }
      finally { insertClass.executeBatch(); insertClass.close() }

      val generate = conn.prepareCall("{CALL generar_salidas(?)}")
      try { generate.setLong(1, flightId); drain(generate) }
      finally generate.close()

      val audit = conn.prepareStatement(
        "INSERT INTO auditoria (actor_usuario_id,accion,entidad,entidad_id,detalles) VALUES (?,?,'vuelo',?,?)")
      try {
        audit.setLong(1, actorId)
        audit.setString(2, "flight.created")
        audit.setLong(3, flightId)
        audit.setString(4, s"{\"codigo\":\"$code\"}")
        audit.executeUpdate()
      } finally audit.close()
      conn.commit()
      Right(flightId)
    } catch {
      case ex: SQLException if Option(ex.getSQLState).exists(_.startsWith("23")) =>
        conn.rollback()
        if (ex.getErrorCode == 1062) Left(FlightWriteError.CodeAlreadyExists)
        else if (Option(ex.getMessage).exists(message =>
          message.contains("fk_vuelo_origen") || message.contains("fk_vuelo_destino"))) Left(FlightWriteError.InvalidAirport)
        else Left(FlightWriteError.InvalidData)
      case ex: Throwable => conn.rollback(); throw ex
    } finally conn.close()
  }

  def activeAirports(): List[Map[String, Any]] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement("SELECT id,codigo_iata,nombre,ciudad FROM aeropuerto WHERE activo=TRUE ORDER BY ciudad,nombre")
      val rs = stmt.executeQuery()
      try {
        val airports = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
        while (rs.next()) airports += Map(
          "id" -> rs.getLong("id"), "code" -> rs.getString("codigo_iata"),
          "name" -> rs.getString("nombre"), "city" -> rs.getString("ciudad"))
        airports.toList
      } finally { rs.close(); stmt.close() }
    } finally conn.close()
  }
}
