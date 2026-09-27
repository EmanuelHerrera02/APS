package com.transport.system.controllers

import com.transport.system.db.ErroDeBase
import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.{Permissions, Roles, Vuelo}
import com.transport.system.services.{AeropuertoService, VueloService}
import org.json4s._
import org.json4s.JsonDSL._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

import javax.servlet.http.HttpServletRequest
import scala.util.Try

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

      if (!hasRole(request, Roles.ADMIN)) {
        logAccessDenied(userId, "admin_panel_access", "Missing role: admin")
        Forbidden(JObject("error" -> JString("No tienes acceso al panel de administración")))
      } else {
        logger.info(s"Admin $userId accessing admin dashboard")
        Ok(JObject(
          "message" -> JString("Panel de Administración"),
          "userId" -> userId.fold(JNull: JValue)(i => JInt(i)),
          "stats" -> JObject(
            "totalUsers" -> JInt(0),
            "totalReservations" -> JInt(0),
            "totalRevenue" -> JInt(0)
          )
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error accessing admin dashboard", ex)
        InternalServerError(JObject("error" -> JString("Error al acceder al panel")))
    }
  }

  /**
   * GET /admin/users
   * Listar todos los usuarios
   */
  get("/users") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.MANAGE_USERS)) {
        logAccessDenied(userId, "list_users", s"Missing permission: ${Permissions.MANAGE_USERS}")
        Forbidden(JObject("error" -> JString("No tienes permiso para listar usuarios")))
      } else {
        logger.info(s"Admin $userId listing users")
        Ok(JObject(
          "message" -> JString("Usuarios del sistema"),
          "users" -> JArray(List.empty[JValue])
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error listing users", ex)
        InternalServerError(JObject("error" -> JString("Error al listar usuarios")))
    }
  }

  /**
   * POST /admin/users
   * Crear nuevo usuario
   */
  post("/users") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.MANAGE_USERS)) {
        logAccessDenied(userId, "create_user", s"Missing permission: ${Permissions.MANAGE_USERS}")
        Forbidden(JObject("error" -> JString("No tienes permiso para crear usuarios")))
      } else {
        logger.info(s"Admin $userId creating new user")
        val body = parsedBody
        Ok(JObject(
          "message" -> JString("Usuario creado exitosamente"),
          "userId" -> JInt(1)
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error creating user", ex)
        BadRequest(JObject("error" -> JString("Error al crear usuario")))
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

      if (!hasPermission(request, Permissions.MANAGE_USERS)) {
        logAccessDenied(userId, s"edit_user_$targetUserId", s"Missing permission: ${Permissions.MANAGE_USERS}")
        Forbidden(JObject("error" -> JString("No tienes permiso para editar usuarios")))
      } else {
        logger.info(s"Admin $userId editing user $targetUserId")
        Ok(JObject(
          "message" -> JString("Usuario actualizado"),
          "userId" -> JString(targetUserId)
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error editing user", ex)
        BadRequest(JObject("error" -> JString("Error al editar usuario")))
    }
  }

  /**
   * GET /admin/reports
   * Ver reportes financieros
   */
  get("/reports") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.VIEW_REPORTS)) {
        logAccessDenied(userId, "view_financial_reports", s"Missing permission: ${Permissions.VIEW_REPORTS}")
        Forbidden(JObject("error" -> JString("No tienes permiso para ver reportes financieros")))
      } else {
        logger.info(s"Admin $userId viewing financial reports")
        Ok(JObject(
          "message" -> JString("Reportes Financieros"),
          "reports" -> JArray(List.empty[JValue])
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching reports", ex)
        InternalServerError(JObject("error" -> JString("Error al obtener reportes")))
    }
  }

  /**
   * GET /admin/audit
   * Ver auditoría del sistema
   */
  get("/audit") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.MANAGE_SYSTEM)) {
        logAccessDenied(userId, "view_audit", s"Missing permission: ${Permissions.MANAGE_SYSTEM}")
        Forbidden(JObject("error" -> JString("No tienes permiso para ver la auditoría")))
      } else {
        logger.info(s"Admin $userId viewing audit logs")
        Ok(JObject(
          "message" -> JString("Auditoría del Sistema"),
          "logs" -> JArray(List.empty[JValue])
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching audit logs", ex)
        InternalServerError(JObject("error" -> JString("Error al obtener auditoría")))
    }
  }

  // ---------------------------------------------------------------------------
  // Alta de vuelo
  //
  // A diferencia de los endpoints de arriba, que son stubs, estos no envuelven
  // todo en un catch genérico: un ErroDeBase trae el status y el campo que hay
  // que señalar, y un catch que loiban a BadRequest perdería esa información
  // justo cuando el formulario la necesita. Por eso se dejan pasar.
  // ---------------------------------------------------------------------------

  /**
   * GET /admin/aeropuertos
   * Aeropuertos para el selector del formulario de alta.
   */
  get("/aeropuertos") {
    val userId = autenticadoOrNull(request)
    if (!esAdmin(request)) {
      logAccessDenied(userId, "list_airports", s"Missing role: ${Roles.ADMIN}")
      responder(403, JObject("error" -> JString("No tienes permiso para ver los aeropuertos")))
    } else {
      val aero = AeropuertoService.listar()
      Ok(
        JObject(
          "aeropuertos" -> JArray(aero.map { a =>
            JObject(
              "id" -> a.id,
              "codigoIata" -> a.codigoIata,
              "nombre" -> a.nombre,
              "ciudad" -> a.ciudad,
              "provincia" -> a.provincia,
              "activo" -> a.activo
            ): JValue
          })
        )
      )
    }
  }

  /**
   * POST /admin/vuelos
   * Crea un vuelo y materializa sus salidas.
   */
  post("/vuelos") {
    val userId = autenticadoOrNull(request)
    if (!esAdmin(request)) {
      logAccessDenied(userId, "create_flight", s"Missing role: ${Roles.ADMIN}")
      responder(403, JObject("error" -> JString("No tienes permiso para crear vuelos")))
    } else {
      val adminId = userId.getOrElse(
        throw ErroDeBase(http = 401, mensaje = "Falta un token válido")
      )
      // El cuerpo mal formado se traduce a 422 con el campo; un JSON inválido
      // entero es un error del cliente, no un 500.
      val cuerpo = parsearCuerpo()
      val alta = ParseoAlta.parsear(cuerpo)
      val creado = VueloService.crear(alta, adminId)
      logger.info(s"Admin $adminId creó el vuelo ${creado.codigo} (${creado.vueloId})")
      ActionResult(
        201,
        JObject(
          "id" -> creado.vueloId,
          "codigo" -> creado.codigo,
          "salidasGeneradas" -> creado.salidasGeneradas,
          "salidaClasesGeneradas" -> creado.salidaClasesGeneradas
        ),
        Map("Location" -> s"/admin/vuelos/${creado.vueloId}")
      )
    }
  }

  /**
   * GET /admin/vuelos/:id
   * Detalle de un vuelo, con sus días y sus clases.
   */
  get("/vuelos/:id") {
    val userId = autenticadoOrNull(request)
    if (!esAdmin(request)) {
      logAccessDenied(userId, "view_flight", s"Missing role: ${Roles.ADMIN}")
      responder(403, JObject("error" -> JString("No tienes permiso para ver los vuelos")))
    } else {
      val id = params.getOrElse(
        "id",
        throw ErroDeBase(http = 422, mensaje = "Falta el id del vuelo")
      )
      val largo = Try(id.toLong).getOrElse(
        throw ErroDeBase(
          http = 422,
          mensaje = s"El id $id no es un número",
          campo = Some("id")
        )
      )
      VueloService.buscar(largo) match {
        case Some(v) => Ok(jsonDeVuelo(v))
        case None    => responder(404, JObject("error" -> JString("El vuelo no existe")))
      }
    }
  }

  /**
   * Traduce los errores de la base a la respuesta que espera el formulario.
   *
   * Va como un `handle` y no como un catch dentro de cada endpoint para que no
   * se pueda olvidar en uno nuevo.
   */
  error {
    case e: ErroDeBase =>
      val cuerpo: JValue = e.campo match {
        case Some(c) => ("error" -> e.mensaje) ~ ("campo" -> c)
        case None    => "error" -> e.mensaje
      }
      logger.info(
        s"Alta de vuelo rechazada: http=${e.http} campo=${e.campo.getOrElse("-")} ${e.mensaje}"
      )
      ActionResult(e.http, cuerpo, Map.empty)
  }

  private def responder(codigo: Int, cuerpo: Any): ActionResult =
    ActionResult(codigo, cuerpo, Map.empty)

  private def autenticadoOrNull(r: HttpServletRequest): Option[Int] =
    identidad(r).map(_.userId)

  private def esAdmin(r: HttpServletRequest): Boolean =
    identidad(r).exists(_.roles.exists(_.equalsIgnoreCase(Roles.ADMIN)))

  /**
   * El cuerpo de la petición como JSON.
   *
   * Scalatra lanza MappingException si el cuerpo no es JSON, que es un error del
   * cliente y no una falla de la base, así que se traduce a 422 y no a 500.
   */
  private def parsearCuerpo(): JValue =
    try parsedBody
    catch {
      case _: MappingException =>
        throw ErroDeBase(
          http = 422,
          mensaje = "El cuerpo de la petición no es un JSON válido"
        )
    }

  private def jsonDeVuelo(v: Vuelo): JObject =
    JObject(
      "id" -> v.id,
      "codigo" -> v.codigo,
      "origen" -> v.origen,
      "destino" -> v.destino,
      "horaPartida" -> v.horaPartida.toString,
      "horaLlegada" -> v.horaLlegada.toString,
      "diasDesfaseLlegada" -> v.diasDesfaseLlegada,
      "fechaDesde" -> v.fechaDesde.toString,
      "fechaHasta" -> v.fechaHasta.toString,
      "estado" -> v.estado,
      "diasOperacion" -> JArray(v.diasOperacion.map(n => JInt(n): JValue)),
      "clases" -> JArray(v.clases.map { c =>
        JObject(
          "clase" -> c.clase,
          "capacidad" -> c.capacidad,
          "precio" -> JDecimal(scala.math.BigDecimal(c.precio.toString))
        ): JValue
      })
    )
}
