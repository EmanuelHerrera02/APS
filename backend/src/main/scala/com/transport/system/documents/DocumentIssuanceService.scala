package com.transport.system.documents

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.nio.file.{Files, Path, Paths, StandardCopyOption}
import java.sql.{Connection, DriverManager}
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.util.Locale
import org.slf4j.LoggerFactory

object DocumentIssuanceService {
  private val logger = LoggerFactory.getLogger(getClass)
  private val dateFormat = DateTimeFormatter.ofPattern("dd/MM/yyyy")
  private val timeFormat = DateTimeFormatter.ofPattern("HH:mm")
  private val root = Paths.get(sys.env.getOrElse("AERONET_DOCUMENT_STORAGE", "var/documentos"))
    .toAbsolutePath.normalize()
  private val templateRoot = Paths.get(sys.env.getOrElse("AERONET_DOCUMENT_TEMPLATE_DIR", "docs/us10/templates"))
    .toAbsolutePath.normalize()

  private def connection(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  private def escape(value: String): String = Option(value).getOrElse("").flatMap {
    case '&' => "&amp;"
    case '<' => "&lt;"
    case '>' => "&gt;"
    case '"' => "&quot;"
    case '\'' => "&#39;"
    case char => char.toString
  }

  private[documents] def render(templateName: String, values: Map[String, String]): String = {
    val template = Files.readString(templateRoot.resolve(templateName), StandardCharsets.UTF_8)
    val token = "\\{\\{([a-z_]+)}}".r
    val rendered = token.replaceAllIn(template, matched => {
      val key = matched.group(1)
      escape(values.getOrElse(key, throw new IllegalArgumentException(s"Falta el campo de documento: $key")))
    })
    require(!"\\{\\{[^}]+}}".r.findFirstIn(rendered).isDefined, s"Quedaron campos sin resolver en $templateName")
    rendered
  }

  private[documents] def pdf(html: String): Array[Byte] = {
    val output = new ByteArrayOutputStream()
    new PdfRendererBuilder().withHtmlContent(html, null).toStream(output).run()
    output.toByteArray
  }

  private def formatMoney(value: java.math.BigDecimal): String =
    NumberFormat.getNumberInstance(Locale.forLanguageTag("es-AR")).format(value)

  private def writeAtomically(relativePath: Path, bytes: Array[Byte]): Path = {
    val destination = root.resolve(relativePath).normalize()
    require(destination.startsWith(root), "Ruta de documento inválida")
    Files.createDirectories(destination.getParent)
    val temporary = Files.createTempFile(destination.getParent, ".documento-", ".tmp")
    try {
      Files.write(temporary, bytes)
      Files.move(temporary, destination, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    } finally Files.deleteIfExists(temporary)
    destination
  }

  private def existingFile(relative: Option[String]): Boolean = relative.exists { value =>
    val path = root.resolve(value).normalize()
    path.startsWith(root) && Files.isRegularFile(path)
  }

  /**
   * Creates private PDF files for an already confirmed purchase and stores their
   * relative paths. The purchase row lock serializes duplicate worker runs.
   */
  def issueForConfirmedPurchase(purchaseId: Long): Int = {
    require(purchaseId > 0, "purchaseId debe ser positivo")
    val db = connection()
    val newlyWritten = scala.collection.mutable.ListBuffer.empty[Path]
    try {
      db.setAutoCommit(false)
      val purchaseStmt = db.prepareStatement(
        """SELECT c.id, c.codigo, c.estado, f.id AS factura_id, f.numero, f.tipo,
          |       f.fecha, f.total, f.receptor_nombre, f.receptor_cuit, f.ruta_pdf AS factura_pdf,
          |       s.fecha AS fecha_vuelo, s.hora_partida, s.hora_llegada, v.codigo AS codigo_vuelo,
          |       ao.codigo_iata AS origen, ao.ciudad AS ciudad_origen,
          |       ad.codigo_iata AS destino, ad.ciudad AS ciudad_destino
          |FROM compra c
          |JOIN salida s ON s.id = c.salida_id
          |JOIN vuelo v ON v.id = s.vuelo_id
          |JOIN aeropuerto ao ON ao.id = v.aeropuerto_origen_id
          |JOIN aeropuerto ad ON ad.id = v.aeropuerto_destino_id
          |LEFT JOIN factura f ON f.compra_id = c.id
          |WHERE c.id = ? FOR UPDATE""".stripMargin)
      purchaseStmt.setLong(1, purchaseId)
      val purchaseRs = purchaseStmt.executeQuery()
      if (!purchaseRs.next()) throw new IllegalArgumentException("No existe la compra indicada")
      if (purchaseRs.getString("estado") != "CONFIRMADA") {
        throw new IllegalStateException("Solo se generan documentos para compras CONFIRMADAS")
      }
      val invoiceId = purchaseRs.getLong("factura_id")
      if (purchaseRs.wasNull()) throw new IllegalStateException("La compra confirmada todavía no tiene factura")
      val purchaseCode = purchaseRs.getString("codigo")
      val invoiceCode = purchaseRs.getString("numero")
      val invoiceType = purchaseRs.getString("tipo")
      val invoiceDate = purchaseRs.getTimestamp("fecha").toLocalDateTime.toLocalDate.format(dateFormat)
      val invoiceTotal = purchaseRs.getBigDecimal("total")
      val recipientName = purchaseRs.getString("receptor_nombre")
      val recipientTaxId = Option(purchaseRs.getString("receptor_cuit")).getOrElse("No informado")
      val routeValues = Map(
        "origin" -> purchaseRs.getString("ciudad_origen"),
        "destination" -> purchaseRs.getString("ciudad_destino"),
        "flight_code" -> purchaseRs.getString("codigo_vuelo"),
        "travel_date" -> purchaseRs.getDate("fecha_vuelo").toLocalDate.format(dateFormat),
        "departure_time" -> purchaseRs.getTime("hora_partida").toLocalTime.format(timeFormat),
        "arrival_time" -> purchaseRs.getTime("hora_llegada").toLocalTime.format(timeFormat))
      val invoiceRelative = Paths.get(purchaseId.toString, s"factura-$invoiceId.pdf")
      var generated = 0
      if (!existingFile(Option(purchaseRs.getString("factura_pdf")))) {
        val invoiceHtml = render("factura.html", Map(
          "issuer_name" -> sys.env.getOrElse("AERONET_BILLING_ISSUER_NAME", "Aeronet"),
          "issuer_tax_id" -> sys.env.getOrElse("AERONET_BILLING_ISSUER_TAX_ID", "No informado"),
          "invoice_type" -> invoiceType, "invoice_number" -> invoiceCode, "invoice_date" -> invoiceDate,
          "recipient_name" -> recipientName, "recipient_tax_id" -> recipientTaxId,
          "purchase_code" -> purchaseCode, "payment_method" -> "Pago aprobado",
          "description" -> s"Pasajes de vuelo ${routeValues("flight_code")}",
          "travel_date" -> routeValues("travel_date"),
          "travel_class" -> "Ver detalle en los pasajes", "line_total" -> s"ARS ${formatMoney(invoiceTotal)}",
          "currency" -> "ARS", "invoice_total" -> formatMoney(invoiceTotal)))
        val path = writeAtomically(invoiceRelative, pdf(invoiceHtml))
        newlyWritten += path
        val update = db.prepareStatement("UPDATE factura SET ruta_pdf = ? WHERE id = ?")
        try { update.setString(1, invoiceRelative.toString.replace('\\', '/')); update.setLong(2, invoiceId); generated += update.executeUpdate() }
        finally update.close()
      }
      purchaseRs.close()
      purchaseStmt.close()

      val tickets = db.prepareStatement(
        "SELECT id, codigo, nombre, apellido, tipo_documento, numero_documento, clase, ruta_pdf " +
          "FROM pasaje WHERE compra_id = ? AND estado = 'EMITIDO' ORDER BY id")
      tickets.setLong(1, purchaseId)
      val ticketsRs = tickets.executeQuery()
      var ticketCount = 0
      while (ticketsRs.next()) {
        ticketCount += 1
        val ticketId = ticketsRs.getLong("id")
        val ticketRelative = Paths.get(purchaseId.toString, s"pasaje-$ticketId.pdf")
        if (!existingFile(Option(ticketsRs.getString("ruta_pdf")))) {
          val passengerName = s"${ticketsRs.getString("nombre")} ${ticketsRs.getString("apellido")}".trim
          val ticketHtml = render("pasaje.html", routeValues ++ Map(
            "ticket_code" -> ticketsRs.getString("codigo"), "purchase_code" -> purchaseCode,
            "passenger_name" -> passengerName, "document_type" -> ticketsRs.getString("tipo_documento"),
            "document_number" -> ticketsRs.getString("numero_documento"),
            "travel_class" -> (if (ticketsRs.getString("clase") == "PRIMERA") "Primera" else "Economy"),
            "issued_at" -> java.time.LocalDateTime.now().format(DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"))))
          val path = writeAtomically(ticketRelative, pdf(ticketHtml))
          newlyWritten += path
          val update = db.prepareStatement("UPDATE pasaje SET ruta_pdf = ? WHERE id = ?")
          try { update.setString(1, ticketRelative.toString.replace('\\', '/')); update.setLong(2, ticketId); generated += update.executeUpdate() }
          finally update.close()
        }
      }
      ticketsRs.close()
      tickets.close()
      if (ticketCount == 0) throw new IllegalStateException("La compra confirmada no contiene pasajes emitidos")
      db.commit()
      generated
    } catch {
      case ex: Throwable =>
        try db.rollback() catch { case rollbackError: Throwable => logger.warn("No se pudo revertir la emisión", rollbackError) }
        newlyWritten.foreach(path => try Files.deleteIfExists(path) catch { case cleanupError: Throwable => logger.warn("No se pudo limpiar un PDF temporal", cleanupError) })
        throw ex
    } finally db.close()
  }

  def pendingPurchaseIds(limit: Int = 25): List[Long] = {
    val db = connection()
    try {
      val stmt = db.prepareStatement(
        """SELECT c.id FROM compra c JOIN factura f ON f.compra_id=c.id
          |WHERE c.estado='CONFIRMADA' AND (f.ruta_pdf IS NULL OR EXISTS
          | (SELECT 1 FROM pasaje p WHERE p.compra_id=c.id AND p.estado='EMITIDO' AND p.ruta_pdf IS NULL))
          |ORDER BY c.confirmada_en, c.id LIMIT ?""".stripMargin)
      stmt.setInt(1, math.max(1, math.min(limit, 100)))
      val rs = stmt.executeQuery()
      val ids = scala.collection.mutable.ListBuffer.empty[Long]
      try while (rs.next()) ids += rs.getLong(1)
      finally { rs.close(); stmt.close() }
      ids.toList
    } finally db.close()
  }

  def generatePending(): Unit = pendingPurchaseIds().foreach { id =>
    try issueForConfirmedPurchase(id)
    catch { case ex: Exception => logger.error(s"No se pudieron generar los documentos de la compra $id", ex) }
  }
}
