// US6 — Edición y cancelación sobre la API y una base aislada.
// Uso: node tests/http/us6-modificacion-cancelacion.mjs
import { addDays, api, argentinaToday, createReport, isoWeekday, login, sql, sqlValue } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US6 — Modificación y cancelación de vuelos');
const adminEmail = process.env.AERONET_DEV_ADMIN_EMAIL || 'admin.dev@aeronet.test';
const adminToken = await login(adminEmail, process.env.AERONET_DEV_ADMIN_PASSWORD);
const adminId = sqlValue(container, `SELECT id FROM usuario WHERE email='${adminEmail.replaceAll("'", "''")}';`);
const [origin, destination] = sql(container, "SELECT id FROM aeropuerto WHERE activo=1 ORDER BY id LIMIT 2;").map((row) => Number(row[0]));
if (!origin || !destination) throw new Error('La base requiere dos aeropuertos activos');

const code = `U6${String(Date.now()).slice(-4)}`;
const start = addDays(argentinaToday(), 2);
const end = addDays(start, 27);
const operatingDays = [1, 2, 3, 4, 5, 6, 7];
const baseFlight = {
  code, originAirportId: origin, destinationAirportId: destination,
  departureTime: '10:00', arrivalTime: '12:00', arrivalDayOffset: 0,
  startDate: start, endDate: end, operatingDays,
  classes: [{ className: 'ECONOMY', capacity: 20, price: 10000 }, { className: 'PRIMERA', capacity: 5, price: 25000 }],
};
const created = await api('/admin/flights', { method: 'POST', token: adminToken, body: baseFlight });
if (created.status !== 201) throw new Error(`No se pudo crear el vuelo de prueba: HTTP ${created.status} ${created.body.error || ''}`);
const flightId = Number(created.body.flightId);
const dates = sql(container, `SELECT id,fecha FROM salida WHERE vuelo_id=${flightId} ORDER BY fecha;`);
if (dates.length < 3) throw new Error('El fixture debe crear al menos tres salidas');
const [confirmedDepartureId, pendingDepartureId, cancelledDepartureId] = dates.map((row) => Number(row[0]));
const passengerEmail = `us6-${Date.now()}@aeronet.test`;
const registration = await api('/auth/register', { method: 'POST', body: {
  email: passengerEmail, password: `US6-test-${Date.now()}-Password`, firstName: 'Pasajero', lastName: 'US6',
} });
if (registration.status !== 201 || !registration.body.accessToken) throw new Error(`No se pudo registrar pasajero: HTTP ${registration.status}`);

async function reserve(departureId, suffix, count = 1) {
  return api('/passenger/reservations', { method: 'POST', token: registration.body.accessToken, body: {
    departureId, emailContact: passengerEmail,
    passengers: Array.from({ length: count }, (_, index) => ({ firstName: 'Pasajero', lastName: 'US6', documentType: 'DNI',
      documentNumber: `U6${Date.now()}${suffix}${index}`.slice(0, 20), class: 'ECONOMY' })),
  } });
}

const confirmed = await reserve(confirmedDepartureId, 'A', 2);
if (confirmed.status !== 201) throw new Error(`No se pudo preparar pasaje vendido: HTTP ${confirmed.status} ${confirmed.body.error || ''}`);
const confirmedPurchaseId = Number(confirmed.body.reservation.reservationId);
const paymentSql = `SET @pago=NULL; SET @resultado=NULL; CALL registrar_pago(${confirmedPurchaseId},20000.00,'EFECTIVO','APROBADO',NULL,NULL,NULL,@pago,@resultado); SELECT @resultado;`;
const payment = sql(container, paymentSql).at(-1)?.[0];
if (payment !== 'CONFIRMADA') throw new Error(`No se pudo confirmar la compra de prueba: ${payment}`);
const pending = await reserve(pendingDepartureId, 'B');
if (pending.status !== 201) throw new Error(`No se pudo preparar compra pendiente: HTTP ${pending.status} ${pending.body.error || ''}`);
const pendingPurchaseId = Number(pending.body.reservation.reservationId);

const updatePayload = { ...baseFlight, departureTime: '11:00', arrivalTime: '13:00',
  operatingDays: [1, 2, 3, 4, 5, 6, 7],
  classes: [{ className: 'ECONOMY', capacity: 19, price: 12000 }, { className: 'PRIMERA', capacity: 5, price: 25000 }],
};
let response = await api(`/admin/flights/${flightId}`, { method: 'PUT', token: adminToken, body: {
  ...updatePayload, classes: [{ className: 'ECONOMY', capacity: 1, price: 12000 }, updatePayload.classes[1]],
} });
report.check('US6-01', 'Rechaza capacidad por debajo de pasajes vendidos', response.status === 409
  && /capacidad|vendidos/i.test(response.body.error || ''),
  `HTTP ${response.status}`);

response = await api(`/admin/flights/${flightId}`, { method: 'PUT', token: adminToken, body: updatePayload });
report.check('US6-02', 'Modifica horario, capacidad y precio aplicando validaciones', response.status === 200,
  `HTTP ${response.status} ${response.body.error || ''}`);
const [priceSnapshot] = sql(container, `SELECT c.total, sc.capacidad, vc.precio, s.hora_partida
  FROM compra c JOIN salida s ON s.id=c.salida_id JOIN salida_clase sc ON sc.salida_id=s.id AND sc.clase='ECONOMY'
  JOIN vuelo_clase vc ON vc.vuelo_id=s.vuelo_id AND vc.clase='ECONOMY'
  WHERE c.id=${confirmedPurchaseId};`)[0] || [];
report.check('US6-03', 'El cambio de precio no altera compras previas y actualiza salidas',
  Number(priceSnapshot) === 20000 && sqlValue(container, `SELECT capacidad FROM salida_clase WHERE salida_id=${confirmedDepartureId} AND clase='ECONOMY';`) === '19'
    && sqlValue(container, `SELECT TIME_FORMAT(hora_partida,'%H:%i') FROM salida WHERE id=${confirmedDepartureId};`) === '11:00',
  `importe previo=${priceSnapshot}`);

const confirmedDate = dates.find((row) => Number(row[0]) === confirmedDepartureId)?.[1];
const shortenedPeriod = await api(`/admin/flights/${flightId}`, { method: 'PUT', token: adminToken, body: {
  ...updatePayload, startDate: addDays(confirmedDate, 1),
} });
const removedWeekday = await api(`/admin/flights/${flightId}`, { method: 'PUT', token: adminToken, body: {
  ...updatePayload, operatingDays: operatingDays.filter((day) => day !== isoWeekday(confirmedDate)),
} });
report.check('US6-08', 'Rechaza cambios de período o días que dejan fuera pasajes vendidos',
  shortenedPeriod.status === 409 && removedWeekday.status === 409
    && /pasajes vendidos/i.test(shortenedPeriod.body.error || '')
    && sqlValue(container, `SELECT estado FROM salida WHERE id=${confirmedDepartureId};`) === 'PROGRAMADA'
    && sqlValue(container, `SELECT estado FROM compra WHERE id=${confirmedPurchaseId};`) === 'CONFIRMADA',
  `período HTTP ${shortenedPeriod.status}, días HTTP ${removedWeekday.status}`);

response = await api(`/admin/flights/${flightId}/departures/${pendingDepartureId}/cancel`, {
  method: 'POST', token: adminToken, body: { reason: 'Ajuste operativo US6' },
});
report.check('US6-04', 'Cancela una salida y la compra pendiente asociada', response.status === 200
  && sqlValue(container, `SELECT estado FROM compra WHERE id=${pendingPurchaseId};`) === 'CANCELADA'
  && sqlValue(container, `SELECT motivo_cancelacion FROM salida WHERE id=${pendingDepartureId};`) === 'Ajuste operativo US6',
  `HTTP ${response.status}`);
const searchDate = dates.find((row) => Number(row[0]) === pendingDepartureId)?.[1];
const search = await api(`/passenger/search?origin=${encodeURIComponent(sqlValue(container, `SELECT codigo_iata FROM aeropuerto WHERE id=${origin};`))}`
  + `&destination=${encodeURIComponent(sqlValue(container, `SELECT codigo_iata FROM aeropuerto WHERE id=${destination};`))}`
  + `&dateFrom=${searchDate}&dateTo=${searchDate}`);
report.check('US6-05', 'La salida cancelada desaparece de la búsqueda', search.status === 200
  && !search.body.results?.some((row) => Number(row.departureId) === pendingDepartureId), `HTTP ${search.status}`);

const fullCancel = await api(`/admin/flights/${flightId}/cancel`, {
  method: 'POST', token: adminToken, body: { reason: 'Cancelación total US6' },
});
report.check('US6-06', 'Cancela el vuelo completo con motivo', fullCancel.status === 200
  && sqlValue(container, `SELECT estado FROM vuelo WHERE id=${flightId};`) === 'CANCELADO'
  && sqlValue(container, `SELECT COUNT(*) FROM salida WHERE vuelo_id=${flightId} AND estado='PROGRAMADA';`) === '0',
  `HTTP ${fullCancel.status}`);
const audited = sqlValue(container, `SELECT COUNT(*) FROM auditoria WHERE actor_usuario_id=${adminId}
  AND ((accion='flight.updated' AND entidad='vuelo' AND entidad_id=${flightId})
    OR (accion='flight.departure.cancelled' AND entidad='salida' AND entidad_id=${pendingDepartureId})
    OR (accion='flight.cancelled' AND entidad='vuelo' AND entidad_id=${flightId}));`);
report.check('US6-07', 'Edición y cancelaciones quedan auditadas por el administrador', audited === '3', `${audited} registros`);

// Evita dejar compras confirmadas en vuelos cancelados: el fixture es efímero y la base se descarta al terminar.
report.finish();
