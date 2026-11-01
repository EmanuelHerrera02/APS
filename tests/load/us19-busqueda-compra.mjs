// US19 — Carga reproducible de búsqueda y creación de compra con 200 usuarios concurrentes.
// Requiere una API local y una base descartable con dos aeropuertos activos.
// Variables: AERONET_API_URL, AERONET_TEST_DB_CONTAINER, AERONET_DEV_ADMIN_PASSWORD.
// Uso: node tests/load/us19-busqueda-compra.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { addDays, api, apiUrl, argentinaToday, login, sql, sqlValue } from '../http/lib.mjs';

const concurrency = 200;
const capacity = concurrency + 20;
const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const unique = Date.now();
const adminEmail = process.env.AERONET_DEV_ADMIN_EMAIL || 'admin.dev@aeronet.test';
const adminToken = await login(adminEmail, process.env.AERONET_DEV_ADMIN_PASSWORD);
const reportPath = resolve(process.env.AERONET_LOAD_REPORT || `tests/load/results/us19-${unique}.json`);
const samples = { searchMs: [], purchaseMs: [] };
const failures = [];

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2));
}

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

function timedSample(target, latency, status, detail = '') {
  target.push(latency);
  if (status < 200 || status >= 300) failures.push({ status, detail });
}

const airportIds = sql(container, 'SELECT id FROM aeropuerto WHERE activo=1 ORDER BY id LIMIT 2;').map((row) => Number(row[0]));
if (airportIds.length !== 2) throw new Error(`La base ${container} necesita dos aeropuertos activos`);
const [origin, destination] = airportIds;
const originCode = sqlValue(container, `SELECT codigo_iata FROM aeropuerto WHERE id=${origin};`);
const destinationCode = sqlValue(container, `SELECT codigo_iata FROM aeropuerto WHERE id=${destination};`);
let code;
for (let attempt = 0; attempt < 50; attempt += 1) {
  code = `L9${String((unique + attempt) % 10000).padStart(4, '0')}`;
  if (sqlValue(container, `SELECT COUNT(*) FROM vuelo WHERE codigo='${code}';`) === '0') break;
  code = undefined;
}
if (!code) throw new Error('No se encontró un código libre para el vuelo de carga');

const date = addDays(argentinaToday(), 2);
const flight = await api('/admin/flights', { method: 'POST', token: adminToken, body: {
  code, originAirportId: origin, destinationAirportId: destination,
  departureTime: '10:00', arrivalTime: '12:00', arrivalDayOffset: 0,
  startDate: date, endDate: date, operatingDays: [1, 2, 3, 4, 5, 6, 7],
  classes: [{ className: 'ECONOMY', capacity, price: 15000 }],
} });
if (flight.status !== 201) throw new Error(`No se pudo preparar vuelo con ${capacity} plazas: HTTP ${flight.status} ${flight.body.error || ''}`);
const departureId = Number(sqlValue(container, `SELECT id FROM salida WHERE vuelo_id=${Number(flight.body.flightId)} AND fecha='${date}';`));
if (!departureId) throw new Error('El vuelo de carga no generó la salida esperada');

console.log(`Preparación: alta de ${concurrency} cuentas y vuelo ${code} el ${date}; API ${apiUrl}`);
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

console.log('Fase 1/2: 200 búsquedas simultáneas');
const searches = await Promise.all(users.map(async (user, index) => {
  const started = performance.now();
  try {
    const response = await api(`/passenger/search?origin=${encodeURIComponent(originCode)}&destination=${encodeURIComponent(destinationCode)}&dateFrom=${date}&dateTo=${date}`, { token: user.token });
    const elapsed = performance.now() - started;
    timedSample(samples.searchMs, elapsed, response.status, response.body.error || '');
    const found = response.body.results?.some((row) => Number(row.departureId) === departureId && row.class === 'ECONOMY');
    if (response.status === 200 && !found) failures.push({ status: 0, detail: `Búsqueda ${index + 1} no encontró salida vendible` });
    return { ok: response.status === 200 && found };
  } catch (error) {
    timedSample(samples.searchMs, performance.now() - started, 0, error.message);
    return { ok: false };
  }
}));

console.log('Fase 2/2: 200 reservas de compra simultáneas');
let documentIndex = 0;
const purchases = await Promise.all(users.map(async (user) => {
  const index = documentIndex++;
  const started = performance.now();
  try {
    const response = await api('/passenger/reservations', { method: 'POST', token: user.token, body: {
      departureId, emailContact: user.email,
      passengers: [{ firstName: user.firstName, lastName: user.lastName, documentType: 'DNI',
        documentNumber: `19${String(unique).slice(-8)}${String(index).padStart(6, '0')}`.slice(0, 20), class: 'ECONOMY' }],
    } });
    const elapsed = performance.now() - started;
    timedSample(samples.purchaseMs, elapsed, response.status, response.body.error || '');
    return { ok: response.status === 201 && response.body.reservation?.status === 'PENDIENTE_PAGO' };
  } catch (error) {
    timedSample(samples.purchaseMs, performance.now() - started, 0, error.message);
    return { ok: false };
  }
}));

const [sold, actualCapacity] = sql(container, `SELECT vendidos,capacidad FROM salida_clase
  WHERE salida_id=${departureId} AND clase='ECONOMY';`)[0].map(Number);
const pendingPurchases = Number(sqlValue(container, `SELECT COUNT(*) FROM compra WHERE salida_id=${departureId}
  AND estado='PENDIENTE_PAGO';`));
const searchP95 = p95(samples.searchMs);
const purchaseP95 = p95(samples.purchaseMs);
const summary = {
  story: 'US19', generatedAt: new Date().toISOString(), apiUrl, concurrency,
  flightCode: code, departureId, date,
  searches: { total: samples.searchMs.length, successful: searches.filter((item) => item.ok).length,
    p95Ms: searchP95, maxMs: Math.max(...samples.searchMs).toFixed(2) },
  purchases: { total: samples.purchaseMs.length, successful: purchases.filter((item) => item.ok).length,
    p95Ms: purchaseP95, maxMs: Math.max(...samples.purchaseMs).toFixed(2) },
  inventory: { soldOrReserved: sold, capacity: actualCapacity, pendingPurchases,
    noOversell: sold <= actualCapacity },
  serverErrors: failures.filter((item) => item.status >= 500).length,
  failedRequests: failures.length,
  failures: failures.slice(0, 50),
  acceptance: { p95UnderThreeSeconds: searchP95 < 3000 && purchaseP95 < 3000,
    allRequestsSuccessful: failures.length === 0 && searches.every((item) => item.ok) && purchases.every((item) => item.ok),
    noOversell: sold <= actualCapacity },
};
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log(`Informe guardado en ${reportPath}`);
if (!summary.acceptance.p95UnderThreeSeconds || !summary.acceptance.allRequestsSuccessful || !summary.acceptance.noOversell) {
  process.exitCode = 1;
}
