package com.transport.system.models

import java.math.BigDecimal
import java.time.{LocalDate, LocalTime}

/**
 * Modelos del alta de vuelos.
 *
 * Los aeropuertos se porcentajes por código IATA y no por id: es lo que conoce
 * el formulario, y evita que el cliente pueda inventar ids. La resolución a id
 * la hace [[com.transport.system.services.AeropuertoService]].
 */

/** Capacidad y precio de una clase en un vuelo. */
final case class ClaseVuelo(
    clase: String,
    capacidad: Int,
    precio: BigDecimal
)

/**
 * Datos del alta que llegan del formulario.
 *
 * No lleva `estado`: un vuelo se crea siempre activo. Tampoco lleva los
 * aeropuertos por id, por lo ya comentado arriba.
 */
final case class AltaVueloRequest(
    codigo: String,
    aeropuertoOrigen: String,
    aeropuertoDestino: String,
    horaPartida: LocalTime,
    horaLlegada: LocalTime,
    diasDesfaseLlegada: Int,
    fechaDesde: LocalDate,
    fechaHasta: LocalDate,
    diasOperacion: List[Int],
    clases: List[ClaseVuelo]
)

/** Lo que devuelve la base tras crear el vuelo y materializar sus salidas. */
final case class VueloCreado(
    vueloId: Long,
    codigo: String,
    salidasGeneradas: Int,
    salidaClasesGeneradas: Int
)

/** Datos de un vuelo ya creado, para mostrarlo en el detalle. */
final case class Vuelo(
    id: Long,
    codigo: String,
    origen: String,
    destino: String,
    horaPartida: LocalTime,
    horaLlegada: LocalTime,
    diasDesfaseLlegada: Int,
    fechaDesde: LocalDate,
    fechaHasta: LocalDate,
    estado: String,
    diasOperacion: List[Int],
    clases: List[ClaseVuelo]
)

/** Aeropuerto para el selector del formulario. */
final case class Aeropuerto(
    id: Long,
    codigoIata: String,
    nombre: String,
    ciudad: String,
    provincia: String,
    activo: Boolean
)
