package com.transport.system.documents

import jakarta.servlet.{ServletContextEvent, ServletContextListener}
import com.transport.system.notifications.EmailQueueWorker
import java.util.concurrent.{Executors, ScheduledExecutorService, TimeUnit}
import org.slf4j.LoggerFactory

class DocumentGenerationLifecycle extends ServletContextListener {
  private val logger = LoggerFactory.getLogger(getClass)
  private var executor: Option[ScheduledExecutorService] = None

  override def contextInitialized(event: ServletContextEvent): Unit = {
    val enabled = sys.env.getOrElse("AERONET_DOCUMENT_GENERATION_ENABLED", "true")
      .equalsIgnoreCase("true")
    if (enabled) {
      val worker = Executors.newSingleThreadScheduledExecutor((runnable: Runnable) => {
        val thread = new Thread(runnable, "aeronet-document-generation")
        thread.setDaemon(true)
        thread
      })
      executor = Some(worker)
      worker.scheduleWithFixedDelay(new Runnable {
        override def run(): Unit = try DocumentIssuanceService.generatePending()
        catch { case ex: Exception => logger.error("Falló el ciclo de emisión de documentos", ex) }
      }, 0, 10, TimeUnit.SECONDS)
      logger.info("Worker de generación de documentos iniciado")
    }
    if (sys.env.getOrElse("AERONET_EMAIL_WORKER_ENABLED", "true").equalsIgnoreCase("true")) {
      if (EmailQueueWorker.isConfigured) {
        val worker = executor.getOrElse {
          val created = Executors.newSingleThreadScheduledExecutor((runnable: Runnable) => {
            val thread = new Thread(runnable, "aeronet-email-queue")
            thread.setDaemon(true)
            thread
          })
          executor = Some(created)
          created
        }
        worker.scheduleWithFixedDelay(new Runnable {
          override def run(): Unit = try EmailQueueWorker.processBatch()
          catch { case ex: Exception => logger.error("Falló el ciclo de envío de emails", ex) }
        }, 0, 5, TimeUnit.SECONDS)
        worker.scheduleWithFixedDelay(new Runnable {
          override def run(): Unit = try EmailQueueWorker.logMetrics()
          catch { case ex: Exception => logger.error("No se pudieron registrar métricas de la cola de emails", ex) }
        }, 60, 60, TimeUnit.SECONDS)
        logger.info("Worker de emails iniciado")
        EmailQueueWorker.configurationWarnings.foreach(warning => logger.warn(s"Configuración de correo: $warning"))
      } else logger.info("Worker de emails desactivado: falta configurar el proveedor AERONET_EMAIL_PROVIDER, sus credenciales o AERONET_SMTP_FROM")
    }
  }

  override def contextDestroyed(event: ServletContextEvent): Unit = executor.foreach(_.shutdownNow())
}
