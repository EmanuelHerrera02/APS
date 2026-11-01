package com.transport.system.security

import org.json4s._
import org.json4s.native.JsonMethods._
import java.sql.{Connection, DriverManager, SQLException, Types}

/** Venta de mostrador sobre los mismos procedimientos atómicos de inventario y cobro que la web. */
object CounterSaleRepository {
  private def connection(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  /**
   * `card` requiere referencia de autorización de la terminal, marca y últimos cuatro dígitos;
   * nunca se reciben ni persisten PAN, CVV o vencimiento.
   */
  def sell(employeeId: Long, departureId: Long, contactEmail: String, passengers: JArray,
           paymentMethod: String, card: Option[(String, String, String)]): Map[String, Any] = {
    val conn = connection()
    conn.setAutoCommit(false)
    try {
      val findBuyer = conn.prepareStatement("SELECT id FROM usuario WHERE email=? AND activo=1 AND rol='PASAJERO'")
      findBuyer.setString(1, contactEmail)
      val buyerRs = findBuyer.executeQuery()
      val buyerId = try if (buyerRs.next()) Some(buyerRs.getLong(1)) else None
        finally { buyerRs.close(); findBuyer.close() }

      val create = conn.prepareCall("{call crear_compra(?, ?, ?, ?, ?, ?, ?)}")
      val passengerPayload = compact(render(passengers))
      val purchaseId = try {
        create.setLong(1, departureId)
        buyerId match {
          case Some(id) => create.setLong(2, id)
          case None => create.setNull(2, Types.BIGINT)
        }
        create.setLong(3, employeeId)
        create.setString(4, "MOSTRADOR")
        create.setString(5, contactEmail)
        create.setString(6, passengerPayload)
        create.registerOutParameter(7, Types.BIGINT)
        create.execute()
        val id = create.getLong(7)
        if (create.wasNull() || id <= 0) throw new SQLException("No se pudo registrar la venta")
        id
      } finally create.close()

      val totalQuery = conn.prepareStatement("SELECT codigo,total FROM compra WHERE id=? AND empleado_id=? AND canal='MOSTRADOR'")
      totalQuery.setLong(1, purchaseId)
      totalQuery.setLong(2, employeeId)
      val totalRs = totalQuery.executeQuery()
      val (code, total) = try {
        if (!totalRs.next()) throw new SQLException("No se encontró la venta registrada")
        totalRs.getString("codigo") -> totalRs.getBigDecimal("total")
      } finally { totalRs.close(); totalQuery.close() }

      val (transactionRef, brand, lastFour) = card match {
        case Some((reference, cardBrand, digits)) => (reference, cardBrand, digits)
        case None => (null, null, null)
      }
      val payment = conn.prepareCall("{call registrar_pago(?, ?, ?, 'APROBADO', ?, ?, ?, ?, ?)}")
      try {
        payment.setLong(1, purchaseId)
        payment.setBigDecimal(2, total)
        payment.setString(3, paymentMethod)
        if (transactionRef == null) payment.setNull(4, Types.VARCHAR) else payment.setString(4, transactionRef)
        if (brand == null) payment.setNull(5, Types.VARCHAR) else payment.setString(5, brand)
        if (lastFour == null) payment.setNull(6, Types.CHAR) else payment.setString(6, lastFour)
        payment.registerOutParameter(7, Types.BIGINT)
        payment.registerOutParameter(8, Types.VARCHAR)
        payment.execute()
        val result = payment.getString(8)
        if (result != "CONFIRMADA") throw new SQLException("El cobro no confirmó la compra")
      } finally payment.close()

      conn.commit()
      Map("purchaseId" -> purchaseId, "code" -> code, "status" -> "CONFIRMADA", "total" -> total,
        "paymentMethod" -> paymentMethod, "documents" -> "EMAIL_ENCOLADO", "accountLinked" -> buyerId.nonEmpty)
    } catch {
      case ex: Exception =>
        try conn.rollback() catch { case _: Exception => () }
        throw ex
    } finally conn.close()
  }
}
