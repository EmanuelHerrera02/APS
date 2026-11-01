package com.transport.system.controllers

import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.Permissions
import com.transport.system.security.{CounterSaleRepository, EmployeePurchaseRepository, UserRepository}
import org.json4s._
import org.json4s.native.JsonMethods._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory
import java.sql.SQLException

/**
 * Controlador para funcionalidades de Empleado de Mostrador
 */
class EmployeeController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  val logger = LoggerFactory.getLogger(getClass)

  private def text(body: JValue, field: String): Option[String] = body \ field match {
    case JString(value) if value.trim.nonEmpty => Some(value.trim)
    case _ => None
  }

  private def containsSensitiveCardData(value: JValue): Boolean = value match {
    case JObject(fields) => fields.exists { case (name, child) =>
      Set("cardnumber", "pan", "cvv", "cvc", "securitycode", "expiration", "expiry")
        .contains(name.toLowerCase(java.util.Locale.ROOT).replace("_", "")) || containsSensitiveCardData(child)
    }
    case JArray(items) => items.exists(containsSensitiveCardData)
    case _ => false
  }

  private case class SalePassenger(first: String, last: String, documentType: String, documentNumber: String, fareClass: String)

  private def parseSale(body: JValue): Either[String, (Long, String, List[SalePassenger], String, Option[(String, String, String)])] = {
    if (!body.isInstanceOf[JObject]) return Left("El cuerpo debe ser un objeto JSON")
    val departure = body \ "departureId" match {
      case JInt(value) if value.isValidLong && value > 0 => Some(value.toLong)
      case JLong(value) if value > 0 => Some(value)
      case _ => None
    }
    val email = text(body, "emailContact").filter(value => value.length <= 255 &&
      value.matches("(?i)^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))
    val passengerResult = body \ "passengers" match {
      case JArray(items) if items.nonEmpty && items.length <= 9 =>
        val values = items.map { item =>
          val first = text(item, "firstName").filter(_.length <= 100)
          val last = text(item, "lastName").filter(_.length <= 100)
          val documentType = text(item, "documentType").map(_.toUpperCase(java.util.Locale.ROOT))
            .filter(Set("DNI", "PASAPORTE", "OTRO"))
          val documentNumber = text(item, "documentNumber").filter(_.length <= 20)
          val fare = text(item, "class").map(_.toUpperCase(java.util.Locale.ROOT))
            .filter(Set("ECONOMY", "PRIMERA"))
          for { f <- first; l <- last; d <- documentType; n <- documentNumber; c <- fare }
            yield SalePassenger(f, l, d, n, c)
        }
        if (values.forall(_.nonEmpty)) Some(values.flatten) else None
      case _ => None
    }
    val method = text(body, "paymentMethod").map(_.toUpperCase(java.util.Locale.ROOT))
      .filter(Set("EFECTIVO", "TARJETA_CREDITO", "TARJETA_DEBITO"))
    val card = method match {
      case Some("TARJETA_CREDITO" | "TARJETA_DEBITO") =>
        val reference = text(body, "terminalReference").filter(_.matches("^[A-Za-z0-9_-]{3,100}$"))
        val brand = text(body, "cardBrand").filter(_.matches("^[A-Za-z0-9 ._-]{2,20}$"))
        val lastFour = text(body, "lastFour").filter(_.matches("^[0-9]{4}$"))
        for { ref <- reference; b <- brand; digits <- lastFour } yield Some((ref, b, digits))
      case Some("EFECTIVO") => Some(None)
      case _ => None
    }
    if (containsSensitiveCardData(body)) Left("No envíes número completo de tarjeta, CVV ni vencimiento")
    else if (departure.isEmpty) Left("departureId debe ser un entero positivo")
    else if (email.isEmpty) Left("emailContact debe ser un email válido para entregar los documentos")
    else if (passengerResult.isEmpty) Left("Ingresá entre 1 y 9 pasajeros con datos válidos")
    else if (method.isEmpty) Left("paymentMethod debe ser EFECTIVO, TARJETA_CREDITO o TARJETA_DEBITO")
    else if (card.isEmpty) Left("Para tarjeta ingresá la autorización de la terminal, la marca y los últimos 4 dígitos")
    else Right((departure.get, email.get, passengerResult.get, method.get, card.get))
  }

  /** POST /employee/sales — venta presencial con cobro y confirmación atómicos. */
  post("/sales") {
    val employeeId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.PAYMENT_PROCESS)) {
      logAccessDenied(employeeId, "counter_sale", s"Missing permission: ${Permissions.PAYMENT_PROCESS}")
      Forbidden(Map("error" -> "No tienes permiso para vender pasajes en mostrador"))
    } else parseSale(parsedBody) match {
      case Left(error) => BadRequest(Map("error" -> error))
      case Right((departureId, email, people, method, card)) =>
        val payload = JArray(people.map(person => JObject(
          "nombre" -> JString(person.first), "apellido" -> JString(person.last),
          "tipo_documento" -> JString(person.documentType), "numero_documento" -> JString(person.documentNumber),
          "clase" -> JString(person.fareClass))))
        try Created(Map("message" -> "Venta confirmada; los pasajes y la factura se enviaron a la cola de correo",
          "sale" -> CounterSaleRepository.sell(employeeId.toLong, departureId, email, payload, method, card)))
        catch {
          case ex: SQLException if Option(ex.getSQLState).contains("45000") =>
            val message = Option(ex.getMessage).getOrElse("No se pudo completar la venta").replaceFirst("^\\(conn=\\d+\\)\\s*", "")
            val status = if (message.toLowerCase(java.util.Locale.ROOT).contains("disponibilidad") ||
              message.toLowerCase(java.util.Locale.ROOT).contains("no está disponible")) 409 else 422
            ActionResult(status, Map("error" -> message), Map.empty)
          case ex: IllegalStateException =>
            logger.error("Counter sale database configuration is missing", ex)
            ServiceUnavailable(Map("error" -> "El servicio de ventas no está configurado"))
          case ex: Exception =>
            logger.error(s"Counter sale failed for employee=$employeeId", ex)
            InternalServerError(Map("error" -> "No se pudo confirmar la venta"))
        }
    }
  }

  /** GET /employee/purchases?query= — busca compras por código, documento, apellido o email. */
  get("/purchases") {
    val employeeId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_VIEW_ALL)) {
      logAccessDenied(employeeId, "search_purchases", s"Missing permission: ${Permissions.RESERVATION_VIEW_ALL}")
      Forbidden(Map("error" -> "No tienes permiso para consultar compras"))
    } else {
      val query = params.getOrElse("query", "").trim
      try Ok(Map("purchases" -> EmployeePurchaseRepository.search(query)))
      catch {
        case ex: IllegalArgumentException => BadRequest(Map("error" -> ex.getMessage))
        case ex: IllegalStateException =>
          logger.error("Employee purchase search database configuration is missing", ex)
          ServiceUnavailable(Map("error" -> "El servicio de compras no está configurado"))
        case ex: Exception =>
          logger.error(s"Purchase search failed for employee=$employeeId", ex)
          InternalServerError(Map("error" -> "No se pudieron consultar las compras"))
      }
    }
  }

  /** POST /employee/purchases/:id/resend — reenvía documentos y audita al empleado solicitante. */
  post("/purchases/:id/resend") {
    val employeeId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_VIEW_ALL)) {
      logAccessDenied(employeeId, "resend_purchase_documents", s"Missing permission: ${Permissions.RESERVATION_VIEW_ALL}")
      Forbidden(Map("error" -> "No tienes permiso para reenviar documentación"))
    } else params("id").toLongOption.filter(_ > 0) match {
      case None => BadRequest(Map("error" -> "El código de compra no es válido"))
      case Some(purchaseId) =>
        val recipient = (parsedBody \ "email") match {
          case JNothing | JNull => Right(None)
          case JString(value) if value.trim.isEmpty => Right(None)
          case JString(value) if value.trim.length <= 255 &&
            value.trim.matches("(?i)^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") => Right(Some(value.trim))
          case _ => Left("email debe ser un email válido o quedar vacío")
        }
        recipient match {
          case Left(error) => BadRequest(Map("error" -> error))
          case Right(email) => try {
            val resend = EmployeePurchaseRepository.resend(purchaseId, employeeId.toLong, email)
            ActionResult(202, Map("message" -> "Reenvío agregado a la cola de correo", "resend" -> resend), Map.empty)
          } catch {
            case ex: SQLException if Option(ex.getSQLState).contains("45000") =>
              val message = Option(ex.getMessage).getOrElse("Solo se reenvía documentación de compras confirmadas")
                .replaceFirst("^\\(conn=\\d+\\)\\s*", "")
              ActionResult(422, Map("error" -> message), Map.empty)
            case ex: IllegalStateException =>
              logger.error("Employee document resend database configuration is missing", ex)
              ServiceUnavailable(Map("error" -> "El servicio de documentación no está configurado"))
            case ex: Exception =>
              logger.error(s"Document resend failed for employee=$employeeId purchase=$purchaseId", ex)
              InternalServerError(Map("error" -> "No se pudo encolar el reenvío"))
          }
        }
    }
  }

  /**
   * GET /employee/reservations
   * Ver todas las reservas (solo empleados)
   */
  get("/reservations") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.RESERVATION_VIEW_ALL)) {
        logAccessDenied(userId, "view_all_reservations", s"Missing permission: ${Permissions.RESERVATION_VIEW_ALL}")
        Forbidden(Map("error" -> "No tienes permiso para ver todas las reservas"))
      } else {
        logger.info(s"Employee $userId viewing all reservations")
        Ok(Map(
          "message" -> "Todas las reservas",
          "reservations" -> List()
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching all reservations", ex)
        InternalServerError(Map("error" -> "Error al obtener reservas"))
    }
  }

  /**
   * POST /employee/reservations/:id/confirm
   * Confirmar una reserva
   */
  post("/reservations/:id/confirm") {
    try {
      val userId = getUserIdFromRequest(request)
      val reservationId = params("id")

      if (!hasPermission(request, Permissions.RESERVATION_CONFIRM)) {
        logAccessDenied(userId, "confirm_reservation", s"Missing permission: ${Permissions.RESERVATION_CONFIRM}")
        Forbidden(Map("error" -> "No tienes permiso para confirmar reservas"))
      } else {
        logger.info(s"Employee $userId confirming reservation $reservationId")
        Ok(Map(
          "message" -> "Reserva confirmada",
          "reservationId" -> reservationId
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error confirming reservation", ex)
        BadRequest(Map("error" -> "Error al confirmar reserva"))
    }
  }

  /**
   * POST /employee/payments/process
   * Procesar pago
   */
  post("/payments/process") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.PAYMENT_PROCESS)) {
        logAccessDenied(userId, "process_payment", s"Missing permission: ${Permissions.PAYMENT_PROCESS}")
        Forbidden(Map("error" -> "No tienes permiso para procesar pagos"))
      } else {
        logger.info(s"Employee $userId processing payment")
        val body = parsedBody
        Ok(Map(
          "message" -> "Pago procesado",
          "paymentId" -> 1
        ))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error processing payment", ex)
        BadRequest(Map("error" -> "Error al procesar pago"))
    }
  }

  /**
   * GET /employee/reports
   * Ver reportes operacionales
   */
  get("/reports") {
    try {
      val userId = getUserIdFromRequest(request)

      if (!hasPermission(request, Permissions.REPORT_VIEW_OPERATIONAL)) {
        logAccessDenied(userId, "view_operational_reports", s"Missing permission: ${Permissions.REPORT_VIEW_OPERATIONAL}")
        Forbidden(Map("error" -> "No tienes permiso para ver reportes"))
      } else {
        logger.info(s"Employee $userId viewing operational reports")
        Ok(Map("stats" -> UserRepository.employeeStats()))
      }
    } catch {
      case ex: Exception =>
        logger.error("Error fetching reports", ex)
        InternalServerError(Map("error" -> "Error al obtener reportes"))
    }
  }
}
