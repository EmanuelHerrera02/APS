package com.transport.system.controllers

import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.{AdminCreateFlightRequest, AdminCreateUserRequest, AdminUserUpdateRequest, Roles, Permissions}
import com.transport.system.security.{FlightRepository, FlightWriteError, UserRepository, UserWriteError}
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

  /** GET /admin/airports — aeropuertos disponibles para el formulario de vuelos. */
  get("/airports") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.FLIGHT_CREATE)) {
      logAccessDenied(userId, "list_flight_airports", s"Missing permission: ${Permissions.FLIGHT_CREATE}")
      Forbidden(Map("error" -> "No tienes permiso para crear vuelos"))
    } else try Ok(Map("airports" -> FlightRepository.activeAirports()))
    catch {
      case ex: Exception =>
        logger.error("Error listing airports for flight creation", ex)
        InternalServerError(Map("error" -> "No se pudieron cargar los aeropuertos"))
    }
  }

  /** POST /admin/flights — crea el vuelo y materializa sus salidas de forma atómica. */
  post("/flights") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.FLIGHT_CREATE)) {
      logAccessDenied(userId, "create_flight", s"Missing permission: ${Permissions.FLIGHT_CREATE}")
      Forbidden(Map("error" -> "No tienes permiso para crear vuelos"))
    } else try {
      val input = parsedBody.extract[AdminCreateFlightRequest]
      FlightRepository.create(userId.toLong, input) match {
        case Right(flightId) => Created(Map("message" -> "Vuelo creado", "flightId" -> flightId))
        case Left(FlightWriteError.InvalidData) => BadRequest(Map("error" -> "Revisa los datos del vuelo"))
        case Left(FlightWriteError.CodeAlreadyExists) => Conflict(Map("error" -> "Ya existe un vuelo con ese código"))
        case Left(FlightWriteError.InvalidAirport) => BadRequest(Map("error" -> "El aeropuerto indicado no existe o no está disponible"))
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "El cuerpo de la solicitud no es válido"))
      case ex: Exception =>
        logger.error("Error creating flight", ex)
        InternalServerError(Map("error" -> "No se pudo crear el vuelo"))
    }
  }

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
          "stats" -> UserRepository.adminStats()
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
        Ok(Map("message" -> "Usuarios del sistema", "users" -> UserRepository.listUsers()))
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
        val input = parsedBody.extract[AdminCreateUserRequest]
        if (input.role != Roles.PASSENGER && !hasPermission(request, Permissions.USER_CHANGE_ROLE)) {
          logAccessDenied(userId, "create_user_with_internal_role", s"Missing permission: ${Permissions.USER_CHANGE_ROLE}")
          Forbidden(Map("error" -> "No tienes permiso para asignar roles internos"))
        } else {
          UserRepository.createByAdministrator(userId.toLong, input.email, input.password, input.firstName, input.lastName,
            input.phone, input.role) match {
            case Right(createdUserId) =>
              logger.info(s"Admin $userId created user $createdUserId")
              Created(Map("message" -> "Usuario creado exitosamente", "userId" -> createdUserId))
            case Left(UserWriteError.InvalidData) => BadRequest(Map("error" -> "Los datos del usuario no son válidos"))
            case Left(UserWriteError.EmailAlreadyExists) => Conflict(Map("error" -> "Ya existe una cuenta con ese email"))
            case Left(UserWriteError.InvalidRole) => BadRequest(Map("error" -> "El rol indicado no es válido"))
          }
        }
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "El cuerpo de la solicitud no es válido"))
      case ex: Exception =>
        logger.error("Error creating user", ex)
        InternalServerError(Map("error" -> "Error al crear usuario"))
    }
  }

  /**
   * PUT /admin/users/:id
   * Editar usuario
   */
  put("/users/:id") {
    try {
      val userId = getUserIdFromRequest(request)
      val targetUserId = params("id").toLong

      if (!hasPermission(request, Permissions.USER_EDIT)) {
        logAccessDenied(userId, s"edit_user_$targetUserId", s"Missing permission: ${Permissions.USER_EDIT}")
        Forbidden(Map("error" -> "No tienes permiso para editar usuarios"))
      } else {
        val input = parsedBody.extract[AdminUserUpdateRequest]
        if (input.role.isDefined && !hasPermission(request, Permissions.USER_CHANGE_ROLE)) {
          logAccessDenied(userId, s"change_role_$targetUserId", s"Missing permission: ${Permissions.USER_CHANGE_ROLE}")
          Forbidden(Map("error" -> "No tienes permiso para cambiar roles"))
        } else if (targetUserId == userId && (input.active.contains(false) || input.role.exists(role => !role.equalsIgnoreCase(Roles.ADMIN)))) {
          BadRequest(Map("error" -> "No podés desactivar tu cuenta ni quitarte el rol de administrador"))
        } else if (UserRepository.updateUser(userId.toLong, targetUserId, input.firstName, input.lastName, input.phone,
          input.active, input.role)) {
          Ok(Map("message" -> "Usuario actualizado", "userId" -> targetUserId))
        } else NotFound(Map("error" -> "No existe el usuario indicado"))
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "El cuerpo de la solicitud no es válido"))
      case _: NumberFormatException => BadRequest(Map("error" -> "El id de usuario no es válido"))
      case ex: IllegalArgumentException => BadRequest(Map("error" -> ex.getMessage))
      case ex: Exception =>
        logger.error("Error editing user", ex)
        InternalServerError(Map("error" -> "Error al editar usuario"))
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
        Ok(Map("reports" -> UserRepository.financialReports()))
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
        Ok(Map("logs" -> UserRepository.auditEntries()))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching audit logs", ex)
        InternalServerError(Map("error" -> "Error al obtener auditoría"))
    }
  }
}
