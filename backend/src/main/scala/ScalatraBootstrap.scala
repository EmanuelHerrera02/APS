import com.transport.system.controllers.{AdminController, AuthController, EmailDeliveryController, EmployeeController, PassengerController, PaymentController, PaymentWebhookController}
import com.transport.system.documents.DocumentGenerationLifecycle
import com.transport.system.payments.PaymentLifecycle
import jakarta.servlet.ServletContext
import org.scalatra.LifeCycle

class ScalatraBootstrap extends LifeCycle {
  override def init(context: ServletContext): Unit = {
    context.addListener(new DocumentGenerationLifecycle)
    context.addListener(new PaymentLifecycle)
    context.mount(new AuthController, "/auth/*")
    context.mount(new PassengerController, "/passenger/*")
    context.mount(new PaymentController, "/payments/*")
    context.mount(new EmailDeliveryController, "/webhooks/email/*")
    context.mount(new PaymentWebhookController, "/webhooks/payments/*")
    context.mount(new EmployeeController, "/employee/*")
    context.mount(new AdminController, "/admin/*")
  }
}
