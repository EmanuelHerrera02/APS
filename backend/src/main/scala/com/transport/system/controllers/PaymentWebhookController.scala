package com.transport.system.controllers

import com.transport.system.payments.{MercadoPagoWebhookSignature, PaymentService}
import java.nio.charset.StandardCharsets
import org.json4s._
import org.json4s.native.JsonMethods.parse
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

/**
 * Notificaciones asincrónicas de Mercado Pago (US9). Se valida la firma x-signature y luego se
 * consulta el pago en la API con credenciales propias: el estado nunca se toma del cuerpo recibido.
 * Repetir la notificación es seguro porque resolver_transaccion_pago es idempotente.
 */
class PaymentWebhookController extends ScalatraServlet with JacksonJsonSupport {
  protected implicit val jsonFormats: Formats = DefaultFormats
  private val logger = LoggerFactory.getLogger(getClass)

  before() {
    contentType = formats("json")
  }

  private def secret: Option[String] = sys.env.get("AERONET_MP_WEBHOOK_SECRET").map(_.trim).filter(_.length >= 16)

  post("/mercadopago") {
    val raw = request.getInputStream.readAllBytes()
    val body = scala.util.Try(parse(new String(raw, StandardCharsets.UTF_8))).getOrElse(JNothing)
    val dataId = params.get("data.id").map(_.trim).filter(_.nonEmpty).orElse(body \ "data" \ "id" match {
      case JString(value) if value.trim.nonEmpty => Some(value.trim)
      case JInt(value) => Some(value.toString)
      case _ => None
    })
    val topic = params.get("type").orElse(params.get("topic")).orElse(body \ "type" match {
      case JString(value) => Some(value)
      case _ => None
    })

    secret match {
      case None =>
        logger.warn("Webhook de Mercado Pago recibido sin AERONET_MP_WEBHOOK_SECRET configurado")
        ServiceUnavailable(Map("error" -> "Webhook de pagos no configurado"))
      case Some(key) if !MercadoPagoWebhookSignature.isValid(key, Option(request.getHeader("x-signature")),
          Option(request.getHeader("x-request-id")), dataId) =>
        Unauthorized(Map("error" -> "Firma de Mercado Pago inválida"))
      case Some(_) => (topic, dataId) match {
        case (Some("payment"), Some(paymentId)) =>
          try {
            val result = PaymentService.synchronize(paymentId)
            logger.info("payment_webhook gateway_payment={} result={}", paymentId, result)
            Ok(Map("accepted" -> true, "result" -> result))
          } catch {
            case ex: Exception =>
              // 5xx: Mercado Pago reintenta la notificación más tarde.
              logger.error(s"No se pudo procesar el webhook del pago $paymentId", ex)
              InternalServerError(Map("error" -> "No se pudo procesar la notificación"))
          }
        case _ => Ok(Map("accepted" -> true, "result" -> "IGNORADO"))
      }
    }
  }
}
