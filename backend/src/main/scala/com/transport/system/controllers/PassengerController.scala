package com.transport.system.controllers

import com.transport.system.middleware.{AuthorizedAction, SecurityException}
import com.transport.system.documents.PassengerDocumentService
import com.transport.system.models.{Roles, Permissions}
import com.transport.system.security.UserRepository
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory
import java.sql.{CallableStatement, DriverManager, SQLException, Types}
import java.nio.file.Files
import java.time.LocalDate
import java.time.ZoneId
import scala.util.Try

/**
 * Controlador para funcionalidades de Pasajero
 */
class PassengerController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  val logger = LoggerFactory.getLogger(getClass)

  /**
   * Patrón LIKE para ubicar un aeropuerto por ciudad o nombre. Desde 4 caracteres
   * busca coincidencias parciales ("Bariloche", "Aeroparque"); los términos más
   * cortos deben coincidir completos para no confundir un código IATA con un fragmento.
   */
  private def placePattern(term: String): String = {
    val escaped = term.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    if (term.length >= 4) s"%$escaped%" else escaped
  }

  private case class ReservationPassenger(
    firstName: String,
    lastName: String,
    documentType: String,
    documentNumber: String,
    fareClass: String
  )

  private def jsonText(value: JValue, field: String): Either[String, String] = value \ field match {
    case JString(text) if text.trim.nonEmpty => Right(text.trim)
    case _ => Left(s"$field es obligatorio y debe ser texto")
  }

  private def reservationRequest(body: JValue): Either[String, (Long, String, List[ReservationPassenger])] = {
    if (!body.isInstanceOf[JObject]) return Left("El cuerpo debe ser un objeto JSON")

    val departureId = (body \ "departureId") match {
      case JInt(value) if value.isValidLong && value > 0 => Right(value.toLong)
      case JLong(value) if value > 0 => Right(value)
      case _ => Left("departureId debe ser un entero positivo")
    }
    val email = jsonText(body, "emailContact").flatMap { value =>
      if (value.matches("(?i)^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") && value.length <= 255) Right(value)
      else Left("emailContact no tiene un formato válido")
    }
    val passengers = (body \ "passengers") match {
      case JArray(items) if items.nonEmpty && items.length <= 9 =>
        val parsed = items.map { item =>
          val firstName = jsonText(item, "firstName").flatMap(value =>
            if (value.length <= 100) Right(value) else Left("firstName no puede superar 100 caracteres"))
          val lastName = jsonText(item, "lastName").flatMap(value =>
            if (value.length <= 100) Right(value) else Left("lastName no puede superar 100 caracteres"))
          val documentType = jsonText(item, "documentType").flatMap { value =>
            val normalized = value.toUpperCase(java.util.Locale.ROOT)
            if (Set("DNI", "PASAPORTE", "OTRO").contains(normalized)) Right(normalized)
            else Left("documentType debe ser DNI, PASAPORTE u OTRO")
          }
          val documentNumber = jsonText(item, "documentNumber").flatMap(value =>
            if (value.length <= 20) Right(value) else Left("documentNumber no puede superar 20 caracteres"))
          val fareClass = jsonText(item, "class").flatMap { value =>
            val normalized = value.toUpperCase(java.util.Locale.ROOT)
            if (Set("ECONOMY", "PRIMERA").contains(normalized)) Right(normalized)
            else Left("class debe ser ECONOMY o PRIMERA")
          }
          for {
            first <- firstName
            last <- lastName
            docType <- documentType
            docNumber <- documentNumber
            fare <- fareClass
          } yield ReservationPassenger(first, last, docType, docNumber, fare)
        }
        parsed.collectFirst { case Left(error) => error } match {
          case Some(error) => Left(error)
          case None => Right(parsed.collect { case Right(passenger) => passenger })
        }
      case JArray(_) => Left("La compra admite entre 1 y 9 pasajeros")
      case _ => Left("passengers debe ser un array")
    }

    for {
      id <- departureId
      contact <- email
      people <- passengers
    } yield (id, contact, people)
  }

  private def releaseExpiredReservations(connection: java.sql.Connection): Unit = {
    val call = connection.prepareCall("{call liberar_reservas_vencidas()}")
    try {
      var hasResult = call.execute()
      while (hasResult || call.getUpdateCount != -1) {
        if (hasResult) {
          val rs = call.getResultSet
          if (rs != null) rs.close()
        }
        hasResult = call.getMoreResults()
      }
    } finally call.close()
  }

  /**
   * Dos altas simultáneas pueden chocar en un deadlock de InnoDB (bloqueos de hueco sobre
   * uq_compra_codigo al generar el código en trg_compra_bi). crear_compra es atómica y la base
   * ya deshizo la transacción, así que se reintenta como recomienda MariaDB.
   */
  private def retryOnDeadlock[T](attempts: Int = 4)(work: => T): T =
    try work
    catch {
      case ex: SQLException if attempts > 1 && Option(ex.getSQLState).contains("40001") =>
        Thread.sleep(10L + scala.util.Random.nextInt(40))
        retryOnDeadlock(attempts - 1)(work)
    }

  private def executeCreateReservation(connection: java.sql.Connection, userId: Int, departureId: Long,
                                       email: String, passengerJsonPayload: String): Map[String, Any] = {
    val call: CallableStatement = connection.prepareCall("{call crear_compra(?, ?, ?, ?, ?, ?, ?)}")
    try {
      call.setLong(1, departureId)
      call.setLong(2, userId.toLong)
      call.setNull(3, Types.BIGINT)
      call.setString(4, "WEB")
      call.setString(5, email)
      call.setString(6, passengerJsonPayload)
      call.registerOutParameter(7, Types.BIGINT)
      call.execute()
      val reservationId = call.getLong(7)
      if (call.wasNull() || reservationId <= 0) throw new SQLException("La base no devolvió el identificador de compra")
      val query = connection.prepareStatement("SELECT codigo, total, estado, expira_en FROM compra WHERE id = ?")
      try {
        query.setLong(1, reservationId)
        val result = query.executeQuery()
        try {
          if (!result.next()) throw new SQLException("No se encontró la compra creada")
          Map(
            "reservationId" -> reservationId,
            "code" -> result.getString("codigo"),
            "status" -> result.getString("estado"),
            "total" -> result.getBigDecimal("total"),
            "expiresAt" -> result.getTimestamp("expira_en").toString
          )
        } finally result.close()
      } finally query.close()
    } finally call.close()
  }

  private def callCreateReservation(userId: Int, departureId: Long, email: String,
                                    passengers: List[ReservationPassenger]): Map[String, Any] = {
    val jdbcUrl = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val dbUser = sys.env.getOrElse("AERONET_DB_USER", "")
    val dbPassword = sys.env.getOrElse("AERONET_DB_PASSWORD", "")
    if (jdbcUrl.isEmpty || dbUser.isEmpty) throw new IllegalStateException("Database configuration is missing")

    val passengerJson = JArray(passengers.map { passenger =>
      JObject(
        "nombre" -> JString(passenger.firstName),
        "apellido" -> JString(passenger.lastName),
        "tipo_documento" -> JString(passenger.documentType),
        "numero_documento" -> JString(passenger.documentNumber),
        "clase" -> JString(passenger.fareClass)
      )
    })
    val payload = compact(render(passengerJson))
    val connection = DriverManager.getConnection(jdbcUrl, dbUser, dbPassword)
    try {
      try {
        retryOnDeadlock()(executeCreateReservation(connection, userId, departureId, email, payload))
      } catch {
        case ex: SQLException
            if Option(ex.getSQLState).contains("45000") &&
              Option(ex.getMessage).exists(_.toLowerCase(java.util.Locale.ROOT).contains("disponibilidad")) =>
          retryOnDeadlock()(releaseExpiredReservations(connection))
          retryOnDeadlock()(executeCreateReservation(connection, userId, departureId, email, payload))
      }
    } finally connection.close()
  }

  /**
   * GET /passenger/search?origin=AEP&destination=COR&dateFrom=2026-10-10&dateTo=2026-10-12
   * Buscar salidas vendibles por código IATA, ciudad o nombre de aeropuerto y rango inclusivo de fechas.
   */
  get("/search") {
    val origin = params.getOrElse("origin", "").trim
    val destination = params.getOrElse("destination", "").trim
    val dateFromParam = params.getOrElse("dateFrom", "").trim
    val dateToParam = params.getOrElse("dateTo", dateFromParam).trim

    if (origin.isEmpty || destination.isEmpty || dateFromParam.isEmpty) {
      BadRequest(Map("error" -> "Origen, destino y fecha de salida son obligatorios"))
    } else if (origin.equalsIgnoreCase(destination)) {
      BadRequest(Map("error" -> "El origen y el destino deben ser distintos"))
    } else {
      val parsedDates = for {
        dateFrom <- Try(LocalDate.parse(dateFromParam)).toOption
        dateTo <- Try(LocalDate.parse(dateToParam)).toOption
      } yield (dateFrom, dateTo)

      parsedDates match {
        case None => BadRequest(Map("error" -> "Las fechas deben tener el formato AAAA-MM-DD"))
        case Some((dateFrom, dateTo)) if dateTo.isBefore(dateFrom) =>
          BadRequest(Map("error" -> "La fecha final debe ser igual o posterior a la inicial"))
        case Some((dateFrom, dateTo)) if dateFrom.isBefore(LocalDate.now(ZoneId.of("America/Argentina/Buenos_Aires"))) =>
          BadRequest(Map("error" -> "La fecha de salida no puede ser anterior a hoy"))
        case Some((dateFrom, dateTo)) =>
          val jdbcUrl = sys.env.getOrElse("AERONET_JDBC_URL", "")
          val dbUser = sys.env.getOrElse("AERONET_DB_USER", "")
          val dbPassword = sys.env.getOrElse("AERONET_DB_PASSWORD", "")

          if (jdbcUrl.isEmpty || dbUser.isEmpty) {
            logger.error("Passenger search database configuration is missing")
            ServiceUnavailable(Map("error" -> "El servicio de búsqueda no está configurado"))
          } else {
            val sql =
              """SELECT salida_id, vuelo_id, codigo_vuelo, origen, ciudad_origen,
                |       destino, ciudad_destino, fecha, hora_partida, hora_llegada,
                |       dias_desfase_llegada, clase, precio, asientos_disponibles
                |FROM v_disponibilidad
                |WHERE (UPPER(origen) = UPPER(?)
                |       OR origen IN (SELECT codigo_iata FROM aeropuerto
                |                      WHERE ciudad LIKE ? ESCAPE '!' OR nombre LIKE ? ESCAPE '!'))
                |  AND (UPPER(destino) = UPPER(?)
                |       OR destino IN (SELECT codigo_iata FROM aeropuerto
                |                       WHERE ciudad LIKE ? ESCAPE '!' OR nombre LIKE ? ESCAPE '!'))
                |  AND fecha BETWEEN ? AND ?
                |  AND asientos_disponibles > 0
                |ORDER BY fecha, hora_partida, codigo_vuelo, clase""".stripMargin

            try {
              val connection = DriverManager.getConnection(jdbcUrl, dbUser, dbPassword)
              try {
                releaseExpiredReservations(connection)
                val statement = connection.prepareStatement(sql)
                try {
                  statement.setString(1, origin)
                  statement.setString(2, placePattern(origin))
                  statement.setString(3, placePattern(origin))
                  statement.setString(4, destination)
                  statement.setString(5, placePattern(destination))
                  statement.setString(6, placePattern(destination))
                  statement.setDate(7, java.sql.Date.valueOf(dateFrom))
                  statement.setDate(8, java.sql.Date.valueOf(dateTo))
                  val resultSet = statement.executeQuery()
                  val results = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
                  try {
                    while (resultSet.next()) {
                      results += Map(
                        "departureId" -> resultSet.getLong("salida_id"),
                        "flightId" -> resultSet.getLong("vuelo_id"),
                        "flightCode" -> resultSet.getString("codigo_vuelo"),
                        "originCode" -> resultSet.getString("origen"),
                        "originCity" -> resultSet.getString("ciudad_origen"),
                        "destinationCode" -> resultSet.getString("destino"),
                        "destinationCity" -> resultSet.getString("ciudad_destino"),
                        "date" -> resultSet.getString("fecha"),
                        "departureTime" -> resultSet.getString("hora_partida"),
                        "arrivalTime" -> resultSet.getString("hora_llegada"),
                        "arrivalDayOffset" -> resultSet.getInt("dias_desfase_llegada"),
                        "class" -> resultSet.getString("clase"),
                        "price" -> resultSet.getBigDecimal("precio"),
                        "seatsAvailable" -> resultSet.getInt("asientos_disponibles")
                      )
                    }
                  } finally resultSet.close()

                  Ok(Map(
                    "dateFrom" -> dateFrom.toString,
                    "dateTo" -> dateTo.toString,
                    "results" -> results.toList
                  ))
                } finally statement.close()
              } finally connection.close()
            } catch {
              case ex: Exception =>
                logger.error("Error searching available departures", ex)
                InternalServerError(Map("error" -> "Error al buscar opciones de viaje"))
            }
          }
      }
    }
  }

  /**
   * GET /passenger/reservations
   * Ver mis reservas (requiere auth)
   */
  get("/reservations") {
    try {
      val userId = getUserIdFromRequest(request)
      
      if (!hasPermission(request, Permissions.RESERVATION_VIEW_OWN)) {
        logAccessDenied(userId, "view_own_reservations", s"Missing permission: ${Permissions.RESERVATION_VIEW_OWN}")
        Forbidden(Map("error" -> "No tienes permiso para ver tus reservas"))
      } else {
        Ok(Map("reservations" -> PassengerDocumentService.listForPassenger(userId.toLong)))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching passenger reservations", ex)
        InternalServerError(Map("error" -> "Error al obtener reservas"))
    }
  }

  /**
   * POST /passenger/reservations
   * Crear nueva reserva
   */
  post("/reservations") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_CREATE)) {
      logAccessDenied(userId, "create_reservation", s"Missing permission: ${Permissions.RESERVATION_CREATE}")
      Forbidden(Map("error" -> "No tienes permiso para crear reservas"))
    } else {
      reservationRequest(parsedBody) match {
        case Left(error) => BadRequest(Map("error" -> error))
        case Right((departureId, email, passengers)) =>
          try {
            val reservation = callCreateReservation(userId, departureId, email, passengers)
            Created(Map("message" -> "Compra registrada pendiente de pago", "reservation" -> reservation))
          } catch {
            case ex: SQLException if Option(ex.getSQLState).contains("45000") =>
              val rawMessage = Option(ex.getMessage).getOrElse("No se pudo completar la compra")
              val message = rawMessage.replaceFirst("^\\(conn=\\d+\\)\\s*", "")
              val status = if (message.toLowerCase(java.util.Locale.ROOT).contains("disponibilidad") ||
                message.toLowerCase(java.util.Locale.ROOT).contains("no está disponible")) 409 else 422
              halt(status, Map("error" -> message))
            case ex: IllegalStateException =>
              logger.error("Reservation database configuration is missing", ex)
              ServiceUnavailable(Map("error" -> "El servicio de compras no está configurado"))
            case ex: Exception =>
              logger.error("Error creating reservation", ex)
              InternalServerError(Map("error" -> "No se pudo registrar la compra"))
          }
      }
    }
  }

  private def streamPrivatePdf(path: java.nio.file.Path, filename: String): Unit = {
    response.setStatus(200)
    response.setContentType("application/pdf")
    response.setHeader("Content-Disposition", s"attachment; filename=\"$filename\"")
    response.setHeader("Cache-Control", "private, no-store")
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setContentLengthLong(Files.size(path))
    Files.copy(path, response.getOutputStream)
    response.flushBuffer()
  }

  get("/reservations/:purchaseId/documents/invoice") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_VIEW_OWN)) {
      logAccessDenied(userId, "download_own_invoice", s"Missing permission: ${Permissions.RESERVATION_VIEW_OWN}")
      Forbidden(Map("error" -> "No tienes permiso para descargar esta factura"))
    } else params.get("purchaseId").flatMap(_.toLongOption).filter(_ > 0) match {
      case Some(purchaseId) => PassengerDocumentService.invoiceForPassenger(userId.toLong, purchaseId) match {
        case Some(path) => streamPrivatePdf(path, s"factura-compra-$purchaseId.pdf")
        case None => NotFound(Map("error" -> "La factura no está disponible"))
      }
      case None => BadRequest(Map("error" -> "Identificador de compra inválido"))
    }
  }

  get("/reservations/:purchaseId/documents/tickets/:ticketId") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_VIEW_OWN)) {
      logAccessDenied(userId, "download_own_ticket", s"Missing permission: ${Permissions.RESERVATION_VIEW_OWN}")
      Forbidden(Map("error" -> "No tienes permiso para descargar este pasaje"))
    } else {
      val purchaseId = params.get("purchaseId").flatMap(_.toLongOption).filter(_ > 0)
      val ticketId = params.get("ticketId").flatMap(_.toLongOption).filter(_ > 0)
      (purchaseId, ticketId) match {
        case (Some(pId), Some(tId)) => PassengerDocumentService.ticketForPassenger(userId.toLong, pId, tId) match {
          case Some(path) => streamPrivatePdf(path, s"pasaje-$tId.pdf")
          case None => NotFound(Map("error" -> "El pasaje no está disponible"))
        }
        case _ => BadRequest(Map("error" -> "Identificador de compra o pasaje inválido"))
      }
    }
  }

  /**
   * GET /passenger/profile
   * Ver perfil propio
   */
  get("/profile") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.PROFILE_VIEW_OWN)) {
        logAccessDenied(userId, "view_own_profile", s"Missing permission: ${Permissions.PROFILE_VIEW_OWN}")
        Forbidden(Map("error" -> "No tienes permiso para ver tu perfil"))
      } else {
        UserRepository.profile(userId.toLong) match {
          case Some(profile) => Ok(Map("profile" -> profile))
          case None => NotFound(Map("error" -> "No existe el usuario"))
        }
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching passenger profile", ex)
        InternalServerError(Map("error" -> "Error al obtener perfil"))
    }
  }
}
