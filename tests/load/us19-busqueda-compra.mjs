// US19 — Carga reproducible de búsqueda y compra con 200 usuarios concurrentes.
// Requiere una API local y una base descartable con dos aeropuertos activos.
// Variables: AERONET_API_URL, AERONET_TEST_DB_CONTAINER, AERONET_DEV_ADMIN_PASSWORD,
// AERONET_DEV_MOSTRADOR_PASSWORD y, opcionalmente, AERONET_LOAD_WORKERS (activos/desactivados).
// Uso: node tests/load/us19-busqueda-compra.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { addDays, api, apiUrl, argentinaToday, login, sql, sqlValue } from '../http/lib.mjs';

const concurrency = 200;
const capacity = concurrency + 20;
// La fase de mostrador ofrece menos asientos que solicitudes para forzar la competencia por la última plaza.
const contendedCapacity = concurrency - 50;
const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const unique = Date.now();
const adminEmail = process.env.AERONET_DEV_ADMIN_EMAIL || 'admin.dev@aeronet.test';
const employeeEmail = process.env.AERONET_DEV_MOSTRADOR_EMAIL || 'mostrador.dev@aeronet.test';
const adminToken = await login(adminEmail, process.env.AERONET_DEV_ADMIN_PASSWORD);
const employeeToken = await login(employeeEmail, process.env.AERONET_DEV_MOSTRADOR_PASSWORD);
const reportPath = resolve(process.env.AERONET_LOAD_REPORT || `tests/load/results/us19-${unique}.json`);
const samples = { searchMs: [], purchaseMs: [], reservationMs: [], paymentStartMs: [], counterSaleMs: [], counterConfirmedMs: [] };
const failures = [];

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2));
}

const maxMs = (values) => (values.length ? Math.max(...values).toFixed(2) : null);

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

function recordFailure(phase, status, detail = '') {
  failures.push({ phase, status, detail });
}

async function timed(task) {
  const started = performance.now();
  const response = await task();
  return { response, elapsed: performance.now() - started };
}

const airportIds = sql(container, 'SELECT id FROM aeropuerto WHERE activo=1 ORDER BY id LIMIT 2;').map((row) => Number(row[0]));
if (airportIds.length !== 2) throw new Error(`La base ${container} necesita dos aeropuertos activos`);
const [origin, destination] = airportIds;
const originCode = sqlValue(container, `SELECT codigo_iata FROM aeropuerto WHERE id=${origin};`);
const destinationCode = sqlValue(container, `SELECT codigo_iata FROM aeropuerto WHERE id=${destination};`);
const date = addDays(argentinaToday(), 2);

function freeFlightCode(offset) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `L9${String((unique + offset + attempt) % 10000).padStart(4, '0')}`;
    if (sqlValue(container, `SELECT COUNT(*) FROM vuelo WHERE codigo='${candidate}';`) === '0') return candidate;
  }
  throw new Error('No se encontró un código libre para el vuelo de carga');
}

async function createDeparture(code, seats) {
  const flight = await api('/admin/flights', { method: 'POST', token: adminToken, body: {
    code, originAirportId: origin, destinationAirportId: destination,
    departureTime: '10:00', arrivalTime: '12:00', arrivalDayOffset: 0,
    startDate: date, endDate: date, operatingDays: [1, 2, 3, 4, 5, 6, 7],
    classes: [{ className: 'ECONOMY', capacity: seats, price: 15000 }],
  } });
  if (flight.status !== 201) throw new Error(`No se pudo preparar vuelo con ${seats} plazas: HTTP ${flight.status} ${flight.body.error || ''}`);
  const departureId = Number(sqlValue(container, `SELECT id FROM salida WHERE vuelo_id=${Number(flight.body.flightId)} AND fecha='${date}';`));
  if (!departureId) throw new Error(`El vuelo de carga ${code} no generó la salida esperada`);
  return departureId;
}

function inventory(departureId) {
  const [sold, actualCapacity] = sql(container, `SELECT vendidos,capacidad FROM salida_clase
    WHERE salida_id=${departureId} AND clase='ECONOMY';`)[0].map(Number);
  const confirmed = Number(sqlValue(container, `SELECT COUNT(*) FROM compra WHERE salida_id=${departureId} AND estado='CONFIRMADA';`));
  const pending = Number(sqlValue(container, `SELECT COUNT(*) FROM compra WHERE salida_id=${departureId} AND estado='PENDIENTE_PAGO';`));
  const activeTickets = Number(sqlValue(container, `SELECT COUNT(*) FROM pasaje WHERE salida_id=${departureId}
    AND estado IN ('RESERVADO','EMITIDO');`));
  return { soldOrReserved: sold, capacity: actualCapacity, confirmedPurchases: confirmed, pendingPurchases: pending,
    activeTickets, noOversell: sold <= actualCapacity && activeTickets <= actualCapacity };
}

const webCode = freeFlightCode(0);
const webDepartureId = await createDeparture(webCode, capacity);
const counterCode = freeFlightCode(100);
const counterDepartureId = await createDeparture(counterCode, contendedCapacity);
const paymentConfig = await api('/payments/config', { token: adminToken });
const paymentsEnabled = paymentConfig.status === 200 && paymentConfig.body.enabled === true;

console.log(`Preparación: alta de ${concurrency} cuentas, vuelos ${webCode} (${capacity} plazas) y ${counterCode} (${contendedCapacity} plazas) el ${date}; API ${apiUrl}`);
const users = await mapLimit(Array.from({ length: concurrency }), 8, async (_, index) => {
  const account = {
    email: `us19-${unique}-${index}@aeronet.test`, password: `US19-load-${unique}-${index}-Pass`,
    firstName: 'Carga', lastName: `Usuario ${index + 1}`,
  };
  const response = await api('/auth/register', { method: 'POST', body: account });
  if (response.status !== 201 || !response.body.accessToken) {
    throw new Error(`Alta usuario ${index + 1}: HTTP ${response.status} ${response.body.error || ''}`);
  }
  return { ...account, token: response.body.accessToken };
});

console.log('Fase 1/3: 200 búsquedas simultáneas');
const searches = await Promise.all(users.map(async (user, index) => {
  try {
    const { response, elapsed } = await timed(() => api(`/passenger/search?origin=${encodeURIComponent(originCode)}`
      + `&destination=${encodeURIComponent(destinationCode)}&dateFrom=${date}&dateTo=${date}`, { token: user.token }));
    samples.searchMs.push(elapsed);
    if (response.status !== 200) recordFailure('search', response.status, response.body.error || '');
    const found = response.body.results?.some((row) => Number(row.departureId) === webDepartureId && row.class === 'ECONOMY');
    if (response.status === 200 && !found) recordFailure('search', 0, `Búsqueda ${index + 1} no encontró salida vendible`);
    return { ok: response.status === 200 && found };
  } catch (error) {
    recordFailure('search', 0, error.message);
    return { ok: false };
  }
}));

// Compra web del lado del sistema: reserva de plazas + inicio de la transacción de pago. El cobro con
// tarjeta ocurre en la pasarela externa y no se somete a carga (latencia ajena y límites del sandbox).
console.log(`Fase 2/3: 200 compras web simultáneas (reserva${paymentsEnabled ? ' + inicio de pago' : '; pasarela no configurada'})`);
const purchases = await Promise.all(users.map(async (user, index) => {
  try {
    const reservation = await timed(() => api('/passenger/reservations', { method: 'POST', token: user.token, body: {
      departureId: webDepartureId, emailContact: user.email,
      passengers: [{ firstName: user.firstName, lastName: user.lastName, documentType: 'DNI',
        documentNumber: `19${String(unique).slice(-8)}${String(index).padStart(6, '0')}`.slice(0, 20), class: 'ECONOMY' }],
    } }));
    samples.reservationMs.push(reservation.elapsed);
    const reserved = reservation.response.status === 201 && reservation.response.body.reservation?.status === 'PENDIENTE_PAGO';
    if (!reserved) {
      recordFailure('reservation', reservation.response.status, reservation.response.body.error || '');
      samples.purchaseMs.push(reservation.elapsed);
      return { ok: false };
    }
    if (!paymentsEnabled) {
      samples.purchaseMs.push(reservation.elapsed);
      return { ok: true };
    }
    const payment = await timed(() => api('/payments/transactions', { method: 'POST', token: user.token,
      body: { purchaseId: Number(reservation.response.body.reservation.reservationId) } }));
    samples.paymentStartMs.push(payment.elapsed);
    samples.purchaseMs.push(reservation.elapsed + payment.elapsed);
    if (payment.response.status !== 201) recordFailure('paymentStart', payment.response.status, payment.response.body.error || '');
    return { ok: payment.response.status === 201 };
  } catch (error) {
    recordFailure('purchase', 0, error.message);
    return { ok: false };
  }
}));

// Compra completa y confirmada (reserva + cobro + emisión) compitiendo por menos plazas que solicitudes.
// Los rechazos por falta de disponibilidad (HTTP 409) son el resultado esperado, no un error.
console.log(`Fase 3/3: 200 ventas confirmadas simultáneas por ${contendedCapacity} plazas`);
const counterSales = await Promise.all(users.map(async (user, index) => {
  try {
    const { response, elapsed } = await timed(() => api('/employee/sales', { method: 'POST', token: employeeToken, body: {
      departureId: counterDepartureId, emailContact: user.email, paymentMethod: 'EFECTIVO',
      passengers: [{ firstName: user.firstName, lastName: user.lastName, documentType: 'DNI',
        documentNumber: `29${String(unique).slice(-8)}${String(index).padStart(6, '0')}`.slice(0, 20), class: 'ECONOMY' }],
    } }));
    samples.counterSaleMs.push(elapsed);
    if (response.status === 201) samples.counterConfirmedMs.push(elapsed);
    else if (response.status !== 409) recordFailure('counterSale', response.status, response.body.error || '');
    return { status: response.status };
  } catch (error) {
    recordFailure('counterSale', 0, error.message);
    return { status: 0 };
  }
}));

const webInventory = inventory(webDepartureId);
const counterInventory = inventory(counterDepartureId);
const confirmedSales = counterSales.filter((item) => item.status === 201).length;
const rejectedSales = counterSales.filter((item) => item.status === 409).length;
const searchP95 = p95(samples.searchMs);
const purchaseP95 = p95(samples.purchaseMs);
const counterConfirmedP95 = p95(samples.counterConfirmedMs);
const contentionResolved = confirmedSales === contendedCapacity && rejectedSales === concurrency - contendedCapacity
  && counterInventory.confirmedPurchases === contendedCapacity && counterInventory.soldOrReserved === contendedCapacity;
const summary = {
  story: 'US19', generatedAt: new Date().toISOString(), apiUrl, concurrency, date,
  backgroundWorkers: process.env.AERONET_LOAD_WORKERS || 'no informado',
  searches: { departureId: webDepartureId, total: samples.searchMs.length, successful: searches.filter((item) => item.ok).length,
    p95Ms: searchP95, maxMs: maxMs(samples.searchMs) },
  webPurchases: { flightCode: webCode, departureId: webDepartureId, total: purchases.length,
    successful: purchases.filter((item) => item.ok).length,
    includesPaymentStart: paymentsEnabled,
    p95Ms: purchaseP95, maxMs: maxMs(samples.purchaseMs),
    reservationP95Ms: p95(samples.reservationMs), paymentStartP95Ms: p95(samples.paymentStartMs),
    inventory: webInventory },
  counterSales: { flightCode: counterCode, departureId: counterDepartureId, total: counterSales.length,
    confirmed: confirmedSales, rejectedNoAvailability: rejectedSales,
    confirmedP95Ms: counterConfirmedP95, allP95Ms: p95(samples.counterSaleMs), maxMs: maxMs(samples.counterSaleMs),
    inventory: counterInventory },
  serverErrors: failures.filter((item) => item.status >= 500).length,
  failedRequests: failures.length,
  failures: failures.slice(0, 50),
  acceptance: {
    p95UnderThreeSeconds: [searchP95, purchaseP95, counterConfirmedP95].every((value) => value !== null && value < 3000),
    allRequestsSuccessful: failures.length === 0 && searches.every((item) => item.ok) && purchases.every((item) => item.ok),
    noOversell: webInventory.noOversell && counterInventory.noOversell,
    contentionResolved,
  },
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log(`Informe guardado en ${reportPath}`);
if (Object.values(summary.acceptance).some((passed) => !passed)) process.exitCode = 1;
