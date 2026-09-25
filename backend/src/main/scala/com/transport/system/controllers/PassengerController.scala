package com.transport.system.controllers

import com.transport.system.middleware.{AuthorizedAction, SecurityException}
import com.transport.system.models.{Roles, Permissions}
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

/**
 * Controlador para funcionalidades de Pasajero
 */
class PassengerController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  val logger = LoggerFactory.getLogger(getClass)

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
