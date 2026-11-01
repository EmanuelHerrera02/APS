// US14 — Reporte de ocupación y exportación CSV verificados contra una venta conocida.
// Requiere API, base aislada y cuentas locales ADMIN/MOSTRADOR.
// Uso: node tests/http/us14-reportes-ocupacion.mjs
import { api, apiUrl, createReport, login, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US14 — Reportes de ocupación');
const adminEmail = process.env.AERONET_DEV_ADMIN_EMAIL || 'admin.dev@aeronet.test';
const employeeEmail = process.env.AERONET_DEV_MOSTRADOR_EMAIL || 'mostrador.dev@aeronet.test';
const adminToken = await login(adminEmail, process.env.AERONET_DEV_ADMIN_PASSWORD);
const employeeToken = await login(employeeEmail, process.env.AERONET_DEV_MOSTRADOR_PASSWORD);
const unique = Date.now();

const [departureId, flightCode, fareClass, date] = sql(container, `SELECT d.salida_id,d.codigo_vuelo,d.clase,d.fecha
  FROM v_disponibilidad d JOIN salida s ON s.id=d.salida_id
  WHERE d.asientos_disponibles>0 AND d.fecha>=CURDATE() AND TIMESTAMP(d.fecha,s.hora_partida)>NOW()
  ORDER BY d.fecha,d.salida_id,d.clase LIMIT 1;`)[0] || [];
if (!departureId) throw new Error('No hay salidas futuras disponibles en la base aislada');

const sold = await api('/employee/sales', { method: 'POST', token: employeeToken, body: {
  departureId: Number(departureId), emailContact: `us14-${unique}@aeronet.test`, paymentMethod: 'EFECTIVO',
  passengers: [{ firstName: 'Venta', lastName: `US14-${unique}`, documentType: 'DNI',
    documentNumber: `U14${unique}`.slice(0, 20), class: fareClass }],
} });
if (sold.status !== 201) throw new Error(`No se pudo preparar venta de referencia: HTTP ${sold.status} ${sold.body.error || ''}`);

const query = new URLSearchParams({ flightCode, class: fareClass, dateFrom: date, dateTo: date }).toString();
const response = await api(`/admin/occupancy?${query}`, { token: adminToken });
const row = response.body.rows?.find((item) => Number(item.departureId) === Number(departureId) && item.class === fareClass);
const known = sql(container, `SELECT capacidad,emitidos,reservados,disponibles,porcentaje_ocupacion,recaudado
  FROM v_ocupacion WHERE salida_id=${Number(departureId)} AND clase='${String(fareClass).replaceAll("'", "''")}';`)[0] || [];
report.check('US14-01', 'ADMIN filtra por vuelo, clase y fecha y las cifras coinciden con la vista',
  response.status === 200 && Boolean(row) && known.length === 6
    && Number(row.capacity) === Number(known[0]) && Number(row.sold) === Number(known[1])
    && Number(row.reserved) === Number(known[2]) && Number(row.available) === Number(known[3])
    && Number(row.occupancyPercent) === Number(known[4]) && Number(row.revenue) === Number(known[5]),
  `HTTP ${response.status}; vendidos=${row?.sold ?? '—'}, recaudado=${row?.revenue ?? '—'}`);

const unauthorized = await api(`/admin/occupancy?${query}`, { token: employeeToken });
report.check('US14-02', 'Un usuario de mostrador no puede ver el reporte', unauthorized.status === 403, `HTTP ${unauthorized.status}`);

const csv = await fetch(`${apiUrl}/admin/occupancy.csv?${query}`, {
  headers: { Authorization: `Bearer ${adminToken}`, Accept: 'text/csv' },
});
const csvText = await csv.text();
report.check('US14-03', 'Exporta CSV con encabezados y la salida filtrada', csv.status === 200
  && csv.headers.get('content-type')?.includes('text/csv')
  && csv.headers.get('content-disposition')?.includes('ocupacion.csv')
  && csvText.includes('Pasajes vendidos') && csvText.includes(String(departureId)), `HTTP ${csv.status}`);

report.finish();
