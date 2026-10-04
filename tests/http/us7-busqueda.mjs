// US7 — Matriz HTTP de la búsqueda de viajes contra la instancia aislada docker-compose.us7.yml.
// Ver docs/pruebas-busqueda-viajes.md para la preparación. Uso: node tests/http/us7-busqueda.mjs
import { addDays, api, argentinaToday, createReport, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us7-db';
const report = createReport('US7 — Búsqueda de viajes');

const search = (origin, destination, dateFrom, dateTo) => {
  const params = new URLSearchParams();
  if (origin !== undefined) params.set('origin', origin);
  if (destination !== undefined) params.set('destination', destination);
  if (dateFrom !== undefined) params.set('dateFrom', dateFrom);
  if (dateTo !== undefined) params.set('dateTo', dateTo);
  return api(`/passenger/search?${params}`);
};
const keys = (results) => results.map((row) => `${row.departureId}:${row.class}`).sort().join(',');
const describe = ({ status, body }) => `HTTP ${status}${body.error ? ` ${body.error}` : ` · ${(body.results || []).length} opciones`}`;

const fixtureDates = sql(container, `SELECT s.fecha FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
  WHERE v.codigo = 'US71' ORDER BY s.fecha;`).flat();
if (fixtureDates.length !== 2) throw new Error(`La instancia ${container} no tiene cargado db/us7_search_fixture.sql`);
const [partialDate, soldOutDate] = fixtureDates;

const corDates = sql(container, `SELECT DISTINCT s.fecha FROM salida s
  JOIN vuelo v ON v.id = s.vuelo_id
  JOIN aeropuerto o ON o.id = s.aeropuerto_origen_id
  JOIN aeropuerto d ON d.id = s.aeropuerto_destino_id
  JOIN salida_clase sc ON sc.salida_id = s.id
  WHERE o.codigo_iata = 'AEP' AND d.codigo_iata = 'COR'
    AND TIMESTAMP(s.fecha, s.hora_partida) > NOW() AND s.estado = 'PROGRAMADA'
    AND v.estado = 'ACTIVO' AND sc.capacidad > sc.vendidos
  ORDER BY s.fecha LIMIT 3;`).flat();
const [first, , third] = corDates;
const today = argentinaToday();

// S01 — IATA, una fecha.
const s01 = await search('AEP', 'COR', first);
report.check('S01', 'AEP → COR por código IATA en una fecha', s01.status === 200 && s01.body.results.length > 0
  && s01.body.results.every((row) => row.originCode === 'AEP' && row.destinationCode === 'COR' && row.date === first
    && row.seatsAvailable > 0 && row.departureTime && row.arrivalTime && row.class && Number(row.price) > 0), describe(s01));

// S02 — misma ruta por ciudad.
const s02 = await search('Ciudad Autónoma de Buenos Aires', 'Córdoba', first);
report.check('S02', 'La misma ruta por ciudad', s02.status === 200 && keys(s02.body.results) === keys(s01.body.results), describe(s02));

// S03 — rango inclusivo.
const s03 = await search('AEP', 'COR', first, third);
const s03Dates = new Set(s03.body.results?.map((row) => row.date));
report.check('S03', 'Rango inclusivo de fechas', s03.status === 200 && s03Dates.has(first) && s03Dates.has(third)
  && [...s03Dates].every((date) => date >= first && date <= third), describe(s03));

// S04 — ruta sin vuelos.
const s04 = await search('EZE', 'AEP', addDays(today, 1), addDays(today, 30));
report.check('S04', 'Ruta sin vuelos: EZE → AEP', s04.status === 200 && s04.body.results.length === 0, describe(s04));

// S05 — Economy agotada, Primera disponible.
const s05 = await search('AEP', 'EZE', partialDate);
report.check('S05', 'Clase agotada se omite y la disponible se muestra', s05.status === 200
  && s05.body.results.length > 0 && s05.body.results.every((row) => row.class === 'PRIMERA'), describe(s05));

// S06 — todas las clases agotadas.
const s06 = await search('AEP', 'EZE', soldOutDate);
report.check('S06', 'Salida totalmente agotada', s06.status === 200 && s06.body.results.length === 0, describe(s06));

// S07–S11 — validaciones.
const validations = [
  ['S07a', 'Falta origen', [undefined, 'COR', first]],
  ['S07b', 'Falta destino', ['AEP', undefined, first]],
  ['S07c', 'Falta fecha inicial', ['AEP', 'COR', undefined]],
  ['S08', 'Origen igual a destino', ['AEP', 'aep', first]],
  ['S09', 'Fecha mal formada', ['AEP', 'COR', '10/10/2030']],
  ['S10', 'Fecha final anterior a la inicial', ['AEP', 'COR', third, first]],
  ['S11', 'Fecha inicial anterior a hoy', ['AEP', 'COR', addDays(today, -1)]],
];
for (const [id, description, args] of validations) {
  const response = await search(...args);
  report.check(id, description, response.status === 400 && Boolean(response.body.error), describe(response));
}

// S12 — endpoint público (ninguna llamada de esta matriz envía Authorization).
report.check('S12', 'Búsqueda válida sin Authorization', s01.status === 200, describe(s01));

// S13–S16 — coincidencia por ciudad o nombre de aeropuerto.
const brcDate = sql(container, `SELECT MIN(fecha) FROM v_disponibilidad
  WHERE origen = 'AEP' AND destino = 'BRC' AND asientos_disponibles > 0;`)[0][0];
const byCode = await search('AEP', 'BRC', brcDate);
const s13 = await search('aep', 'Bariloche', brcDate);
report.check('S13', 'Ciudad parcial: "Bariloche" ubica BRC', s13.status === 200 && s13.body.results.length > 0
  && keys(s13.body.results) === keys(byCode.body.results), describe(s13));
const s14 = await search('Aeroparque', 'bariloche', brcDate);
report.check('S14', 'Nombre de aeropuerto: "Aeroparque" ubica AEP', s14.status === 200
  && keys(s14.body.results) === keys(byCode.body.results), describe(s14));
const s15 = await search('AEP', 'Bar', brcDate);
report.check('S15', 'Términos de menos de 4 letras deben coincidir completos', s15.status === 200
  && s15.body.results.length === 0, describe(s15));
const s16 = await search('%%%%', '____', brcDate);
report.check('S16', 'Comodines SQL se buscan como texto literal', s16.status === 200
  && s16.body.results.length === 0, describe(s16));

report.finish();
