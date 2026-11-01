package com.transport.system.security

import org.mariadb.jdbc.MariaDbPoolDataSource
import java.sql.Connection

/** Shared bounded MariaDB pool for request paths that need frequent short-lived connections. */
object DatabaseConnections {
  private val poolSize = sys.env.get("AERONET_DB_POOL_SIZE").flatMap(_.toIntOption)
    .filter(size => size >= 8 && size <= 140).getOrElse(100)

  private lazy val pool: MariaDbPoolDataSource = {
    val url = sys.env.getOrElse("AERONET_JDBC_URL", "")
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (url.isEmpty || user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    val password = sys.env.getOrElse("AERONET_DB_PASSWORD", "")
    val options = List(s"maxPoolSize=$poolSize", "minPoolSize=8", "poolValidMinDelay=5000")
    val separator = if (url.contains("?")) "&" else "?"
    val dataSource = new MariaDbPoolDataSource()
    dataSource.setUser(user)
    dataSource.setPassword(password)
    dataSource.setUrl(url + separator + options.mkString("&"))
    dataSource
  }

  def connection(): Connection = {
    val user = sys.env.getOrElse("AERONET_DB_USER", "")
    if (user.isEmpty) throw new IllegalStateException("Database configuration is missing")
    pool.getConnection()
  }
}
