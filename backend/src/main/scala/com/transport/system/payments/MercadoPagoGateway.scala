package com.transport.system.payments

import java.net.URI
import java.net.URLEncoder
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.util.Locale
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json4s._
import org.json4s.native.JsonMethods._

/**
 * Integración con la API de pagos de Mercado Pago (Checkout API + Card Payment Brick).
 * El navegador tokeniza la tarjeta con el SDK de Mercado Pago; acá solo viaja el token.
 * Cada cobro lleva X-Idempotency-Key, así un reintento con la misma clave no cobra dos veces.
 */
final class MercadoPagoGateway(
  accessToken: String,
  publicKey: String,
  apiUrl: String,
  sdkUrl: String,
  notificationUrl: Option[String],
  statementDescriptor: String,
  environment: String
) extends PaymentGateway {
  private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
  private val safeId = "^[A-Za-z0-9_-]{1,64}$".r

  override val provider: String = "mercadopago"

  override def publicConfig: Map[String, Any] = Map(
    "provider" -> provider,
    "publicKey" -> publicKey,
    "sdkUrl" -> sdkUrl,
    "locale" -> "es-AR",
    "environment" -> environment
  )

  private def request(path: String): HttpRequest.Builder =
    HttpRequest.newBuilder(URI.create(apiUrl.stripSuffix("/") + path))
      .timeout(Duration.ofSeconds(25))
      .header("Authorization", s"Bearer $accessToken")
      .header("Accept", "application/json")

  private def send(httpRequest: HttpRequest): HttpResponse[String] =
    try client.send(httpRequest, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
    catch {
      case ex: java.io.IOException => throw new GatewayUnavailable("No se pudo contactar a Mercado Pago", ex)
      case ex: InterruptedException =>
        Thread.currentThread().interrupt()
        throw new GatewayUnavailable("Se interrumpió la llamada a Mercado Pago", ex)
    }

  /** 4xx definitivos: Mercado Pago no creó el pago. 408/409/429 y 5xx dejan el resultado en duda. */
  private def definitiveRejection(status: Int): Boolean =
    status >= 400 && status < 500 && !Set(408, 409, 423, 429).contains(status)

  private def errorReason(body: String): String = {
    val json = scala.util.Try(parse(body)).getOrElse(JNothing)
    val cause = (json \ "cause") match {
      case JArray(first :: _) =>
        val code = first \ "code" match {
          case JInt(value) => Some(value.toString)
          case JString(value) => Some(value)
          case _ => None
        }
        val description = first \ "description" match {
          case JString(value) => Some(value)
          case _ => None
        }
        Some(List(code, description).flatten.mkString(" "))
      case _ => None
    }
    val message = json \ "message" match {
      case JString(value) => Some(value)
      case _ => None
    }
    cause.filter(_.nonEmpty).orElse(message).getOrElse("solicitud inválida").take(100)
  }

  override def createCardPayment(payment: CardPaymentRequest): GatewayPayment = {
    val payer = JObject(
      ("email" -> JString(payment.payerEmail)) :: payment.payerIdentification.toList.map { case (kind, number) =>
        "identification" -> JObject("type" -> JString(kind), "number" -> JString(number))
      }
    )
    val fields = List(
      "transaction_amount" -> JDecimal(payment.amount),
      "token" -> JString(payment.token),
      "description" -> JString(payment.description),
      "installments" -> JInt(payment.installments),
      "payment_method_id" -> JString(payment.paymentMethodId),
      "external_reference" -> JString(payment.externalReference),
      "statement_descriptor" -> JString(statementDescriptor),
      "payer" -> payer
    ) ++ payment.issuerId.map(id => "issuer_id" -> id.toLongOption.map(JInt(_)).getOrElse(JString(id))) ++
      notificationUrl.map(url => "notification_url" -> JString(url))

    val response = send(request("/v1/payments")
      .header("Content-Type", "application/json")
      .header("X-Idempotency-Key", payment.idempotencyKey)
      .POST(HttpRequest.BodyPublishers.ofString(compact(render(JObject(fields))), StandardCharsets.UTF_8))
      .build())
    response.statusCode() match {
      case 200 | 201 => parsePayment(response.body())
      case status if definitiveRejection(status) => throw new GatewayRequestRejected(status, errorReason(response.body()))
      case status => throw new GatewayUnavailable(s"Mercado Pago respondió HTTP $status al crear el pago")
    }
  }

  override def findPayment(paymentId: String): Option[GatewayPayment] = {
    if (safeId.findFirstIn(paymentId).isEmpty) return None
    val response = send(request(s"/v1/payments/$paymentId").GET().build())
    response.statusCode() match {
      case 200 => Some(parsePayment(response.body()))
      case 404 => None
      case status => throw new GatewayUnavailable(s"Mercado Pago respondió HTTP $status al consultar el pago")
    }
  }

  override def findByExternalReference(reference: String): Option[GatewayPayment] = {
    val query = s"external_reference=${URLEncoder.encode(reference, StandardCharsets.UTF_8)}&sort=date_created&criteria=desc"
    val response = send(request(s"/v1/payments/search?$query").GET().build())
    response.statusCode() match {
      case 200 => parse(response.body(), useBigDecimalForDouble = true) \ "results" match {
        case JArray(first :: _) => Some(parsePayment(first))
        case _ => None
      }
      case status => throw new GatewayUnavailable(s"Mercado Pago respondió HTTP $status al buscar pagos")
    }
  }

  override def refund(paymentId: String, idempotencyKey: String): Unit = {
    if (safeId.findFirstIn(paymentId).isEmpty) throw new IllegalArgumentException("Identificador de pago inválido")
    val response = send(request(s"/v1/payments/$paymentId/refunds")
      .header("Content-Type", "application/json")
      .header("X-Idempotency-Key", idempotencyKey)
      .POST(HttpRequest.BodyPublishers.ofString("{}", StandardCharsets.UTF_8))
      .build())
    response.statusCode() match {
      case 200 | 201 => ()
      case status if definitiveRejection(status) =>
        // Un reembolso ya hecho también responde 4xx: se acepta si el pago figura reembolsado.
        if (!findPayment(paymentId).exists(_.providerStatus == "refunded"))
          throw new GatewayRequestRejected(status, errorReason(response.body()))
      case status => throw new GatewayUnavailable(s"Mercado Pago respondió HTTP $status al reembolsar")
    }
  }

  private def parsePayment(body: String): GatewayPayment =
    parsePayment(scala.util.Try(parse(body, useBigDecimalForDouble = true))
      .getOrElse(throw new GatewayUnavailable("Mercado Pago devolvió una respuesta ilegible")))

  private def text(value: JValue): Option[String] = value match {
    case JString(v) if v.trim.nonEmpty => Some(v.trim)
    case JInt(v) => Some(v.toString)
    case JLong(v) => Some(v.toString)
    case _ => None
  }

  private def parsePayment(json: JValue): GatewayPayment = {
    val id = text(json \ "id").getOrElse(throw new GatewayUnavailable("Mercado Pago devolvió un pago sin id"))
    val providerStatus = text(json \ "status").getOrElse("unknown").toLowerCase(Locale.ROOT)
    val amount = json \ "transaction_amount" match {
      case JInt(v) => BigDecimal(v)
      case JLong(v) => BigDecimal(v)
      case JDecimal(v) => v
      case JDouble(v) => BigDecimal(v)
      case _ => throw new GatewayUnavailable("Mercado Pago devolvió un pago sin importe")
    }
    val paymentType = text(json \ "payment_type_id").map(_.toLowerCase(Locale.ROOT))
    val methodId = text(json \ "payment_method_id").map(_.toLowerCase(Locale.ROOT))
    GatewayPayment(
      id = id,
      status = providerStatus match {
        case "approved" => "APROBADA"
        case "rejected" | "cancelled" | "refunded" | "charged_back" => "RECHAZADA"
        case _ => "PENDIENTE" // pending, in_process, authorized, in_mediation
      },
      providerStatus = providerStatus,
      statusDetail = text(json \ "status_detail").map(_.take(100)),
      externalReference = text(json \ "external_reference"),
      amount = amount,
      paymentMethod = paymentType.collect {
        case "credit_card" => "TARJETA_CREDITO"
        case "debit_card" | "prepaid_card" => "TARJETA_DEBITO"
      },
      cardBrand = methodId.map {
        case "visa" | "debvisa" => "VISA"
        case "master" | "debmaster" => "MASTERCARD"
        case "amex" => "AMEX"
        case "cabal" | "debcabal" => "CABAL"
        case other => other.toUpperCase(Locale.ROOT).take(20)
      },
      lastFour = text(json \ "card" \ "last_four_digits").filter(_.matches("^[0-9]{4}$"))
    )
  }
}

/**
 * Firma de los webhooks de Mercado Pago: header x-signature "ts=…,v1=…", donde v1 es
 * HMAC-SHA256 (hex) con la clave secreta del webhook sobre "id:[data.id];request-id:[x-request-id];ts:[ts];".
 */
object MercadoPagoWebhookSignature {
  private def hmacHex(secret: String, message: String): String = {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"))
    mac.doFinal(message.getBytes(StandardCharsets.UTF_8)).map(byte => f"${byte & 0xff}%02x").mkString
  }

  def manifest(dataId: Option[String], requestId: Option[String], timestamp: String): String = {
    val id = dataId.map(value => if (value.forall(_.isLetterOrDigit)) value.toLowerCase(Locale.ROOT) else value)
    id.map(value => s"id:$value;").getOrElse("") +
      requestId.map(value => s"request-id:$value;").getOrElse("") +
      s"ts:$timestamp;"
  }

  def isValid(secret: String, signatureHeader: Option[String], requestId: Option[String], dataId: Option[String]): Boolean =
    signatureHeader.exists { header =>
      val parts = header.split(",").iterator.map(_.trim.split("=", 2)).collect {
        case Array(key, value) => key.trim -> value.trim
      }.toMap
      (parts.get("ts"), parts.get("v1")) match {
        case (Some(timestamp), Some(received)) =>
          val expected = hmacHex(secret, manifest(dataId, requestId, timestamp))
          MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
            received.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8))
        case _ => false
      }
    }
}
