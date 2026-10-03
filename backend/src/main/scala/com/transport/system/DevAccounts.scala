package com.transport.system

import com.password4j.Password
import java.sql.DriverManager

/** Crea o renueva las tres cuentas locales de desarrollo. */
object DevAccounts {
  private final case class Account(email: String, role: String, firstName: String, lastName: String, password: String)

  def main(args: Array[String]): Unit = {
    if (sys.env.get("AERONET_DEV_ACCOUNTS_ENABLED").forall(_ != "true")) {
      throw new IllegalStateException("Set AERONET_DEV_ACCOUNTS_ENABLED=true to enable the local account seeder")
    }

    val accounts = List(
      Account("admin.dev@aeronet.test", "ADMIN", "Admin", "Desarrollo", requiredPassword("ADMIN")),
      Account("pasajero.dev@aeronet.test", "PASAJERO", "Pasajero", "Desarrollo", requiredPassword("PASAJERO")),
      Account("mostrador.dev@aeronet.test", "MOSTRADOR", "Mostrador", "Desarrollo", requiredPassword("MOSTRADOR"))
    )
    if (accounts.map(_.password).distinct.size != accounts.size) {
      throw new IllegalArgumentException("Use a different development password for each role")
    }

    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")

    val connection = DriverManager.getConnection(url, user, sys.env.getOrElse("AERONET_DB_PASSWORD", ""))
    try {
      connection.setAutoCommit(false)
      val statement = connection.prepareStatement(
        "INSERT INTO usuario (email,password_hash,rol,activo,nombre,apellido) VALUES (?,?,?,TRUE,?,?) " +
          "ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),rol=VALUES(rol),activo=TRUE," +
          "nombre=VALUES(nombre),apellido=VALUES(apellido)"
      )
      try {
        accounts.foreach { account =>
          if (account.password.length < 12 || account.password.length > 256) {
            throw new IllegalArgumentException(s"Password for ${account.role} must be 12 to 256 characters")
          }
          val hash = Password.hash(account.password).addRandomSalt(16).withArgon2().getResult
          statement.setString(1, account.email)
          statement.setString(2, hash)
          statement.setString(3, account.role)
          statement.setString(4, account.firstName)
          statement.setString(5, account.lastName)
          statement.addBatch()
        }
        statement.executeBatch()
      } finally statement.close()
      connection.commit()
      println("Development accounts ready: admin.dev@aeronet.test, pasajero.dev@aeronet.test, mostrador.dev@aeronet.test")
    } catch {
      case ex: Throwable => connection.rollback(); throw ex
    } finally connection.close()
  }

  private def requiredPassword(role: String): String = {
    val password = sys.env.getOrElse(s"AERONET_DEV_${role}_PASSWORD", "")
    if (password.isEmpty) throw new IllegalArgumentException(s"AERONET_DEV_${role}_PASSWORD is required")
    password
  }
}
