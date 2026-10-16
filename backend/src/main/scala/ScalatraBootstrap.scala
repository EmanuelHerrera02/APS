import com.transport.system.controllers.{AdminController, AuthController, EmployeeController, PassengerController}
import com.transport.system.documents.DocumentGenerationLifecycle
import jakarta.servlet.ServletContext
import org.scalatra.LifeCycle

class ScalatraBootstrap extends LifeCycle {
  override def init(context: ServletContext): Unit = {
    context.addListener(new DocumentGenerationLifecycle)
    context.mount(new AuthController, "/auth/*")
    context.mount(new PassengerController, "/passenger/*")
    context.mount(new EmployeeController, "/employee/*")
    context.mount(new AdminController, "/admin/*")
  }
}
