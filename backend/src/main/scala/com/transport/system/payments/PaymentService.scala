package com.transport.system.payments

import java.nio.charset.StandardCharsets
import java.sql.{Connection, DriverManager, SQLException, Types}
import java.util.UUID
import org.slf4j.LoggerFactory

/** Error con el estado HTTP que corresponde informar al cliente. */
final class PaymentFailure(val status: Int, message: String) extends RuntimeException(message)

/** Token y datos no sensibles que devuelve el formulario seguro de la pasarela. */
final case class CardSubmission(
  token: String,
  paymentMethodId: String,
  issuerId: Option[String],
  installments: Int,
  payerEmail: Option[String],
  payerIdentification: Option[(String, String)]
)

/**
 * Orquesta el pago en línea: crea transacciones con uuid, las envía a la pasarela con
 * ese uuid como clave de idempotencia y aplica el resultado (respuesta sincrónica,
 * webhook o conciliación) mediante los procedimientos de la base, que son idempotentes.
 */
object PaymentService {
  private val logger = LoggerFactory.getLogger(getClass)
  private val uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$".r

  def gateway: Option[PaymentGateway] = PaymentGateway.configured

  def isTransactionId(value: String): Boolean = uuidPattern.findFirstIn(value).isDefined

  private def requireGateway(): PaymentGateway =
    gateway.getOrElse(throw new PaymentFailure(503, "El pago en línea no está configurado"))

  private def withConnection[T](work: Connection => T): T = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    val connection = DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
    try work(connection) finally connection.close()
  }

  /** Traduce los SIGNAL de negocio (SQLSTATE 45000) a un estado HTTP; el resto se propaga. */
  private def businessRule[T](work: => T): T =
    try work
    catch {
      case ex: SQLException if Option(ex.getSQLState).contains("45000") =>
        val message = Option(ex.getMessage).getOrElse("No se pudo procesar el pago").replaceFirst("^\\(conn=\\d+\\)\\s*", "")
        val status =
          if (message.startsWith("La compra no existe") || message.startsWith("La transacción de pago no existe")) 404
          else if (message.contains("pendiente de pago") || message.contains("vencida")) 409
          else 422
        throw new PaymentFailure(status, message)
    }

  /** Crea la transacción de la compra o devuelve la que ya está activa (dos clics obtienen el mismo uuid). */
  def start(userId: Long, purchaseId: Long): Map[String, Any] = {
    requireGateway()
    businessRule(withConnection { connection =>
      val call = connection.prepareCall("{call iniciar_transaccion_pago(?, ?, ?, ?)}")
      val transactionId = try {
        call.setLong(1, purchaseId)
        call.setLong(2, userId)
        call.setString(3, UUID.randomUUID().toString)
        call.registerOutParameter(4, Types.VARCHAR)
        call.execute()
        call.getString(4)
      } finally call.close()
      view(connection, transactionId, Some(userId))
        .getOrElse(throw new IllegalStateException("No se encontró la transacción creada"))
    })
  }

  def status(userId: Long, transactionId: String): Option[Map[String, Any]] =
    if (!isTransactionId(transactionId)) None
    else withConnection(view(_, transactionId, Some(userId)))

  /**
   * Envía la tarjeta tokenizada a la pasarela. Si la transacción ya avanzó (reintento del
   * cliente o doble clic), devuelve el estado guardado sin volver a cobrar.
   */
  def process(userId: Long, transactionId: String, card: CardSubmission): Map[String, Any] = {
    val paymentGateway = requireGateway()
    if (!isTransactionId(transactionId)) throw new PaymentFailure(404, "La transacción de pago no existe")

    val (action, amount, purchaseCode, contactEmail) = businessRule(withConnection { connection =>
      val call = connection.prepareCall("{call tomar_transaccion_pago(?, ?, ?)}")
      val action = try {
        call.setString(1, transactionId)
        call.setLong(2, userId)
        call.registerOutParameter(3, Types.VARCHAR)
        call.execute()
        call.getString(3)
      } finally call.close()
      val query = connection.prepareStatement(
        "SELECT t.monto, c.codigo, c.email_contacto FROM transaccion_pago t JOIN compra c ON c.id = t.compra_id WHERE t.uuid = ?")
      try {
        query.setString(1, transactionId)
        val rs = query.executeQuery()
        try {
          if (!rs.next()) throw new PaymentFailure(404, "La transacción de pago no existe")
          (action, BigDecimal(rs.getBigDecimal(1)), rs.getString(2), rs.getString(3))
        } finally rs.close()
      } finally query.close()
    })

    if (action == "PROCESAR") {
      val request = CardPaymentRequest(
        idempotencyKey = transactionId,
        amount = amount,
        description = s"AeroNet - compra $purchaseCode",
        externalReference = transactionId,
        token = card.token,
        paymentMethodId = card.paymentMethodId,
        issuerId = card.issuerId,
        installments = card.installments,
        payerEmail = card.payerEmail.getOrElse(contactEmail),
        payerIdentification = card.payerIdentification
      )
      try {
        val payment = paymentGateway.createCardPayment(request)
        if (!payment.externalReference.forall(_ == transactionId))
          throw new GatewayUnavailable("La pasarela devolvió un pago de otra transacción")
        val result = applyPayment(transactionId, payment)
        logger.info("payment_processed transaction={} gateway_payment={} status={} result={}",
          transactionId, payment.id, payment.status, result)
      } catch {
        case rejected: GatewayRequestRejected =>
          markError(transactionId, rejected.reason)
          logger.warn("payment_request_rejected transaction={} http_status={} reason={}",
            transactionId, Int.box(rejected.httpStatus), rejected.reason)
        case unavailable: GatewayUnavailable =>
          // Resultado incierto: queda PROCESANDO y el conciliador lo busca por external_reference.
          logger.warn(s"payment_result_unknown transaction=$transactionId: ${unavailable.getMessage}")
      }
    }
    status(userId, transactionId).getOrElse(throw new PaymentFailure(404, "La transacción de pago no existe"))
  }

  /** Webhook: consulta el pago en la pasarela (no confía en el cuerpo recibido) y aplica su estado. */
  def synchronize(gatewayPaymentId: String): String = {
    val paymentGateway = requireGateway()
    paymentGateway.findPayment(gatewayPaymentId) match {
      case Some(payment) => payment.externalReference.filter(isTransactionId) match {
        case Some(transactionId) if exists(transactionId) => applyPayment(transactionId, payment)
        case _ => "IGNORADO"
      }
      case None => "IGNORADO"
    }
  }

  private def exists(transactionId: String): Boolean = withConnection { connection =>
    val query = connection.prepareStatement("SELECT 1 FROM transaccion_pago WHERE uuid = ?")
    try {
      query.setString(1, transactionId)
      val rs = query.executeQuery()
      try rs.next() finally rs.close()
    } finally query.close()
  }

  /** Aplica el estado de la pasarela; si el pago se aprobó con la reserva ya vencida, lo reembolsa. */
  private def applyPayment(transactionId: String, payment: GatewayPayment): String = {
    if (payment.status != "PENDIENTE" && (payment.paymentMethod.isEmpty || payment.lastFour.isEmpty))
      throw new GatewayUnavailable("La pasarela no informó el medio de pago o los últimos dígitos de la tarjeta")
    val result = withConnection { connection =>
      val call = connection.prepareCall("{call resolver_transaccion_pago(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)}")
      try {
        call.setString(1, transactionId)
        call.setString(2, payment.status)
        call.setString(3, payment.id)
        call.setString(4, payment.providerStatus.take(40))
        payment.statusDetail match {
          case Some(detail) => call.setString(5, detail.take(100))
          case None => call.setNull(5, Types.VARCHAR)
        }
        call.setBigDecimal(6, payment.amount.bigDecimal)
        payment.paymentMethod match {
          case Some(method) => call.setString(7, method)
          case None => call.setNull(7, Types.VARCHAR)
        }
        payment.cardBrand match {
          case Some(brand) => call.setString(8, brand)
          case None => call.setNull(8, Types.VARCHAR)
        }
        payment.lastFour match {
          case Some(lastFour) => call.setString(9, lastFour)
          case None => call.setNull(9, Types.CHAR)
        }
        call.registerOutParameter(10, Types.VARCHAR)
        call.execute()
        Option(call.getString(10)).getOrElse("")
      } finally call.close()
    }
    if (result == "REQUIERE_REEMBOLSO") refund(transactionId, payment.id)
    result
  }

  private def refund(transactionId: String, gatewayPaymentId: String): Unit = {
    val paymentGateway = requireGateway()
    try {
      val refundKey = UUID.nameUUIDFromBytes(s"refund:$transactionId".getBytes(StandardCharsets.UTF_8)).toString
      paymentGateway.refund(gatewayPaymentId, refundKey)
      withConnection { connection =>
        val call = connection.prepareCall("{call registrar_reembolso_transaccion(?)}")
        try { call.setString(1, transactionId); call.execute() } finally call.close()
      }
      logger.info("payment_refunded transaction={} gateway_payment={}", transactionId, gatewayPaymentId)
    } catch {
      case ex: Exception =>
        // Queda APROBADA con REQUIERE_REEMBOLSO: el conciliador reintenta.
        logger.error(s"No se pudo reembolsar la transacción $transactionId", ex)
    }
  }

  private def markError(transactionId: String, reason: String): Unit = withConnection { connection =>
    val update = connection.prepareStatement(
      "UPDATE transaccion_pago SET estado = 'ERROR', detalle_estado = ? WHERE uuid = ? AND estado IN ('CREADA', 'PROCESANDO')")
    try {
      update.setString(1, reason.take(100))
      update.setString(2, transactionId)
      update.executeUpdate()
    } finally update.close()
  }

  private final case class PendingTransaction(id: String, state: String, gatewayId: Option[String], ageSeconds: Long)

  /**
   * Polling de respaldo para los pagos sin respuesta final: consulta la pasarela por id de
   * pago o por external_reference (si la respuesta original se perdió) y aplica el estado.
   * También reintenta reembolsos pendientes. Devuelve la cantidad de transacciones revisadas.
   */
  def reconcile(): Int = {
    gateway.fold(0)(reconcileWith)
  }

  private def reconcileWith(paymentGateway: PaymentGateway): Int = {
    val candidates = withConnection { connection =>
      val query = connection.prepareStatement(
        """SELECT uuid, estado, id_pago_pasarela, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS edad
          |FROM transaccion_pago
          |WHERE (estado IN ('PROCESANDO', 'PENDIENTE')
          |       AND created_at >= NOW() - INTERVAL 7 DAY
          |       AND updated_at <= NOW() - INTERVAL LEAST(15 * (consultas + 1), 300) SECOND)
          |   OR (estado = 'APROBADA' AND resultado_compra = 'REQUIERE_REEMBOLSO')
          |ORDER BY updated_at, id LIMIT 20""".stripMargin)
      try {
        val rs = query.executeQuery()
        val rows = scala.collection.mutable.ListBuffer.empty[PendingTransaction]
        try while (rs.next()) rows += PendingTransaction(rs.getString(1), rs.getString(2),
          Option(rs.getString(3)), rs.getLong(4))
        finally rs.close()
        rows.toList
      } finally query.close()
    }
    candidates.foreach { transaction =>
      try {
        if (transaction.state == "APROBADA") transaction.gatewayId.foreach(refund(transaction.id, _))
        else {
          val payment = transaction.gatewayId match {
            case Some(id) => paymentGateway.findPayment(id)
            case None => paymentGateway.findByExternalReference(transaction.id)
          }
          payment.filter(_.externalReference.forall(_ == transaction.id)) match {
            case Some(found) => applyPayment(transaction.id, found)
            case None if transaction.state == "PROCESANDO" && transaction.ageSeconds > 900 =>
              markError(transaction.id, "La pasarela no registró el pago")
            case None => ()
          }
          withConnection { connection =>
            val update = connection.prepareStatement(
              "UPDATE transaccion_pago SET consultas = consultas + 1 WHERE uuid = ? AND estado IN ('PROCESANDO', 'PENDIENTE')")
            try { update.setString(1, transaction.id); update.executeUpdate() } finally update.close()
          }
        }
      } catch {
        case ex: Exception => logger.warn(s"No se pudo conciliar la transacción ${transaction.id}: ${ex.getMessage}")
      }
    }
    candidates.size
  }

  private def message(status: String, detail: Option[String], purchaseResult: Option[String]): String = status match {
    case "CREADA" => "Ingresá los datos de la tarjeta en el formulario seguro de Mercado Pago."
    case "PROCESANDO" => "Estamos confirmando el pago con la pasarela…"
    case "PENDIENTE" => "El pago quedó en revisión en la pasarela. Te avisaremos por email apenas se confirme."
    case "APROBADA" if purchaseResult.contains("REQUIERE_REEMBOLSO") =>
      "El pago se acreditó después de que venció la reserva: estamos procesando el reembolso."
    case "APROBADA" => "¡Pago aprobado! Tus pasajes están confirmados; te enviamos los pasajes y la factura por email."
    case "REEMBOLSADA" => "El pago se acreditó después de que venció la reserva y fue reembolsado."
    case "ERROR" => "No pudimos procesar la tarjeta. Revisá los datos e intentá nuevamente."
    case "RECHAZADA" =>
      val reason = detail.getOrElse("") match {
        case "cc_rejected_insufficient_amount" => "La tarjeta no tiene fondos suficientes."
        case "cc_rejected_bad_filled_security_code" => "El código de seguridad es incorrecto."
        case "cc_rejected_bad_filled_date" => "La fecha de vencimiento es incorrecta."
        case "cc_rejected_bad_filled_card_number" | "cc_rejected_bad_filled_other" => "Revisá los datos de la tarjeta."
        case "cc_rejected_call_for_authorize" => "Tenés que autorizar el pago con el emisor de la tarjeta."
        case "cc_rejected_card_disabled" => "La tarjeta está inhabilitada; comunicate con el emisor."
        case "cc_rejected_duplicated_payment" => "Ya hiciste un pago por ese importe."
        case "cc_rejected_high_risk" => "La pasarela rechazó el pago por prevención de fraude."
        case _ => "La pasarela rechazó el pago."
      }
      if (purchaseResult.contains("CANCELADA")) s"$reason Liberamos los asientos reservados; podés iniciar una nueva compra."
      else reason
    case _ => "Estado de pago desconocido."
  }

  private def view(connection: Connection, transactionId: String, userId: Option[Long]): Option[Map[String, Any]] = {
    val query = connection.prepareStatement(
      """SELECT t.uuid, t.compra_id, t.monto, t.moneda, t.estado, t.estado_pasarela, t.detalle_estado,
        |       t.resultado_compra, t.id_pago_pasarela, t.created_at, t.updated_at,
        |       c.codigo, c.estado AS compra_estado, c.email_contacto, c.usuario_id,
        |       GREATEST(TIMESTAMPDIFF(SECOND, NOW(), c.expira_en), 0) AS segundos_restantes
        |FROM transaccion_pago t JOIN compra c ON c.id = t.compra_id
        |WHERE t.uuid = ?""".stripMargin)
    try {
      query.setString(1, transactionId)
      val rs = query.executeQuery()
      try {
        if (!rs.next()) None
        else {
          val owner = rs.getLong("usuario_id")
          val ownerMissing = rs.wasNull()
          val ownerMatches = userId.forall(id => !ownerMissing && owner == id)
          if (!ownerMatches) None
          else {
            val state = rs.getString("estado")
            val detail = Option(rs.getString("detalle_estado"))
            val purchaseResult = Option(rs.getString("resultado_compra"))
            val purchaseState = rs.getString("compra_estado")
            Some(Map(
              "id" -> rs.getString("uuid"),
              "purchaseId" -> rs.getLong("compra_id"),
              "purchaseCode" -> rs.getString("codigo"),
              "amount" -> rs.getBigDecimal("monto"),
              "currency" -> rs.getString("moneda"),
              "status" -> state,
              "providerStatus" -> Option(rs.getString("estado_pasarela")).orNull,
              "statusDetail" -> detail.orNull,
              "gatewayPaymentId" -> Option(rs.getString("id_pago_pasarela")).orNull,
              "purchaseStatus" -> purchaseState,
              "purchaseResult" -> purchaseResult.orNull,
              "payerEmail" -> rs.getString("email_contacto"),
              "secondsToExpire" -> (if (purchaseState == "PENDIENTE_PAGO") rs.getLong("segundos_restantes") else 0L),
              "createdAt" -> rs.getTimestamp("created_at").toLocalDateTime.toString,
              "updatedAt" -> rs.getTimestamp("updated_at").toLocalDateTime.toString,
              "message" -> message(state, detail, purchaseResult)
            ))
          }
        }
      } finally rs.close()
    } finally query.close()
  }
}
