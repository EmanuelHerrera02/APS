package com.transport.system.security

import java.sql.{Connection, DriverManager}
import scala.collection.mutable

/** Search and document-resend actions available to authenticated counter employees. */
object EmployeePurchaseRepository {
  private def connection(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  /** Matches purchase code, buyer/contact email, passenger document, or passenger surname. */
  def search(term: String): List[Map[String, Any]] = {
    val value = Option(term).getOrElse("").trim
    if (value.isEmpty || value.length > 120) throw new IllegalArgumentException("Ingresá un criterio de hasta 120 caracteres")
    val escaped = value.replace("!", "!!").replace("%", "!%").replace("_", "!_")
    val conn = connection()
    try {
      val statement = conn.prepareStatement(
        """SELECT c.id,c.codigo,c.estado,c.total,c.email_contacto,s.fecha,s.hora_partida,s.hora_llegada,
          |       v.codigo AS vuelo,ao.ciudad AS origen,ad.ciudad AS destino,
          |       f.numero AS factura,p.id AS pasaje_id,p.nombre,p.apellido,p.tipo_documento,
          |       p.numero_documento,p.clase,p.precio AS precio_pasaje,p.estado AS estado_pasaje
          |FROM compra c JOIN salida s ON s.id=c.salida_id JOIN vuelo v ON v.id=s.vuelo_id
          |JOIN aeropuerto ao ON ao.id=v.aeropuerto_origen_id JOIN aeropuerto ad ON ad.id=v.aeropuerto_destino_id
          |LEFT JOIN usuario u ON u.id=c.usuario_id LEFT JOIN factura f ON f.compra_id=c.id
          |JOIN pasaje p ON p.compra_id=c.id
          |WHERE c.codigo=? OR c.email_contacto=? OR u.email=?
          |   OR EXISTS (SELECT 1 FROM pasaje px WHERE px.compra_id=c.id
          |      AND (px.numero_documento=? OR px.apellido LIKE ? ESCAPE '!'))
          |ORDER BY c.created_at DESC,c.id DESC,p.id LIMIT 500""".stripMargin)
      statement.setString(1, value.toUpperCase(java.util.Locale.ROOT))
      statement.setString(2, value)
      statement.setString(3, value)
      statement.setString(4, value)
      statement.setString(5, s"%$escaped%")
      val rs = statement.executeQuery()
      val purchases = mutable.LinkedHashMap.empty[Long, mutable.Map[String, Any]]
      try while (rs.next()) {
        val id = rs.getLong("id")
        val record = purchases.getOrElseUpdate(id, mutable.Map[String, Any](
          "id" -> id, "code" -> rs.getString("codigo"), "status" -> rs.getString("estado"),
          "total" -> rs.getBigDecimal("total"), "email" -> rs.getString("email_contacto"),
          "flight" -> rs.getString("vuelo"), "origin" -> rs.getString("origen"),
          "destination" -> rs.getString("destino"), "date" -> rs.getDate("fecha").toString,
          "departureTime" -> rs.getTime("hora_partida").toString,
          "arrivalTime" -> rs.getTime("hora_llegada").toString,
          "invoiceNumber" -> Option(rs.getString("factura")).orNull,
          "passengers" -> mutable.ListBuffer.empty[Map[String, Any]]))
        record("passengers").asInstanceOf[mutable.ListBuffer[Map[String, Any]]] += Map(
          "ticketId" -> rs.getLong("pasaje_id"), "firstName" -> rs.getString("nombre"),
          "lastName" -> rs.getString("apellido"), "documentType" -> rs.getString("tipo_documento"),
          "documentNumber" -> rs.getString("numero_documento"), "class" -> rs.getString("clase"),
          "fare" -> rs.getBigDecimal("precio_pasaje"), "ticketStatus" -> rs.getString("estado_pasaje"))
      } finally { rs.close(); statement.close() }
      purchases.valuesIterator.map { purchase =>
        purchase("passengers") = purchase("passengers").asInstanceOf[mutable.ListBuffer[Map[String, Any]]].toList
        purchase.toMap
      }.toList
    } finally conn.close()
  }

  /** Enqueues a resend through the existing transactional outbox and records the requesting employee. */
  def resend(purchaseId: Long, employeeId: Long, recipientOverride: Option[String]): Map[String, Any] = {
    val conn = connection()
    conn.setAutoCommit(false)
    try {
      val call = conn.prepareCall("{call reenviar_documentacion(?,?,?)}")
      try {
        call.setLong(1, purchaseId)
        call.setLong(2, employeeId)
        recipientOverride match {
          case Some(email) => call.setString(3, email)
          case None => call.setNull(3, java.sql.Types.VARCHAR)
        }
        call.execute()
      } finally call.close()
      val query = conn.createStatement()
      val rs = query.executeQuery("SELECT LAST_INSERT_ID()")
      val notificationId = try { rs.next(); rs.getLong(1) } finally { rs.close(); query.close() }
      val recipientQuery = conn.prepareStatement("SELECT destinatario FROM notificacion WHERE id=? AND solicitado_por_id=?")
      recipientQuery.setLong(1, notificationId)
      recipientQuery.setLong(2, employeeId)
      val recipientRs = recipientQuery.executeQuery()
      val recipient = try if (recipientRs.next()) recipientRs.getString(1) else ""
        finally { recipientRs.close(); recipientQuery.close() }
      if (recipient.isEmpty) throw new IllegalStateException("No se pudo recuperar el aviso de reenvío")
      conn.commit()
      Map("notificationId" -> notificationId, "recipient" -> recipient, "status" -> "PENDIENTE")
    } catch {
      case ex: Exception =>
        try conn.rollback() catch { case _: Exception => () }
        throw ex
    } finally conn.close()
  }
}
