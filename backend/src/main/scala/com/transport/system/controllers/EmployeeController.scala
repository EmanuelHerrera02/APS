package com.transport.system.controllers

import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.{Roles, Permissions}
import com.transport.system.security.UserRepository
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

/**
 * Controlador para funcionalidades de Empleado de Mostrador
 */
class EmployeeController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  val logger = LoggerFactory.getLogger(getClass)

  /**
   * GET /employee/reservations
   * Ver todas las reservas (solo empleados)
   */
  get("/reservations") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.RESERVATION_VIEW_ALL)) {
        logAccessDenied(userId, "view_all_reservations", s"Missing permission: ${Permissions.RESERVATION_VIEW_ALL}")
        Forbidden(Map("error" -> "No tienes permiso para ver todas las reservas"))
      } else {
        logger.info(s"Employee $userId viewing all reservations")
        Ok(Map(
          "message" -> "Todas las reservas",
          "reservations" -> List()
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching all reservations", ex)
        InternalServerError(Map("error" -> "Error al obtener reservas"))
    }
  }

  /**
   * POST /employee/reservations/:id/confirm
   * Confirmar una reserva
   */
  post("/reservations/:id/confirm") {
    try {
      val userId = getUserIdFromRequest(request)
      val reservationId = params("id")

      if (!hasPermission(request, Permissions.RESERVATION_CONFIRM)) {
        logAccessDenied(userId, "confirm_reservation", s"Missing permission: ${Permissions.RESERVATION_CONFIRM}")
        Forbidden(Map("error" -> "No tienes permiso para confirmar reservas"))
      } else {
        logger.info(s"Employee $userId confirming reservation $reservationId")
        Ok(Map(
          "message" -> "Reserva confirmada",
          "reservationId" -> reservationId
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error confirming reservation", ex)
        BadRequest(Map("error" -> "Error al confirmar reserva"))
    }
  }

  /**
   * POST /employee/payments/process
   * Procesar pago
   */
  post("/payments/process") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.PAYMENT_PROCESS)) {
        logAccessDenied(userId, "process_payment", s"Missing permission: ${Permissions.PAYMENT_PROCESS}")
        Forbidden(Map("error" -> "No tienes permiso para procesar pagos"))
      } else {
        logger.info(s"Employee $userId processing payment")
        val body = parsedBody
        Ok(Map(
          "message" -> "Pago procesado",
          "paymentId" -> 1
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error processing payment", ex)
        BadRequest(Map("error" -> "Error al procesar pago"))
    }
  }

  /**
   * GET /employee/reports
   * Ver reportes operacionales
   */
  get("/reports") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.REPORT_VIEW_OPERATIONAL)) {
        logAccessDenied(userId, "view_operational_reports", s"Missing permission: ${Permissions.REPORT_VIEW_OPERATIONAL}")
        Forbidden(Map("error" -> "No tienes permiso para ver reportes"))
      } else {
        logger.info(s"Employee $userId viewing operational reports")
        Ok(Map("stats" -> UserRepository.employeeStats()))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching reports", ex)
        InternalServerError(Map("error" -> "Error al obtener reportes"))
    }
  }
}
