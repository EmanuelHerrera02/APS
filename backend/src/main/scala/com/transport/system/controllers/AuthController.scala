package com.transport.system.controllers

import com.transport.system.models.LoginRequest
import com.transport.system.security.Authentication
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
    "roles" -> response.roles.map(role => Map("id" -> role.id, "name" -> role.name, "description" -> role.description))
  )

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
        Authentication.logout(user.sessionId)
        Ok(Map("message" -> "Sesión cerrada"))
    }
  }

  get("/me") {
    val header = Option(request.getHeader("Authorization")).getOrElse("")
    if (!header.startsWith("Bearer ")) Unauthorized(Map("error" -> "Sesión inválida o expirada"))
    else Authentication.authenticate(header.substring(7).trim) match {
      case None => Unauthorized(Map("error" -> "Sesión inválida o expirada"))
      case Some(user) => Ok(Map("userId" -> user.userId, "email" -> user.email,
        "roles" -> user.roles, "permissions" -> user.permissions))
    }
  }
}
