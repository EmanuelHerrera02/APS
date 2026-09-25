package com.transport.system.models

import java.time.LocalDateTime

/**
 * Modelo de Usuario
 */
case class User(
  id: Int,
  email: String,
  firstName: String,
  lastName: String,
  phone: Option[String],
  status: String,
  createdAt: LocalDateTime,
  lastLogin: Option[LocalDateTime]
)

/**
 * Modelo de Rol
 */
case class Role(
  id: Int,
  name: String,
  description: String
)

/**
 * Modelo de Permiso
 */
case class Permission(
  id: Int,
  name: String,
  description: String,
  category: String
)

/**
 * Request para login
 */
case class LoginRequest(
  email: String,
  password: String
)

/**
 * Response de login
 */
case class LoginResponse(
  accessToken: String,
  refreshToken: String,
  user: User,
  roles: List[Role]
)

/**
 * Payload del JWT
 */
case class JwtPayload(
  sub: String,
  userId: Int,
  email: String,
  roles: List[String],
  permissions: List[String],
  iat: Long,
  exp: Long
)

/**
 * Request para cambiar contraseña
 */
case class ChangePasswordRequest(
  oldPassword: String,
  newPassword: String
)

/**
 * Request para registrar usuario
 */
case class RegisterRequest(
  email: String,
  password: String,
  firstName: String,
  lastName: String,
  phone: Option[String],
  role: String = "passenger"
)

/**
 * Roles del sistema
 */
object Roles {
  val ADMIN = "admin"
  val EMPLOYEE = "counter_employee"
  val PASSENGER = "passenger"
}

/**
 * Permisos del sistema
 */
object Permissions {
  val MANAGE_USERS = "manage_users"
  val MANAGE_SYSTEM = "manage_system"
  val MANAGE_TICKETS = "manage_tickets"
  val VIEW_REPORTS = "view_reports"
  val SELL_TICKETS = "sell_tickets"
  val MANAGE_SCHEDULES = "manage_schedules"
  val BOOK_TICKETS = "book_tickets"
  val VIEW_HISTORY = "view_history"
  val UPDATE_PROFILE = "update_profile"
}

/**
 * Clase base para usuarios con roles
 */
abstract class UserProfile {
  def user: User
  def permissions: List[String]
}

case class Administrador(user: User) extends UserProfile {
  val permissions = List(
    Permissions.MANAGE_USERS,
    Permissions.MANAGE_SYSTEM,
    Permissions.MANAGE_TICKETS,
    Permissions.VIEW_REPORTS,
    Permissions.UPDATE_PROFILE
  )
}

case class EmpleadoMostrador(user: User) extends UserProfile {
  val permissions = List(
    Permissions.SELL_TICKETS,
    Permissions.MANAGE_SCHEDULES,
    Permissions.VIEW_HISTORY,
    Permissions.UPDATE_PROFILE
  )
}

case class Pasajero(user: User) extends UserProfile {
  val permissions = List(
    Permissions.BOOK_TICKETS,
    Permissions.VIEW_HISTORY,
    Permissions.UPDATE_PROFILE
  )
}
