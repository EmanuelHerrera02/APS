package com.transport.system.security

import com.transport.system.models.{AdminCreateFlightRequest, FlightClassRequest}
import java.sql.{Connection, Date, DriverManager, SQLException, Time}
import java.time.{LocalDate, LocalTime, ZoneId}
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

enum FlightWriteError {
  case InvalidData(message: String)
  case CodeAlreadyExists, InvalidAirport, NotFound, AlreadyCancelled
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

  private def flightMap(conn: Connection, id: Long): Option[Map[String, Any]] = {
    val statement = conn.prepareStatement(
      "SELECT id,codigo,aeropuerto_origen_id,aeropuerto_destino_id,hora_partida,hora_llegada," +
        "dias_desfase_llegada,fecha_desde,fecha_hasta,estado FROM vuelo WHERE id=?")
    statement.setLong(1, id)
    val rs = statement.executeQuery()
    try if (!rs.next()) None else {
      val daysQuery = conn.prepareStatement("SELECT dia_semana FROM vuelo_dia_operacion WHERE vuelo_id=? ORDER BY dia_semana")
      daysQuery.setLong(1, id)
      val daysRs = daysQuery.executeQuery()
      val days = scala.collection.mutable.ListBuffer.empty[Int]
      try while (daysRs.next()) days += daysRs.getInt(1)
      finally { daysRs.close(); daysQuery.close() }

      val classesQuery = conn.prepareStatement(
        "SELECT clase,capacidad,precio FROM vuelo_clase WHERE vuelo_id=? ORDER BY clase")
      classesQuery.setLong(1, id)
      val classesRs = classesQuery.executeQuery()
      val classes = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
      try while (classesRs.next()) classes += Map(
        "className" -> classesRs.getString("clase"),
        "capacity" -> classesRs.getInt("capacidad"),
        "price" -> classesRs.getBigDecimal("precio"))
      finally { classesRs.close(); classesQuery.close() }

      val departuresQuery = conn.prepareStatement(
        "SELECT id,fecha,hora_partida,hora_llegada,estado FROM salida " +
          "WHERE vuelo_id=? AND fecha>=CURDATE() ORDER BY fecha LIMIT 100")
      departuresQuery.setLong(1, id)
      val departuresRs = departuresQuery.executeQuery()
      val departures = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
      try while (departuresRs.next()) departures += Map(
        "id" -> departuresRs.getLong("id"),
        "date" -> departuresRs.getDate("fecha").toString,
        "departureTime" -> departuresRs.getTime("hora_partida").toString.take(5),
        "arrivalTime" -> departuresRs.getTime("hora_llegada").toString.take(5),
        "status" -> departuresRs.getString("estado"))
      finally { departuresRs.close(); departuresQuery.close() }

      Some(Map(
        "id" -> rs.getLong("id"), "code" -> rs.getString("codigo"),
        "originAirportId" -> rs.getLong("aeropuerto_origen_id"),
        "destinationAirportId" -> rs.getLong("aeropuerto_destino_id"),
        "departureTime" -> rs.getTime("hora_partida").toString.take(5),
        "arrivalTime" -> rs.getTime("hora_llegada").toString.take(5),
        "arrivalDayOffset" -> rs.getInt("dias_desfase_llegada"),
        "startDate" -> rs.getDate("fecha_desde").toString,
        "endDate" -> rs.getDate("fecha_hasta").toString,
        "status" -> rs.getString("estado"), "operatingDays" -> days.toList,
        "classes" -> classes.toList, "departures" -> departures.toList))
    } finally { rs.close(); statement.close() }
  }

  def listForAdministration(): List[Map[String, Any]] = {
    val conn = connection()
    try {
      val ids = conn.prepareStatement("SELECT id FROM vuelo ORDER BY estado,codigo")
      val rs = ids.executeQuery()
      val flightIds = scala.collection.mutable.ListBuffer.empty[Long]
      try while (rs.next()) flightIds += rs.getLong(1)
      finally { rs.close(); ids.close() }
      flightIds.toList.flatMap(id => flightMap(conn, id))
    } finally conn.close()
  }

  def update(actorId: Long, flightId: Long, input: AdminCreateFlightRequest): Either[FlightWriteError, Unit] = {
    val flight = validate(input, LocalDate.now(zone)) match {
      case Left(message) => return Left(FlightWriteError.InvalidData(message))
      case Right(data) => data
    }
    val conn = connection()
    try {
      conn.setAutoCommit(false)
      val current = conn.prepareStatement("SELECT codigo,aeropuerto_origen_id,aeropuerto_destino_id,estado FROM vuelo WHERE id=? FOR UPDATE")
      current.setLong(1, flightId)
      val rs = current.executeQuery()
      val existing = try if (rs.next()) Some((rs.getString("codigo"), rs.getLong("aeropuerto_origen_id"),
        rs.getLong("aeropuerto_destino_id"), rs.getString("estado"))) else None
      finally { rs.close(); current.close() }
      if (existing.isEmpty) { conn.rollback(); return Left(FlightWriteError.NotFound) }
      val (oldCode, oldOrigin, oldDestination, oldStatus) = existing.get
      if (oldStatus != "ACTIVO") { conn.rollback(); return Left(FlightWriteError.AlreadyCancelled) }
      if (flight.code != oldCode || input.originAirportId != oldOrigin || input.destinationAirportId != oldDestination) {
        conn.rollback()
        return Left(FlightWriteError.InvalidData("El código y la ruta de un vuelo existente no se pueden cambiar"))
      }
      if (!airportsAvailable(conn, oldOrigin, oldDestination)) {
        conn.rollback()
        return Left(FlightWriteError.InvalidAirport)
      }

      val existingClassesQuery = conn.prepareStatement("SELECT clase FROM vuelo_clase WHERE vuelo_id=? FOR UPDATE")
      existingClassesQuery.setLong(1, flightId)
      val existingClassesRs = existingClassesQuery.executeQuery()
      val existingClasses = scala.collection.mutable.Set.empty[String]
      try while (existingClassesRs.next()) existingClasses += existingClassesRs.getString(1)
      finally { existingClassesRs.close(); existingClassesQuery.close() }
      val requestedClasses = flight.classes.map(_._1).toSet
      if (!existingClasses.subsetOf(requestedClasses)) {
        conn.rollback()
        return Left(FlightWriteError.InvalidData("No se puede quitar una clase existente; modificá su capacidad o precio"))
      }

      val updateFlight = conn.prepareStatement(
        "UPDATE vuelo SET hora_partida=?,hora_llegada=?,dias_desfase_llegada=?,fecha_desde=?,fecha_hasta=? WHERE id=?")
      try {
        updateFlight.setTime(1, Time.valueOf(flight.departure))
        updateFlight.setTime(2, Time.valueOf(flight.arrival))
        updateFlight.setInt(3, input.arrivalDayOffset)
        updateFlight.setDate(4, Date.valueOf(flight.start))
        updateFlight.setDate(5, Date.valueOf(flight.end))
        updateFlight.setLong(6, flightId)
        updateFlight.executeUpdate()
      } finally updateFlight.close()

      val clearDays = conn.prepareStatement("DELETE FROM vuelo_dia_operacion WHERE vuelo_id=?")
      try { clearDays.setLong(1, flightId); clearDays.executeUpdate() } finally clearDays.close()
      val insertDay = conn.prepareStatement("INSERT INTO vuelo_dia_operacion (vuelo_id,dia_semana) VALUES (?,?)")
      try {
        flight.days.foreach { day => insertDay.setLong(1, flightId); insertDay.setInt(2, day); insertDay.addBatch() }
        insertDay.executeBatch()
      } finally insertDay.close()

      // Las salidas que quedan fuera del nuevo calendario se cancelan, salvo que tengan pasajes emitidos:
      // en ese caso se rechaza el cambio para no dejar sin lugar a pasajeros que ya pagaron.
      val soldOutsideCalendar = conn.prepareStatement(
        """SELECT s.fecha FROM salida s
          |WHERE s.vuelo_id=? AND s.estado='PROGRAMADA' AND TIMESTAMP(s.fecha,s.hora_partida)>NOW()
          |  AND (s.fecha<? OR s.fecha>? OR NOT EXISTS (
          |    SELECT 1 FROM vuelo_dia_operacion d WHERE d.vuelo_id=s.vuelo_id AND d.dia_semana=WEEKDAY(s.fecha)+1))
          |  AND EXISTS (SELECT 1 FROM pasaje p WHERE p.salida_id=s.id AND p.estado='EMITIDO')
          |ORDER BY s.fecha LIMIT 5 FOR UPDATE""".stripMargin)
      val blockedDates = try {
        soldOutsideCalendar.setLong(1, flightId)
        soldOutsideCalendar.setDate(2, Date.valueOf(flight.start))
        soldOutsideCalendar.setDate(3, Date.valueOf(flight.end))
        val blockedRs = soldOutsideCalendar.executeQuery()
        val dates = scala.collection.mutable.ListBuffer.empty[String]
        try while (blockedRs.next()) dates += blockedRs.getDate(1).toString
        finally blockedRs.close()
        dates.toList
      } finally soldOutsideCalendar.close()
      if (blockedDates.nonEmpty) {
        conn.rollback()
        return Left(FlightWriteError.InvalidData(
          s"El nuevo período o los días de operación dejan fuera salidas con pasajes vendidos (${blockedDates.mkString(", ")}). " +
            "Cancelá esas salidas explícitamente o mantenelas en el calendario"))
      }

      val cancelRemovedDates = conn.prepareStatement(
        """UPDATE salida s SET estado='CANCELADA', motivo_cancelacion='Fuera del nuevo período de operación'
          |WHERE s.vuelo_id=? AND s.estado='PROGRAMADA' AND TIMESTAMP(s.fecha,s.hora_partida)>NOW()
          |  AND (s.fecha<? OR s.fecha>? OR NOT EXISTS (
          |    SELECT 1 FROM vuelo_dia_operacion d WHERE d.vuelo_id=s.vuelo_id AND d.dia_semana=WEEKDAY(s.fecha)+1))""".stripMargin)
      try {
        cancelRemovedDates.setLong(1, flightId)
        cancelRemovedDates.setDate(2, Date.valueOf(flight.start))
        cancelRemovedDates.setDate(3, Date.valueOf(flight.end))
        cancelRemovedDates.executeUpdate()
      } finally cancelRemovedDates.close()

      val updateClass = conn.prepareStatement(
        "UPDATE vuelo_clase SET capacidad=?,precio=? WHERE vuelo_id=? AND clase=?")
      val insertClass = conn.prepareStatement(
        "INSERT INTO vuelo_clase (vuelo_id,clase,capacidad,precio) VALUES (?,?,?,?)")
      try flight.classes.foreach { case (name, capacity, price) =>
        if (existingClasses.contains(name)) {
          updateClass.setInt(1, capacity); updateClass.setBigDecimal(2, price.bigDecimal)
          updateClass.setLong(3, flightId); updateClass.setString(4, name)
          updateClass.executeUpdate()
        } else {
          insertClass.setLong(1, flightId); insertClass.setString(2, name)
          insertClass.setInt(3, capacity); insertClass.setBigDecimal(4, price.bigDecimal)
          insertClass.executeUpdate()
        }
      } finally { updateClass.close(); insertClass.close() }

      val generate = conn.prepareCall("{CALL generar_salidas(?)}")
      try { generate.setLong(1, flightId); drain(generate) } finally generate.close()
      val audit = conn.prepareStatement(
        "INSERT INTO auditoria (actor_usuario_id,accion,entidad,entidad_id,detalles) VALUES (?,?,'vuelo',?,?)")
      try {
        audit.setLong(1, actorId); audit.setString(2, "flight.updated"); audit.setLong(3, flightId)
        audit.setString(4, s"{\"codigo\":\"$oldCode\"}"); audit.executeUpdate()
      } finally audit.close()
      conn.commit()
      Right(())
    } catch {
      case ex: SQLException if Option(ex.getSQLState).exists(_.startsWith("23")) =>
        conn.rollback()
        Left(FlightWriteError.InvalidData(Option(ex.getMessage).getOrElse("Los cambios contradicen la capacidad vendida")))
      case ex: SQLException if ex.getErrorCode == 1644 =>
        conn.rollback()
        Left(FlightWriteError.InvalidData(Option(ex.getMessage).getOrElse("El cambio no cumple las reglas del vuelo")))
      case ex: Throwable => conn.rollback(); throw ex
    } finally conn.close()
  }

  def cancel(actorId: Long, flightId: Long, departureId: Option[Long], reasonInput: String): Either[FlightWriteError, Unit] = {
    val reason = Option(reasonInput).getOrElse("").trim
    if (reason.isEmpty || reason.length > 255)
      return Left(FlightWriteError.InvalidData("El motivo es obligatorio y no puede superar 255 caracteres"))
    val conn = connection()
    try {
      conn.setAutoCommit(false)
      val exists = conn.prepareStatement("SELECT estado FROM vuelo WHERE id=? FOR UPDATE")
      exists.setLong(1, flightId)
      val rs = exists.executeQuery()
      val status = try if (rs.next()) Some(rs.getString(1)) else None finally { rs.close(); exists.close() }
      if (status.isEmpty) { conn.rollback(); return Left(FlightWriteError.NotFound) }
      if (status.contains("CANCELADO")) { conn.rollback(); return Left(FlightWriteError.AlreadyCancelled) }

      departureId match {
        case Some(id) =>
          val cancelDeparture = conn.prepareStatement(
            "UPDATE salida SET estado='CANCELADA',motivo_cancelacion=? WHERE id=? AND vuelo_id=? AND estado='PROGRAMADA'")
          try {
            cancelDeparture.setString(1, reason); cancelDeparture.setLong(2, id); cancelDeparture.setLong(3, flightId)
            if (cancelDeparture.executeUpdate() == 0) {
              conn.rollback(); return Left(FlightWriteError.InvalidData("La salida no existe, no pertenece al vuelo o ya está cancelada"))
            }
          } finally cancelDeparture.close()
        case None =>
          val cancelDepartures = conn.prepareStatement(
            "UPDATE salida SET estado='CANCELADA',motivo_cancelacion=? WHERE vuelo_id=? AND estado='PROGRAMADA' AND TIMESTAMP(fecha,hora_partida)>NOW()")
          try { cancelDepartures.setString(1, reason); cancelDepartures.setLong(2, flightId); cancelDepartures.executeUpdate() }
          finally cancelDepartures.close()
          val cancelFlight = conn.prepareStatement("UPDATE vuelo SET estado='CANCELADO' WHERE id=?")
          try { cancelFlight.setLong(1, flightId); cancelFlight.executeUpdate() } finally cancelFlight.close()
      }
      val audit = conn.prepareStatement(
        "INSERT INTO auditoria (actor_usuario_id,accion,entidad,entidad_id,detalles) VALUES (?,?,?,?,?)")
      try {
        audit.setLong(1, actorId)
        audit.setString(2, if (departureId.isDefined) "flight.departure.cancelled" else "flight.cancelled")
        audit.setString(3, if (departureId.isDefined) "salida" else "vuelo")
        audit.setLong(4, departureId.getOrElse(flightId))
        audit.setString(5, s"{\"vuelo_id\":$flightId,\"motivo\":\"${reason.replace("\\", "\\\\").replace("\"", "\\\"")}\"}")
        audit.executeUpdate()
      } finally audit.close()
      conn.commit()
      Right(())
    } catch {
      case ex: SQLException if ex.getErrorCode == 1644 =>
        conn.rollback(); Left(FlightWriteError.InvalidData(Option(ex.getMessage).getOrElse("No se pudo cancelar el vuelo")))
      case ex: Throwable => conn.rollback(); throw ex
    } finally conn.close()
  }

  def getForAdministration(id: Long): Option[Map[String, Any]] = {
    val conn = connection()
    try flightMap(conn, id) finally conn.close()
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
