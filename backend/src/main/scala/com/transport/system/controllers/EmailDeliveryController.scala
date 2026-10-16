package com.transport.system.controllers

import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.sql.DriverManager
import org.json4s._
import org.scalatra._
import org.scalatra.json._
import org.slf4j.LoggerFactory

/** Receives normalized delivery events from the configured email provider. */
class EmailDeliveryController extends ScalatraServlet with JacksonJsonSupport {
  protected implicit val jsonFormats: Formats = DefaultFormats
  private val logger = LoggerFactory.getLogger(getClass)

  private def configuredSecret: Option[Array[Byte]] = sys.env.get("AERONET_EMAIL_WEBHOOK_SECRET")
    .map(_.trim).filter(_.length >= 32).map(_.getBytes(StandardCharsets.UTF_8))

  private def authorized: Boolean = {
    val provided = Option(request.getHeader("X-Aeronet-Webhook-Secret"))
      .map(_.getBytes(StandardCharsets.UTF_8)).getOrElse(Array.emptyByteArray)
    configuredSecret.exists(expected => MessageDigest.isEqual(expected, provided))
  }

  private def field(body: JValue, name: String): Option[String] = (body \\ name) match {
    case JString(value) if value.trim.nonEmpty => Some(value.trim)
    case JInt(value) => Some(value.toString)
    case JLong(value) => Some(value.toString)
    case _ => None
  }

  private def verifiedSendGridPayload(raw: Array[Byte]): Boolean = {
    val publicKeyPem = sys.env.get("AERONET_SENDGRID_WEBHOOK_PUBLIC_KEY").map(_.trim).filter(_.nonEmpty)
    val signature = Option(request.getHeader("X-Twilio-Email-Event-Webhook-Signature"))
    val timestamp = Option(request.getHeader("X-Twilio-Email-Event-Webhook-Timestamp"))
    (publicKeyPem, signature, timestamp) match {
      case (Some(pem), Some(signatureValue), Some(timestampValue)) =>
        try {
          val der = Base64.getDecoder.decode(pem.replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "").replaceAll("\\s", ""))
          val key = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der))
          val verifier = Signature.getInstance("SHA256withECDSA")
          verifier.initVerify(key)
          verifier.update(timestampValue.getBytes(StandardCharsets.UTF_8))
          verifier.update(raw)
          verifier.verify(Base64.getDecoder.decode(signatureValue))
        } catch { case _: Exception => false }
      case _ => false
    }
  }

  private def handleSendGridEvent(event: JValue): Unit = {
    val eventId = field(event, "sg_event_id")
    val notificationId = field(event, "notification_id").flatMap(_.toLongOption).filter(_ > 0)
    val status = field(event, "event").map(_.toLowerCase(java.util.Locale.ROOT)).flatMap {
      case "delivered" => Some("DELIVERED")
      case "bounce" | "blocked" => Some("BOUNCED")
      case "dropped" => Some("DROPPED")
      case _ => None // processed/deferred/open/click are not final delivery states
    }
    (eventId, notificationId, status) match {
      case (Some(id), Some(notification), Some(state)) if id.length <= 190 =>
        recordEvent(id, notification, state)
      case _ => ()
    }
  }

  private def recordEvent(eventId: String, notificationId: Long, providerStatus: String): Boolean = {
    val normalized = providerStatus.toUpperCase(java.util.Locale.ROOT)
    val nextState = normalized match {
      case "DELIVERED" => "ENTREGADA"
      case "BOUNCED" | "REJECTED" => "REBOTADA"
      case "FAILED" | "DROPPED" => "FALLIDA"
      case _ => throw new IllegalArgumentException("status debe ser DELIVERED, BOUNCED, REJECTED, FAILED o DROPPED")
    }
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    val connection = DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
    try {
      connection.setAutoCommit(false)
      val event = connection.prepareStatement(
        "INSERT IGNORE INTO email_delivery_event (provider_event_id, notification_id, provider_status) VALUES (?, ?, ?)")
      event.setString(1, eventId)
      event.setLong(2, notificationId)
      event.setString(3, normalized)
      val inserted = event.executeUpdate()
      event.close()
      if (inserted == 0) {
        connection.commit()
        true // Provider retries are expected and are idempotent by event ID.
      } else {
        val update = connection.prepareStatement(
          "UPDATE notificacion SET estado=?, updated_at=NOW() " +
            "WHERE id=? AND canal='EMAIL' AND tipo IN ('CONFIRMACION','REENVIO') AND estado='ENVIADA'")
        update.setString(1, nextState)
        update.setLong(2, notificationId)
        val changed = update.executeUpdate()
        update.close()
        if (changed == 0) connection.rollback()
        else connection.commit()
        changed == 1
      }
    } catch {
      case ex: Throwable => connection.rollback(); throw ex
    } finally connection.close()
  }

  post("/") {
    if (!authorized) Unauthorized(Map("error" -> "Webhook no autorizado"))
    else {
      val eventId = field(parsedBody, "eventId")
      val notificationId = field(parsedBody, "notificationId").flatMap(_.toLongOption).filter(_ > 0)
      val status = field(parsedBody, "status")
      (eventId, notificationId, status) match {
        case (Some(id), Some(notification), Some(state)) if id.length <= 190 =>
          try {
            if (recordEvent(id, notification, state)) Ok(Map("accepted" -> true))
            else NotFound(Map("error" -> "Notificación no disponible para actualizar"))
          } catch {
            case ex: IllegalArgumentException => BadRequest(Map("error" -> ex.getMessage))
            case ex: Exception =>
              logger.error("No se pudo procesar el evento de entrega de email", ex)
              InternalServerError(Map("error" -> "No se pudo procesar el evento"))
          }
        case _ => BadRequest(Map("error" -> "Se requieren eventId, notificationId y status válidos"))
      }
    }
  }

  /** SendGrid sends a signed JSON array; its sg_event_id is the idempotency key. */
  post("/sendgrid/") {
    val raw = request.getInputStream.readAllBytes()
    if (!verifiedSendGridPayload(raw)) Unauthorized(Map("error" -> "Firma de SendGrid inválida"))
    else try {
      val events = org.json4s.native.JsonMethods.parse(new String(raw, StandardCharsets.UTF_8)) match {
        case JArray(values) => values
        case _ => throw new IllegalArgumentException("El webhook debe ser un arreglo de eventos")
      }
      events.foreach(handleSendGridEvent)
      Ok(Map("accepted" -> true, "events" -> events.size))
    } catch {
      case _: IllegalArgumentException => BadRequest(Map("error" -> "Payload de SendGrid inválido"))
      case ex: Exception =>
        logger.error("No se pudo procesar el webhook de SendGrid", ex)
        InternalServerError(Map("error" -> "No se pudo procesar el evento"))
    }
  }
}
