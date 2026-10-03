package com.transport.system

import com.transport.system.controllers.{AdminController, AuthController, EmployeeController, PassengerController}
import jakarta.servlet.{DispatcherType, Filter, FilterChain, ServletRequest, ServletResponse}
import jakarta.servlet.http.{HttpServletRequest, HttpServletResponse}
import org.eclipse.jetty.ee10.servlet.{FilterHolder, ServletContextHandler, ServletHolder}
import org.eclipse.jetty.server.Server

import java.util.EnumSet

/** Punto de entrada para ejecutar la API localmente con `sbt run`. */
object BackendMain {
  def main(args: Array[String]): Unit = {
    val port = sys.env.get("AERONET_HTTP_PORT").flatMap(_.toIntOption).getOrElse(8080)
    val server = new Server(port)
    val context = new ServletContextHandler()
    context.setContextPath("/")
    context.addFilter(new FilterHolder(new LocalCorsFilter), "/*", EnumSet.of(DispatcherType.REQUEST))
    context.addServlet(new ServletHolder(new AuthController), "/auth/*")
    context.addServlet(new ServletHolder(new PassengerController), "/passenger/*")
    context.addServlet(new ServletHolder(new EmployeeController), "/employee/*")
    context.addServlet(new ServletHolder(new AdminController), "/admin/*")
    server.setHandler(context)

    Runtime.getRuntime.addShutdownHook(new Thread(() => server.stop()))
    server.start()
    println(s"AeroNet API escuchando en http://localhost:$port")
    server.join()
  }
}

/** Habilita las solicitudes del frontend local, incluyendo los preflight JSON y Bearer. */
private class LocalCorsFilter extends Filter {
  private val allowedOrigins = Set("http://localhost:5173", "http://127.0.0.1:5173")

  override def doFilter(request: ServletRequest, response: ServletResponse, chain: FilterChain): Unit = {
    val httpRequest = request.asInstanceOf[HttpServletRequest]
    val httpResponse = response.asInstanceOf[HttpServletResponse]
    Option(httpRequest.getHeader("Origin")).filter(allowedOrigins.contains).foreach { origin =>
      httpResponse.setHeader("Access-Control-Allow-Origin", origin)
      httpResponse.setHeader("Vary", "Origin")
      httpResponse.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
      httpResponse.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
    }
    if (httpRequest.getMethod == "OPTIONS") httpResponse.setStatus(HttpServletResponse.SC_NO_CONTENT)
    else chain.doFilter(request, response)
  }
}
