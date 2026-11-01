package com.transport.system.security

import java.sql.{Connection, Date, DriverManager}
import java.time.LocalDate
import scala.collection.mutable.ListBuffer

object OccupancyReportRepository {
  private def connection(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  def query(flightCode: Option[String], fareClass: Option[String], from: LocalDate,
            to: LocalDate): List[Map[String, Any]] = {
    val conditions = ListBuffer("fecha BETWEEN ? AND ?")
    flightCode.foreach(_ => conditions += "codigo_vuelo=?")
    fareClass.foreach(_ => conditions += "clase=?")
    val sql =
      """SELECT vuelo_id,codigo_vuelo,origen,destino,salida_id,fecha,estado_salida,clase,capacidad,
        |       emitidos,reservados,disponibles,porcentaje_ocupacion,recaudado
        |FROM v_ocupacion WHERE """.stripMargin + conditions.mkString(" AND ") +
        " ORDER BY fecha,codigo_vuelo,salida_id,clase"
    val conn = connection()
    try {
      val statement = conn.prepareStatement(sql)
      try {
        var index = 1
        statement.setDate(index, Date.valueOf(from)); index += 1
        statement.setDate(index, Date.valueOf(to)); index += 1
        flightCode.foreach { code => statement.setString(index, code); index += 1 }
        fareClass.foreach { cls => statement.setString(index, cls); index += 1 }
        val rs = statement.executeQuery()
        val rows = ListBuffer.empty[Map[String, Any]]
        try while (rs.next()) rows += Map(
          "flightId" -> rs.getLong("vuelo_id"), "flightCode" -> rs.getString("codigo_vuelo"),
          "origin" -> rs.getString("origen"), "destination" -> rs.getString("destino"),
          "departureId" -> rs.getLong("salida_id"), "date" -> rs.getDate("fecha").toString,
          "departureStatus" -> rs.getString("estado_salida"), "class" -> rs.getString("clase"),
          "capacity" -> rs.getInt("capacidad"), "sold" -> rs.getInt("emitidos"),
          "reserved" -> rs.getInt("reservados"), "available" -> rs.getInt("disponibles"),
          "occupancyPercent" -> Option(rs.getBigDecimal("porcentaje_ocupacion")).map(_.doubleValue()).getOrElse(0d),
          "revenue" -> rs.getBigDecimal("recaudado"))
        finally rs.close()
        rows.toList
      } finally if (!statement.isClosed) statement.close()
    } finally conn.close()
  }
}
