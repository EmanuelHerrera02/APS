package com.transport.system.documents

import java.nio.charset.StandardCharsets
import java.nio.file.Files

@main def documentTemplateSmoke(): Unit = {
  val examples = List(
    "pasaje.html" -> Map(
      "ticket_code" -> "TK-DEMO-001", "purchase_code" -> "AB12CD", "passenger_name" -> "Ana Ejemplo",
      "document_type" -> "DNI", "document_number" -> "12345678", "travel_class" -> "Economy",
      "origin" -> "Buenos Aires", "destination" -> "Córdoba", "flight_code" -> "AR-DEMO-01",
      "travel_date" -> "20/11/2026", "departure_time" -> "09:30", "arrival_time" -> "11:00",
      "issued_at" -> "16/10/2026 12:00"),
    "factura.html" -> Map(
      "issuer_name" -> "Aeronet Demo S.A.", "issuer_tax_id" -> "CUIT 30-12345678-9", "invoice_type" -> "C",
      "invoice_number" -> "INT-AB12CD", "invoice_date" -> "16/10/2026", "recipient_name" -> "Ana Ejemplo",
      "recipient_tax_id" -> "No informado", "purchase_code" -> "AB12CD", "payment_method" -> "Pago aprobado",
      "description" -> "Pasajes de vuelo AR-DEMO-01", "travel_date" -> "20/11/2026",
      "travel_class" -> "Ver detalle en los pasajes", "line_total" -> "ARS 45.000,00",
      "currency" -> "ARS", "invoice_total" -> "45.000,00"))

  val output = Files.createTempDirectory("aeronet-us10-pdf-smoke-")
  examples.foreach { case (templateName, values) =>
    val html = DocumentIssuanceService.render(templateName, values)
    require(html.contains("Ana Ejemplo") && html.contains("AB12CD"), s"Faltan datos en $templateName")
    require(!html.contains("{{"), s"Quedaron placeholders en $templateName")
    val bytes = DocumentIssuanceService.pdf(html)
    val signature = new String(bytes.take(5), StandardCharsets.US_ASCII)
    require(signature == "%PDF-" && bytes.length > 500, s"PDF inválido para $templateName")
    Files.write(output.resolve(templateName.replace(".html", ".pdf")), bytes)
    println(s"OK $templateName -> PDF (${bytes.length} bytes)")
  }
  println(s"PDF de muestra generado en $output; se utilizaron datos ficticios")
}
