package com.transport.system.payments

import jakarta.servlet.{ServletContextEvent, ServletContextListener}
import java.util.concurrent.{Executors, ScheduledExecutorService, TimeUnit}
import org.slf4j.LoggerFactory

/** Programa la conciliación periódica de pagos pendientes contra la pasarela (polling de respaldo del webhook). */
class PaymentLifecycle extends ServletContextListener {
  private val logger = LoggerFactory.getLogger(getClass)
  private var executor: Option[ScheduledExecutorService] = None

  override def contextInitialized(event: ServletContextEvent): Unit = {
    val enabled = sys.env.getOrElse("AERONET_PAYMENT_WORKER_ENABLED", "true").equalsIgnoreCase("true")
    if (!enabled) logger.info("Conciliación de pagos desactivada por AERONET_PAYMENT_WORKER_ENABLED")
    else if (PaymentService.gateway.isEmpty)
      logger.info("Pago en línea desactivado: falta AERONET_PAYMENT_PROVIDER o las credenciales de la pasarela")
    else {
      val interval = sys.env.get("AERONET_PAYMENT_RECONCILE_SECONDS").flatMap(_.toIntOption).filter(_ > 0).getOrElse(30)
      val worker = Executors.newSingleThreadScheduledExecutor((runnable: Runnable) => {
        val thread = new Thread(runnable, "aeronet-payment-reconciliation")
        thread.setDaemon(true)
        thread
      })
      executor = Some(worker)
      worker.scheduleWithFixedDelay(new Runnable {
        override def run(): Unit = try PaymentService.reconcile()
        catch { case ex: Exception => logger.error("Falló el ciclo de conciliación de pagos", ex) }
      }, interval, interval, TimeUnit.SECONDS)
      logger.info(s"Conciliación de pagos iniciada cada $interval s")
    }
  }

  override def contextDestroyed(event: ServletContextEvent): Unit = executor.foreach(_.shutdownNow())
}
