package com.transport.system

import org.scalatra.LifeCycle
import org.slf4j.LoggerFactory

import javax.servlet.ServletContext

/**
 * Arranque del ciclo de vida de Scalatra.
 *
 * org.scalatra.jetty.JettyServer registra siempre un ScalatraListener, que busca
 * una clase LifeCycle por el init param "org.scalatra.LifeCycle" (o, en su
 * defecto, una llamada "ScalatraBootstrap"). Sin una de las dos, el listener
 * revienta con "No lifecycle class found!" al arrancar Jetty.
 *
 * Acá no hace falta montar nada: Main.scala ya registra cada controller con
 * addServlet, y ScalatraServlet se inicializa solo en su init(). Esta clase solo
 * cumple el contrato.
 */
class AeronetCycle extends LifeCycle {

  private val logger = LoggerFactory.getLogger(getClass)

  override def init(context: ServletContext): Unit =
    logger.info("AeroNet: ciclo de vida inicializado")
}
