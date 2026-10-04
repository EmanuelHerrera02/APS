// US5 — Pruebas HTTP del alta de vuelos contra la API real y la instancia aislada docker-compose.us5.yml.
// Ver docs/pruebas-alta-vuelos.md para la preparación. Uso: node tests/http/us5-alta-vuelos.mjs
import { addDays, api, argentinaToday, createReport, isoWeekday, login, sql, sqlValue } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us5-db';
const report = createReport('US5 — Alta de vuelos');

const snapshot = () => sql(container, `SELECT
  (SELECT COUNT(*) FROM vuelo), (SELECT COUNT(*) FROM vuelo_dia_operacion), (SELECT COUNT(*) FROM vuelo_clase),
  (SELECT COUNT(*) FROM salida), (SELECT COUNT(*) FROM salida_clase),
  (SELECT COUNT(*) FROM auditoria WHERE accion = 'flight.created');`)[0].join('/');

function unusedCode() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = `T5${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    if (sqlValue(container, `SELECT COUNT(*) FROM vuelo WHERE codigo = '${code}';`) === '0') return code;
  }
  throw new Error('No se encontró un código de vuelo libre');
}

const fixtureReady = sqlValue(container, `SELECT
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'aeronet' AND TRIGGER_NAME = 'trg_us5_test_fallo')
  + (SELECT COUNT(*) FROM aeropuerto WHERE codigo_iata = 'XIN' AND NOT activo);`);
if (fixtureReady !== '2') {
  throw new Error(`La instancia ${container} no tiene cargado db/us5_test_fixture.sql`);
}

const airport = (code) => Number(sqlValue(container, `SELECT id FROM aeropuerto WHERE codigo_iata = '${code}';`));
const origin = airport('NQN');
const destination = airport('SLA');
const inactive = airport('XIN');
const adminId = sqlValue(container, "SELECT id FROM usuario WHERE email = 'admin.dev@aeronet.test';");

const [adminToken, passengerToken, counterToken] = await Promise.all([
  login('admin.dev@aeronet.test', process.env.AERONET_DEV_ADMIN_PASSWORD),
  login('pasajero.dev@aeronet.test', process.env.AERONET_DEV_PASAJERO_PASSWORD),
  login('mostrador.dev@aeronet.test', process.env.AERONET_DEV_MOSTRADOR_PASSWORD),
]);

const today = argentinaToday();
const start = addDays(today, 1);
const end = addDays(start, 13);
const operatingDays = [1, 3, 5];
const validFlight = {
  code: unusedCode(), originAirportId: origin, destinationAirportId: destination,
  departureTime: '22:30', arrivalTime: '01:10', arrivalDayOffset: 1,
  startDate: start, endDate: end, operatingDays,
  classes: [{ className: 'ECONOMY', capacity: 120, price: 85000.5 }, { className: 'PRIMERA', capacity: 8, price: 210000 }],
};
const expectedDates = Array.from({ length: 14 }, (_, offset) => addDays(start, offset))
  .filter((date) => operatingDays.includes(isoWeekday(date)));

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------
const before = snapshot();
let response = await api('/admin/flights', { method: 'POST', body: validFlight });
report.check('A01', 'Sin sesión: POST /admin/flights', response.status === 401, `HTTP ${response.status}`);
response = await api('/admin/flights', { method: 'POST', token: passengerToken, body: validFlight });
report.check('A02', 'PASAJERO sin flight:create', response.status === 403, `HTTP ${response.status}`);
response = await api('/admin/flights', { method: 'POST', token: counterToken, body: validFlight });
report.check('A03', 'MOSTRADOR sin flight:create', response.status === 403, `HTTP ${response.status}`);
response = await api('/admin/airports', { token: passengerToken });
report.check('A04', 'PASAJERO no lista aeropuertos del alta', response.status === 403, `HTTP ${response.status}`);
response = await api('/admin/airports', { token: adminToken });
report.check('A05', 'ADMIN lista solo aeropuertos activos',
  response.status === 200 && response.body.airports.some((item) => item.id === origin)
    && !response.body.airports.some((item) => item.id === inactive), `HTTP ${response.status}`);
report.check('A06', 'Los accesos denegados no crean datos', snapshot() === before, before);

// ---------------------------------------------------------------------------
// Datos inválidos: HTTP 400 con un mensaje entendible y sin escribir nada
// ---------------------------------------------------------------------------
const invalidCases = [
  ['V01', 'Código con formato inválido', { code: 'A-12' }, 'El código debe tener dos letras o números seguidos de uno a cuatro dígitos'],
  ['V02', 'Sin aeropuerto de origen', { originAirportId: 0 }, 'Elegí los aeropuertos de origen y destino'],
  ['V03', 'Origen igual a destino', { destinationAirportId: origin }, 'El origen y el destino deben ser distintos'],
  ['V04', 'Aeropuerto inexistente', { destinationAirportId: 999999999 }, 'El aeropuerto indicado no existe o no está disponible'],
  ['V05', 'Aeropuerto deshabilitado', { destinationAirportId: inactive }, 'El aeropuerto indicado no existe o no está disponible'],
  ['V06', 'Horario mal formado', { departureTime: '25:00' }, 'Los horarios deben tener el formato HH:mm'],
  ['V07', 'Llegada anterior a la partida el mismo día', { arrivalDayOffset: 0 }, 'La llegada debe ser posterior a la partida o indicar llegada al día siguiente'],
  ['V08', 'Desfase de llegada de 2 días', { arrivalDayOffset: 2 }, 'La llegada debe ser el mismo día o el día siguiente'],
  ['V09', 'Fecha mal formada', { startDate: start.replaceAll('-', '/') }, 'Las fechas deben tener el formato AAAA-MM-DD'],
  ['V10', 'Período invertido', { startDate: end, endDate: start }, 'La fecha de inicio debe ser anterior o igual a la fecha de fin'],
  ['V11', 'Período que empieza antes de hoy', { startDate: addDays(today, -1) }, 'El período no puede comenzar antes de hoy'],
  ['V12', 'Período mayor a 366 días', { endDate: addDays(start, 366) }, 'El período no puede superar los 366 días'],
  ['V13', 'Sin días de operación', { operatingDays: [] }, 'Seleccioná al menos un día de operación'],
  ['V14', 'Día de operación 8', { operatingDays: [1, 8] }, 'Los días de operación deben ser valores distintos entre 1 (lunes) y 7 (domingo)'],
  ['V15', 'Días de operación repetidos', { operatingDays: [1, 1] }, 'Los días de operación deben ser valores distintos entre 1 (lunes) y 7 (domingo)'],
  ['V16', 'Período sin ningún día de operación', { endDate: start, operatingDays: [(isoWeekday(start) % 7) + 1] }, 'El período no incluye ninguno de los días de operación elegidos'],
  ['V17', 'Sin clases', { classes: [] }, 'Seleccioná al menos una clase'],
  ['V18', 'Clase desconocida', { classes: [{ className: 'BUSINESS', capacity: 10, price: 100 }] }, 'Las clases válidas son ECONOMY y PRIMERA'],
  ['V19', 'Clase repetida', { classes: [{ className: 'ECONOMY', capacity: 10, price: 100 }, { className: 'economy', capacity: 5, price: 100 }] }, 'Cada clase puede indicarse una sola vez'],
  ['V20', 'Capacidad cero', { classes: [{ className: 'ECONOMY', capacity: 0, price: 100 }] }, 'La capacidad de cada clase debe ser un entero mayor que cero'],
  ['V21', 'Precio cero', { classes: [{ className: 'ECONOMY', capacity: 10, price: 0 }] }, 'El precio de cada clase debe ser positivo, tener hasta dos decimales y no superar 9.999.999.999,99'],
  ['V22', 'Precio con tres decimales', { classes: [{ className: 'ECONOMY', capacity: 10, price: 10.005 }] }, 'El precio de cada clase debe ser positivo, tener hasta dos decimales y no superar 9.999.999.999,99'],
  ['V23', 'Precio mayor al límite de DECIMAL(12,2)', { classes: [{ className: 'ECONOMY', capacity: 10, price: 10000000000 }] }, 'El precio de cada clase debe ser positivo, tener hasta dos decimales y no superar 9.999.999.999,99'],
];
for (const [id, description, change, message] of invalidCases) {
  response = await api('/admin/flights', { method: 'POST', token: adminToken, body: { ...validFlight, ...change } });
  report.check(id, description, response.status === 400 && response.body.error === message,
    `HTTP ${response.status} ${response.body.error || ''}`);
}
response = await api('/admin/flights', { method: 'POST', token: adminToken, rawBody: '{"code":' });
report.check('V24', 'JSON mal formado', response.status === 400, `HTTP ${response.status} ${response.body.error || ''}`);
const { classes, ...withoutClasses } = validFlight;
response = await api('/admin/flights', { method: 'POST', token: adminToken, body: withoutClasses });
report.check('V25', 'Falta el campo classes', response.status === 400, `HTTP ${response.status} ${response.body.error || ''}`);
response = await api('/admin/flights', { method: 'POST', token: adminToken,
  body: { ...validFlight, classes: [{ className: 'ECONOMY', capacity: 1.5, price: 100 }] } });
report.check('V26', 'Capacidad no entera', response.status === 400, `HTTP ${response.status} ${response.body.error || ''}`);
report.check('V27', 'Las solicitudes inválidas no crean datos', snapshot() === before, `${before} -> ${snapshot()}`);

// ---------------------------------------------------------------------------
// Alta válida: vuelo, días, clases, salidas, capacidades y auditoría
// ---------------------------------------------------------------------------
response = await api('/admin/flights', { method: 'POST', token: adminToken, body: validFlight });
const flightId = response.body.flightId;
report.check('C01', `Alta válida de ${validFlight.code}`, response.status === 201 && Number.isInteger(flightId),
  `HTTP ${response.status} ${response.body.error || `flightId ${flightId}`}`);

if (Number.isInteger(flightId)) {
  const [flight] = sql(container, `SELECT codigo, aeropuerto_origen_id, aeropuerto_destino_id, TIME_FORMAT(hora_partida, '%H:%i'),
    TIME_FORMAT(hora_llegada, '%H:%i'), dias_desfase_llegada, fecha_desde, fecha_hasta, estado, creado_por_id
    FROM vuelo WHERE id = ${flightId};`);
  report.check('C02', 'Vuelo persistido con los datos enviados', JSON.stringify(flight) === JSON.stringify([
    validFlight.code, String(origin), String(destination), '22:30', '01:10', '1', start, end, 'ACTIVO', adminId]),
  (flight || []).join(' | '));

  const days = sql(container, `SELECT dia_semana FROM vuelo_dia_operacion WHERE vuelo_id = ${flightId} ORDER BY dia_semana;`).flat();
  report.check('C03', 'Días de operación persistidos', days.join(',') === '1,3,5', days.join(','));

  const classRows = sql(container, `SELECT clase, capacidad, precio FROM vuelo_clase WHERE vuelo_id = ${flightId} ORDER BY clase;`)
    .map((row) => row.join(':')).join(', ');
  report.check('C04', 'Clases con capacidad y precio', classRows === 'ECONOMY:120:85000.50, PRIMERA:8:210000.00', classRows);

  const dates = sql(container, `SELECT fecha FROM salida WHERE vuelo_id = ${flightId} ORDER BY fecha;`).flat();
  report.check('C05', 'Una salida por cada día de operación del período',
    dates.join(',') === expectedDates.join(','), `${dates.length} salidas; esperadas ${expectedDates.length}`);

  const departureClasses = sql(container, `SELECT COUNT(*), SUM(sc.capacidad = vc.capacidad AND sc.vendidos = 0)
    FROM salida_clase sc JOIN salida s ON s.id = sc.salida_id
    JOIN vuelo_clase vc ON vc.vuelo_id = s.vuelo_id AND vc.clase = sc.clase
    WHERE s.vuelo_id = ${flightId};`)[0];
  report.check('C06', 'Capacidad por clase en cada salida, sin vendidos',
    departureClasses[0] === String(expectedDates.length * 2) && departureClasses[1] === departureClasses[0],
    `${departureClasses[0]} salida_clase`);

  const auditRows = sqlValue(container, `SELECT COUNT(*) FROM auditoria WHERE accion = 'flight.created'
    AND entidad = 'vuelo' AND entidad_id = ${flightId} AND actor_usuario_id = ${adminId};`);
  report.check('C07', 'Auditoría del alta registrada', auditRows === '1', `${auditRows} filas`);

  response = await api(`/passenger/search?origin=NQN&destination=SLA&dateFrom=${expectedDates[0]}&dateTo=${expectedDates[0]}`);
  report.check('C08', 'El vuelo creado aparece en la búsqueda de pasajeros',
    response.status === 200 && response.body.results.filter((row) => row.flightCode === validFlight.code).length === 2,
    `HTTP ${response.status}`);
}

// ---------------------------------------------------------------------------
// Duplicación de código
// ---------------------------------------------------------------------------
const afterCreate = snapshot();
response = await api('/admin/flights', { method: 'POST', token: adminToken, body: validFlight });
report.check('D01', 'Código duplicado', response.status === 409 && response.body.error === 'Ya existe un vuelo con ese código',
  `HTTP ${response.status} ${response.body.error || ''}`);
response = await api('/admin/flights', { method: 'POST', token: adminToken, body: { ...validFlight, code: validFlight.code.toLowerCase() } });
report.check('D02', 'Código duplicado en minúsculas', response.status === 409, `HTTP ${response.status} ${response.body.error || ''}`);
report.check('D03', 'El duplicado no deja datos parciales', snapshot() === afterCreate, `${afterCreate} -> ${snapshot()}`);

// ---------------------------------------------------------------------------
// Atomicidad: un fallo al generar las salidas deshace todo el alta
// ---------------------------------------------------------------------------
response = await api('/admin/flights', { method: 'POST', token: adminToken, body: { ...validFlight, code: 'ZF9001' } });
report.check('T01', 'Fallo inyectado al generar salidas', response.status === 500, `HTTP ${response.status} ${response.body.error || ''}`);
const leftovers = sqlValue(container, "SELECT COUNT(*) FROM vuelo WHERE codigo = 'ZF9001';");
report.check('T02', 'No queda el vuelo ZF9001', leftovers === '0', `${leftovers} filas`);
report.check('T03', 'No quedan días, clases, salidas, capacidades ni auditoría parciales',
  snapshot() === afterCreate, `${afterCreate} -> ${snapshot()}`);

report.finish();
