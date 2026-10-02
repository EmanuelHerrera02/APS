import com.transport.system.controllers.{AdminController, AuthController, EmployeeController, PassengerController}
import jakarta.servlet.ServletContext
import org.scalatra.LifeCycle

class ScalatraBootstrap extends LifeCycle {
  override def init(context: ServletContext): Unit = {
    context.mount(new AuthController, "/auth/*")
    context.mount(new PassengerController, "/passenger/*")
    context.mount(new EmployeeController, "/employee/*")
    context.mount(new AdminController, "/admin/*")
  }
}
