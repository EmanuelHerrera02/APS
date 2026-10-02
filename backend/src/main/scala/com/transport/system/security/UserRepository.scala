package com.transport.system.security

import com.password4j.Password
import com.transport.system.models.Roles
import java.sql.{Connection, DriverManager, SQLException}
import java.util.Locale

enum UserWriteError {
  case InvalidData, EmailAlreadyExists, InvalidRole
}

object UserRepository {
  private def connection(): Connection = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
  }

  private def valid(email: String, password: String, firstName: String, lastName: String, phone: Option[String]): Boolean = {
    val normalizedEmail = Option(email).getOrElse("").trim
    normalizedEmail.matches("(?i)^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") && normalizedEmail.length <= 255 &&
      Option(password).exists(value => value.length >= 8 && value.length <= 256) &&
      Option(firstName).exists(value => value.trim.nonEmpty && value.trim.length <= 100) &&
      Option(lastName).exists(value => value.trim.nonEmpty && value.trim.length <= 100) &&
      phone.forall(value => value.length <= 30)
  }

  private def passwordHash(password: String): String =
    Password.hash(password).addRandomSalt(16).withArgon2().getResult

  /** El rol por defecto se fija aquí. El endpoint público no puede sobreescribirlo. */
  def registerPassenger(email: String, password: String, firstName: String, lastName: String,
                        phone: Option[String]): Either[UserWriteError, Long] =
    insertUser(email, password, firstName, lastName, phone, Roles.PASSENGER, None)

  /** Crear usuarios internos solo desde rutas protegidas por user:create. */
  def createByAdministrator(actorId: Long, email: String, password: String, firstName: String, lastName: String,
                            phone: Option[String], role: String): Either[UserWriteError, Long] = {
    val normalizedRole = Option(role).getOrElse("").trim.toUpperCase(Locale.ROOT)
    if (!Set(Roles.ADMIN, Roles.EMPLOYEE, Roles.PASSENGER).contains(normalizedRole)) Left(UserWriteError.InvalidRole)
    else insertUser(email, password, firstName, lastName, phone, normalizedRole, Some(actorId))
  }

  private def insertUser(email: String, password: String, firstName: String, lastName: String,
                         phone: Option[String], role: String, actorId: Option[Long]): Either[UserWriteError, Long] = {
    if (!valid(email, password, firstName, lastName, phone)) return Left(UserWriteError.InvalidData)
    val normalizedEmail = email.trim.toLowerCase(Locale.ROOT)
    val hash = passwordHash(password)
    val conn = connection()
    try {
      conn.setAutoCommit(false)
      val stmt = conn.prepareStatement(
        "INSERT INTO usuario (email,password_hash,rol,activo,nombre,apellido,telefono) VALUES (?,?,?,TRUE,?,?,?)",
        java.sql.Statement.RETURN_GENERATED_KEYS)
      try {
        stmt.setString(1, normalizedEmail)
        stmt.setString(2, hash)
        stmt.setString(3, role)
        stmt.setString(4, firstName.trim)
        stmt.setString(5, lastName.trim)
        stmt.setString(6, phone.map(_.trim).filter(_.nonEmpty).orNull)
        stmt.executeUpdate()
        val keys = stmt.getGeneratedKeys
        try {
          if (!keys.next()) throw new SQLException("User insert did not return an id")
          val id = keys.getLong(1)
          writeAudit(conn, actorId, "user.created", "usuario", Some(id), Some(s"{\"role\":\"$role\"}"))
          conn.commit()
          Right(id)
        } finally keys.close()
      } finally stmt.close()
    } catch {
      case ex: SQLException if Option(ex.getSQLState).exists(_.startsWith("23")) =>
        conn.rollback(); Left(UserWriteError.EmailAlreadyExists)
      case ex: Throwable => conn.rollback(); throw ex
    } finally conn.close()
  }

  def listUsers(): List[Map[String, Any]] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement(
        "SELECT id,email,rol,activo,nombre,apellido,telefono,created_at,ultimo_acceso FROM usuario ORDER BY id")
      val rs = stmt.executeQuery()
      try {
        val users = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
        while (rs.next()) users += userMap(rs)
        users.toList
      } finally { rs.close(); stmt.close() }
    } finally conn.close()
  }

  def profile(userId: Long): Option[Map[String, Any]] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement(
        "SELECT id,email,rol,activo,nombre,apellido,telefono,created_at,ultimo_acceso FROM usuario WHERE id=?")
      stmt.setLong(1, userId)
      val rs = stmt.executeQuery()
      try if (rs.next()) Some(userMap(rs)) else None
      finally { rs.close(); stmt.close() }
    } finally conn.close()
  }

  private def userMap(rs: java.sql.ResultSet): Map[String, Any] = Map(
    "id" -> rs.getLong("id"),
    "email" -> rs.getString("email"),
    "role" -> rs.getString("rol"),
    "active" -> rs.getBoolean("activo"),
    "firstName" -> rs.getString("nombre"),
    "lastName" -> rs.getString("apellido"),
    "phone" -> Option(rs.getString("telefono")).orNull,
    "createdAt" -> rs.getString("created_at"),
    "lastLogin" -> Option(rs.getString("ultimo_acceso")).orNull
  )

  def writeAudit(conn: Connection, actorId: Option[Long], action: String, entity: String,
                 entityId: Option[Long], details: Option[String]): Unit = {
    val stmt = conn.prepareStatement(
      "INSERT INTO auditoria (actor_usuario_id,accion,entidad,entidad_id,detalles) VALUES (?,?,?,?,?)")
    actorId match {
      case Some(id) => stmt.setLong(1, id)
      case None => stmt.setNull(1, java.sql.Types.BIGINT)
    }
    stmt.setString(2, action)
    stmt.setString(3, entity)
    entityId match {
      case Some(id) => stmt.setLong(4, id)
      case None => stmt.setNull(4, java.sql.Types.BIGINT)
    }
    details match {
      case Some(value) => stmt.setString(5, value)
      case None => stmt.setNull(5, java.sql.Types.LONGVARCHAR)
    }
    stmt.executeUpdate()
    stmt.close()
  }

  def auditEntries(limit: Int = 100): List[Map[String, Any]] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement(
        "SELECT a.id,a.actor_usuario_id,u.email AS actor_email,a.accion,a.entidad,a.entidad_id,a.detalles,a.created_at " +
          "FROM auditoria a LEFT JOIN usuario u ON u.id=a.actor_usuario_id ORDER BY a.id DESC LIMIT ?")
      stmt.setInt(1, limit.max(1).min(500))
      val rs = stmt.executeQuery()
      try {
        val entries = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
        while (rs.next()) entries += Map(
          "id" -> rs.getLong("id"),
          "actorUserId" -> Option(rs.getObject("actor_usuario_id")).map(_.toString).orNull,
          "actorEmail" -> Option(rs.getString("actor_email")).orNull,
          "action" -> rs.getString("accion"),
          "entity" -> rs.getString("entidad"),
          "entityId" -> Option(rs.getObject("entidad_id")).map(_.toString).orNull,
          "details" -> Option(rs.getString("detalles")).orNull,
          "createdAt" -> rs.getString("created_at")
        )
        entries.toList
      } finally { rs.close(); stmt.close() }
    } finally conn.close()
  }

  def updateUser(actorId: Long, userId: Long, firstName: Option[String], lastName: Option[String], phone: Option[String],
                 active: Option[Boolean], role: Option[String]): Boolean = {
    val normalizedRole = role.map(_.trim.toUpperCase(Locale.ROOT))
    if (normalizedRole.exists(value => !Set(Roles.ADMIN, Roles.EMPLOYEE, Roles.PASSENGER).contains(value)))
      throw new IllegalArgumentException("Invalid role")
    if (firstName.exists(value => value.trim.isEmpty || value.trim.length > 100) ||
        lastName.exists(value => value.trim.isEmpty || value.trim.length > 100) ||
        phone.exists(_.length > 30)) throw new IllegalArgumentException("Invalid user data")

    val fields = List(
      firstName.map(_ => "nombre=?"), lastName.map(_ => "apellido=?"), phone.map(_ => "telefono=?"),
      active.map(_ => "activo=?"), normalizedRole.map(_ => "rol=?")
    ).flatten
    val conn = connection()
    try {
      conn.setAutoCommit(false)
      if (fields.isEmpty) {
        val exists = conn.prepareStatement("SELECT 1 FROM usuario WHERE id=?")
        exists.setLong(1, userId)
        val rs = exists.executeQuery()
        val found = try rs.next() finally { rs.close(); exists.close() }
        conn.commit()
        found
      } else {
        val check = conn.prepareStatement("SELECT 1 FROM usuario WHERE id=? FOR UPDATE")
        check.setLong(1, userId)
        val checkRs = check.executeQuery()
        val exists = try checkRs.next() finally { checkRs.close(); check.close() }
        if (!exists) { conn.commit(); return false }
        val stmt = conn.prepareStatement(s"UPDATE usuario SET ${fields.mkString(", ")} WHERE id=?")
        var index = 1
        firstName.foreach { value => stmt.setString(index, value.trim); index += 1 }
        lastName.foreach { value => stmt.setString(index, value.trim); index += 1 }
        phone.foreach { value => stmt.setString(index, value.trim); index += 1 }
        active.foreach { value => stmt.setBoolean(index, value); index += 1 }
        normalizedRole.foreach { value => stmt.setString(index, value); index += 1 }
        stmt.setLong(index, userId)
        val changed = stmt.executeUpdate()
        stmt.close()
        if (changed > 0) writeAudit(conn, Some(actorId), "user.updated", "usuario", Some(userId), None)
        conn.commit()
        true
      }
    } catch { case ex: Throwable => conn.rollback(); throw ex }
    finally conn.close()
  }

  def adminStats(): Map[String, Any] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement(
        "SELECT (SELECT COUNT(*) FROM usuario) AS total_users, " +
          "(SELECT COUNT(*) FROM compra) AS total_reservations, " +
          "(SELECT COALESCE(SUM(monto),0) FROM pago WHERE estado='APROBADO') AS total_revenue, " +
          "(SELECT COUNT(*) FROM auditoria) AS audited_events")
      val rs = stmt.executeQuery()
      try {
        rs.next()
        Map("totalUsers" -> rs.getLong("total_users"),
          "totalReservations" -> rs.getLong("total_reservations"),
          "totalRevenue" -> rs.getBigDecimal("total_revenue"),
          "auditedEvents" -> rs.getLong("audited_events"))
      } finally { rs.close(); stmt.close() }
    } finally conn.close()
  }

  def employeeStats(): Map[String, Any] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement(
        "SELECT (SELECT COUNT(*) FROM compra WHERE estado='PENDIENTE_PAGO') AS pending_purchases, " +
          "(SELECT COUNT(*) FROM pago WHERE estado='APROBADO' AND DATE(fecha_pago)=CURDATE()) AS payments_today, " +
          "(SELECT COALESCE(SUM(monto),0) FROM pago WHERE estado='APROBADO' AND YEAR(fecha_pago)=YEAR(CURDATE()) " +
          "AND MONTH(fecha_pago)=MONTH(CURDATE())) AS revenue_this_month, " +
          "(SELECT COUNT(*) FROM usuario WHERE activo=TRUE) AS active_users")
      val rs = stmt.executeQuery()
      try {
        rs.next()
        Map("pendingReservations" -> rs.getLong("pending_purchases"),
          "paymentsToday" -> rs.getLong("payments_today"),
          "revenueThisMonth" -> rs.getBigDecimal("revenue_this_month"),
          "activeUsers" -> rs.getLong("active_users"))
      } finally { rs.close(); stmt.close() }
    } finally conn.close()
  }

  def financialReports(): List[Map[String, Any]] = {
    val conn = connection()
    try {
      val stmt = conn.prepareStatement(
        "SELECT DATE_FORMAT(fecha_pago,'%Y-%m') AS period, medio AS method, COUNT(*) AS payments, " +
          "SUM(monto) AS revenue FROM pago WHERE estado='APROBADO' " +
          "GROUP BY DATE_FORMAT(fecha_pago,'%Y-%m'), medio ORDER BY period DESC, method")
      val rs = stmt.executeQuery()
      try {
        val reports = scala.collection.mutable.ListBuffer.empty[Map[String, Any]]
        while (rs.next()) reports += Map("period" -> rs.getString("period"),
          "method" -> rs.getString("method"), "payments" -> rs.getLong("payments"),
          "revenue" -> rs.getBigDecimal("revenue"))
        reports.toList
      } finally { rs.close(); stmt.close() }
    } finally conn.close()
  }
}
