package com.transport.system.controllers

import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.{AdminCreateFlightRequest, AdminCreateUserRequest, AdminUserUpdateRequest, Roles, Permissions}
import com.transport.system.security.{FlightRepository, FlightWriteError, OccupancyReportRepository, UserRepository, UserWriteError}
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory
import java.time.LocalDate
import scala.util.Try

/**
 * Controlador para funcionalidades de Administrador
 */
class AdminController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  val logger = LoggerFactory.getLogger(getClass)

  private def occupancyFilters(): Either[String, (Option[String], Option[String], LocalDate, LocalDate)] = {
    val from = params.get("dateFrom").flatMap(value => Try(LocalDate.parse(value)).toOption)
      .toRight("dateFrom es obligatorio y debe tener formato AAAA-MM-DD")
    val to = params.get("dateTo").flatMap(value => Try(LocalDate.parse(value)).toOption)
      .toRight("dateTo es obligatorio y debe tener formato AAAA-MM-DD")
    val flight = params.get("flightCode").map(_.trim.toUpperCase(java.util.Locale.ROOT)).filter(_.nonEmpty)
    val fare = params.get("class").map(_.trim.toUpperCase(java.util.Locale.ROOT)).filter(_.nonEmpty)
    for {
      start <- from
      end <- to
      _ <- Either.cond(!end.isBefore(start), (), "dateTo debe ser igual o posterior a dateFrom")
      _ <- Either.cond(flight.forall(_.matches("^[A-Z0-9]{2}[0-9]{1,4}$")), (), "flightCode no tiene un formato válido")
      _ <- Either.cond(fare.forall(Set("ECONOMY", "PRIMERA")), (), "class debe ser ECONOMY o PRIMERA")
    } yield (flight, fare, start, end)
  }

  private def csvCell(value: Any): String = s"\"${Option(value).map(_.toString).getOrElse("").replace("\"", "\"\"")}\""

  private def occupancyCsv(rows: List[Map[String, Any]]): String = {
    val header = List("Vuelo", "Origen", "Destino", "Salida ID", "Fecha", "Estado", "Clase", "Capacidad",
      "Pasajes vendidos", "Reservas pendientes", "Asientos disponibles", "Ocupación (%)", "Recaudado")
    val body = rows.map { row =>
      List("flightCode", "origin", "destination", "departureId", "date", "departureStatus", "class", "capacity",
        "sold", "reserved", "available", "occupancyPercent", "revenue").map(key => csvCell(row.getOrElse(key, ""))).mkString(",")
    }
    "\uFEFF" + (header.map(csvCell).mkString(",") :: body).mkString("\r\n")
  }

  private def streamCsv(content: String): Unit = {
    val bytes = content.getBytes(java.nio.charset.StandardCharsets.UTF_8)
    response.setStatus(200)
    response.setContentType("text/csv; charset=utf-8")
    response.setHeader("Content-Disposition", "attachment; filename=ocupacion.csv")
    response.setHeader("Cache-Control", "private, no-store")
    response.setContentLength(bytes.length)
    response.getOutputStream.write(bytes)
    response.flushBuffer()
  }

  private def adminOccupancyAccess(userId: Int): Boolean =
    hasRole(request, Roles.ADMIN) && hasPermission(request, Permissions.REPORT_VIEW_FINANCIAL)

  /** GET /admin/occupancy — ocupación por vuelo, clase y fechas. */
  get("/occupancy") {
    val userId = getUserIdFromRequest(request)
    if (!adminOccupancyAccess(userId)) {
      logAccessDenied(userId, "view_occupancy_report", "Requires ADMIN role and report:view_financial")
      Forbidden(Map("error" -> "Solo administradores pueden consultar la ocupación"))
    } else occupancyFilters() match {
      case Left(error) => BadRequest(Map("error" -> error))
      case Right((flight, fare, from, to)) => try {
        Ok(Map("rows" -> OccupancyReportRepository.query(flight, fare, from, to),
          "filters" -> Map("flightCode" -> flight.orNull, "class" -> fare.orNull,
            "dateFrom" -> from.toString, "dateTo" -> to.toString)))
      } catch {
        case ex: IllegalStateException =>
          logger.error("Occupancy report database configuration is missing", ex)
          ServiceUnavailable(Map("error" -> "El servicio de reportes no está configurado"))
        case ex: Exception =>
          logger.error(s"Occupancy report failed for admin=$userId", ex)
          InternalServerError(Map("error" -> "No se pudo generar el reporte de ocupación"))
      }
    }
  }

  /** GET /admin/occupancy.csv — descarga CSV con los mismos filtros que la consulta. */
  get("/occupancy.csv") {
    val userId = getUserIdFromRequest(request)
    if (!adminOccupancyAccess(userId)) {
      logAccessDenied(userId, "export_occupancy_report", "Requires ADMIN role and report:view_financial")
      Forbidden(Map("error" -> "Solo administradores pueden exportar la ocupación"))
    } else occupancyFilters() match {
      case Left(error) => BadRequest(Map("error" -> error))
      case Right((flight, fare, from, to)) => try {
        val rows = OccupancyReportRepository.query(flight, fare, from, to)
        streamCsv(occupancyCsv(rows))
      } catch {
        case ex: IllegalStateException =>
          logger.error("Occupancy CSV database configuration is missing", ex)
          ServiceUnavailable(Map("error" -> "El servicio de reportes no está configurado"))
        case ex: Exception =>
          logger.error(s"Occupancy CSV failed for admin=$userId", ex)
          InternalServerError(Map("error" -> "No se pudo exportar el reporte de ocupación"))
      }
    }
  }

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
      val input = AdminCreateFlightRequest.fromJson(parsedBody)
      FlightRepository.create(userId.toLong, input) match {
        case Right(flightId) => Created(Map("message" -> "Vuelo creado", "flightId" -> flightId))
        case Left(FlightWriteError.InvalidData(message)) => BadRequest(Map("error" -> message))
        case Left(FlightWriteError.CodeAlreadyExists) => Conflict(Map("error" -> "Ya existe un vuelo con ese código"))
        case Left(FlightWriteError.InvalidAirport) => BadRequest(Map("error" -> "El aeropuerto indicado no existe o no está disponible"))
        case Left(_) => InternalServerError(Map("error" -> "No se pudo crear el vuelo"))
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "El cuerpo de la solicitud no es válido"))
      case ex: Exception =>
        logger.error("Error creating flight", ex)
        InternalServerError(Map("error" -> "No se pudo crear el vuelo"))
    }
  }

  /** GET /admin/flights — vuelos y configuración editable para administración. */
  get("/flights") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.FLIGHT_EDIT)) {
      logAccessDenied(userId, "list_flights", s"Missing permission: ${Permissions.FLIGHT_EDIT}")
      Forbidden(Map("error" -> "No tienes permiso para administrar vuelos"))
    } else try Ok(Map("flights" -> FlightRepository.listForAdministration()))
    catch {
      case ex: Exception =>
        logger.error("Error listing flights for administration", ex)
        InternalServerError(Map("error" -> "No se pudieron cargar los vuelos"))
    }
  }

  /** GET /admin/flights/:id — configuración de un vuelo para edición. */
  get("/flights/:id") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.FLIGHT_EDIT)) {
      logAccessDenied(userId, "view_flight", s"Missing permission: ${Permissions.FLIGHT_EDIT}")
      Forbidden(Map("error" -> "No tienes permiso para administrar vuelos"))
    } else params("id").toLongOption.filter(_ > 0) match {
      case None => BadRequest(Map("error" -> "El id del vuelo no es válido"))
      case Some(id) => FlightRepository.getForAdministration(id) match {
        case Some(flight) => Ok(Map("flight" -> flight))
        case None => NotFound(Map("error" -> "No existe el vuelo indicado"))
      }
    }
  }

  /** PUT /admin/flights/:id — actualiza horarios, calendario, capacidad y precios. */
  put("/flights/:id") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.FLIGHT_EDIT)) {
      logAccessDenied(userId, "update_flight", s"Missing permission: ${Permissions.FLIGHT_EDIT}")
      Forbidden(Map("error" -> "No tienes permiso para administrar vuelos"))
    } else params("id").toLongOption.filter(_ > 0) match {
      case None => BadRequest(Map("error" -> "El id del vuelo no es válido"))
      case Some(id) => try {
        val input = AdminCreateFlightRequest.fromJson(parsedBody)
        FlightRepository.update(userId.toLong, id, input) match {
          case Right(_) => Ok(Map("message" -> "Vuelo actualizado", "flightId" -> id))
          case Left(FlightWriteError.NotFound) => NotFound(Map("error" -> "No existe el vuelo indicado"))
          case Left(FlightWriteError.AlreadyCancelled) => Conflict(Map("error" -> "El vuelo ya está cancelado"))
          case Left(FlightWriteError.InvalidAirport) => BadRequest(Map("error" -> "El aeropuerto no está disponible"))
          case Left(FlightWriteError.CodeAlreadyExists) => Conflict(Map("error" -> "Ya existe un vuelo con ese código"))
          case Left(FlightWriteError.InvalidData(message)) => Conflict(Map("error" -> message))
        }
      } catch {
        case _: MappingException => BadRequest(Map("error" -> "El cuerpo de la solicitud no es válido"))
        case ex: Exception =>
          logger.error(s"Error updating flight $id", ex)
          InternalServerError(Map("error" -> "No se pudo actualizar el vuelo"))
      }
    }
  }

  /** POST /admin/flights/:id/cancel — cancela todas las salidas futuras del vuelo. */
  post("/flights/:id/cancel") {
    cancelFlight(departureId = None)
  }

  /** POST /admin/flights/:id/departures/:departureId/cancel — cancelación puntual. */
  post("/flights/:id/departures/:departureId/cancel") {
    params("departureId").toLongOption.filter(_ > 0) match {
      case None => BadRequest(Map("error" -> "El id de la salida no es válido"))
      case Some(departureId) => cancelFlight(Some(departureId))
    }
  }

  private def cancelFlight(departureId: Option[Long]): ActionResult = {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.FLIGHT_EDIT)) {
      logAccessDenied(userId, "cancel_flight", s"Missing permission: ${Permissions.FLIGHT_EDIT}")
      Forbidden(Map("error" -> "No tienes permiso para administrar vuelos"))
    } else params("id").toLongOption.filter(_ > 0) match {
      case None => BadRequest(Map("error" -> "El id del vuelo no es válido"))
      case Some(flightId) =>
        val reason = parsedBody \ "reason" match {
          case JString(value) => value
          case _ => ""
        }
        FlightRepository.cancel(userId.toLong, flightId, departureId, reason) match {
          case Right(_) => Ok(Map("message" -> "Cancelación registrada", "flightId" -> flightId))
          case Left(FlightWriteError.NotFound) => NotFound(Map("error" -> "No existe el vuelo indicado"))
          case Left(FlightWriteError.AlreadyCancelled) => Conflict(Map("error" -> "El vuelo ya está cancelado"))
          case Left(FlightWriteError.InvalidData(message)) => Conflict(Map("error" -> message))
          case Left(_) => Conflict(Map("error" -> "No se pudo cancelar el vuelo"))
        }
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
        val input = AdminUserUpdateRequest.fromJson(parsedBody)
        if (input.role.isDefined && !hasPermission(request, Permissions.USER_CHANGE_ROLE)) {
          logAccessDenied(userId, s"change_role_$targetUserId", s"Missing permission: ${Permissions.USER_CHANGE_ROLE}")
          Forbidden(Map("error" -> "No tienes permiso para cambiar roles"))
        } else if (targetUserId == userId && (input.active.contains(false) || input.role.exists(role => !role.equalsIgnoreCase(Roles.ADMIN)))) {
          BadRequest(Map("error" -> "No podés desactivar tu cuenta ni quitarte el rol de administrador"))
        } else if (UserRepository.updateUser(userId.toLong, targetUserId, input.email, input.password, input.firstName,
          input.lastName, input.phone, input.active, input.role)) {
          Ok(Map("message" -> "Usuario actualizado", "userId" -> targetUserId))
        } else NotFound(Map("error" -> "No existe el usuario indicado"))
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "El cuerpo de la solicitud no es válido"))
      case _: NumberFormatException => BadRequest(Map("error" -> "El id de usuario no es válido"))
      case ex: IllegalArgumentException if ex.getMessage == "Ya existe una cuenta con ese email" =>
        Conflict(Map("error" -> ex.getMessage))
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
