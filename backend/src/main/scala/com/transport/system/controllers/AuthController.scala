package com.transport.system.controllers

import com.transport.system.models.{LoginRequest, RegisterRequest}
import com.transport.system.security.{Authentication, UserRepository, UserWriteError}
import org.json4s._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

class AuthController extends ScalatraServlet with JacksonJsonSupport {
  protected implicit val jsonFormats: Formats = DefaultFormats
  private val logger = LoggerFactory.getLogger(getClass)

  private def responseJson(response: com.transport.system.models.LoginResponse): Map[String, Any] = Map(
    "accessToken" -> response.accessToken,
    "refreshToken" -> response.refreshToken,
    "user" -> Map(
      "id" -> response.user.id,
      "email" -> response.user.email,
      "firstName" -> response.user.firstName,
      "lastName" -> response.user.lastName,
      "phone" -> response.user.phone.orNull,
      "status" -> response.user.status,
      "createdAt" -> response.user.createdAt.toString,
      "lastLogin" -> response.user.lastLogin.map(_.toString).orNull
    ),
    "roles" -> response.roles.map(role => Map("id" -> role.id, "name" -> role.name, "description" -> role.description)),
    "permissions" -> response.permissions
  )

  post("/register") {
    try {
      val input = parsedBody.extract[RegisterRequest]
      Authentication.validateConfiguration()
      UserRepository.registerPassenger(input.email, input.password, input.firstName, input.lastName, input.phone) match {
        case Left(UserWriteError.InvalidData) =>
          BadRequest(Map("error" -> "Revisá email, contraseña, nombre, apellido y teléfono"))
        case Left(UserWriteError.EmailAlreadyExists) =>
          Conflict(Map("error" -> "Ya existe una cuenta con ese email"))
        case Left(UserWriteError.InvalidRole) =>
          BadRequest(Map("error" -> "El rol de registro no es válido"))
        case Right(userId) =>
          Authentication.login(input.email, input.password) match {
            case Some(response) => Created(responseJson(response))
            case None =>
              logger.error(s"User $userId was registered but could not be signed in")
              Created(Map("userId" -> userId, "message" -> "Cuenta creada; iniciá sesión para continuar"))
          }
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "Faltan campos obligatorios"))
      case ex: IllegalStateException =>
        logger.error("Registration service is not configured", ex)
        ServiceUnavailable(Map("error" -> "El servicio de autenticación no está configurado"))
      case ex: Exception =>
        logger.error("Registration failed", ex)
        InternalServerError(Map("error" -> "No se pudo crear la cuenta"))
    }
  }

  post("/login") {
    try {
      val input = parsedBody.extract[LoginRequest]
      Authentication.login(input.email, input.password) match {
        case Some(response) => Ok(responseJson(response))
        case None => Unauthorized(Map("error" -> "Credenciales inválidas o cuenta inactiva"))
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "Email y contraseña son obligatorios"))
      case ex: IllegalStateException =>
        logger.error("Authentication service is not configured", ex)
        ServiceUnavailable(Map("error" -> "El servicio de autenticación no está configurado"))
      case ex: Exception =>
        logger.error("Login failed", ex)
        InternalServerError(Map("error" -> "No se pudo iniciar sesión"))
    }
  }

  post("/refresh") {
    try {
      val refreshToken = (parsedBody \\ "refreshToken").extract[String]
      Authentication.refresh(refreshToken) match {
        case Some(response) => Ok(responseJson(response))
        case None => Unauthorized(Map("error" -> "Sesión inválida o expirada"))
      }
    } catch {
      case _: MappingException => BadRequest(Map("error" -> "refreshToken es obligatorio"))
      case ex: Exception =>
        logger.error("Session refresh failed", ex)
        InternalServerError(Map("error" -> "No se pudo renovar la sesión"))
    }
  }

  post("/logout") {
    val header = Option(request.getHeader("Authorization")).getOrElse("")
    if (!header.startsWith("Bearer ")) Unauthorized(Map("error" -> "Sesión inválida o expirada"))
    else Authentication.authenticate(header.substring(7).trim) match {
      case None => Unauthorized(Map("error" -> "Sesión inválida o expirada"))
      case Some(user) =>
        Authentication.logout(user.sessionId, user.userId.toLong)
        Ok(Map("message" -> "Sesión cerrada"))
    }
  }

  get("/me") {
    val header = Option(request.getHeader("Authorization")).getOrElse("")
    if (!header.startsWith("Bearer ")) Unauthorized(Map("error" -> "Sesión inválida o expirada"))
    else Authentication.authenticate(header.substring(7).trim) match {
      case None => Unauthorized(Map("error" -> "Sesión inválida o expirada"))
      case Some(authenticated) =>
        val roles = authenticated.roles.map { role =>
          Map("id" -> role, "name" -> role, "description" -> role)
        }
        UserRepository.profile(authenticated.userId.toLong) match {
          case Some(user) => Ok(Map("user" -> user, "roles" -> roles, "permissions" -> authenticated.permissions))
          case None => Unauthorized(Map("error" -> "La cuenta ya no está disponible"))
        }
    }
  }
}
