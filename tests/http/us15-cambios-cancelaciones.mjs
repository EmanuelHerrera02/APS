// US15 — Avisos por cambio de horario y cancelación, con reintento SMTP.
// Requiere API AeroNet y una base aislada; el backend debe usar SMTP falso en 127.0.0.1:2526.
// Uso: node tests/http/us15-cambios-cancelaciones.mjs
import net from 'node:net';
import { addDays, api, argentinaToday, createReport, isoWeekday, login, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US15 — Cambios y cancelaciones');
const adminEmail = process.env.AERONET_DEV_ADMIN_EMAIL || 'admin.dev@aeronet.test';
const adminToken = await login(adminEmail, process.env.AERONET_DEV_ADMIN_PASSWORD);
const messages = [];
const failOnce = new Set();
const smtp = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 aeronet-us15 ESMTP\r\n');
  let buffer = '';
  let dataMode = false;
  let message = '';
  let recipient = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 2);
      if (dataMode) {
        if (line === '.') {
          dataMode = false;
          messages.push({ recipient, body: message });
          message = '';
          socket.write('250 2.0.0 queued\r\n');
        } else message += `${line}\r\n`;
      } else if (/^EHLO\b|^HELO\b/i.test(line)) socket.write('250-aeronet-us15\r\n250 SIZE 10000000\r\n');
      else if (/^MAIL FROM:/i.test(line)) socket.write('250 2.1.0 sender ok\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        recipient = line.match(/<([^>]+)>/)?.[1]?.toLowerCase() || '';
        if (failOnce.delete(recipient)) socket.write('450 4.2.0 temporary failure\r\n');
        else socket.write('250 2.1.5 recipient ok\r\n');
      } else if (/^DATA$/i.test(line)) { dataMode = true; socket.write('354 end with <CRLF>.<CRLF>\r\n'); }
      else if (/^RSET$/i.test(line)) socket.write('250 reset\r\n');
      else if (/^QUIT$/i.test(line)) { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});

const unique = Date.now();
const email = `us15-${unique}@aeronet.test`;
const password = `US15-test-${unique}-Password`;

async function waitFor(check, timeoutMs = 115000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function rowsFor(purchaseId) {
  return sql(container, `SELECT id, tipo, estado, intentos, TIMESTAMPDIFF(SECOND,created_at,enviada_en)
    FROM notificacion WHERE compra_id=${Number(purchaseId)} AND canal='EMAIL'
      AND tipo IN ('CAMBIO_HORARIO','CANCELACION') ORDER BY id;`);
}

function decodeQuotedPrintable(value) {
  const source = value.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let index = 0; index < source.length; index += 1) {
    const encoded = source.slice(index + 1, index + 3);
    if (source[index] === '=' && /^[0-9a-f]{2}$/i.test(encoded)) {
      bytes.push(Number.parseInt(encoded, 16));
      index += 2;
    } else bytes.push(...new TextEncoder().encode(source[index]));
  }
  return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
}

try {
  await new Promise((resolve, reject) => { smtp.once('error', reject); smtp.listen(2526, '127.0.0.1', resolve); });
  const registered = await api('/auth/register', { method: 'POST', body: {
    email, password, firstName: 'Prueba', lastName: 'US15', phone: '+54 11 5555-1515',
  } });
  if (registered.status !== 201 || !registered.body.accessToken) throw new Error(`Registro pasajero: HTTP ${registered.status}`);
  const airportIds = sql(container, 'SELECT id FROM aeropuerto WHERE activo=1 ORDER BY id LIMIT 2;').map((row) => Number(row[0]));
  if (airportIds.length !== 2) throw new Error('La base aislada requiere dos aeropuertos activos');
  const startDate = addDays(argentinaToday(), 2);
  let code;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `N5${String((unique + attempt) % 10000).padStart(4, '0')}`;
    if (sql(container, `SELECT COUNT(*) FROM vuelo WHERE codigo='${candidate}';`)[0]?.[0] === '0') {
      code = candidate;
      break;
    }
  }
  if (!code) throw new Error('No se encontró un código libre para el vuelo de US15');
  const flightResponse = await api('/admin/flights', { method: 'POST', token: adminToken, body: {
    code, originAirportId: airportIds[0], destinationAirportId: airportIds[1], departureTime: '10:00',
    arrivalTime: '12:00', arrivalDayOffset: 0, startDate, endDate: startDate,
    operatingDays: [isoWeekday(startDate)], classes: [{ className: 'ECONOMY', capacity: 10, price: 140000 }],
  } });
  if (flightResponse.status !== 201) throw new Error(`Alta de vuelo para avisos: HTTP ${flightResponse.status} ${flightResponse.body.error || ''}`);
  const flightId = Number(flightResponse.body.flightId);
  const [departureId] = sql(container, `SELECT id FROM salida WHERE vuelo_id=${flightId} AND fecha='${startDate}';`)[0] || [];
  const fareClass = 'ECONOMY';
  if (!departureId) throw new Error('El vuelo de prueba no generó su salida');
  const reservation = await api('/passenger/reservations', { method: 'POST', token: registered.body.accessToken,
    body: { departureId: Number(departureId), emailContact: email, passengers: [{
      firstName: 'Pasajero', lastName: 'US15', documentType: 'DNI', documentNumber: `U15${unique}`, class: fareClass,
    }] },
  });
  if (reservation.status !== 201) throw new Error(`Reserva: HTTP ${reservation.status} ${reservation.body.error || ''}`);
  const purchaseId = Number(reservation.body.reservation.reservationId);
  const total = sql(container, `SELECT total FROM compra WHERE id=${purchaseId};`)[0]?.[0];
  sql(container, `CALL registrar_pago(${purchaseId}, ${total}, 'EFECTIVO', 'APROBADO', NULL, NULL, NULL, @us15_pago, @us15_resultado); SELECT @us15_resultado;`);
  const initial = await waitFor(() => sql(container, `SELECT estado FROM compra WHERE id=${purchaseId};`)[0]?.[0] === 'CONFIRMADA');
  if (!initial) throw new Error('La compra no quedó confirmada');

  // Una modificación comercial sin impacto en el viaje no debe producir avisos.
  const beforePrice = Number(sql(container, `SELECT COUNT(*) FROM notificacion WHERE compra_id=${purchaseId}
    AND tipo IN ('CAMBIO_HORARIO','CANCELACION');`)[0]?.[0]);
  const [flightCode, originId, destinationId, oldDeparture, oldArrival, arrivalDayOffset, flightStart, flightEnd] =
    sql(container, `SELECT codigo,aeropuerto_origen_id,aeropuerto_destino_id,
      TIME_FORMAT(hora_partida,'%H:%i'),TIME_FORMAT(hora_llegada,'%H:%i'),dias_desfase_llegada,fecha_desde,fecha_hasta
      FROM vuelo WHERE id=${flightId};`)[0];
  const operatingDays = sql(container, `SELECT dia_semana FROM vuelo_dia_operacion WHERE vuelo_id=${flightId};`).flat().map(Number);
  const currentClasses = sql(container, `SELECT clase,capacidad,precio FROM vuelo_clase WHERE vuelo_id=${flightId};`)
    .map(([className, capacity, price]) => ({ className, capacity: Number(capacity), price: Number(price) + 1 }));
  const priceUpdate = await api(`/admin/flights/${flightId}`, { method: 'PUT', token: adminToken, body: {
    code: flightCode, originAirportId: Number(originId), destinationAirportId: Number(destinationId),
    departureTime: oldDeparture, arrivalTime: oldArrival, arrivalDayOffset: Number(arrivalDayOffset),
    startDate: flightStart, endDate: flightEnd, operatingDays, classes: currentClasses,
  } });
  if (priceUpdate.status !== 200) throw new Error(`Cambio de precio: HTTP ${priceUpdate.status} ${priceUpdate.body.error || ''}`);
  const afterPrice = Number(sql(container, `SELECT COUNT(*) FROM notificacion WHERE compra_id=${purchaseId}
    AND tipo IN ('CAMBIO_HORARIO','CANCELACION');`)[0]?.[0]);
  report.check('US15-01', 'Cambiar el precio no genera avisos', beforePrice === afterPrice, `avisos ${beforePrice} → ${afterPrice}`);

  failOnce.add(email.toLowerCase());
  const scheduleUpdate = await api(`/admin/flights/${flightId}`, { method: 'PUT', token: adminToken, body: {
    code: flightCode, originAirportId: Number(originId), destinationAirportId: Number(destinationId),
    departureTime: '10:01', arrivalTime: '12:01', arrivalDayOffset: Number(arrivalDayOffset),
    startDate: flightStart, endDate: flightEnd, operatingDays, classes: currentClasses,
  } });
  if (scheduleUpdate.status !== 200) throw new Error(`Cambio de horario: HTTP ${scheduleUpdate.status} ${scheduleUpdate.body.error || ''}`);
  const scheduleNotice = await waitFor(() => rowsFor(purchaseId).find((row) => row[1] === 'CAMBIO_HORARIO' && row[2] === 'ENVIADA'));
  const deliveredChange = messages.find((message) => message.recipient === email.toLowerCase()
    && /Horario anterior:/i.test(message.body) && /Nuevo horario:/i.test(message.body));
  report.check('US15-02', 'Cambio de horario llega con horario anterior y nuevo tras reintento',
    Boolean(scheduleNotice && Number(scheduleNotice[3]) >= 2 && Number(scheduleNotice[4]) >= 0
      && Number(scheduleNotice[4]) < 120 && deliveredChange),
    scheduleNotice ? `estado=${scheduleNotice[2]}, intentos=${scheduleNotice[3]}, latencia=${scheduleNotice[4]}s` : 'sin entrega en 115s');
  report.check('US15-03', 'El aviso del cambio aparece en la compra del pasajero',
    (await api('/passenger/reservations', { token: registered.body.accessToken })).body.reservations
      ?.find((item) => Number(item.id) === purchaseId)?.notices?.some((notice) => notice.type === 'CAMBIO_HORARIO'),
    'consulta de compras del pasajero');

  const cancelFlight = await api(`/admin/flights/${flightId}/cancel`, { method: 'POST', token: adminToken,
    body: { reason: 'Prueba US15: operación suspendida' },
  });
  if (cancelFlight.status !== 200) throw new Error(`Cancelación completa: HTTP ${cancelFlight.status} ${cancelFlight.body.error || ''}`);
  const cancelNotice = await waitFor(() => rowsFor(purchaseId).find((row) => row[1] === 'CANCELACION' && row[2] === 'ENVIADA'));
  const cancellation = messages.find((message) => message.recipient === email.toLowerCase()
    && /Motivo: Prueba US15: operación suspendida/i.test(decodeQuotedPrintable(message.body)));
  report.check('US15-04', 'Cancelación llega con el motivo indicado', Boolean(cancelNotice && cancellation),
    cancelNotice ? `estado=${cancelNotice[2]}, intentos=${cancelNotice[3]}` : 'sin entrega');
  report.check('US15-05', 'Aviso de cancelación aparece en la compra del pasajero',
    (await api('/passenger/reservations', { token: registered.body.accessToken })).body.reservations
      ?.find((item) => Number(item.id) === purchaseId)?.notices?.some((notice) => notice.type === 'CANCELACION'
        && notice.reason === 'Prueba US15: operación suspendida'), 'consulta de compras del pasajero');
  const departureStatus = sql(container, `SELECT estado FROM salida WHERE id=${Number(departureId)};`)[0]?.[0];
  report.check('US15-06', 'La cancelación del vuelo actualiza la salida afectada', departureStatus === 'CANCELADA', departureStatus);
  report.finish();
} finally {
  smtp.close();
}
