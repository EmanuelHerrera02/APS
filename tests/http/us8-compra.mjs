// US8 — Flujo integrado de compra en una base aislada. Requiere API en ejecución.
// Uso: node tests/http/us8-compra.mjs
import { api, createReport, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US8 — Compra de pasajes');
const email = `us8-${Date.now()}@aeronet.test`;
const password = `US8-test-${Date.now()}-Pass`;

const registration = await api('/auth/register', {
  method: 'POST',
  body: { email, password, firstName: 'Prueba', lastName: 'US8', phone: '+54 11 5555-0101' },
});
const token = registration.body.accessToken;
report.check('C01', 'Registro del pasajero de prueba en la base aislada',
  registration.status === 201 && Boolean(token), `HTTP ${registration.status}`);
if (!token) {
  report.finish();
  process.exit(1);
}

const candidates = sql(container, `SELECT salida_id, vuelo_id, clase, precio, asientos_disponibles, origen, destino, fecha
  FROM v_disponibilidad
  WHERE asientos_disponibles > 0 AND fecha >= CURDATE()
    AND TIMESTAMP(fecha, hora_partida) > NOW()
  ORDER BY fecha, hora_partida, clase;`);
if (candidates.length === 0) throw new Error(`No hay salidas futuras vendibles en ${container}`);
const [departureId, flightId, fareClass, price, available, origin, destination, date] = candidates[0];
const search = await api(`/passenger/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&dateFrom=${date}`);
report.check('C02', 'La búsqueda expone salidas disponibles', search.status === 200
  && search.body.results.some((row) => String(row.departureId) === departureId && row.class === fareClass),
`HTTP ${search.status}, ${search.body.results?.length ?? 0} opciones`);

const passenger = {
  firstName: 'Prueba', lastName: 'US8', documentType: 'DNI',
  documentNumber: `U${Date.now()}`, class: fareClass,
};
const payload = { departureId: Number(departureId), emailContact: email, passengers: [passenger] };
const unauthenticated = await api('/passenger/reservations', { method: 'POST', body: payload });
report.check('C03', 'La compra exige sesión', unauthenticated.status === 401, `HTTP ${unauthenticated.status}`);

const tooMany = await api('/passenger/reservations', {
  method: 'POST', token, body: { ...payload, passengers: Array.from({ length: 10 }, (_, i) => ({ ...passenger, documentNumber: `T${i}` })) },
});
report.check('C04', 'Rechaza más de nueve pasajes', tooMany.status === 400, `HTTP ${tooMany.status}`);

const badDocumentType = await api('/passenger/reservations', {
  method: 'POST', token, body: { ...payload, passengers: [{ ...passenger, documentType: 'INVALIDO' }] },
});
report.check('C05', 'Rechaza tipo de documento inválido', badDocumentType.status === 400, `HTTP ${badDocumentType.status}`);

const badClass = await api('/passenger/reservations', {
  method: 'POST', token, body: { ...payload, passengers: [{ ...passenger, class: 'BUSINESS' }] },
});
report.check('C06', 'Rechaza clase inválida', badClass.status === 400, `HTTP ${badClass.status}`);

const purchase = await api('/passenger/reservations', { method: 'POST', token, body: payload });
const reservation = purchase.body.reservation;
const expectedTotal = Number(price).toFixed(2);
report.check('C07', 'Crea una compra pendiente de pago y devuelve importe/código', purchase.status === 201
  && reservation?.status === 'PENDIENTE_PAGO' && reservation.code && Number(reservation.total).toFixed(2) === expectedTotal
  && reservation.expiresAt, `HTTP ${purchase.status}${reservation ? `, ${reservation.status}, ${reservation.total}` : ''}`);

if (reservation?.reservationId) {
  const persisted = sql(container, `SELECT c.estado, c.total, COUNT(p.id), sc.vendidos
    FROM compra c JOIN pasaje p ON p.compra_id = c.id
    JOIN salida_clase sc ON sc.salida_id = c.salida_id AND sc.clase = '${fareClass}'
    WHERE c.id = ${Number(reservation.reservationId)}
    GROUP BY c.id, sc.vendidos;`)[0] || [];
  report.check('C08', 'Compra, pasajero y asiento reservado persisten en MariaDB',
    persisted[0] === 'PENDIENTE_PAGO' && Number(persisted[1]).toFixed(2) === expectedTotal
      && Number(persisted[2]) === 1 && Number(persisted[3]) > 0
      && Number(sql(container, `SELECT asientos_disponibles FROM v_disponibilidad
        WHERE salida_id = ${Number(departureId)} AND clase = '${fareClass}';`)[0][0]) === Number(available) - 1,
    `estado=${persisted[0] ?? 'sin registro'}, pasajes=${persisted[2] ?? 0}, plazas previas=${available}`);
} else {
  report.check('C08', 'Compra, pasajero y asiento reservado persisten en MariaDB', false, 'no hay reservationId');
}

const [outsidePeriodDepartureId] = sql(container, `
  INSERT IGNORE INTO salida (vuelo_id, aeropuerto_origen_id, aeropuerto_destino_id, fecha, hora_partida, hora_llegada)
  SELECT id, aeropuerto_origen_id, aeropuerto_destino_id, fecha_hasta + INTERVAL 1 DAY, hora_partida, hora_llegada
  FROM vuelo WHERE id = ${Number(flightId)};
  SET @us8_outside_period_departure = (
    SELECT s.id FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
    WHERE v.id = ${Number(flightId)} AND s.fecha = v.fecha_hasta + INTERVAL 1 DAY
  );
  INSERT IGNORE INTO salida_clase (salida_id, clase, capacidad, vendidos)
  SELECT @us8_outside_period_departure, clase, capacidad, 0
  FROM vuelo_clase WHERE vuelo_id = ${Number(flightId)};
  SELECT @us8_outside_period_departure;
`)[0] || [];
const outOfPeriod = await api('/passenger/reservations', {
  method: 'POST', token, body: { ...payload, departureId: Number(outsidePeriodDepartureId) },
});
const purchasesForContact = Number(sql(container,
  `SELECT COUNT(*) FROM compra WHERE email_contacto = '${email}';`)[0][0]);
report.check('C09', 'La API rechaza la salida fuera del período de venta sin crear compra',
  outOfPeriod.status === 422 && purchasesForContact === 1,
  `HTTP ${outOfPeriod.status}, compras persistidas para el contacto=${purchasesForContact}`);

const [operatingWeekday] = sql(container, `SELECT WEEKDAY('${date}') + 1;`)[0];
const [removedWeekday] = sql(container, `
  DELETE FROM vuelo_dia_operacion WHERE vuelo_id = ${Number(flightId)} AND dia_semana = ${Number(operatingWeekday)};
  SELECT ROW_COUNT();
`)[0] || [];
if (Number(removedWeekday) !== 1) throw new Error('No se pudo preparar el caso de día no operativo');
let nonOperatingDay;
try {
  nonOperatingDay = await api('/passenger/reservations', { method: 'POST', token, body: payload });
} finally {
  sql(container, `INSERT IGNORE INTO vuelo_dia_operacion (vuelo_id, dia_semana)
    VALUES (${Number(flightId)}, ${Number(operatingWeekday)});`);
}
const purchasesAfterNonOperatingDay = Number(sql(container,
  `SELECT COUNT(*) FROM compra WHERE email_contacto = '${email}';`)[0][0]);
report.check('C10', 'La API rechaza días sin operación sin crear compra',
  nonOperatingDay.status === 422 && String(nonOperatingDay.body.error).includes('no opera ese día')
    && purchasesAfterNonOperatingDay === 1,
  `HTTP ${nonOperatingDay.status}, compras persistidas para el contacto=${purchasesAfterNonOperatingDay}`);

report.finish();
