package com.transport.system.controllers

import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.{Roles, Permissions}
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

/**
 * Controlador para funcionalidades de Administrador
 */
class AdminController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  val logger = LoggerFactory.getLogger(getClass)

  /**
   * GET /admin/dashboard
   * Dashboard administrativo
   */
  get("/dashboard") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasRole(request, Roles.ADMIN) || !hasPermission(request, Permissions.ADMIN_PANEL_ACCESS)) {
        logAccessDenied(userId, "admin_panel_access", "Missing role or permission: ADMIN / admin:panel_access")
        Forbidden(Map("error" -> "No tienes acceso al panel de administración"))
      } else {
        logger.info(s"Admin $userId accessing admin dashboard")
        Ok(Map(
          "message" -> "Panel de Administración",
          "userId" -> userId,
          "stats" -> Map(
            "totalUsers" -> 0,
            "totalReservations" -> 0,
            "totalRevenue" -> 0
          )
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error accessing admin dashboard", ex)
        InternalServerError(Map("error" -> "Error al acceder al panel"))
    }
  }

  /**
   * GET /admin/users
   * Listar todos los usuarios
   */
  get("/users") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.USER_LIST)) {
        logAccessDenied(userId, "list_users", s"Missing permission: ${Permissions.USER_LIST}")
        Forbidden(Map("error" -> "No tienes permiso para listar usuarios"))
      } else {
        logger.info(s"Admin $userId listing users")
        Ok(Map(
          "message" -> "Usuarios del sistema",
          "users" -> List()
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error listing users", ex)
        InternalServerError(Map("error" -> "Error al listar usuarios"))
    }
  }

  /**
   * POST /admin/users
   * Crear nuevo usuario
   */
  post("/users") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.USER_CREATE)) {
        logAccessDenied(userId, "create_user", s"Missing permission: ${Permissions.USER_CREATE}")
        Forbidden(Map("error" -> "No tienes permiso para crear usuarios"))
      } else {
        logger.info(s"Admin $userId creating new user")
        val body = parsedBody
        Ok(Map(
          "message" -> "Usuario creado exitosamente",
          "userId" -> 1
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error creating user", ex)
        BadRequest(Map("error" -> "Error al crear usuario"))
    }
  }

  /**
   * PUT /admin/users/:id
   * Editar usuario
   */
  put("/users/:id") {
    try {
      val userId = getUserIdFromRequest(request)
      val targetUserId = params("id")

      if (!hasPermission(request, Permissions.USER_EDIT)) {
        logAccessDenied(userId, s"edit_user_$targetUserId", s"Missing permission: ${Permissions.USER_EDIT}")
        Forbidden(Map("error" -> "No tienes permiso para editar usuarios"))
      } else {
        logger.info(s"Admin $userId editing user $targetUserId")
        Ok(Map(
          "message" -> "Usuario actualizado",
          "userId" -> targetUserId
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error editing user", ex)
        BadRequest(Map("error" -> "Error al editar usuario"))
    }
  }

  /**
   * GET /admin/reports
   * Ver reportes financieros
   */
  get("/reports") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.REPORT_VIEW_FINANCIAL)) {
        logAccessDenied(userId, "view_financial_reports", s"Missing permission: ${Permissions.REPORT_VIEW_FINANCIAL}")
        Forbidden(Map("error" -> "No tienes permiso para ver reportes financieros"))
      } else {
        logger.info(s"Admin $userId viewing financial reports")
        Ok(Map(
          "message" -> "Reportes Financieros",
          "reports" -> List()
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching reports", ex)
        InternalServerError(Map("error" -> "Error al obtener reportes"))
    }
  }

  /**
   * GET /admin/audit
   * Ver auditoría del sistema
   */
  get("/audit") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.ADMIN_VIEW_AUDIT)) {
        logAccessDenied(userId, "view_audit", s"Missing permission: ${Permissions.ADMIN_VIEW_AUDIT}")
        Forbidden(Map("error" -> "No tienes permiso para ver la auditoría"))
      } else {
        logger.info(s"Admin $userId viewing audit logs")
        Ok(Map(
          "message" -> "Auditoría del Sistema",
          "logs" -> List()
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching audit logs", ex)
        InternalServerError(Map("error" -> "Error al obtener auditoría"))
    }
  }
}
