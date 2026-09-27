package com.transport.system.services

import com.transport.system.db.{Database, ErroDeBase}
import com.transport.system.models.{AltaVueloRequest, ClaseVuelo}
import org.scalatest.BeforeAndAfterAll
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import java.math.BigDecimal
import java.sql.{Connection, ResultSet}
import java.time.{LocalDate, LocalTime}

/**
 * Integracion del alta contra MariaDB.
 *
 * Corre contra la base de verdad, no contra un doble: lo que se prueba es
 * justamente el comportamiento de la base (CHECKs, ENUMs, el procedure), y un
 * doble lo daria por goodo.
 *
 * No limpia lo que crea, y es a proposito. La base prohibe el borrado fisico
 * con triggers en todas sus tablas (db/02_logic.sql:42-61), asi que un vuelo
 * de test no se puede borrar despues: ni el vuelo, ni sus salidas, ni sus
 * clases. Por eso `beforeAll` se niega a correr si no apuntan a una base cuyo
 * nombre termine en `_test`, y por eso hay que recargarla antes de cada
 * corrida con scripts/reset-test-db.sh.
 *
 * Cada test usa un codigo propio, asi que tampoco se pisan entre si.
 */
class VueloServiceSpec
    extends AnyWordSpec
    with Matchers
    with BeforeAndAfterAll {

  // IATA de los aeropuertos del seed. Se usan codigos y no nombres para que el
  // test no dependa de como este redactado el campo `nombre`.
  private val aep = "AEP" // Ciudad de Buenos Aires
  private val brc = "BRC" // San Carlos de Bariloche
  private val cor = "COR" // Cordoba
  private val mdz = "MDZ" // Mendoza

  private val adminId = 1L

  override def beforeAll(): Unit = {
    val url = Database.url
    val nombre = url.split('/').lastOption.getOrElse("")
    withClue(
      s"""Los tests de integracion necesitan una base propia y recien cargada,
         |pero AERONET_DB_URL apunta a '$nombre'.
         |La base prohibe el borrado fisico, asi que un test no se puede
         |deshacer y contaminaria la de desarrollo.
         |
         |  scripts/reset-test-db.sh
         |  AERONET_DB_URL='jdbc:mariadb://127.0.0.1:3306/aeronet_test' sbt test
         |""".stripMargin
    ) {
      nombre should endWith("_test")
    }
  }

  private def alta(
      codigo: String,
      origen: String,
      destino: String,
      dias: List[Int] = List(1, 2, 3, 4, 5, 6, 7),
      clases: List[ClaseVuelo] = List(
        ClaseVuelo("ECONOMY", 150, new BigDecimal("120000.00")),
        ClaseVuelo("PRIMERA", 12, new BigDecimal("280000.00"))
      )
  ): AltaVueloRequest =
    AltaVueloRequest(
      codigo = codigo,
      aeropuertoOrigen = origen,
      aeropuertoDestino = destino,
      horaPartida = LocalTime.of(6, 40),
      horaLlegada = LocalTime.of(8, 35),
      diasDesfaseLlegada = 0,
      // 2026-11-02 es lunes y el período va hasta el domingo 8.
      fechaDesde = LocalDate.of(2026, 11, 2),
      fechaHasta = LocalDate.of(2026, 11, 8),
      diasOperacion = dias,
      clases = clases
    )

  private def conConexion[A](f: Connection => A): A = {
    val conn = Database.conectar()
    try f(conn)
    finally conn.close()
  }

  private def contarSalidas(vueloId: Long): Int =
    conConexion { conn =>
      leerEntero(conn, "SELECT COUNT(*) FROM salida WHERE vuelo_id = ?", vueloId)
    }

  private def contarSalidaClases(vueloId: Long): Int =
    conConexion { conn =>
      leerEntero(
        conn,
        """SELECT COUNT(*) FROM salida_clase sc
             JOIN salida s ON s.id = sc.salida_id
            WHERE s.vuelo_id = ?""",
        vueloId
      )
    }

  private def leerEntero(conn: Connection, sql: String, id: Long): Int = {
    val ps = conn.prepareStatement(sql)
    try {
      ps.setLong(1, id)
      leerEntero(ps.executeQuery())
    } finally ps.close()
  }

  private def leerEntero(rs: ResultSet): Int =
    if (rs.next()) rs.getInt(1) else 0

  private def errorDe(operacion: => Any): ErroDeBase =
    intercept[ErroDeBase](operacion)

  "VueloService.crear" should {

    "crear el vuelo y materializar las salidas del período" in {
      val creado = VueloService.crear(alta("TS901", aep, brc), adminId)

      creado.codigo shouldBe "TS901"
      creado.vueloId should be > 0L
      // Con los 7 días cargados, una salida por día del período.
      creado.salidasGeneradas shouldBe 7
      creado.salidaClasesGeneradas shouldBe 14 // 7 salidas x 2 clases
      contarSalidas(creado.vueloId) shouldBe 7
      contarSalidaClases(creado.vueloId) shouldBe 14
    }

    "respeta los días de operación cargados" in {
      // Solo lunes: en el período de una semana tiene que salir una sola, con
      // una fila de salida_clase por cada una de las dos clases del vuelo.
      val creado = VueloService.crear(alta("TS902", aep, cor, dias = List(1)), adminId)

      creado.salidasGeneradas shouldBe 1
      creado.salidaClasesGeneradas shouldBe 2
      contarSalidas(creado.vueloId) shouldBe 1
    }

    "copiar la ruta y el horario del vuelo a cada salida" in {
      val creado = VueloService.crear(alta("TS903", aep, mdz), adminId)

      conConexion { conn =>
        val ps = conn.prepareStatement(
          """SELECT v.aeropuerto_origen_id, v.aeropuerto_destino_id,
                    s.aeropuerto_origen_id, s.aeropuerto_destino_id,
                    v.hora_partida, s.hora_partida
               FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
              WHERE s.vuelo_id = ? LIMIT 1"""
        )
        try {
          ps.setLong(1, creado.vueloId)
          val rs = ps.executeQuery()
          rs.next() shouldBe true
          rs.getLong(1) shouldBe rs.getLong(3)
          rs.getLong(2) shouldBe rs.getLong(4)
          rs.getString(5) shouldBe rs.getString(6)
        } finally ps.close()
      }
    }

    "dejar el vuelo ACTIVO y con el admin como creador" in {
      val creado = VueloService.crear(alta("TS904", aep, brc), adminId)

      conConexion { conn =>
        val ps =
          conn.prepareStatement("SELECT estado, creado_por_id FROM vuelo WHERE id = ?")
        try {
          ps.setLong(1, creado.vueloId)
          val rs = ps.executeQuery()
          rs.next() shouldBe true
          rs.getString("estado") shouldBe "ACTIVO"
          rs.getLong("creado_por_id") shouldBe adminId
        } finally ps.close()
      }
    }

    "rechazar un código duplicado con 409 y campo codigo" in {
      VueloService.crear(alta("TS905", aep, brc), adminId)

      val error = errorDe(VueloService.crear(alta("TS905", aep, cor), adminId))

      error.http shouldBe 409
      error.campo shouldBe Some("codigo")
    }

    "rechazar un código con formato inválido con 422" in {
      val error = errorDe(VueloService.crear(alta("basura", aep, brc), adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("codigo")
    }

    "rechazar origen igual a destino con 422" in {
      val error = errorDe(VueloService.crear(alta("TS906", aep, aep), adminId))

      error.http shouldBe 422
    }

    "rechazar un período invertido con 422" in {
      val req = alta("TS907", aep, brc).copy(
        fechaDesde = LocalDate.of(2026, 11, 8),
        fechaHasta = LocalDate.of(2026, 11, 2)
      )

      val error = errorDe(VueloService.crear(req, adminId))

      error.http shouldBe 422
    }

    "rechazar una clase con capacidad 0 con 422" in {
      val req = alta(
        "TS908",
        aep,
        brc,
        clases = List(ClaseVuelo("ECONOMY", 0, new BigDecimal("120000.00")))
      )

      val error = errorDe(VueloService.crear(req, adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("clases")
    }

    "rechazar un precio 0 con 422" in {
      val req = alta(
        "TS909",
        aep,
        brc,
        clases = List(ClaseVuelo("ECONOMY", 150, BigDecimal.ZERO))
      )

      val error = errorDe(VueloService.crear(req, adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("clases")
    }

    "rechazar un día de operación fuera de rango con 422" in {
      val error =
        errorDe(VueloService.crear(alta("TS910", aep, brc, dias = List(9)), adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("diasOperacion")
    }

    "rechazar un vuelo sin días de operación" in {
      val error =
        errorDe(VueloService.crear(alta("TS911", aep, brc, dias = Nil), adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("diasOperacion")
    }

    "rechazar un vuelo sin clases" in {
      val error =
        errorDe(VueloService.crear(alta("TS912", aep, brc, clases = Nil), adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("clases")
    }

    "rechazar un origen inexistente señalando el campo" in {
      val error = errorDe(VueloService.crear(alta("TS913", "ZZZ", brc), adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("aeropuertoOrigen")
    }

    "rechazar un destino inexistente señalando el campo" in {
      val error = errorDe(VueloService.crear(alta("TS914", aep, "QQQ"), adminId))

      error.http shouldBe 422
      error.campo shouldBe Some("aeropuertoDestino")
    }

    "no dejar nada escrito cuando falla a mitad de camino" in {
      val req = alta(
        "TS915",
        aep,
        brc,
        clases = List(
          ClaseVuelo("ECONOMY", 150, new BigDecimal("120000.00")),
          // Precio inválido: el vuelo y la primera clase ya quedaron insertados.
          ClaseVuelo("PRIMERA", 12, BigDecimal.ZERO)
        )
      )

      errorDe(VueloService.crear(req, adminId)).http shouldBe 422

      conConexion { conn =>
        val ps = conn.prepareStatement("SELECT COUNT(*) FROM vuelo WHERE codigo = ?")
        try {
          ps.setString(1, "TS915")
          leerEntero(ps.executeQuery()) shouldBe 0
        } finally ps.close()
      }
    }
  }
}
