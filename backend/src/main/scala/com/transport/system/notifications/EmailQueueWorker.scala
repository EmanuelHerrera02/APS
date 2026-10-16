package com.transport.system.notifications

import jakarta.activation.FileDataSource
import jakarta.mail.{Authenticator, Message, MessagingException, PasswordAuthentication, Session, Transport}
import jakarta.mail.internet.{AddressException, InternetAddress, MimeBodyPart, MimeMessage, MimeMultipart}
import java.nio.file.{Files, Path, Paths}
import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.time.Duration
import java.sql.{Connection, DriverManager}
import java.util.Base64
import java.util.Properties
import org.json4s._
import org.json4s.native.JsonMethods._
import org.slf4j.LoggerFactory

private case class MailJob(id: Long, kind: String, recipient: String, purchaseId: Option[Long], attempts: Int)
private case class MailContent(subject: String, body: String, attachments: List[Path])

private class PermanentMailFailure(message: String, cause: Throwable = null) extends RuntimeException(message, cause)

object EmailQueueWorker {
  private val logger = LoggerFactory.getLogger(getClass)
  private val maxAttempts = 5
  private val storageRoot = Paths.get(sys.env.getOrElse("AERONET_DOCUMENT_STORAGE", "var/documentos"))
    .toAbsolutePath.normalize()

  private def provider: String = sys.env.getOrElse("AERONET_EMAIL_PROVIDER", "smtp").trim.toLowerCase(java.util.Locale.ROOT)

  def isConfigured: Boolean = provider match {
    case "smtp" => Seq("AERONET_SMTP_HOST", "AERONET_SMTP_FROM")
      .forall(key => sys.env.get(key).exists(_.trim.nonEmpty))
    case "sendgrid" => Seq("AERONET_SENDGRID_API_KEY", "AERONET_SMTP_FROM")
      .forall(key => sys.env.get(key).exists(_.trim.nonEmpty))
    case _ => false
  }

  private def db(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  private def smtpSession(): Session = {
    val properties = new Properties()
    properties.setProperty("mail.smtp.host", sys.env("AERONET_SMTP_HOST"))
    properties.setProperty("mail.smtp.port", sys.env.getOrElse("AERONET_SMTP_PORT", "587"))
    properties.setProperty("mail.smtp.auth", sys.env.get("AERONET_SMTP_USER").exists(_.nonEmpty).toString)
    properties.setProperty("mail.smtp.starttls.enable", sys.env.getOrElse("AERONET_SMTP_STARTTLS", "true"))
    properties.setProperty("mail.smtp.ssl.enable", sys.env.getOrElse("AERONET_SMTP_SSL", "false"))
    properties.setProperty("mail.smtp.connectiontimeout", "10000")
    properties.setProperty("mail.smtp.timeout", "15000")
    properties.setProperty("mail.smtp.writetimeout", "15000")
    val credentials = for {
      user <- sys.env.get("AERONET_SMTP_USER").filter(_.nonEmpty)
      password <- sys.env.get("AERONET_SMTP_PASSWORD")
    } yield (user, password)
    credentials match {
      case Some((user, password)) => Session.getInstance(properties, new Authenticator {
        override protected def getPasswordAuthentication: PasswordAuthentication =
          new PasswordAuthentication(user, password)
      })
      case None => Session.getInstance(properties)
    }
  }

  private def documentPaths(job: MailJob): List[Path] = job.purchaseId.toList.flatMap { purchaseId =>
    val connection = db()
    try {
      val invoice = connection.prepareStatement(
        "SELECT ruta_pdf FROM factura WHERE compra_id = ? AND ruta_pdf IS NOT NULL")
      invoice.setLong(1, purchaseId)
      val invoiceRs = invoice.executeQuery()
      val paths = scala.collection.mutable.ListBuffer.empty[String]
      try while (invoiceRs.next()) paths += invoiceRs.getString(1)
      finally { invoiceRs.close(); invoice.close() }

      val tickets = connection.prepareStatement(
        "SELECT ruta_pdf FROM pasaje WHERE compra_id = ? AND estado = 'EMITIDO' ORDER BY id")
      tickets.setLong(1, purchaseId)
      val ticketsRs = tickets.executeQuery()
      var ticketCount = 0
      var hasMissing = false
      try while (ticketsRs.next()) {
        ticketCount += 1
        Option(ticketsRs.getString(1)) match {
          case Some(path) => paths += path
          case None => hasMissing = true
        }
      } finally { ticketsRs.close(); tickets.close() }
      if (paths.isEmpty || ticketCount == 0 || hasMissing) Nil
      else paths.toList.map { value =>
        val path = storageRoot.resolve(value).normalize()
        if (!path.startsWith(storageRoot)) throw new IllegalArgumentException("La ruta del documento sale del almacenamiento privado")
        path
      }.filter(Files.isRegularFile(_)) match {
        case files if files.size == paths.size => files
        case _ => Nil
      }
    } finally connection.close()
  }

  private def content(job: MailJob): Option[MailContent] = {
    if (!Set("CONFIRMACION", "REENVIO").contains(job.kind) || job.purchaseId.isEmpty) {
      Some(MailContent(s"Notificación AeroNet: ${job.kind.toLowerCase(java.util.Locale.ROOT)}",
        "Tenés una actualización de tu gestión con AeroNet. Consultá el portal para ver los detalles.", Nil))
    } else {
      val attachments = documentPaths(job)
      if (attachments.isEmpty) None
      else {
        val connection = db()
        try {
          val query = connection.prepareStatement(
            """SELECT c.codigo, c.total, f.numero AS factura, s.fecha, s.hora_partida, s.hora_llegada,
              |       v.codigo AS vuelo, ao.ciudad AS origen, ad.ciudad AS destino,
              |       p.nombre, p.apellido, p.clase
              |FROM compra c JOIN factura f ON f.compra_id=c.id
              |JOIN salida s ON s.id=c.salida_id JOIN vuelo v ON v.id=s.vuelo_id
              |JOIN aeropuerto ao ON ao.id=v.aeropuerto_origen_id
              |JOIN aeropuerto ad ON ad.id=v.aeropuerto_destino_id
              |JOIN pasaje p ON p.compra_id=c.id AND p.estado='EMITIDO'
              |WHERE c.id=? AND c.estado='CONFIRMADA' ORDER BY p.id""".stripMargin)
          query.setLong(1, job.purchaseId.get)
          val rs = query.executeQuery()
          val detail = new StringBuilder
          var purchaseCode = ""
          var invoiceCode = ""
          try while (rs.next()) {
            purchaseCode = rs.getString("codigo")
            invoiceCode = rs.getString("factura")
            detail.append(s"Pasajero: ${rs.getString("nombre")} ${rs.getString("apellido")}\n")
            detail.append(s"Vuelo: ${rs.getString("vuelo")} — ${rs.getString("origen")} a ${rs.getString("destino")}\n")
            detail.append(s"Fecha: ${rs.getDate("fecha")} | Salida: ${rs.getTime("hora_partida")} | Llegada: ${rs.getTime("hora_llegada")}\n")
            detail.append(s"Clase: ${rs.getString("clase")}\n\n")
          } finally { rs.close(); query.close() }
          if (purchaseCode.isEmpty) None
          else {
            val body = s"Hola,\n\nAdjuntamos tus pasajes y la factura de la compra $purchaseCode.\n\n" +
              detail.toString + s"Factura: $invoiceCode\nTotal: ARS ${jobTotal(job.purchaseId.get)}\n\nAeroNet"
            Some(MailContent(s"Tus pasajes y factura — compra $purchaseCode", body, attachments))
          }
        } finally connection.close()
      }
    }
  }

  private def jobTotal(purchaseId: Long): String = {
    val connection = db()
    try {
      val statement = connection.prepareStatement("SELECT total FROM compra WHERE id = ? AND estado = 'CONFIRMADA'")
      statement.setLong(1, purchaseId)
      val rs = statement.executeQuery()
      try if (rs.next()) rs.getBigDecimal(1).toPlainString else "0.00"
      finally { rs.close(); statement.close() }
    } finally connection.close()
  }

  private def claim(limit: Int = 10): List[MailJob] = {
    val connection = db()
    try {
      connection.setAutoCommit(false)
      val query = connection.prepareStatement(
        """SELECT id, tipo, destinatario, compra_id, intentos FROM notificacion
          |WHERE canal='EMAIL' AND estado IN ('PENDIENTE','FALLIDA','PROCESANDO')
          |  AND intentos < ? AND programada_para <= NOW()
          |  AND (estado <> 'PROCESANDO' OR updated_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE))
          |  AND (tipo NOT IN ('CONFIRMACION','REENVIO') OR compra_id IS NULL OR EXISTS (
          |    SELECT 1 FROM factura f JOIN compra c ON c.id=f.compra_id
          |    WHERE f.compra_id=notificacion.compra_id AND c.estado='CONFIRMADA'
          |      AND f.ruta_pdf IS NOT NULL
          |      AND NOT EXISTS (SELECT 1 FROM pasaje p WHERE p.compra_id=c.id
          |                       AND p.estado='EMITIDO' AND p.ruta_pdf IS NULL)))
          |ORDER BY programada_para, id LIMIT ? FOR UPDATE SKIP LOCKED""".stripMargin)
      query.setInt(1, maxAttempts)
      query.setInt(2, limit)
      val rs = query.executeQuery()
      val jobs = scala.collection.mutable.ListBuffer.empty[MailJob]
      try while (rs.next()) {
        val purchaseId = rs.getLong("compra_id")
        val optionalPurchase = if (rs.wasNull()) None else Some(purchaseId)
        jobs += MailJob(rs.getLong("id"), rs.getString("tipo"), rs.getString("destinatario"),
          optionalPurchase, rs.getInt("intentos"))
      } finally { rs.close(); query.close() }
      jobs.foreach { job =>
        val update = connection.prepareStatement("UPDATE notificacion SET estado='PROCESANDO' WHERE id=?")
        try { update.setLong(1, job.id); update.executeUpdate() } finally update.close()
      }
      connection.commit()
      jobs.toList
    } catch {
      case ex: Throwable => connection.rollback(); throw ex
    } finally connection.close()
  }

  private def send(job: MailJob, content: MailContent): Unit = {
    if (provider == "sendgrid") {
      sendWithSendGrid(job, content)
      return
    }
    val message = new MimeMessage(smtpSession())
    message.setFrom(new InternetAddress(sys.env("AERONET_SMTP_FROM")))
    message.setRecipients(Message.RecipientType.TO,
      InternetAddress.parse(job.recipient, false).map(address => address: jakarta.mail.Address))
    // Providers that expose original/custom message headers can use this value to
    // correlate delivery callbacks with the outbox row without exposing PII.
    message.setHeader("X-Aeronet-Notification-ID", job.id.toString)
    message.setSubject(content.subject, "UTF-8")
    val multipart = new MimeMultipart()
    val text = new MimeBodyPart()
    text.setText(content.body, "UTF-8")
    multipart.addBodyPart(text)
    content.attachments.foreach { path =>
      val attachment = new MimeBodyPart()
      attachment.setDataHandler(new jakarta.activation.DataHandler(new FileDataSource(path.toFile)))
      attachment.setFileName(path.getFileName.toString)
      multipart.addBodyPart(attachment)
    }
    message.setContent(multipart)
    Transport.send(message)
  }

  /** Sends through SendGrid v3 while carrying a non-PII outbox ID into event callbacks. */
  private def sendWithSendGrid(job: MailJob, content: MailContent): Unit = {
    val attachments = content.attachments.map { path =>
      val mimeType = Option(Files.probeContentType(path)).getOrElse("application/octet-stream")
      JObject(
        "content" -> JString(Base64.getEncoder.encodeToString(Files.readAllBytes(path))),
        "type" -> JString(mimeType),
        "filename" -> JString(path.getFileName.toString),
        "disposition" -> JString("attachment")
      )
    }
    val payload = JObject(
      "personalizations" -> JArray(List(JObject(
        "to" -> JArray(List(JObject("email" -> JString(job.recipient)))),
        "custom_args" -> JObject("notification_id" -> JString(job.id.toString))
      ))),
      "from" -> JObject("email" -> JString(sys.env("AERONET_SMTP_FROM"))),
      "subject" -> JString(content.subject),
      "content" -> JArray(List(JObject("type" -> JString("text/plain"), "value" -> JString(content.body)))),
      "headers" -> JObject("X-Aeronet-Notification-ID" -> JString(job.id.toString)),
      "attachments" -> JArray(attachments)
    )
    val request = HttpRequest.newBuilder(URI.create("https://api.sendgrid.com/v3/mail/send"))
      .timeout(Duration.ofSeconds(20))
      .header("Authorization", s"Bearer ${sys.env("AERONET_SENDGRID_API_KEY")}")
      .header("Content-Type", "application/json")
      .POST(HttpRequest.BodyPublishers.ofString(compact(render(payload)), java.nio.charset.StandardCharsets.UTF_8))
      .build()
    val response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build()
      .send(request, HttpResponse.BodyHandlers.ofString())
    if (response.statusCode() != 202) {
      // Never include response bodies: providers may echo recipient or account details.
      throw new RuntimeException(s"SendGrid Mail Send rechazó el mensaje (HTTP ${response.statusCode()})")
    }
  }

  private def permanentAddressFailure(error: Throwable): Boolean = {
    var current = error
    while (current != null) {
      if (current.isInstanceOf[AddressException]) return true
      if (current.getClass.getSimpleName == "SMTPAddressFailedException") {
        val code = try current.getClass.getMethod("getReturnCode").invoke(current).asInstanceOf[Int]
          catch { case _: Exception => 0 }
        if (code >= 500) return true
      }
      current = current match {
        case mail: MessagingException if mail.getNextException != null => mail.getNextException
        case other => other.getCause
      }
    }
    false
  }

  private def update(job: MailJob, state: String, attempts: Int, error: Option[String], delaySeconds: Int): Unit = {
    val connection = db()
    try {
      val query = connection.prepareStatement(
        "UPDATE notificacion SET estado=?, intentos=?, ultimo_error=?, " +
          "programada_para=DATE_ADD(NOW(), INTERVAL ? SECOND), " +
          "enviada_en=CASE WHEN ? IN ('ENVIADA','ENTREGADA') THEN NOW() ELSE enviada_en END WHERE id=?")
      try {
        query.setString(1, state)
        query.setInt(2, attempts)
        error match { case Some(value) => query.setString(3, value.take(500)); case None => query.setNull(3, java.sql.Types.VARCHAR) }
        query.setInt(4, delaySeconds)
        query.setString(5, state)
        query.setLong(6, job.id)
        query.executeUpdate()
      } finally query.close()
    } finally connection.close()
  }

  /** Emits low-cardinality queue health and delivery latency without logging addresses or secrets. */
  def logMetrics(): Unit = {
    val connection = db()
    try {
      val statement = connection.prepareStatement(
        """SELECT
          |  SUM(estado IN ('PENDIENTE','PROCESANDO')) AS active_count,
          |  COALESCE(MAX(CASE WHEN estado IN ('PENDIENTE','PROCESANDO')
          |    THEN TIMESTAMPDIFF(SECOND, created_at, NOW()) END), 0) AS oldest_age_seconds,
          |  SUM(estado='ENVIADA' AND enviada_en >= DATE_SUB(NOW(), INTERVAL 1 HOUR)) AS accepted_last_hour,
          |  COALESCE(AVG(CASE WHEN estado='ENVIADA' AND enviada_en >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          |    THEN TIMESTAMPDIFF(SECOND, created_at, enviada_en) END), 0) AS avg_latency_seconds,
          |  SUM(estado='ENTREGADA' AND updated_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)) AS delivered_last_hour,
          |  COALESCE(AVG(CASE WHEN estado='ENTREGADA' AND updated_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          |    THEN (SELECT TIMESTAMPDIFF(SECOND, n.created_at, MIN(e.received_at))
          |          FROM email_delivery_event e WHERE e.notification_id=n.id AND e.provider_status='DELIVERED') END), 0)
          |    AS avg_delivery_seconds,
          |  SUM(estado='ENTREGADA' AND updated_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          |    AND (SELECT TIMESTAMPDIFF(SECOND, n.created_at, MIN(e.received_at))
          |         FROM email_delivery_event e WHERE e.notification_id=n.id AND e.provider_status='DELIVERED') < 120)
          |    AS delivered_under_2m_last_hour,
          |  SUM(estado='REBOTADA' AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS bounced_last_day,
          |  SUM(estado='FALLIDA' AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS failed_last_day,
          |  SUM(estado='FALLIDA' AND intentos >= ?) AS exhausted_count
          |FROM notificacion n WHERE canal='EMAIL'""".stripMargin)
      statement.setInt(1, maxAttempts)
      val rs = statement.executeQuery()
      try if (rs.next()) logger.info(
        "email_queue_metrics active={} oldest_age_seconds={} accepted_last_hour={} avg_acceptance_seconds={} delivered_last_hour={} avg_delivery_seconds={} delivered_under_2m_last_hour={} bounced_last_24h={} failed_last_24h={} exhausted={}",
        Long.box(rs.getLong("active_count")), Long.box(rs.getLong("oldest_age_seconds")),
        Long.box(rs.getLong("accepted_last_hour")), Double.box(rs.getDouble("avg_latency_seconds")),
        Long.box(rs.getLong("delivered_last_hour")), Double.box(rs.getDouble("avg_delivery_seconds")),
        Long.box(rs.getLong("delivered_under_2m_last_hour")),
        Long.box(rs.getLong("bounced_last_day")), Long.box(rs.getLong("failed_last_day")),
        Long.box(rs.getLong("exhausted_count")))
      finally { rs.close(); statement.close() }
    } finally connection.close()
  }

  def processBatch(): Int = {
    if (!isConfigured) return 0
    val jobs = claim()
    jobs.foreach { job =>
      try content(job) match {
        case None => update(job, "PENDIENTE", job.attempts, Some("Esperando la generación de pasajes y factura"), 15)
        case Some(mail) =>
          val started = System.nanoTime()
          send(job, mail)
          // SMTP acceptance confirms handoff to the provider, not final inbox delivery.
          update(job, "ENVIADA", job.attempts + 1, None, 0)
          logger.info("email_accepted notification_id={} attempt={} processing_ms={}",
            Long.box(job.id), Int.box(job.attempts + 1), Long.box((System.nanoTime() - started) / 1000000L))
      } catch {
        case ex: Exception if permanentAddressFailure(ex) =>
          update(job, "REBOTADA", job.attempts + 1, Some(Option(ex.getMessage).getOrElse("Destinatario rechazado")), 0)
        case ex: Exception =>
          val attempts = job.attempts + 1
          val waitSeconds = Vector(30, 120, 600, 1800).lift(job.attempts).getOrElse(1800)
          val message = Option(ex.getMessage).getOrElse(ex.getClass.getSimpleName)
          update(job, "FALLIDA", attempts, Some(message), if (attempts >= maxAttempts) 86400 else waitSeconds)
          logger.warn(s"Fallo en el envío de notificación ${job.id}, intento $attempts/$maxAttempts", ex)
          if (attempts >= maxAttempts) logger.error(s"Se agotaron los reintentos de la notificación ${job.id}")
      }
    }
    jobs.length
  }
}
