package com.transport.system.middleware

import com.transport.system.security.{Authentication, AuthenticatedUser}
import org.scalatra._
import org.slf4j.LoggerFactory

class SecurityException(message: String) extends RuntimeException(message)

trait AuthorizedAction { self: ScalatraServlet =>
  private val securityLogger = LoggerFactory.getLogger(getClass)
  private val userAttribute = "com.transport.system.authenticatedUser"

  before() {
    // El buscador de opciones es público; los demás endpoints de estos controladores requieren sesión.
    val isPublicSearch = request.getMethod == "GET" && request.getRequestURI.endsWith("/passenger/search")
    if (!isPublicSearch) {
      currentUser(request) match {
        case Some(user) => request.setAttribute(userAttribute, user)
        case None => halt(401, Map("error" -> "Sesión inválida o expirada"))
      }
    }
  }

  private def currentUser(req: jakarta.servlet.http.HttpServletRequest): Option[AuthenticatedUser] = {
    Option(req.getAttribute(userAttribute)).map(_.asInstanceOf[AuthenticatedUser]).orElse {
      val header = Option(req.getHeader("Authorization")).getOrElse("")
      if (!header.startsWith("Bearer ")) None
      else Authentication.authenticate(header.substring(7).trim)
    }
  }

  def getUserIdFromRequest(req: jakarta.servlet.http.HttpServletRequest): Int =
    currentUser(req).map(_.userId).getOrElse(throw new SecurityException("Authentication required"))

  def hasRole(req: jakarta.servlet.http.HttpServletRequest, role: String): Boolean =
    currentUser(req).exists(_.roles.contains(role))

  def hasPermission(req: jakarta.servlet.http.HttpServletRequest, permission: String): Boolean =
    currentUser(req).exists(_.permissions.contains(permission))

  def logAccessDenied(userId: Int, action: String, reason: String): Unit =
    securityLogger.warn(s"Access denied for user=$userId action=$action reason=$reason")
}
