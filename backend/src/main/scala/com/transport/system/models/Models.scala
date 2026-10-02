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
  role: String = "PASAJERO"
)

/**
 * Roles del sistema
 */
object Roles {
  val ADMIN = "ADMIN"
  val EMPLOYEE = "MOSTRADOR"
  val PASSENGER = "PASAJERO"
}

/**
 * Permisos del sistema
 */
object Permissions {
  val AUTH_LOGIN = "auth:login"
  val PROFILE_VIEW_OWN = "profile:view_own"
  val RESERVATION_VIEW_OWN = "reservation:view_own"
  val RESERVATION_CREATE = "reservation:create"
  val RESERVATION_VIEW_ALL = "reservation:view_all"
  val RESERVATION_CONFIRM = "reservation:confirm"
  val PAYMENT_PROCESS = "payment:process"
  val PAYMENT_REGISTER_METHOD = "payment:register_method"
  val REPORT_VIEW_OPERATIONAL = "report:view_operational"
  val ADMIN_PANEL_ACCESS = "admin:panel_access"
  val USER_LIST = "user:list"
  val USER_CREATE = "user:create"
  val USER_EDIT = "user:edit"
  val USER_CHANGE_ROLE = "user:change_role"
  val REPORT_VIEW_FINANCIAL = "report:view_financial"
  val ADMIN_VIEW_AUDIT = "admin:view_audit"
  val ADMIN_CONFIG = "admin:config"
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
    Permissions.AUTH_LOGIN,
    Permissions.PROFILE_VIEW_OWN,
    Permissions.ADMIN_PANEL_ACCESS,
    Permissions.USER_LIST,
    Permissions.USER_CREATE,
    Permissions.USER_EDIT,
    Permissions.USER_CHANGE_ROLE,
    Permissions.REPORT_VIEW_FINANCIAL,
    Permissions.ADMIN_VIEW_AUDIT,
    Permissions.ADMIN_CONFIG
  )
}

case class EmpleadoMostrador(user: User) extends UserProfile {
  val permissions = List(
    Permissions.AUTH_LOGIN,
    Permissions.PROFILE_VIEW_OWN,
    Permissions.RESERVATION_VIEW_ALL,
    Permissions.RESERVATION_CONFIRM,
    Permissions.PAYMENT_PROCESS,
    Permissions.REPORT_VIEW_OPERATIONAL
  )
}

case class Pasajero(user: User) extends UserProfile {
  val permissions = List(
    Permissions.AUTH_LOGIN,
    Permissions.PROFILE_VIEW_OWN,
    Permissions.RESERVATION_VIEW_OWN,
    Permissions.RESERVATION_CREATE,
    Permissions.PAYMENT_REGISTER_METHOD
  )
}
