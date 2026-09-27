package com.transport.system.services

import com.transport.system.db.{Database, ErroDeBase}
import com.transport.system.models.Aeropuerto

import java.sql.{Connection, ResultSet}

/**
 * Lecturas de aeropuerto para el alta de vuelo.
 *
 * Solo lectura: no hace falta transacción propia, alcanza con
 * [[Database.conLectura]].
 */
object AeropuertoService {

  private val seleccion = """
    SELECT id, codigo_iata, nombre, ciudad, provincia, activo
      FROM aeropuerto
     ORDER BY codigo_iata
  """

  /**
   * Todos los aeropuertos, para el selector del formulario.
   *
   * Se incluyen los inactivos: la base es la que decide si un aeropuerto se
   * puede usar, y el formulario solo los muestra deshabilitados.
   */
  def listar(): List[Aeropuerto] =
    Database.conLectura { conn =>
      val ps = conn.prepareStatement(seleccion)
      try {
        val rs = ps.executeQuery()
        val salida = List.newBuilder[Aeropuerto]
        while (rs.next()) salida += leer(rs)
        salida.result()
      } finally ps.close()
    }

  /**
   * Resuelve un código IATA a id.
   *
   * Se usa antes de insertar el vuelo para poder atribuir el error a
   * `aeropuertoOrigen` o `aeropuertoDestino` en vez de dejar que reviente la FK
   * con un id inexistente.
   */
  def idDeIata(conn: Connection, iata: String, campo: String): Long = {
    val ps = conn.prepareStatement("SELECT id FROM aeropuerto WHERE codigo_iata = ?")
    try {
      ps.setString(1, iata)
      val rs = ps.executeQuery()
      if (rs.next()) rs.getLong("id")
      else
        throw ErroDeBase(
          http = 422,
          mensaje = s"El aeropuerto $iata no existe",
          campo = Some(campo)
        )
    } finally ps.close()
  }

  private def leer(rs: ResultSet): Aeropuerto =
    Aeropuerto(
      id = rs.getLong("id"),
      codigoIata = rs.getString("codigo_iata"),
      nombre = rs.getString("nombre"),
      ciudad = rs.getString("ciudad"),
      provincia = rs.getString("provincia"),
      activo = rs.getBoolean("activo")
    )
}
