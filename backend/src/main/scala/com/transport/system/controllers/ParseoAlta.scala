package com.transport.system.controllers

import com.transport.system.db.ErroDeBase
import com.transport.system.models.{AltaVueloRequest, ClaseVuelo}
import org.json4s.{JArray, JDecimal, JDouble, JInt, JLong, JNumber, JObject, JString, JValue}

import java.math.BigDecimal
import java.time.format.DateTimeFormatter
import java.time.{LocalDate, LocalTime}
import scala.util.{Failure, Success, Try}

/**
 * Traduce el cuerpo JSON del alta a [[AltaVueloRequest]].
 *
 * Se parsea a mano y no con `extract[AltaVueloRequest]` por dos razones.
 *
 * Una: json4s 4.1.1 no trae formatos para `java.time` (eso vive en json4s-ext,
 * que no esta en el build), asi que `LocalDate` y `LocalTime` no tendrian
 * formato.
 *
 * Dos, que es la importante: cada error de formato sale con el nombre del campo
 * que lo produjo, y el formulario puede marcar ese input. Con `extract` un tipo
 * malvenido revienta con un error generico sin campo.
 *
 * Ojo con el alcance: acá solo se traduce el formato de lo que llega. Las reglas
 * de negocio las sigue aplicando la base, y sus errores los traduce
 * [[ErroDeBase]].
 */
object ParseoAlta {

  /** Clases del ENUM `vuelo_clase.clase` (db/01_schema.sql:146). */
  private val clasesValidas = Set("ECONOMY", "PRIMERA")

  /** Acepta HH:mm y tambien HH:mm:ss, que es lo que puede mandar un time input. */
  private val formatosHora = Seq(
    DateTimeFormatter.ofPattern("HH:mm"),
    DateTimeFormatter.ofPattern("HH:mm:ss")
  )

  private def campo(nombre: String, mensaje: String): Nothing =
    throw ErroDeBase(http = 422, mensaje = mensaje, campo = Some(nombre))

  private def objetoRaiz(j: JValue): JObject = j match {
    case o: JObject => o
    case _ =>
      throw ErroDeBase(
        http = 422,
        mensaje = "El cuerpo de la petición tiene que ser un objeto JSON"
      )
  }

  private def valorDe(o: JObject, nombre: String): JValue =
    o.obj
      .find(_._1 == nombre)
      .map(_._2)
      .getOrElse(
        campo(nombre, s"Falta el campo $nombre en el cuerpo de la petición")
      )

  private def textoDe(o: JObject, nombre: String): String =
    valorDe(o, nombre) match {
      case JString(s) if s.trim.nonEmpty => s.trim
      case JString(_) => campo(nombre, s"El campo $nombre no puede estar vacío")
      case _           => campo(nombre, s"El campo $nombre tiene que ser un texto")
    }

  /**
   * Número de un nodo JSON como BigDecimal.
   *
   * En json4s 4.1.1 `JNumber` es un marcador vacío y cada subtipo expone su `num`
   * con un tipo distinto, así que no hay un accessor común: hay que matchear los
   * cuatro. No sirve pasar por `toString`, que devuelve la representación del
   * case class ("JInt(0)") y no el número.
   */
  private def numeroDe(v: JValue, nombre: String, mensaje: String): BigDecimal = v match {
    // Las conversiones son explicitas porque json4s trabaja con scala.math y
    // aca se necesita java.math, que es el que espera PreparedStatement.
    case JInt(n)     => new BigDecimal(n.bigInteger)
    case JLong(n)    => java.math.BigDecimal.valueOf(n)
    case JDecimal(n) => n.bigDecimal
    case JDouble(n)  => java.math.BigDecimal.valueOf(n)
    case JString(s) =>
      Try(new BigDecimal(s.trim)) match {
        case Success(d) => d
        case Failure(_) => campo(nombre, mensaje)
      }
    case _ => campo(nombre, mensaje)
  }

  private def enteroDe(o: JObject, nombre: String): Int = {
    val mensaje = s"El campo $nombre tiene que ser un número entero"
    val numero = numeroDe(valorDe(o, nombre), nombre, mensaje)
    Try(numero.intValueExact) match {
      case Success(i) => i
      case Failure(_) => campo(nombre, mensaje)
    }
  }

  private def decimalDe(o: JObject, nombre: String): BigDecimal =
    numeroDe(valorDe(o, nombre), nombre, s"El campo $nombre tiene que ser un número")

  private def fechaDe(o: JObject, nombre: String): LocalDate = {
    val s = textoDe(o, nombre)
    Try(LocalDate.parse(s)) match {
      case Success(d) => d
      case Failure(_) =>
        campo(
          nombre,
          s"El campo $nombre tiene que ser una fecha con formato AAAA-MM-DD"
        )
    }
  }

  private def horaDe(o: JObject, nombre: String): LocalTime = {
    val s = textoDe(o, nombre)
    formatosHora.iterator
      .map(f => Try(LocalTime.parse(s, f)).toOption)
      .collectFirst { case Some(hora) => hora }
      .getOrElse(
        campo(
          nombre,
          s"El campo $nombre tiene que ser una hora con formato HH:mm"
        )
      )
  }

  private def listaDe(o: JObject, nombre: String): List[JValue] =
    valorDe(o, nombre) match {
      case JArray(l) => l.toList
      case _         => campo(nombre, s"El campo $nombre tiene que ser una lista")
    }

  private def enterosDe(o: JObject, nombre: String): List[Int] = {
    val mensaje = s"El campo $nombre tiene que ser una lista de números enteros"
    listaDe(o, nombre).map { elemento =>
      Try(numeroDe(elemento, nombre, mensaje).intValueExact) match {
        case Success(i) => i
        case Failure(_) => campo(nombre, mensaje)
      }
    }
  }

  private def claseDe(j: JValue): ClaseVuelo = j match {
    case o: JObject =>
      val clase = textoDe(o, "clase").toUpperCase
      if (!clasesValidas.contains(clase))
        campo(
          "clases",
          s"La clase $clase no existe. Las opciones son ${clasesValidas.toList.sorted.mkString(", ")}"
        )
      ClaseVuelo(
        clase = clase,
        capacidad = enteroDe(o, "capacidad"),
        precio = decimalDe(o, "precio")
      )
    case _ => campo("clases", "Cada clase tiene que ser un objeto")
  }

  def parsear(cuerpo: JValue): AltaVueloRequest = {
    val o = objetoRaiz(cuerpo)
    AltaVueloRequest(
      codigo = textoDe(o, "codigo").toUpperCase,
      aeropuertoOrigen = textoDe(o, "aeropuertoOrigen"),
      aeropuertoDestino = textoDe(o, "aeropuertoDestino"),
      horaPartida = horaDe(o, "horaPartida"),
      horaLlegada = horaDe(o, "horaLlegada"),
      diasDesfaseLlegada = enteroDe(o, "diasDesfaseLlegada"),
      fechaDesde = fechaDe(o, "fechaDesde"),
      fechaHasta = fechaDe(o, "fechaHasta"),
      diasOperacion = enterosDe(o, "diasOperacion"),
      clases = listaDe(o, "clases").map(claseDe)
    )
  }
}
