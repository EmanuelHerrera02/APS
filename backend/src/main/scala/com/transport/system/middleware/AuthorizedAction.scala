package com.transport.system.middleware

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.JWTVerificationException
import com.auth0.jwt.interfaces.JWTVerifier
import com.transport.system.db.Database
import javax.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory

import scala.jdk.CollectionConverters.*
import scala.util.Try

/** Identidad autenticada extraida de un JWT verificado. */
final case class Identidad(
    userId: Int,
    email: Option[String],
    roles: Set[String],
    permissions: Set[String]
)

/**
 * Credencial ausente, invalida o vencida. `http` permite distinguir un 401 de
 * un 403 sin agregar otra excepcion.
 */
final case class SecurityException(mensaje: String, http: Int = 401)
    extends RuntimeException(mensaje)

/**
 * Autorizacion por JWT (HS256).
 *
 * El token se espera en `Authorization: Bearer <jwt>` y sus claims siguen el
 * modelo JwtPayload de models/Models.scala: `userId`, `email`, `roles` y
 * `permissions`.
 *
 * Este trait no implementa el inicio de sesion: solo verifica lo que otro
 * componente haya firmado. El secreto se lee de `aeronet.jwt.secret`, que en
 * application.conf no tiene valor por defecto a proposito.
 */
trait AuthorizedAction {

  private val logger = LoggerFactory.getLogger(getClass)

  private val cacheAttribute = "aeronet.identidad"

  private def algorithm: Algorithm = Algorithm.HMAC256(secret)

  private lazy val secret: String = {
    val valor =
      Try(Database.config.getString("aeronet.jwt.secret")).toOption
        .map(_.trim)
        .filter(_.nonEmpty)
    valor.getOrElse {
      throw new IllegalStateException(
        "Falta aeronet.jwt.secret. Definí la variable de entorno AERONET_JWT_SECRET: " +
          "el proceso no arranca con una clave de firma conocida."
      )
    }
  }

  private def issuer: String = Database.config.getString("aeronet.jwt.issuer")

  private lazy val verifier: JWTVerifier =
    JWT.require(algorithm).withIssuer(issuer).build()

  private def tokenDe(request: HttpServletRequest): Option[String] =
    Option(request.getHeader("Authorization"))
      .map(_.trim)
      .collect { case h if h.regionMatches(true, 0, "Bearer ", 0, 7) =>
        h.substring(7).trim
      }
      .filter(_.nonEmpty)

  /**
   * Verifica el token y lo cachea en la request para no validarlo en cada
   * llamada. Un token ausente o invalido no es excepcion todavia: devuelve
   * None y cada endpoint decide si responde 401 o 403.
   */
  def identidad(request: HttpServletRequest): Option[Identidad] = {
    // Ojo: no envolver en Option. Option(null) es None, y None != null, asi
    // que el early-return dispararia siempre con identidad vacia y el token
    // jamais se verificaria.
    val cacheado = request.getAttribute(cacheAttribute)
    if (cacheado != null) return cacheado.asInstanceOf[Option[Identidad]]

    val resultado = tokenDe(request).flatMap { token =>
      try {
        val jwt = verifier.verify(token)
        val roles = claims(jwt.getClaim("roles").asList(classOf[String]))
        val permisos = claims(jwt.getClaim("permissions").asList(classOf[String]))
        val userId = Option(jwt.getClaim("userId").asInt())
          .map(_.intValue())
          .getOrElse {
            throw new JWTVerificationException(
              "El token no trae el claim userId"
            )
          }
        Some(
          Identidad(
            userId = userId,
            email = Option(jwt.getClaim("email").asString())
              .filter(_.nonEmpty),
            roles = roles,
            permissions = permisos
          )
        )
      } catch {
        case e: JWTVerificationException =>
          logger.debug(s"Token rechazado: ${e.getMessage}")
          None
        case e: RuntimeException =>
          // java-jwt envuelve certains fallos (p. ej. exp como Instant) en
          // RuntimeException no casa con JWTVerificationException.
          logger.debug(s"Token invalido: ${e.getMessage}")
          None
      }
    }

    request.setAttribute(cacheAttribute, resultado)
    resultado
  }

  /**
   * Identidad o 401. Para los endpoints nuevos conviene usar este metodo en vez
   * de getUserIdFromRequest, que devuelve Option para no romper los controllers
   * que ya escribieron.
   */
  def autenticado(request: HttpServletRequest): Identidad =
    identidad(request).getOrElse(
      throw SecurityException("Falta un token valido o ya vencio", 401)
    )

  def getUserIdFromRequest(request: HttpServletRequest): Option[Int] =
    identidad(request).map(_.userId)

  /**
   * Los roles de Models.scala van en minuscula ("admin", "passenger") mientras
   * que el enum de la tabla usuario usa mayusculas ("ADMIN", "PASAJERO"). La
   * comparacion es insensible a mayusculas para tolerar ambos.
   */
  def hasRole(request: HttpServletRequest, rol: String): Boolean =
    identidad(request).exists(_.roles.exists(_.equalsIgnoreCase(rol)))

  def hasPermission(request: HttpServletRequest, permiso: String): Boolean =
    identidad(request).exists { i =>
      i.permissions.contains(permiso) || i.roles.exists(r =>
        r.equalsIgnoreCase("admin")
      )
    }

  def logAccessDenied(
      userId: Option[Int],
      accion: String,
      motivo: String
  ): Unit =
    logger.warn(
      s"Acceso denegado: usuario=${userId.getOrElse("anonimo")} accion=$accion motivo=$motivo"
    )

  private def claims(lista: java.util.List[String]): Set[String] =
    if (lista == null) Set.empty
    else lista.asScala.toSet.filter(_ != null)
}
