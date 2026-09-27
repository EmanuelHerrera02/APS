package com.transport.system.controllers

import com.transport.system.db.ErroDeBase
import org.json4s.jackson.JsonMethods
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.math.BigDecimal
import java.time.{LocalDate, LocalTime}

/**
 * Tests del parseo del cuerpo del alta.
 *
 * Son unitarios: no tocan la base, asi que pueden correr sin MySQL. Lo que se
 * verifica acá es que cada error de formato salga con el nombre del campo, que es
 * lo que permite al formulario marcar el input。而 lo que la base rechaza se
 * traduce en otro spec.
 */
class ParseoAltaSpec extends AnyWordSpec with Matchers {

  private val valido =
    """{
      "codigo": "AN1001",
      "aeropuertoOrigen": "AEP",
      "aeropuertoDestino": "BRC",
      "horaPartida": "06:40",
      "horaLlegada": "08:35",
      "diasDesfaseLlegada": 0,
      "fechaDesde": "2026-11-02",
      "fechaHasta": "2026-11-08",
      "diasOperacion": [1, 2, 3, 4, 5],
      "clases": [
        {"clase": "ECONOMY", "capacidad": 150, "precio": 120000.00},
        {"clase": "PRIMERA", "capacidad": 12, "precio": 280000.00}
      ]
    }"""

  private def parsear(json: String) = ParseoAlta.parsear(JsonMethods.parse(json))

  private def errorDe(json: String): ErroDeBase =
    intercept[ErroDeBase](parsear(json))

  "un cuerpo valido" should {

    "traducirse al request completo" in {
      val r = parsear(valido)

      r.codigo shouldBe "AN1001"
      r.aeropuertoOrigen shouldBe "AEP"
      r.aeropuertoDestino shouldBe "BRC"
      r.horaPartida shouldBe LocalTime.of(6, 40)
      r.horaLlegada shouldBe LocalTime.of(8, 35)
      r.diasDesfaseLlegada shouldBe 0
      r.fechaDesde shouldBe LocalDate.of(2026, 11, 2)
      r.fechaHasta shouldBe LocalDate.of(2026, 11, 8)
      r.diasOperacion shouldBe List(1, 2, 3, 4, 5)
      r.clases should have size 2
      r.clases.head.clase shouldBe "ECONOMY"
      r.clases.head.capacidad shouldBe 150
      r.clases.head.precio.compareTo(new BigDecimal("120000.00")) shouldBe 0
    }

    "aceptar HH:mm:ss ademas de HH:mm" in {
      val r = parsear(valido.replace("\"06:40\"", "\"06:40:00\""))
      r.horaPartida shouldBe LocalTime.of(6, 40)
    }

    "aceptar numeros enviados como texto" in {
      val r = parsear(
        valido
          .replace("\"diasDesfaseLlegada\": 0", "\"diasDesfaseLlegada\": \"1\"")
          .replace("\"capacidad\": 150", "\"capacidad\": \"150\"")
          .replace("\"precio\": 120000.00", "\"precio\": \"120000.00\"")
      )
      r.diasDesfaseLlegada shouldBe 1
      r.clases.head.capacidad shouldBe 150
      r.clases.head.precio.compareTo(new BigDecimal("120000.00")) shouldBe 0
    }

    "normalizar el codigo del vuelo a mayusculas" in {
      parsear(valido.replace("\"AN1001\"", "\"an1001\"")).codigo shouldBe "AN1001"
    }
  }

  "un cuerpo incompleto" should {

    "señalar el campo que falta" in {
      val e = errorDe("""{"aeropuertoOrigen": "AEP"}""")
      e.http shouldBe 422
      e.campo shouldBe Some("codigo")
    }

    "señalar el input exacto de la clase que falta" in {
      val e = errorDe(
        valido.replace(
          """{"clase": "PRIMERA", "capacidad": 12, "precio": 280000.00}""",
          """{"clase": "PRIMERA", "precio": 280000.00}"""
        )
      )
      e.http shouldBe 422
      e.campo shouldBe Some("capacidad")
    }
  }

  "un valor mal formado" should {

    "señalar la hora de partida" in {
      val e = errorDe(valido.replace("\"06:40\"", "\"25:99\""))
      e.campo shouldBe Some("horaPartida")
      e.mensaje should include("hora")
    }

    "señalar la fecha de inicio" in {
      val e = errorDe(valido.replace("\"2026-11-02\"", "\"02/11/2026\""))
      e.campo shouldBe Some("fechaDesde")
    }

    "señalar un entero que no se puede convertir" in {
      val e = errorDe(valido.replace("\"diasDesfaseLlegada\": 0", "\"diasDesfaseLlegada\": \"mucho\""))
      e.campo shouldBe Some("diasDesfaseLlegada")
    }

    "señalar una capacidad decimal" in {
      val e = errorDe(valido.replace("\"capacidad\": 150", "\"capacidad\": 12.5"))
      e.campo shouldBe Some("capacidad")
    }

    "señalar una clase que no existe" in {
      val e = errorDe(valido.replace("\"ECONOMY\"", "\"SUPER\""))
      e.campo shouldBe Some("clases")
      e.mensaje should include("ECONOMY")
    }

    "señalar un dia de operacion que no es un numero" in {
      val e = errorDe(valido.replace("[1, 2, 3, 4, 5]", """[1, "dos"]"""))
      e.campo shouldBe Some("diasOperacion")
    }
  }

  "un cuerpo bien formado que la base va a rechazar" should {

    // El parser no revalida reglas de negocio: solo traduce formato. Estas
    // pasan y las corta el CHECK de la base, que ErroDeBase traduce despues.
    "dejar pasar una lista de dias vacia" in {
      parsear(valido.replace("[1, 2, 3, 4, 5]", "[]")).diasOperacion shouldBe empty
    }

    "dejar pasar un dia de operacion fuera de rango" in {
      parsear(valido.replace("[1, 2, 3, 4, 5]", "[1, 9]")).diasOperacion shouldBe List(1, 9)
    }
  }

  "una raiz que no es un objeto" should {
    "ser rechazada" in {
      val e = intercept[ErroDeBase](parsear("""[1, 2, 3]"""))
      e.http shouldBe 422
    }
  }
}
