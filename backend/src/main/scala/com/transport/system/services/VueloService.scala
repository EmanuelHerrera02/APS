package com.transport.system.services

import com.transport.system.db.Database
import com.transport.system.models.{AltaVueloRequest, ClaseVuelo, Vuelo, VueloCreado}

import java.sql.{Connection, Statement}
import java.time.{LocalDate, LocalTime}

/**
 * Alta de vuelo.
 *
 * Son los 4 pasos de la receta 5.1 de docs/manual-base-de-datos.md, en una sola
 * transacción y sobre una sola conexión:
 *
 *   1. INSERT vuelo
 *   2. INSERT vuelo_dia_operacion (batch)
 *   3. INSERT vuelo_clase (batch)
 *   4. CALL generar_salidas(id)
 *
 * Los pasos 2 y 3 van en batch porque son de a varias filas y no dependen del
 * resultado del anterior.
 *
 * Que todo vaya por la misma conexión no es un detalle de estilo:
 * [[Database.conTransaccion]] desactiva el autocommit antes de la primera
 * sentencia, así que cuando se llama al procedimiento la transacción ya está
 * abierta. generar_salidas decide entre START TRANSACTION y SAVEPOINT según
 * `@@in_transaction` (db/02_logic.sql:409); si el backend no la hubiera abierto,
 * el procedimiento abriría la suya, el commit del backend no la alcanzaría y
 * revertir el alta no deshacería las salidas.
 *
 * No se validan reglas de negocio acá: la base es la autoridad y
 * [[com.transport.system.db.ErroDeBase]] traduce sus errores. Lo único que hace
 * el servicio es resolver los IATA a id para poder atribuir el error al campo
 * correcto del formulario.
 */
object VueloService {

  private val insercionVuelo = """
    INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id,
                       hora_partida, hora_llegada, dias_desfase_llegada,
                       fecha_desde, fecha_hasta, creado_por_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  """

  private val insercionDia = """
    INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana) VALUES (?, ?)
  """

  private val insercionClase = """
    INSERT INTO vuelo_clase (vuelo_id, clase, capacidad, precio) VALUES (?, ?, ?, ?)
  """

  /**
   * Crea el vuelo y materializa sus salidas.
   *
   * @param creadoPorId usuario admin que hace el alta; va a `vuelo.creado_por_id`
   * @throws com.transport.system.db.ErroDeBase si la base rechaza los datos
   */
  def crear(
      alta: AltaVueloRequest,
      creadoPorId: Long
  ): VueloCreado =
    Database.conTransaccion { conn =>
      val vueloId = insertarVuelo(conn, alta, creadoPorId)
      insertarDias(conn, vueloId, alta.diasOperacion)
      insertarClases(conn, vueloId, alta.clases)
      val (salidas, clases) = generarSalidas(conn, vueloId)
      VueloCreado(
        vueloId = vueloId,
        codigo = alta.codigo,
        salidasGeneradas = salidas,
        salidaClasesGeneradas = clases
      )
    }

  private def insertarVuelo(
      conn: Connection,
      alta: AltaVueloRequest,
      creadoPorId: Long
  ): Long = {
    val origen = AeropuertoService.idDeIata(
      conn,
      alta.aeropuertoOrigen,
      "aeropuertoOrigen"
    )
    val destino = AeropuertoService.idDeIata(
      conn,
      alta.aeropuertoDestino,
      "aeropuertoDestino"
    )

    val ps = conn.prepareStatement(
      insercionVuelo,
      Statement.RETURN_GENERATED_KEYS
    )
    try {
      ps.setString(1, alta.codigo)
      ps.setLong(2, origen)
      ps.setLong(3, destino)
      ps.setString(4, alta.horaPartida.toString)
      ps.setString(5, alta.horaLlegada.toString)
      ps.setInt(6, alta.diasDesfaseLlegada)
      ps.setObject(7, alta.fechaDesde)
      ps.setObject(8, alta.fechaHasta)
      ps.setLong(9, creadoPorId)
      ps.executeUpdate()

      val rs = ps.getGeneratedKeys
      if (!rs.next())
        throw new IllegalStateException(
          "La base no devolvio el id del vuelo recien insertado"
        )
      rs.getLong(1)
    } finally ps.close()
  }

  private def insertarDias(
      conn: Connection,
      vueloId: Long,
      dias: List[Int]
  ): Unit = {
    if (dias.isEmpty) return
    val ps = conn.prepareStatement(insercionDia)
    try {
      dias.distinct.foreach { dia =>
        ps.setLong(1, vueloId)
        ps.setInt(2, dia)
        ps.addBatch()
      }
      ps.executeBatch()
      ()
    } finally ps.close()
  }

  private def insertarClases(
      conn: Connection,
      vueloId: Long,
      clases: List[ClaseVuelo]
  ): Unit = {
    if (clases.isEmpty) return
    val ps = conn.prepareStatement(insercionClase)
    try {
      clases.foreach { c =>
        ps.setLong(1, vueloId)
        ps.setString(2, c.clase)
        ps.setInt(3, c.capacidad)
        ps.setBigDecimal(4, c.precio)
        ps.addBatch()
      }
      ps.executeBatch()
      ()
    } finally ps.close()
  }

  /**
   * Llama a generar_salidas y lee su result set.
   *
   * El procedimiento devuelve una fila con (vuelo_id, salidas_generadas,
   * salida_clases_generadas).
   */
  private def generarSalidas(conn: Connection, vueloId: Long): (Int, Int) = {
    val cs = conn.prepareCall("CALL generar_salidas(?)")
    try {
      cs.setLong(1, vueloId)
      cs.execute()
      val rs = cs.getResultSet
      if (rs == null || !rs.next())
        throw new IllegalStateException(
          "generar_salidas no devolvio el conteo de salidas"
        )
      val par =
        (rs.getInt("salidas_generadas"), rs.getInt("salida_clases_generadas"))
      rs.close()
      par
    } finally cs.close()
  }

  private val busqueda = """
    SELECT v.id, v.codigo,
           ao.codigo_iata AS origen, ad.codigo_iata AS destino,
           v.hora_partida, v.hora_llegada, v.dias_desfase_llegada,
           v.fecha_desde, v.fecha_hasta, v.estado
      FROM vuelo v
      JOIN aeropuerto ao ON ao.id = v.aeropuerto_origen_id
      JOIN aeropuerto ad ON ad.id = v.aeropuerto_destino_id
     WHERE v.id = ?
  """

  private val sqlDias = """
    SELECT dia_semana FROM vuelo_dia_operacion
     WHERE vuelo_id = ? ORDER BY dia_semana
  """

  private val sqlClases = """
    SELECT clase, capacidad, precio FROM vuelo_clase
     WHERE vuelo_id = ? ORDER BY clase
  """

  /**
   * Un vuelo con sus días y sus clases, o None si no existe.
   *
   * Son tres consultas sobre la misma conexión en vez de una con joins: los
   * días y las clases son colecciones y hay que armar listas igual, y así se
   * evita el producto cartesiano de las dos tablas.
   */
  def buscar(id: Long): Option[Vuelo] =
    Database.conLectura { conn =>
      val ps = conn.prepareStatement(busqueda)
      try {
        ps.setLong(1, id)
        val rs = ps.executeQuery()
        if (!rs.next()) None
        else
          Some(
            Vuelo(
              id = rs.getLong("id"),
              codigo = rs.getString("codigo"),
              origen = rs.getString("origen"),
              destino = rs.getString("destino"),
              horaPartida = LocalTime.parse(rs.getString("hora_partida")),
              horaLlegada = LocalTime.parse(rs.getString("hora_llegada")),
              diasDesfaseLlegada = rs.getInt("dias_desfase_llegada"),
              fechaDesde = rs.getObject("fecha_desde", classOf[LocalDate]),
              fechaHasta = rs.getObject("fecha_hasta", classOf[LocalDate]),
              estado = rs.getString("estado"),
              diasOperacion = enteros(conn, sqlDias, id),
              clases = clasesDe(conn, id)
            )
          )
      } finally ps.close()
    }

  private def enteros(conn: Connection, sql: String, vueloId: Long): List[Int] = {
    val ps = conn.prepareStatement(sql)
    try {
      ps.setLong(1, vueloId)
      val rs = ps.executeQuery()
      val salida = List.newBuilder[Int]
      while (rs.next()) salida += rs.getInt(1)
      salida.result()
    } finally ps.close()
  }

  private def clasesDe(conn: Connection, vueloId: Long): List[ClaseVuelo] = {
    val ps = conn.prepareStatement(sqlClases)
    try {
      ps.setLong(1, vueloId)
      val rs = ps.executeQuery()
      val salida = List.newBuilder[ClaseVuelo]
      while (rs.next())
        salida += ClaseVuelo(
          clase = rs.getString("clase"),
          capacidad = rs.getInt("capacidad"),
          precio = rs.getBigDecimal("precio")
        )
      salida.result()
    } finally ps.close()
  }
}
