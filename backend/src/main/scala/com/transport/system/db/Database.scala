package com.transport.system.db

import com.typesafe.config.{Config, ConfigFactory}
import org.slf4j.LoggerFactory

import java.sql.{Connection, DriverManager, SQLException}
import scala.util.Using

/**
 * Acceso a MariaDB.
 *
 * Segun la seccion 6 de docs/manual-base-de-datos.md: siempre parametros
 * prepared, nunca SQL concatenado, y los errores se traducen con [[ErroDeBase]].
 */
object Database {

  private val logger = LoggerFactory.getLogger(getClass)

  val config: Config = ConfigFactory.load()

  private def dbConfig: Config = config.getConfig("aeronet.db")

  val url: String = dbConfig.getString("url")
  val user: String = dbConfig.getString("user")
  val password: String = dbConfig.getString("password")

  def conectar(): Connection = {
    val props = new java.util.Properties()
    props.setProperty("user", user)
    props.setProperty("password", password)
    DriverManager.getConnection(url, props)
  }

  /**
   * Lee dentro de una transaccion propia y hace commit, o revierte ante error.
   *
   * El autocommit se desactiva antes de la primera sentencia, de modo que para
   * MariaDB la transaccion ya esta abierta cuando se llama a un procedimiento.
   * Eso importa porque los procedimientos como generar_salidas eligen entre
   * START TRANSACTION y SAVEPOINT segun el valor de @@in_transaction
   * (db/02_logic.sql:409): si el backend no abrio la transaccion, el
   * procedimiento usa la suya y el commit del backend no alcanzaria para
   * revertir lo que hizo.
   *
   * Todas las sentencias de una operacion deben ir por la misma conexion que se
   * pasa a `f`, nunca por conexiones separadas.
   */
  def conTransaccion[A](f: Connection => A): A =
    Using.resource(conectar()) { conn =>
      conn.setAutoCommit(false)
      try {
        val resultado = f(conn)
        conn.commit()
        resultado
      } catch {
        case e: SQLException =>
          revertir(conn)
          throw ErroDeBase.desde(e)
        case e: Throwable =>
          revertir(conn)
          throw e
      }
    }

  /** Operacion de solo lectura, sin transaccion explicita. */
  def conLectura[A](f: Connection => A): A =
    Using.resource(conectar())(f)

  private def revertir(conn: Connection): Unit =
    try conn.rollback()
    catch {
      case e: SQLException =>
        logger.warn("No se pudo revertir la transaccion", e)
    }
}
