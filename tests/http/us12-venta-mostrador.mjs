// US12 — Venta de mostrador con pagos en efectivo y tarjeta de terminal.
// Requiere API AeroNet y una base aislada (por defecto aeronet-us8-http-db).
// Uso: node tests/http/us12-venta-mostrador.mjs
import { api, createReport, login, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US12 — Venta desde mostrador');
const unique = Date.now();
const employeeEmail = process.env.AERONET_DEV_MOSTRADOR_EMAIL || 'mostrador.dev@aeronet.test';
const employeeToken = await login(employeeEmail, process.env.AERONET_DEV_MOSTRADOR_PASSWORD);

function passenger(suffix, fareClass) {
  return [{ firstName: 'Pasajero', lastName: `US12-${suffix}`, documentType: 'DNI',
    documentNumber: `U12${unique}${suffix}`.slice(0, 20), class: fareClass }];
}

async function sale(body) {
  return api('/employee/sales', { method: 'POST', token: employeeToken, body });
}

const candidates = sql(container, `SELECT salida_id, clase, asientos_disponibles, origen, destino, fecha
  FROM v_disponibilidad WHERE asientos_disponibles>0 AND fecha>=CURDATE()
    AND TIMESTAMP(fecha,hora_partida)>NOW() ORDER BY fecha,hora_partida LIMIT 200;`);
const positive = candidates.filter((row) => Number(row[2]) >= 1);
const accountCandidate = positive.find((row) => row[0] !== positive[0]?.[0]);
const oversellCandidate = positive.find((row) => Number(row[2]) < 9 && row[0] !== positive[0]?.[0] && row[0] !== accountCandidate?.[0]);
if (!positive[0] || !accountCandidate || !oversellCandidate) throw new Error('La base aislada requiere tres salidas/clases futuras con disponibilidad');

const [noAccountDeparture, cashClass, cashAvailable, origin, destination, date] = positive[0];
const [accountDeparture, cardClass, cardAvailable] = accountCandidate;
const [fullDeparture, fullClass, fullAvailable] = oversellCandidate;

const passengerAccount = {
  email: `us12-account-${unique}@aeronet.test`, password: `US12-test-${unique}-Password`,
  firstName: 'Cuenta', lastName: 'US12', phone: '+54 11 5555-1212',
};
const registered = await api('/auth/register', { method: 'POST', body: passengerAccount });
if (registered.status !== 201) throw new Error(`Registro de pasajero con cuenta: HTTP ${registered.status}`);

const search = await api(`/passenger/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&dateFrom=${date}&dateTo=${date}`, { token: employeeToken });
report.check('US12-01', 'Empleado encuentra vuelos con la búsqueda de la web', search.status === 200
  && search.body.results?.some((row) => String(row.departureId) === noAccountDeparture), `HTTP ${search.status}`);

const noAccountEmail = `us12-walkin-${unique}@aeronet.test`;
const cash = await sale({ departureId: Number(noAccountDeparture), emailContact: noAccountEmail,
  paymentMethod: 'EFECTIVO', passengers: passenger('cash', cashClass) });
if (cash.status !== 201) throw new Error(`Venta en efectivo: HTTP ${cash.status} ${cash.body.error || ''}`);
const cashPurchaseId = Number(cash.body.sale.purchaseId);
const cashRow = sql(container, `SELECT COALESCE(c.usuario_id,0),c.empleado_id,c.canal,c.estado,c.total,p.medio,p.estado,
  (SELECT COUNT(*) FROM pasaje t WHERE t.compra_id=c.id AND t.estado='EMITIDO'),
  (SELECT COUNT(*) FROM factura f WHERE f.compra_id=c.id),
  (SELECT COUNT(*) FROM notificacion n WHERE n.compra_id=c.id AND n.tipo='CONFIRMACION' AND n.canal='EMAIL'
    AND n.destinatario='${noAccountEmail}')
  FROM compra c JOIN pago p ON p.compra_id=c.id WHERE c.id=${cashPurchaseId};`)[0] || [];
const employeeId = sql(container, `SELECT id FROM usuario WHERE email='${employeeEmail.replaceAll("'", "''")}';`)[0]?.[0];
report.check('US12-02', 'Venta en efectivo confirma compra, emite pasaje/factura y asocia empleado sin cuenta',
  cashRow[0] === '0' && cashRow[1] === employeeId && cashRow[2] === 'MOSTRADOR'
    && cashRow[3] === 'CONFIRMADA' && cashRow[5] === 'EFECTIVO' && cashRow[6] === 'APROBADO'
    && Number(cashRow[7]) === 1 && Number(cashRow[8]) === 1 && Number(cashRow[9]) === 1,
  `compra=${cashRow[3]}, empleado=${cashRow[1]}, pasajes=${cashRow[7]}, facturas=${cashRow[8]}`);

const card = await sale({ departureId: Number(accountDeparture), emailContact: passengerAccount.email,
  paymentMethod: 'TARJETA_CREDITO', terminalReference: `US12-${unique}`, cardBrand: 'Visa', lastFour: '4242',
  passengers: passenger('card', cardClass) });
if (card.status !== 201) throw new Error(`Venta con tarjeta: HTTP ${card.status} ${card.body.error || ''}`);
const cardPurchaseId = Number(card.body.sale.purchaseId);
const cardRow = sql(container, `SELECT c.usuario_id,c.empleado_id,c.canal,c.estado,p.medio,p.estado,p.id_transaccion_pasarela,p.ultimos_4
  FROM compra c JOIN pago p ON p.compra_id=c.id WHERE c.id=${cardPurchaseId};`)[0] || [];
const accountId = sql(container, `SELECT id FROM usuario WHERE email='${passengerAccount.email}';`)[0]?.[0];
report.check('US12-03', 'Venta con tarjeta de terminal vincula cuenta y guarda solo referencia/últimos cuatro',
  cardRow[0] === accountId && cardRow[1] === employeeId && cardRow[2] === 'MOSTRADOR'
    && cardRow[3] === 'CONFIRMADA' && cardRow[4] === 'TARJETA_CREDITO' && cardRow[5] === 'APROBADO'
    && cardRow[6] === `US12-${unique}` && cardRow[7] === '4242', `compra=${cardRow[3]}, medio=${cardRow[4]}`);

const deniedCardData = await sale({ departureId: Number(accountDeparture), emailContact: passengerAccount.email,
  paymentMethod: 'TARJETA_CREDITO', cardNumber: '4111111111111111', cvv: '123',
  passengers: passenger('sensitive', cardClass) });
report.check('US12-04', 'El endpoint no acepta ni almacena datos sensibles de tarjeta', deniedCardData.status === 400,
  `HTTP ${deniedCardData.status}`);

const excessCount = Math.min(9, Number(fullAvailable) + 1);
const excess = Array.from({ length: excessCount }, (_, index) => ({ ...passenger(`ex${index}`, fullClass)[0],
  documentNumber: `U12X${unique}${index}`.slice(0, 20) }));
const oversell = await sale({ departureId: Number(fullDeparture), emailContact: noAccountEmail,
  paymentMethod: 'EFECTIVO', passengers: excess });
report.check('US12-05', 'Sin disponibilidad suficiente la venta se rechaza sin sobreventa', oversell.status === 409,
  `disponibles=${fullAvailable}, solicitados=${excessCount}, HTTP ${oversell.status}`);

report.finish();
