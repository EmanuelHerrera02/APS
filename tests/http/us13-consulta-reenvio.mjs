// US13 — Consulta por código, documento, apellido o email; reenvío al email registrado/alternativo.
// Requiere API AeroNet y base aislada; MOSTRADOR_PASSWORD se lee de la variable existente de pruebas.
import { api, createReport, login, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US13 — Consulta y reenvío de documentación');
const unique = Date.now();
const employeeEmail = process.env.AERONET_DEV_MOSTRADOR_EMAIL || 'mostrador.dev@aeronet.test';
const token = await login(employeeEmail, process.env.AERONET_DEV_MOSTRADOR_PASSWORD);
const employeeId = sql(container, `SELECT id FROM usuario WHERE email='${employeeEmail.replaceAll("'", "''")}';`)[0]?.[0];

const [departureId, fareClass] = sql(container, `SELECT salida_id,clase FROM v_disponibilidad
  WHERE asientos_disponibles>=2 AND fecha>=CURDATE() AND TIMESTAMP(fecha,hora_partida)>NOW()
  ORDER BY fecha,hora_partida LIMIT 1;`)[0] || [];
if (!departureId) throw new Error('No hay salidas futuras disponibles en la base aislada');

const buyerEmail = `us13-${unique}@aeronet.test`;
const alternateEmail = `us13-alternativo-${unique}@aeronet.test`;
const surname = `US13-${unique}`;
const document = `U13${unique}`.slice(0, 20);
const created = await api('/employee/sales', { method: 'POST', token, body: {
  departureId: Number(departureId), emailContact: buyerEmail, paymentMethod: 'EFECTIVO',
  passengers: [{ firstName: 'Pasajero', lastName: surname, documentType: 'DNI', documentNumber: document, class: fareClass }],
} });
if (created.status !== 201) throw new Error(`No se pudo preparar compra confirmada: HTTP ${created.status} ${created.body.error || ''}`);
const purchaseId = Number(created.body.sale.purchaseId);
const code = created.body.sale.code;

async function search(value) {
  return api(`/employee/purchases?query=${encodeURIComponent(value)}`, { token });
}

const byCode = await search(code);
const byDocument = await search(document);
const bySurname = await search(surname.slice(4));
const byEmail = await search(buyerEmail);
const detail = byCode.body.purchases?.find((purchase) => Number(purchase.id) === purchaseId);
report.check('US13-01', 'Encuentra compra por código, documento, apellido y email',
  [byCode, byDocument, bySurname, byEmail].every((response) => response.status === 200
    && response.body.purchases?.some((purchase) => Number(purchase.id) === purchaseId)),
  `HTTP ${byCode.status}/${byDocument.status}/${bySurname.status}/${byEmail.status}`);
report.check('US13-02', 'El detalle muestra vuelo, fecha, pasajeros, clase, importe y estado',
  Boolean(detail && detail.flight && detail.date && detail.passengers?.some((passenger) =>
    passenger.documentNumber === document && passenger.class === fareClass)
    && Number(detail.total) > 0 && detail.status === 'CONFIRMADA'),
  detail ? `${detail.flight} ${detail.date}, ${detail.passengers.length} pasajero(s), ${detail.status}` : 'sin detalle');

const registeredResend = await api(`/employee/purchases/${purchaseId}/resend`, { method: 'POST', token, body: {} });
const alternateResend = await api(`/employee/purchases/${purchaseId}/resend`, { method: 'POST', token,
  body: { email: alternateEmail } });
const rows = sql(container, `SELECT solicitado_por_id,destinatario,estado FROM notificacion
  WHERE compra_id=${purchaseId} AND tipo='REENVIO' AND canal='EMAIL' ORDER BY id;`);
report.check('US13-03', 'Reenvía documentos al email registrado o a uno alternativo y registra al empleado',
  registeredResend.status === 202 && alternateResend.status === 202 && rows.length === 2
    && rows.every((row) => row[0] === employeeId)
    && rows.some((row) => row[1] === buyerEmail) && rows.some((row) => row[1] === alternateEmail),
  `solicitudes=${rows.length}, empleado=${employeeId}`);

const noResults = await search(`sin-resultados-${unique}`);
report.check('US13-04', 'Una búsqueda sin coincidencias devuelve lista vacía', noResults.status === 200
  && Array.isArray(noResults.body.purchases) && noResults.body.purchases.length === 0, `HTTP ${noResults.status}`);

const passenger = await api('/auth/register', { method: 'POST', body: {
  email: `us13-pending-${unique}@aeronet.test`, password: `US13-test-${unique}-Password`,
  firstName: 'Compra', lastName: 'Pendiente', phone: '+54 11 5555-1313',
} });
if (passenger.status !== 201) throw new Error(`Registro de pasajero para prueba pendiente: HTTP ${passenger.status}`);
const pending = await api('/passenger/reservations', { method: 'POST', token: passenger.body.accessToken,
  body: { departureId: Number(departureId), emailContact: passenger.body.user.email, passengers: [{
    firstName: 'Pendiente', lastName: 'US13', documentType: 'DNI', documentNumber: `P13${unique}`.slice(0, 20), class: fareClass,
  }] },
});
if (pending.status !== 201) throw new Error(`No se pudo crear compra pendiente: HTTP ${pending.status} ${pending.body.error || ''}`);
const rejected = await api(`/employee/purchases/${pending.body.reservation.reservationId}/resend`, { method: 'POST', token, body: {} });
report.check('US13-05', 'No permite reenviar documentación de compra no confirmada', rejected.status === 422,
  `HTTP ${rejected.status}`);

report.finish();
