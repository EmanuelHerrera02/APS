package com.transport.system.controllers

import com.transport.system.middleware.{AuthorizedAction, SecurityException}
import com.transport.system.models.{Roles, Permissions}
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory
import java.sql.DriverManager
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
   * GET /passenger/search?origin=AEP&destination=COR&dateFrom=2026-10-10&dateTo=2026-10-12
   * Buscar salidas vendibles por ciudad/código IATA y rango inclusivo de fechas.
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
                |WHERE (UPPER(origen) = UPPER(?) OR UPPER(ciudad_origen) = UPPER(?))
                |  AND (UPPER(destino) = UPPER(?) OR UPPER(ciudad_destino) = UPPER(?))
                |  AND fecha BETWEEN ? AND ?
                |  AND asientos_disponibles > 0
                |ORDER BY fecha, hora_partida, codigo_vuelo, clase""".stripMargin

            try {
              val connection = DriverManager.getConnection(jdbcUrl, dbUser, dbPassword)
              try {
                val statement = connection.prepareStatement(sql)
                try {
                  statement.setString(1, origin)
                  statement.setString(2, origin)
                  statement.setString(3, destination)
                  statement.setString(4, destination)
                  statement.setDate(5, java.sql.Date.valueOf(dateFrom))
                  statement.setDate(6, java.sql.Date.valueOf(dateTo))
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
      
      if (!hasPermission(request, Permissions.VIEW_HISTORY)) {
        logAccessDenied(userId, "view_own_reservations", s"Missing permission: ${Permissions.VIEW_HISTORY}")
        Forbidden(Map("error" -> "No tienes permiso para ver tus reservas"))
      } else {
        logger.info(s"User $userId viewing their reservations")
        Ok(Map(
          "message" -> "Reservas del usuario",
          "userId" -> userId,
          "reservations" -> List() // Placeholder
        ))
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
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.BOOK_TICKETS)) {
        logAccessDenied(userId, "create_reservation", s"Missing permission: ${Permissions.BOOK_TICKETS}")
        Forbidden(Map("error" -> "No tienes permiso para crear reservas"))
      } else {
        logger.info(s"User $userId creating new reservation")
        val body = parsedBody
        Ok(Map(
          "message" -> "Reserva creada exitosamente",
          "reservationId" -> 1 // Placeholder
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error creating reservation", ex)
        BadRequest(Map("error" -> "Error al crear reserva"))
    }
  }

  /**
   * GET /passenger/profile
   * Ver perfil propio
   */
  get("/profile") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.UPDATE_PROFILE)) {
        logAccessDenied(userId, "view_own_profile", s"Missing permission: ${Permissions.UPDATE_PROFILE}")
        Forbidden(Map("error" -> "No tienes permiso para ver tu perfil"))
      } else {
        logger.info(s"User $userId viewing their profile")
        Ok(Map(
          "message" -> "Perfil del usuario",
          "userId" -> userId
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching passenger profile", ex)
        InternalServerError(Map("error" -> "Error al obtener perfil"))
    }
  }
}
