package com.transport.system.controllers

import com.transport.system.middleware.AuthorizedAction
import com.transport.system.models.Permissions
import com.transport.system.payments.{CardSubmission, PaymentFailure, PaymentService}
import org.json4s._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

/**
 * Pago en línea del pasajero (US9). La tarjeta se tokeniza en el navegador con el SDK de la
 * pasarela: este controlador solo acepta el token y rechaza cualquier dato sensible de tarjeta.
 */
class PaymentController extends ScalatraServlet with JacksonJsonSupport with AuthorizedAction {
  protected implicit val jsonFormats: Formats = DefaultFormats
  private val logger = LoggerFactory.getLogger(getClass)

  /** Campos que nunca deben llegar al backend (PAN, CVV): se rechazan aunque vengan anidados. */
  private val forbiddenCardFields = Set("cardnumber", "securitycode", "cvv", "cvc", "pan")
  private val emailPattern = "(?i)^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$".r

  before() {
    contentType = formats("json")
  }

  private def containsCardData(value: JValue): Boolean = value match {
    case JObject(fields) => fields.exists { case (name, child) =>
      forbiddenCardFields.contains(name.toLowerCase(java.util.Locale.ROOT).replace("_", "")) || containsCardData(child)
    }
    case JArray(items) => items.exists(containsCardData)
    case _ => false
  }

  private def text(value: JValue): Option[String] = value match {
    case JString(v) if v.trim.nonEmpty => Some(v.trim)
    case JInt(v) => Some(v.toString)
    case JLong(v) => Some(v.toString)
    case _ => None
  }

  private def cardSubmission(body: JValue): Either[String, CardSubmission] = {
    val token = text(body \ "token").filter(_.matches("^[A-Za-z0-9_-]{8,255}$"))
      .toRight("token es obligatorio: tokenizá la tarjeta con el formulario de la pasarela")
    val method = text(body \ "paymentMethodId").map(_.toLowerCase(java.util.Locale.ROOT))
      .filter(_.matches("^[a-z_]{2,30}$")).toRight("paymentMethodId es obligatorio")
    val issuer = body \ "issuerId" match {
      case JNothing | JNull => Right(None)
      case value => text(value).filter(_.matches("^[0-9]{1,20}$")).map(Some(_)).toRight("issuerId debe ser numérico")
    }
    val installments = body \ "installments" match {
      case JNothing | JNull => Right(1)
      case JInt(value) if value >= 1 && value <= 12 => Right(value.toInt)
      case JLong(value) if value >= 1 && value <= 12 => Right(value.toInt)
      case _ => Left("installments debe estar entre 1 y 12")
    }
    val email = text(body \ "payer" \ "email") match {
      case None => Right(None)
      case Some(value) if value.length <= 255 && emailPattern.findFirstIn(value).isDefined => Right(Some(value))
      case Some(_) => Left("payer.email no tiene un formato válido")
    }
    val identification = (text(body \ "payer" \ "identification" \ "type"), text(body \ "payer" \ "identification" \ "number")) match {
      case (None, None) => Right(None)
      case (Some(kind), Some(number)) if kind.matches("^[A-Za-z]{2,10}$") && number.matches("^[0-9A-Za-z]{5,20}$") =>
        Right(Some(kind.toUpperCase(java.util.Locale.ROOT) -> number))
      case _ => Left("payer.identification debe tener type y number válidos")
    }
    for {
      t <- token
      m <- method
      i <- issuer
      n <- installments
      e <- email
      id <- identification
    } yield CardSubmission(t, m, i, n, e, id)
  }

  private def failure(ex: Throwable, action: String): ActionResult = ex match {
    case failed: PaymentFailure => ActionResult(failed.status, Map("error" -> failed.getMessage), Map.empty)
    case missing: IllegalStateException =>
      logger.error(s"Configuración faltante al $action", missing)
      ServiceUnavailable(Map("error" -> "El servicio de pagos no está configurado"))
    case other =>
      logger.error(s"Error al $action", other)
      InternalServerError(Map("error" -> "No se pudo procesar el pago"))
  }

  /** GET /payments/config — clave pública y SDK para el formulario seguro de la pasarela. */
  get("/config") {
    PaymentService.gateway match {
      case Some(gateway) => Ok(gateway.publicConfig + ("enabled" -> true))
      case None => ServiceUnavailable(Map("enabled" -> false, "error" -> "El pago en línea no está configurado"))
    }
  }

  /** POST /payments/transactions {purchaseId} — crea (o devuelve) la transacción con su uuid. */
  post("/transactions") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_CREATE)) {
      logAccessDenied(userId, "start_payment", s"Missing permission: ${Permissions.RESERVATION_CREATE}")
      Forbidden(Map("error" -> "No tienes permiso para pagar compras"))
    } else parsedBody \ "purchaseId" match {
      case JInt(value) if value > 0 && value.isValidLong =>
        try Created(Map("transaction" -> PaymentService.start(userId.toLong, value.toLong)))
        catch { case ex: Exception => failure(ex, "iniciar el pago") }
      case JLong(value) if value > 0 =>
        try Created(Map("transaction" -> PaymentService.start(userId.toLong, value)))
        catch { case ex: Exception => failure(ex, "iniciar el pago") }
      case _ => BadRequest(Map("error" -> "purchaseId debe ser un entero positivo"))
    }
  }

  /** POST /payments/transactions/:id/card — envía la tarjeta tokenizada a la pasarela. */
  post("/transactions/:transactionId/card") {
    val userId = getUserIdFromRequest(request)
    val transactionId = params.getOrElse("transactionId", "")
    if (!hasPermission(request, Permissions.RESERVATION_CREATE)) {
      logAccessDenied(userId, "process_payment", s"Missing permission: ${Permissions.RESERVATION_CREATE}")
      Forbidden(Map("error" -> "No tienes permiso para pagar compras"))
    } else if (containsCardData(parsedBody)) {
      logger.warn(s"Se rechazó un pago con datos de tarjeta sin tokenizar user=$userId")
      BadRequest(Map("error" -> "No envíes datos de la tarjeta al servidor: usá el formulario seguro de la pasarela"))
    } else cardSubmission(parsedBody) match {
      case Left(error) => BadRequest(Map("error" -> error))
      case Right(card) =>
        try Ok(Map("transaction" -> PaymentService.process(userId.toLong, transactionId, card)))
        catch { case ex: Exception => failure(ex, "procesar el pago") }
    }
  }

  /** GET /payments/transactions/:id — estado de la transacción (polling del navegador). */
  get("/transactions/:transactionId") {
    val userId = getUserIdFromRequest(request)
    if (!hasPermission(request, Permissions.RESERVATION_VIEW_OWN)) {
      logAccessDenied(userId, "view_payment", s"Missing permission: ${Permissions.RESERVATION_VIEW_OWN}")
      Forbidden(Map("error" -> "No tienes permiso para ver pagos"))
    } else try {
      PaymentService.status(userId.toLong, params.getOrElse("transactionId", "")) match {
        case Some(transaction) => Ok(Map("transaction" -> transaction))
        case None => NotFound(Map("error" -> "La transacción de pago no existe"))
      }
    } catch { case ex: Exception => failure(ex, "consultar el pago") }
  }
}
