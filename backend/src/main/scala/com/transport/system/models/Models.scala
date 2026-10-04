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
  id: String,
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
  roles: List[Role],
  permissions: List[String] = Nil
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
  exp: Long,
  sessionId: String = ""
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
  phone: Option[String] = None
)

/** Alta administrativa: el rol solo se acepta en un endpoint protegido. */
case class AdminCreateUserRequest(
  email: String,
  password: String,
  firstName: String,
  lastName: String,
  phone: Option[String] = None,
  role: String = Roles.PASSENGER
)

case class AdminUserUpdateRequest(
  firstName: Option[String] = None,
  lastName: Option[String] = None,
  phone: Option[String] = None,
  active: Option[Boolean] = None,
  role: Option[String] = None
)

object AdminUserUpdateRequest {
  import org.json4s._

  /**
   * Igual que AdminCreateFlightRequest.fromJson: `extract` falla en Scala 3 con esta case class
   * ("Can't find ScalaSig"). Un campo ausente o null no se modifica; otro tipo lanza MappingException.
   */
  def fromJson(json: JValue): AdminUserUpdateRequest = {
    if (!json.isInstanceOf[JObject]) throw new MappingException("El cuerpo debe ser un objeto JSON")
    def text(field: String): Option[String] = json \ field match {
      case JNothing | JNull => None
      case JString(value) => Some(value)
      case _ => throw new MappingException(s"$field debe ser un texto")
    }
    AdminUserUpdateRequest(
      firstName = text("firstName"),
      lastName = text("lastName"),
      phone = text("phone"),
      active = json \ "active" match {
        case JNothing | JNull => None
        case JBool(value) => Some(value)
        case _ => throw new MappingException("active debe ser true o false")
      },
      role = text("role")
    )
  }
}

case class FlightClassRequest(
  className: String,
  capacity: Int,
  price: BigDecimal
)

case class AdminCreateFlightRequest(
  code: String,
  originAirportId: Long,
  destinationAirportId: Long,
  departureTime: String,
  arrivalTime: String,
  arrivalDayOffset: Int = 0,
  startDate: String,
  endDate: String,
  operatingDays: List[Int],
  classes: List[FlightClassRequest]
)

object AdminCreateFlightRequest {
  import org.json4s._

  /**
   * json4s no puede usar `extract` en Scala 3 con case classes que tienen campos genéricos
   * (List[...]): falla con "Can't find ScalaSig". Se lee campo por campo, con tipos estrictos.
   * Lanza MappingException si falta un campo o tiene otro tipo.
   */
  def fromJson(json: JValue): AdminCreateFlightRequest = {
    def fail(field: String, expected: String) = throw new MappingException(s"$field debe ser $expected")
    def string(value: JValue, field: String): String = value match {
      case JString(text) => text
      case _ => fail(field, "un texto")
    }
    def integer(value: JValue, field: String): BigInt = value match {
      case JInt(number) => number
      case JLong(number) => BigInt(number)
      case _ => fail(field, "un entero")
    }
    def int(value: JValue, field: String): Int = {
      val number = integer(value, field)
      if (number.isValidInt) number.toInt else fail(field, "un entero de 32 bits")
    }
    def long(value: JValue, field: String): Long = {
      val number = integer(value, field)
      if (number.isValidLong) number.toLong else fail(field, "un entero de 64 bits")
    }
    def decimal(value: JValue, field: String): BigDecimal = value match {
      case JInt(number) => BigDecimal(number)
      case JLong(number) => BigDecimal(number)
      case JDouble(number) => BigDecimal(number)
      case JDecimal(number) => number
      case _ => fail(field, "un número")
    }
    def array(value: JValue, field: String): List[JValue] = value match {
      case JArray(items) => items
      case _ => fail(field, "un array")
    }

    AdminCreateFlightRequest(
      code = string(json \ "code", "code"),
      originAirportId = long(json \ "originAirportId", "originAirportId"),
      destinationAirportId = long(json \ "destinationAirportId", "destinationAirportId"),
      departureTime = string(json \ "departureTime", "departureTime"),
      arrivalTime = string(json \ "arrivalTime", "arrivalTime"),
      arrivalDayOffset = json \ "arrivalDayOffset" match {
        case JNothing => 0
        case value => int(value, "arrivalDayOffset")
      },
      startDate = string(json \ "startDate", "startDate"),
      endDate = string(json \ "endDate", "endDate"),
      operatingDays = array(json \ "operatingDays", "operatingDays").map(int(_, "operatingDays")),
      classes = array(json \ "classes", "classes").map { item =>
        FlightClassRequest(
          className = string(item \ "className", "className"),
          capacity = int(item \ "capacity", "capacity"),
          price = decimal(item \ "price", "price"))
      }
    )
  }
}

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
  val FLIGHT_CREATE = "flight:create"
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
    Permissions.ADMIN_CONFIG,
    Permissions.FLIGHT_CREATE
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
