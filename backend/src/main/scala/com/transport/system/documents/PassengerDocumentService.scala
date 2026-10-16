package com.transport.system.documents

import java.nio.file.{Files, Path, Paths}
import java.sql.{Connection, DriverManager}

object PassengerDocumentService {
  private val root = Paths.get(sys.env.getOrElse("AERONET_DOCUMENT_STORAGE", "var/documentos"))
    .toAbsolutePath.normalize()

  private def db(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  private def privateFile(relative: String): Option[Path] = {
    val path = root.resolve(relative).normalize()
    if (!path.startsWith(root)) None
    else try {
      val realRoot = root.toRealPath()
      val realPath = path.toRealPath()
      Option.when(realPath.startsWith(realRoot) && Files.isRegularFile(realPath))(realPath)
    } catch { case _: java.io.IOException => None }
  }

  def listForPassenger(userId: Long): List[Map[String, Any]] = {
    val connection = db()
    try {
      val query = connection.prepareStatement(
        """SELECT c.id, c.codigo, c.estado, c.created_at, s.fecha, v.codigo AS vuelo,
          |       ao.ciudad AS origen, ad.ciudad AS destino
          |FROM compra c JOIN salida s ON s.id=c.salida_id JOIN vuelo v ON v.id=s.vuelo_id
          |JOIN aeropuerto ao ON ao.id=v.aeropuerto_origen_id
          |JOIN aeropuerto ad ON ad.id=v.aeropuerto_destino_id
          |WHERE c.usuario_id=? ORDER BY c.created_at DESC, c.id DESC""".stripMargin)
      query.setLong(1, userId)
      val rs = query.executeQuery()
      val purchases = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
      try while (rs.next()) {
        val id = rs.getLong("id")
        val confirmed = rs.getString("estado") == "CONFIRMADA"
        val invoiceStmt = connection.prepareStatement("SELECT ruta_pdf FROM factura WHERE compra_id=?")
        invoiceStmt.setLong(1, id)
        val invoiceRs = invoiceStmt.executeQuery()
        val invoicePath = try if (invoiceRs.next()) Option(invoiceRs.getString(1)).flatMap(privateFile) else None
          finally { invoiceRs.close(); invoiceStmt.close() }

        val ticketStmt = connection.prepareStatement(
          "SELECT id, ruta_pdf FROM pasaje WHERE compra_id=? AND estado='EMITIDO' ORDER BY id")
        ticketStmt.setLong(1, id)
        val ticketRs = ticketStmt.executeQuery()
        val tickets = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
        try while (ticketRs.next()) {
          val ticketId = ticketRs.getLong("id")
          val available = confirmed && Option(ticketRs.getString("ruta_pdf")).flatMap(privateFile).nonEmpty
          tickets += Map("id" -> ticketId, "available" -> available)
        } finally { ticketRs.close(); ticketStmt.close() }

        purchases += Map(
          "id" -> id, "code" -> rs.getString("codigo"), "status" -> rs.getString("estado"),
          "createdAt" -> rs.getTimestamp("created_at").toLocalDateTime.toString,
          "date" -> rs.getDate("fecha").toString, "flight" -> rs.getString("vuelo"),
          "origin" -> rs.getString("origen"), "destination" -> rs.getString("destino"),
          "invoiceAvailable" -> (confirmed && invoicePath.nonEmpty), "tickets" -> tickets.toList)
      } finally { rs.close(); query.close() }
      purchases.toList
    } finally connection.close()
  }

  def invoiceForPassenger(userId: Long, purchaseId: Long): Option[Path] =
    documentForPassenger(userId, purchaseId,
      "SELECT f.ruta_pdf FROM factura f JOIN compra c ON c.id=f.compra_id " +
        "WHERE c.id=? AND c.usuario_id=? AND c.estado='CONFIRMADA' AND f.ruta_pdf IS NOT NULL")

  def ticketForPassenger(userId: Long, purchaseId: Long, ticketId: Long): Option[Path] =
    documentForPassenger(userId, purchaseId,
      "SELECT p.ruta_pdf FROM pasaje p JOIN compra c ON c.id=p.compra_id " +
        "WHERE c.id=? AND c.usuario_id=? AND c.estado='CONFIRMADA' " +
        "AND p.id=? AND p.estado='EMITIDO' AND p.ruta_pdf IS NOT NULL", Some(ticketId))

  private def documentForPassenger(userId: Long, purchaseId: Long, sql: String,
                                   ticketId: Option[Long] = None): Option[Path] = {
    val connection = db()
    try {
      val query = connection.prepareStatement(sql)
      query.setLong(1, purchaseId)
      query.setLong(2, userId)
      ticketId.foreach(query.setLong(3, _))
      val rs = query.executeQuery()
      try if (rs.next()) Option(rs.getString(1)).flatMap(privateFile) else None
      finally { rs.close(); query.close() }
    } finally connection.close()
  }
}
