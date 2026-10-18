package com.transport.system.payments

/**
 * Cobro con una tarjeta que la pasarela ya tokenizó en el navegador. El backend
 * solo recibe el token: nunca el número de tarjeta, el CVV ni el vencimiento.
 */
final case class CardPaymentRequest(
  idempotencyKey: String,
  amount: BigDecimal,
  description: String,
  externalReference: String,
  token: String,
  paymentMethodId: String,
  issuerId: Option[String],
  installments: Int,
  payerEmail: String,
  payerIdentification: Option[(String, String)]
)

/** Pago según la pasarela, con el estado ya normalizado a APROBADA, RECHAZADA o PENDIENTE. */
final case class GatewayPayment(
  id: String,
  status: String,
  providerStatus: String,
  statusDetail: Option[String],
  externalReference: Option[String],
  amount: BigDecimal,
  paymentMethod: Option[String],
  cardBrand: Option[String],
  lastFour: Option[String]
)

/** La pasarela rechazó la solicitud sin crear un pago (p. ej. token inválido): se puede reintentar. */
final class GatewayRequestRejected(val httpStatus: Int, val reason: String)
  extends RuntimeException(s"La pasarela rechazó la solicitud (HTTP $httpStatus): $reason")

/** No se sabe si la pasarela procesó la solicitud (timeout, 5xx): el resultado se obtiene conciliando. */
final class GatewayUnavailable(message: String, cause: Throwable = null) extends RuntimeException(message, cause)

/** Contrato que usa el resto del sistema; las particularidades de cada proveedor quedan en su implementación. */
trait PaymentGateway {
  def provider: String
  /** Datos que puede ver el navegador para tokenizar la tarjeta (nunca credenciales privadas). */
  def publicConfig: Map[String, Any]
  def createCardPayment(request: CardPaymentRequest): GatewayPayment
  def findPayment(paymentId: String): Option[GatewayPayment]
  def findByExternalReference(reference: String): Option[GatewayPayment]
  def refund(paymentId: String, idempotencyKey: String): Unit
}

object PaymentGateway {
  private def env(name: String): Option[String] = sys.env.get(name).map(_.trim).filter(_.nonEmpty)

  /** Pasarela configurada por variables de entorno; None deja el pago en línea deshabilitado. */
  lazy val configured: Option[PaymentGateway] =
    env("AERONET_PAYMENT_PROVIDER").map(_.toLowerCase(java.util.Locale.ROOT)) match {
      case Some("mercadopago") =>
        for {
          accessToken <- env("AERONET_MP_ACCESS_TOKEN")
          publicKey <- env("AERONET_MP_PUBLIC_KEY")
        } yield new MercadoPagoGateway(
          accessToken = accessToken,
          publicKey = publicKey,
          apiUrl = env("AERONET_MP_API_URL").getOrElse("https://api.mercadopago.com"),
          sdkUrl = env("AERONET_MP_SDK_URL").getOrElse("https://sdk.mercadopago.com/js/v2"),
          notificationUrl = env("AERONET_MP_NOTIFICATION_URL"),
          statementDescriptor = env("AERONET_MP_STATEMENT_DESCRIPTOR").getOrElse("AERONET"),
          environment = env("AERONET_MP_ENVIRONMENT").getOrElse("sandbox")
        )
      case _ => None
    }
}
