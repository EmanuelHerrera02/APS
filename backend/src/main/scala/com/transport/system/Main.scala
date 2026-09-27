package com.transport.system

import com.transport.system.controllers.{
  AdminController,
  EmployeeController,
  PassengerController
}
import com.transport.system.db.Database
import javax.servlet.http.HttpServlet
import org.eclipse.jetty.servlet.ServletHolder
import org.scalatra.jetty.JettyServer
import org.scalatra.servlet.ScalatraListener
import org.slf4j.LoggerFactory

import java.net.InetSocketAddress
import scala.util.{Failure, Success, Try}

/**
 * Arranque del backend.
 *
 * El puerto 8080 es el que espera el frontend (frontend/.env.example) y el que
 * usan las recetas de docs/manual-base-de-datos.md.
 */
object Main {

  private val logger = LoggerFactory.getLogger(getClass)

  def main(args: Array[String]): Unit = {
    val config = Database.config
    val host = config.getString("aeronet.server.host")
    val port = config.getInt("aeronet.server.port")

    // Falla temprano y con un mensaje util si el secreto de firma no esta
    // definido, en vez de arrancar un servicio que responde 401 a todo.
    Try(com.auth0.jwt.algorithms.Algorithm.HMAC256(
      config.getString("aeronet.jwt.secret")
    )) match {
      case Success(_) => ()
      case Failure(e) =>
        logger.error(
          "No se pudo leer aeronet.jwt.secret. Definí AERONET_JWT_SECRET.",
          e
        )
        sys.exit(1)
    }

    logger.info(s"Conectando a ${Database.url}")
    Database.conectar().close()

    // Scalatra usa este directorio como resource base de Jetty. El frontend se
    // sirve aparte (Vite), asi que no hay estaticos que publicar: alcanza con
    // que exista. Se pasa explicito para no depender del directorio de trabajo.
    val webapp = java.nio.file.Paths.get("src", "main", "webapp")
    if (!java.nio.file.Files.isDirectory(webapp)) {
      logger.warn(s"No existe el resource base $webapp; se usa el del classpath")
    }

    val servidor =
      new JettyServer(new InetSocketAddress(host, port), webapp)
    // JettyServer registra un ScalatraListener que exige una clase LifeCycle.
    servidor.context.setInitParameter(
      ScalatraListener.LifeCycleKey,
      classOf[AeronetCycle].getName
    )
    servidor.context.setContextPath("/")

    List[HttpServlet](
      new AdminController,
      new EmployeeController,
      new PassengerController
    ).foreach { servlet =>
      val prefijo =
        servlet.getClass.getSimpleName.stripSuffix("Controller").toLowerCase
      // Jetty exige que el path spec arranque con "/".
      servidor.context.addServlet(new ServletHolder(servlet), s"/$prefijo/*")
    }

    servidor.start()
    logger.info(s"AeroNet escuchando en http://$host:$port")
    servidor.join()
  }
}
