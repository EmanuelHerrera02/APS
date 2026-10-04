package com.transport.system.security

import com.transport.system.models.{AdminCreateFlightRequest, FlightClassRequest}
import java.sql.{Connection, Date, DriverManager, SQLException, Time}
import java.time.{LocalDate, LocalTime, ZoneId}
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

enum FlightWriteError {
  case InvalidData(message: String)
  case CodeAlreadyExists, InvalidAirport
}

object FlightRepository {
  private val flightCode = "^[A-Z0-9]{2}[0-9]{1,4}$".r
  private val supportedClasses = Set("ECONOMY", "PRIMERA")
  private val maxPrice = BigDecimal("9999999999.99")
  /** Límite del período para acotar las salidas que se materializan en una sola transacción. */
  val MaxPeriodDays = 366
  private val zone = ZoneId.of("America/Argentina/Buenos_Aires")

  private final case class FlightData(code: String, start: LocalDate, end: LocalDate, departure: LocalTime,
    arrival: LocalTime, days: List[Int], classes: List[(String, Int, BigDecimal)])

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

  private def normalizeClasses(classes: List[FlightClassRequest]): Either[String, List[(String, Int, BigDecimal)]] = {
    val entries = Option(classes).getOrElse(Nil)
    val normalized = entries.map(item => Option(item).map(value =>
      (Option(value.className).getOrElse("").trim.toUpperCase(Locale.ROOT), value.capacity, value.price)))
    if (normalized.isEmpty) Left("Seleccioná al menos una clase")
    else if (normalized.exists(_.forall { case (name, _, _) => !supportedClasses.contains(name) }))
      Left("Las clases válidas son ECONOMY y PRIMERA")
    else {
      val valid = normalized.flatten
      if (valid.map(_._1).distinct.size != valid.size) Left("Cada clase puede indicarse una sola vez")
      else if (valid.exists(_._2 <= 0)) Left("La capacidad de cada clase debe ser un entero mayor que cero")
      else if (valid.exists { case (_, _, price) =>
        price == null || price <= 0 || price > maxPrice || price.bigDecimal.stripTrailingZeros.scale > 2
      }) Left("El precio de cada clase debe ser positivo, tener hasta dos decimales y no superar 9.999.999.999,99")
      else Right(valid)
    }
  }

  /** Cantidad de fechas del período que caen en alguno de los días de operación (1 = lunes … 7 = domingo). */
  def departuresInPeriod(start: LocalDate, end: LocalDate, days: Set[Int]): Int =
    Iterator.iterate(start)(_.plusDays(1)).takeWhile(!_.isAfter(end))
      .count(date => days.contains(date.getDayOfWeek.getValue))

  private def validate(input: AdminCreateFlightRequest, today: LocalDate): Either[String, FlightData] = {
    if (input == null) return Left("El cuerpo de la solicitud no es válido")
    val code = Option(input.code).getOrElse("").trim.toUpperCase(Locale.ROOT)
    val requestedDays = Option(input.operatingDays).getOrElse(Nil)
    val days = requestedDays.distinct.sorted
    for {
      _ <- Either.cond(flightCode.matches(code), (),
        "El código debe tener dos letras o números seguidos de uno a cuatro dígitos")
      _ <- Either.cond(input.originAirportId > 0 && input.destinationAirportId > 0, (),
        "Elegí los aeropuertos de origen y destino")
      _ <- Either.cond(input.originAirportId != input.destinationAirportId, (), "El origen y el destino deben ser distintos")
      departure <- parseTime(input.departureTime).toRight("Los horarios deben tener el formato HH:mm")
      arrival <- parseTime(input.arrivalTime).toRight("Los horarios deben tener el formato HH:mm")
      _ <- Either.cond(input.arrivalDayOffset == 0 || input.arrivalDayOffset == 1, (),
        "La llegada debe ser el mismo día o el día siguiente")
      _ <- Either.cond(input.arrivalDayOffset == 1 || arrival.isAfter(departure), (),
        "La llegada debe ser posterior a la partida o indicar llegada al día siguiente")
      start <- parseDate(input.startDate).toRight("Las fechas deben tener el formato AAAA-MM-DD")
      end <- parseDate(input.endDate).toRight("Las fechas deben tener el formato AAAA-MM-DD")
      _ <- Either.cond(!start.isAfter(end), (), "La fecha de inicio debe ser anterior o igual a la fecha de fin")
      _ <- Either.cond(!start.isBefore(today), (), "El período no puede comenzar antes de hoy")
      _ <- Either.cond(ChronoUnit.DAYS.between(start, end) < MaxPeriodDays, (),
        s"El período no puede superar los $MaxPeriodDays días")
      _ <- Either.cond(days.nonEmpty, (), "Seleccioná al menos un día de operación")
      _ <- Either.cond(days.size == requestedDays.size && days.forall(day => day >= 1 && day <= 7), (),
        "Los días de operación deben ser valores distintos entre 1 (lunes) y 7 (domingo)")
      _ <- Either.cond(departuresInPeriod(start, end, days.toSet) > 0, (),
        "El período no incluye ninguno de los días de operación elegidos")
      classes <- normalizeClasses(input.classes)
    } yield FlightData(code, start, end, departure, arrival, days, classes)
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

  private def airportsAvailable(conn: Connection, originId: Long, destinationId: Long): Boolean = {
    val stmt = conn.prepareStatement("SELECT COUNT(*) FROM aeropuerto WHERE id IN (?,?) AND activo LOCK IN SHARE MODE")
    try {
      stmt.setLong(1, originId)
      stmt.setLong(2, destinationId)
      val rs = stmt.executeQuery()
      try rs.next() && rs.getInt(1) == 2 finally rs.close()
    } finally stmt.close()
  }

  def create(actorId: Long, input: AdminCreateFlightRequest): Either[FlightWriteError, Long] = {
    val flight = validate(input, LocalDate.now(zone)) match {
      case Left(message) => return Left(FlightWriteError.InvalidData(message))
      case Right(data) => data
    }
    val conn = connection()
    try {
      conn.setAutoCommit(false)
      if (!airportsAvailable(conn, input.originAirportId, input.destinationAirportId)) {
        conn.rollback()
        return Left(FlightWriteError.InvalidAirport)
      }

      val insertFlight = conn.prepareStatement(
        "INSERT INTO vuelo (codigo,aeropuerto_origen_id,aeropuerto_destino_id,hora_partida,hora_llegada," +
          "dias_desfase_llegada,fecha_desde,fecha_hasta,creado_por_id) VALUES (?,?,?,?,?,?,?,?,?)",
        java.sql.Statement.RETURN_GENERATED_KEYS)
      val flightId = try {
        insertFlight.setString(1, flight.code)
        insertFlight.setLong(2, input.originAirportId)
        insertFlight.setLong(3, input.destinationAirportId)
        insertFlight.setTime(4, Time.valueOf(flight.departure))
        insertFlight.setTime(5, Time.valueOf(flight.arrival))
        insertFlight.setInt(6, input.arrivalDayOffset)
        insertFlight.setDate(7, Date.valueOf(flight.start))
        insertFlight.setDate(8, Date.valueOf(flight.end))
        insertFlight.setLong(9, actorId)
        insertFlight.executeUpdate()
        val keys = insertFlight.getGeneratedKeys
        try { if (keys.next()) keys.getLong(1) else throw new SQLException("Flight insert did not return an id") }
        finally keys.close()
      } finally insertFlight.close()

      val insertDay = conn.prepareStatement("INSERT INTO vuelo_dia_operacion (vuelo_id,dia_semana) VALUES (?,?)")
      try {
        flight.days.foreach { day => insertDay.setLong(1, flightId); insertDay.setInt(2, day); insertDay.addBatch() }
        insertDay.executeBatch()
      } finally insertDay.close()

      val insertClass = conn.prepareStatement("INSERT INTO vuelo_clase (vuelo_id,clase,capacidad,precio) VALUES (?,?,?,?)")
      try {
        flight.classes.foreach { case (name, capacity, price) =>
          insertClass.setLong(1, flightId)
          insertClass.setString(2, name)
          insertClass.setInt(3, capacity)
          insertClass.setBigDecimal(4, price.bigDecimal)
          insertClass.addBatch()
        }
        insertClass.executeBatch()
      } finally insertClass.close()

      // Corre dentro de la transacción abierta: generar_salidas usa un SAVEPOINT y no confirma por su cuenta.
      val generate = conn.prepareCall("{CALL generar_salidas(?)}")
      try { generate.setLong(1, flightId); drain(generate) }
      finally generate.close()

      val audit = conn.prepareStatement(
        "INSERT INTO auditoria (actor_usuario_id,accion,entidad,entidad_id,detalles) VALUES (?,?,'vuelo',?,?)")
      try {
        audit.setLong(1, actorId)
        audit.setString(2, "flight.created")
        audit.setLong(3, flightId)
        audit.setString(4, s"{\"codigo\":\"${flight.code}\"}")
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
        else Left(FlightWriteError.InvalidData("Los datos del vuelo no cumplen las reglas de la base de datos"))
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
