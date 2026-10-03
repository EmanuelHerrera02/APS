package com.transport.system.security

import com.password4j.{Argon2Function, Password}
import com.transport.system.models.{LoginResponse, Role, User}
import java.nio.charset.StandardCharsets
import java.security.{MessageDigest, SecureRandom}
import java.sql.{Connection, DriverManager}
import java.time.{LocalDateTime, ZoneOffset}
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json4s._
import org.json4s.native.JsonMethods.{compact, parse, render}

case class AuthenticatedUser(userId: Int, email: String, roles: List[String], permissions: List[String], sessionId: String)

object Authentication {
  private implicit val jsonFormats: Formats = DefaultFormats
  private val random = new SecureRandom()
  private val urlEncoder = Base64.getUrlEncoder.withoutPadding()
  private val urlDecoder = Base64.getUrlDecoder
  private val accessSeconds = 900L

  private def setting(name: String): String = sys.env.getOrElse(name, "")
  private def db(): Connection = {
    val url = setting("AERONET_JDBC_URL")
    val user = setting("AERONET_DB_USER")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    DriverManager.getConnection(url, user, setting("AERONET_DB_PASSWORD"))
  }
  private def secret: Array[Byte] = {
    val value = setting("AERONET_JWT_SECRET")
    val bytes = value.getBytes(StandardCharsets.UTF_8)
    if (bytes.length < 32) throw new IllegalStateException("AERONET_JWT_SECRET must contain at least 32 bytes")
    bytes
  }
  def validateConfiguration(): Unit = { secret; () }
  private def hash(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.getBytes(StandardCharsets.UTF_8)).map(b => f"${b & 0xff}%02x").mkString
  private def randomToken(): String = {
    val bytes = new Array[Byte](48)
    random.nextBytes(bytes)
    urlEncoder.encodeToString(bytes)
  }
  private def sign(content: String): Array[Byte] = {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(new SecretKeySpec(secret, "HmacSHA256"))
    mac.doFinal(content.getBytes(StandardCharsets.US_ASCII))
  }

  private def identity(connection: Connection, userId: Long): (List[String], List[String]) = {
    val rolesStmt = connection.prepareStatement("SELECT rol FROM usuario WHERE id = ? AND activo = TRUE")
    rolesStmt.setLong(1, userId)
    val rolesRs = rolesStmt.executeQuery()
    if (!rolesRs.next()) { rolesRs.close(); rolesStmt.close(); throw new SecurityException("Inactive account") }
    val role = rolesRs.getString(1)
    rolesRs.close(); rolesStmt.close()
    val permissionsStmt = connection.prepareStatement(
      "SELECT permiso_codigo FROM rol_permiso WHERE rol = ? ORDER BY permiso_codigo")
    permissionsStmt.setString(1, role)
    val permissionsRs = permissionsStmt.executeQuery()
    val permissions = scala.collection.mutable.ListBuffer.empty[String]
    try while (permissionsRs.next()) permissions += permissionsRs.getString(1)
    finally { permissionsRs.close(); permissionsStmt.close() }
    (List(role), permissions.toList)
  }

  private def issueAccess(userId: Long, email: String, roles: List[String], permissions: List[String], sessionId: String): String = {
    val now = java.time.Instant.now().getEpochSecond
    val payload = JObject(List(
      "sub" -> JString(userId.toString), "userId" -> JInt(userId), "email" -> JString(email),
      "roles" -> JArray(roles.map(JString.apply)), "permissions" -> JArray(permissions.map(JString.apply)),
      "sid" -> JString(sessionId), "iat" -> JInt(now), "exp" -> JInt(now + accessSeconds)
    ))
    val header = urlEncoder.encodeToString("""{"alg":"HS256","typ":"JWT"}""".getBytes(StandardCharsets.UTF_8))
    val body = urlEncoder.encodeToString(compact(render(payload)).getBytes(StandardCharsets.UTF_8))
    val unsigned = s"$header.$body"
    s"$unsigned.${urlEncoder.encodeToString(sign(unsigned))}"
  }

  def login(emailInput: String, password: String): Option[LoginResponse] = {
    secret // Fail before opening a database transaction if token signing is not configured.
    val email = Option(emailInput).map(_.trim).getOrElse("")
    if (email.isEmpty || password == null || password.isEmpty) return None
    val connection = db()
    try {
      connection.setAutoCommit(false)
      val query = connection.prepareStatement(
        "SELECT id,email,password_hash,rol,activo,nombre,apellido,telefono,created_at,ultimo_acceso " +
          "FROM usuario WHERE email = ? FOR UPDATE")
      query.setString(1, email)
      val rs = query.executeQuery()
      try {
        if (!rs.next() || !rs.getBoolean("activo")) { connection.rollback(); None }
        else {
          val storedHash = rs.getString("password_hash")
          val valid = try {
            if (storedHash.startsWith("$2")) Password.check(password, storedHash).withBcrypt()
            else if (storedHash.startsWith("$argon2")) Argon2Function.getInstanceFromHash(storedHash).check(password, storedHash)
            else false
          } catch { case _: Exception => false }
          if (!valid) { connection.rollback(); None }
          else {
            val userId = rs.getLong("id")
            val userEmail = rs.getString("email")
            val roleName = rs.getString("rol")
            val firstName = rs.getString("nombre")
            val lastName = rs.getString("apellido")
            val phone = Option(rs.getString("telefono"))
            val created = LocalDateTime.parse(rs.getString("created_at").replace(' ', 'T'))
            val sessionId = java.util.UUID.randomUUID().toString
            val refresh = randomToken()
            val now = LocalDateTime.now(ZoneOffset.UTC)
            val update = connection.prepareStatement("UPDATE usuario SET ultimo_acceso = UTC_TIMESTAMP() WHERE id = ?")
            update.setLong(1, userId); update.executeUpdate(); update.close()
            val insert = connection.prepareStatement(
              "INSERT INTO sesion_usuario (id,usuario_id,refresh_hash,expira_en) " +
                "VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 DAY))")
            insert.setString(1, sessionId); insert.setLong(2, userId); insert.setString(3, hash(refresh))
            insert.executeUpdate(); insert.close()
            val (_, permissions) = identity(connection, userId)
            UserRepository.writeAudit(connection, Some(userId), "auth.login", "sesion", None, None)
            connection.commit()
            Some(LoginResponse(
              issueAccess(userId, userEmail, List(roleName), permissions, sessionId), refresh,
              User(userId.toInt, userEmail, firstName, lastName, phone, "ACTIVE", created, Some(now)),
              List(Role(roleName, roleName, roleName)), permissions))
          }
        }
      } finally { rs.close(); query.close() }
    } catch { case ex: Throwable => connection.rollback(); throw ex }
    finally connection.close()
  }

  def authenticate(token: String): Option[AuthenticatedUser] = try {
    val pieces = token.split("\\.")
    if (pieces.length != 3) return None
    val unsigned = s"${pieces(0)}.${pieces(1)}"
    val supplied = urlDecoder.decode(pieces(2))
    if (!MessageDigest.isEqual(sign(unsigned), supplied)) return None
    val claims = parse(new String(urlDecoder.decode(pieces(1)), StandardCharsets.UTF_8))
    val userId = (claims \\ "userId").extract[Long]
    val sessionId = (claims \\ "sid").extract[String]
    val email = (claims \\ "email").extract[String]
    val expires = (claims \\ "exp").extract[Long]
    if (expires <= java.time.Instant.now().getEpochSecond) return None
    val connection = db()
    try {
      val stmt = connection.prepareStatement(
        "SELECT 1 FROM sesion_usuario s JOIN usuario u ON u.id=s.usuario_id " +
          "WHERE s.id=? AND s.usuario_id=? AND s.revocada_en IS NULL AND s.expira_en>UTC_TIMESTAMP() AND u.activo=TRUE")
      stmt.setString(1, sessionId); stmt.setLong(2, userId)
      val rs = stmt.executeQuery()
      val active = try rs.next() finally { rs.close(); stmt.close() }
      if (!active) None else {
        val (roles, permissions) = identity(connection, userId)
        Some(AuthenticatedUser(userId.toInt, email, roles, permissions, sessionId))
      }
    } finally connection.close()
  } catch { case _: Exception => None }

  def refresh(token: String): Option[LoginResponse] = {
    secret
    if (token == null || token.isEmpty) return None
    val connection = db()
    try {
      connection.setAutoCommit(false)
      val stmt = connection.prepareStatement(
        "SELECT s.id,s.usuario_id,u.email,u.nombre,u.apellido,u.telefono,u.created_at,u.ultimo_acceso,u.rol " +
          "FROM sesion_usuario s JOIN usuario u ON u.id=s.usuario_id " +
          "WHERE s.refresh_hash=? AND s.revocada_en IS NULL AND s.expira_en>UTC_TIMESTAMP() AND u.activo=TRUE FOR UPDATE")
      stmt.setString(1, hash(token)); val rs = stmt.executeQuery()
      try if (!rs.next()) { connection.rollback(); None } else {
        val sessionId = rs.getString("id"); val userId = rs.getLong("usuario_id")
        val email = rs.getString("email"); val role = rs.getString("rol")
        val first = rs.getString("nombre"); val last = rs.getString("apellido")
        val phone = Option(rs.getString("telefono"))
        val created = LocalDateTime.parse(rs.getString("created_at").replace(' ', 'T'))
        val lastLogin = Option(rs.getString("ultimo_acceso")).map(value => LocalDateTime.parse(value.replace(' ', 'T')))
        val replacement = randomToken()
        val update = connection.prepareStatement("UPDATE sesion_usuario SET refresh_hash=? WHERE id=? AND refresh_hash=?")
        update.setString(1, hash(replacement)); update.setString(2, sessionId); update.setString(3, hash(token))
        val changed = update.executeUpdate(); update.close()
        if (changed != 1) { connection.rollback(); None } else {
          val (_, permissions) = identity(connection, userId); connection.commit()
          Some(LoginResponse(issueAccess(userId, email, List(role), permissions, sessionId), replacement,
            User(userId.toInt, email, first, last, phone, "ACTIVE", created, lastLogin),
            List(Role(role, role, role)), permissions))
        }
      } finally { rs.close(); stmt.close() }
    } catch { case ex: Throwable => connection.rollback(); throw ex }
    finally connection.close()
  }

  def logout(sessionId: String, userId: Long): Unit = {
    val connection = db()
    try {
      connection.setAutoCommit(false)
      val stmt = connection.prepareStatement("UPDATE sesion_usuario SET revocada_en=UTC_TIMESTAMP() WHERE id=? AND revocada_en IS NULL")
      stmt.setString(1, sessionId)
      val changed = stmt.executeUpdate()
      stmt.close()
      if (changed > 0) UserRepository.writeAudit(connection, Some(userId), "auth.logout", "sesion", None, None)
      connection.commit()
    } catch { case ex: Throwable => connection.rollback(); throw ex }
    finally connection.close()
  }
}
