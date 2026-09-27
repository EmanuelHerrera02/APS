package com.transport.system.db

import java.sql.SQLException
import java.text.Normalizer

/**
 * Error de negocio traducido desde la base.
 *
 * `campo` es el nombre del campo del formulario de alta cuando el error se puede
 * atribuir a uno; None cuando corresponde a la operacion completa.
 */
final case class ErroDeBase(
    http: Int,
    mensaje: String,
    campo: Option[String] = None,
    sqlState: Option[String] = None,
    codigo: Option[Int] = None,
    causa: Option[Throwable] = None
) extends RuntimeException(mensaje)

/**
 * Traduce los errores de MariaDB a respuestas HTTP.
 *
 * Las reglas salen de la seccion 7 de docs/manual-base-de-datos.md. La clave
 * para que el formulario muestre un mensaje util por campo es el nombre de la
 * constraint: MariaDB lo incluye en los errores de CHECK (4025), en los de
 * clave duplicada (1062) y en los de FK (1452).
 */
object ErroDeBase {

  /** CHECK del alta de vuelo: constraint -> (campo, mensaje). */
  private val checks: Map[String, (Option[String], String)] = Map(
    "chk_vuelo_ruta" ->
      (None, "El origen y el destino no pueden ser el mismo aeropuerto"),
    "chk_vuelo_periodo" ->
      (None, "La fecha hasta no puede ser anterior a la fecha desde"),
    "chk_vuelo_desfase" ->
      (Some("diasDesfaseLlegada"),
       "El desfase de llegada debe ser 0 (mismo día) o 1 (día siguiente)"),
    "chk_vuelo_horario" ->
      (Some("horaLlegada"),
       "Si la llegada es el mismo día, la hora de llegada debe ser posterior a la de partida"),
    "chk_vuelo_codigo" ->
      (Some("codigo"),
       "El código debe tener el formato NN1234: 2 caracteres alfanumericos en mayuscula y de 1 a 4 digitos"),
    "chk_vdo_dia" ->
      (Some("diasOperacion"),
       "Los días de operación van de 1 (lunes) a 7 (domingo)"),
    "chk_vuelo_clase_capacidad" ->
      (Some("clases"), "La capacidad de cada clase debe ser mayor que 0"),
    "chk_vuelo_clase_precio" ->
      (Some("clases"), "El precio de cada clase debe ser mayor que 0")
  )

  /** Claves unicas del alta: constraint -> (campo, mensaje, http). */
  private val unicas: Map[String, (Option[String], String, Int)] = Map(
    "uq_vuelo_codigo" ->
      (Some("codigo"), "Ya existe un vuelo con ese código", 409)
  )

  /** FKs del alta: constraint -> campo. */
  private val fks: Map[String, Option[String]] = Map(
    "fk_vuelo_origen" -> Some("aeropuertoOrigen"),
    "fk_vuelo_destino" -> Some("aeropuertoDestino")
  )

  /**
   * Errores de negocio emitidos con SIGNAL SQLSTATE 45000 por triggers y
   * procedimientos: fragmento del texto -> (campo, mensaje, http).
   */
  private val senalados: List[(String, Option[String], String, Int)] = List(
    ("no tiene dias de operacion",
     Some("diasOperacion"),
     "El vuelo debe tener al menos un día de operación", 422),
    ("no tiene clases",
     Some("clases"),
     "El vuelo debe tener al menos una clase con capacidad y precio", 422),
    ("No se generan salidas para un vuelo cancelado",
     Some("estado"),
     "No se pueden generar salidas de un vuelo cancelado", 422),
    ("por debajo de los asientos vendidos",
     Some("clases"),
     "No se puede reducir la capacidad por debajo de los asientos ya vendidos", 409),
    ("La ruta de un vuelo no se modifica",
     Some("aeropuertoOrigen"),
     "La ruta de un vuelo no se puede modificar: cancele el vuelo y cree otro", 422),
    ("Un vuelo cancelado no puede reactivarse",
     Some("estado"),
     "Un vuelo cancelado no se puede reactivar", 409),
    ("Borrado fisico no permitido",
     None,
     "Operación no permitida sobre este recurso", 405)
  )

  // El separador de MariaDB cambia segun la version (apostrofes o acentos
  // graves), asi que se acepta cualquier caracter no alfanumerico.
  private val reConstraint = "(?i)CONSTRAINT[^A-Za-z0-9_]*([A-Za-z0-9_]+)".r
  private val reIndice = "(?i)(?:for key|key)[^A-Za-z0-9_]*([A-Za-z0-9_]+)".r
  private val reConexion = "\\(conn=\\d+\\)\\s*".r

  /**
   * Quita acentos y pasa a minusculas para comparar texto de la base contra los
   * fragmentos de [[senalados]].
   *
   * Los SIGNAL de los procedimientos estan escritos con acentos ("El vuelo no
   * tiene dias de operacion" sale con tilde), asi que comparar en crudo haria
   * fallar el match y el error caeria en el mensaje generico sin `campo`.
   */
  private def normalizar(texto: String): String =
    Normalizer
      .normalize(texto, Normalizer.Form.NFD)
      .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
      .toLowerCase

  /** Nombre de la constraint en un mensaje de MariaDB, si aparece. */
  private def constraintDe(texto: String): Option[String] =
    reConstraint
      .findFirstMatchIn(texto)
      .map(_.group(1).toLowerCase)
      .orElse(
        reIndice.findFirstMatchIn(texto).map(_.group(1).toLowerCase)
      )

  def desde(e: SQLException): ErroDeBase = {
    val sqlState = Option(e.getSQLState)
    val codigo = Option(e.getErrorCode)
    val texto = reConexion
      .replaceAllIn(Option(e.getMessage).getOrElse("").trim, "")

    def base(http: Int, mensaje: String, campo: Option[String]): ErroDeBase =
      ErroDeBase(
        http = http,
        mensaje = mensaje,
        campo = campo,
        sqlState = sqlState,
        codigo = codigo,
        causa = Option(e)
      )

    def porConstraint(http: Int): Option[ErroDeBase] =
      constraintDe(texto).flatMap { c =>
        checks.get(c).map((campo, msg) => base(http, msg, campo))
          .orElse(unicas.get(c).map((campo, msg, h) => base(h, msg, campo)))
          .orElse(fks.get(c).map(campo => base(422, "La referencia no existe o no es válida", campo)))
      }

    sqlState match {
      // Regla de negocio: SIGNAL ... SET MESSAGE_TEXT.
      case Some("45000") =>
        val textoNormalizado = normalizar(texto)
        senalados
          .find((fragmento, _, _, _) =>
            textoNormalizado.contains(normalizar(fragmento))
          )
          .map((_, campo, msg, http) => base(http, msg, campo))
          .getOrElse(base(422, texto, None))

      case _ =>
        codigo match {
          // Clave duplicada.
          case Some(1062) =>
            porConstraint(409).getOrElse(base(409, "El valor ya existe", None))

          // Violacion de CHECK: el nombre de la constraint dice cual.
          case Some(4025) =>
            porConstraint(422).getOrElse(base(422, "Los datos no son válidos", None))

          // Referencia a un id inexistente.
          case Some(1452) =>
            porConstraint(422).getOrElse(base(422, "La referencia no existe", None))

          case _ =>
            base(500, "Error inesperado de la base de datos", None)
        }
    }
  }
}
