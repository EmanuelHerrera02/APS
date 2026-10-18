// US9 — Pago en línea contra el sandbox de Mercado Pago (base aislada + API local).
//
// La prueba levanta el sandbox local (tests/sandbox/mercadopago-sandbox.mjs) en el puerto 8090.
// La API debe estar iniciada contra la base aislada aeronet-us9-db con:
//   AERONET_PAYMENT_PROVIDER=mercadopago
//   AERONET_MP_API_URL=http://127.0.0.1:8090
//   AERONET_MP_ACCESS_TOKEN / AERONET_MP_PUBLIC_KEY / AERONET_MP_WEBHOOK_SECRET  (los mismos que use esta prueba)
//   AERONET_PAYMENT_RECONCILE_SECONDS=5
// y el sandbox debe poder llamar al webhook en ${AERONET_API_URL}/webhooks/payments/mercadopago.
//
// Uso: node tests/http/us9-pago-en-linea.mjs   (ver docs/pruebas-pago-en-linea.md)
import { api, apiUrl, createReport, sql, sqlValue } from './lib.mjs';
import { randomUUID } from 'node:crypto';
import { startMercadoPagoSandbox } from '../sandbox/mercadopago-sandbox.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us9-db';
const accessToken = process.env.AERONET_MP_ACCESS_TOKEN || 'TEST-aeronet-sandbox-access-token';
const publicKey = process.env.AERONET_MP_PUBLIC_KEY || 'TEST-aeronet-sandbox-public-key';
const webhookSecret = process.env.AERONET_MP_WEBHOOK_SECRET || '';
const sandboxPort = Number(process.env.MP_SANDBOX_PORT || 8090);

// Tarjetas de prueba publicadas por Mercado Pago (CVV 123, vencimiento 11/30).
const VISA = '4509953566233704';
const MASTERCARD = '5031755734530604';
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const report = createReport('US9 — Pago en línea (sandbox de Mercado Pago)');
const unique = Date.now();
let sandbox;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 60000, everyMs = 1000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await sleep(everyMs);
  }
  return null;
}

async function register(label) {
  const account = {
    email: `us9-${label}-${unique}@aeronet.test`,
    password: `US9-test-${unique}-Password`,
    firstName: 'Prueba', lastName: `US9 ${label}`, phone: '+54 11 5555-0109',
  };
  const result = await api('/auth/register', { method: 'POST', body: account });
  if (result.status !== 201 || !result.body.accessToken) throw new Error(`Registro ${label}: HTTP ${result.status} ${result.body.error || ''}`);
  return { ...account, token: result.body.accessToken };
}

let documentSequence = 0;
async function reserve(user, departureId, fareClass, count = 1) {
  const passengers = Array.from({ length: count }, (_, index) => {
    documentSequence += 1;
    return {
      firstName: 'Pasajero', lastName: `Pago ${index + 1}`, documentType: 'DNI',
      documentNumber: `9${String(unique).slice(-8)}${documentSequence}`.slice(0, 20), class: fareClass,
    };
  });
  const response = await api('/passenger/reservations', {
    method: 'POST', token: user.token,
    body: { departureId: Number(departureId), emailContact: user.email, passengers },
  });
  if (response.status !== 201) throw new Error(`Crear compra: HTTP ${response.status} ${response.body.error || ''}`);
  return response.body.reservation;
}

async function tokenize(holder, cardNumber = VISA) {
  const response = await fetch(`${sandbox.origin}/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card_number: cardNumber, security_code: '123', expiration_month: 11, expiration_year: 2030,
      cardholder: { name: holder, identification: { type: 'DNI', number: '12345678' } },
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Tokenizar tarjeta: HTTP ${response.status} ${body.message || ''}`);
  return body.id;
}

const startPayment = (user, purchaseId) => api('/payments/transactions', {
  method: 'POST', token: user.token, body: { purchaseId: Number(purchaseId) },
});

async function payCard(user, transactionId, holder, { token, cardNumber = VISA } = {}) {
  const cardToken = token || await tokenize(holder, cardNumber);
  const response = await api(`/payments/transactions/${transactionId}/card`, {
    method: 'POST', token: user.token,
    body: {
      token: cardToken, paymentMethodId: cardNumber.startsWith('5') ? 'master' : 'visa', issuerId: '310', installments: 1,
      payer: { email: user.email, identification: { type: 'DNI', number: '12345678' } },
    },
  });
  return { ...response, cardToken };
}

const transactionStatus = (user, transactionId) => api(`/payments/transactions/${transactionId}`, { token: user.token });
const purchaseState = (purchaseId) => sqlValue(container, `SELECT estado FROM compra WHERE id=${Number(purchaseId)};`);
const paymentRows = (purchaseId) => Number(sqlValue(container, `SELECT COUNT(*) FROM pago WHERE compra_id=${Number(purchaseId)};`));
const soldSeats = (departureId, fareClass) => Number(sqlValue(container,
  `SELECT vendidos FROM salida_clase WHERE salida_id=${Number(departureId)} AND clase='${fareClass}';`));

async function sandboxCall(path, body = {}) {
  const response = await fetch(`${sandbox.origin}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return response.json();
}

try {
  if (webhookSecret.length < 16) throw new Error('Definí AERONET_MP_WEBHOOK_SECRET (mínimo 16 caracteres) en la API y en esta prueba');
  sandbox = await startMercadoPagoSandbox({
    port: sandboxPort, accessToken, publicKey, webhookSecret,
    webhookUrl: `${apiUrl}/webhooks/payments/mercadopago`,
  });

  const owner = await register('owner');
  const other = await register('other');
  const [candidate] = sql(container, `SELECT salida_id, clase FROM v_disponibilidad
    WHERE asientos_disponibles >= 15 AND TIMESTAMP(fecha, hora_partida) > NOW() + INTERVAL 1 DAY
    ORDER BY fecha, hora_partida, clase LIMIT 1;`);
  if (!candidate) throw new Error('No hay salidas futuras con 15 asientos libres en la base aislada');
  const [departureId, fareClass] = candidate;

  // --- Configuración y datos de tarjeta -------------------------------------------------
  const config = await api('/payments/config', { token: owner.token });
  report.check('U9-01', 'La API expone solo la clave pública y el SDK de la pasarela', config.status === 200
    && config.body.provider === 'mercadopago' && config.body.publicKey === publicKey
    && !JSON.stringify(config.body).includes(accessToken) && !JSON.stringify(config.body).includes(webhookSecret),
  `HTTP ${config.status}, sdk=${config.body.sdkUrl}`);

  const anonymous = await api('/payments/config');
  report.check('U9-02', 'Los endpoints de pago exigen sesión', anonymous.status === 401, `HTTP ${anonymous.status}`);

  const createsBeforeRaw = sandbox.stats.createRequests;
  const rawCard = await api(`/payments/transactions/${randomUUID()}/card`, {
    method: 'POST', token: owner.token,
    body: { cardNumber: VISA, securityCode: '123', paymentMethodId: 'visa', token: 'abcdef123456' },
  });
  report.check('U9-03', 'El backend rechaza PAN/CVV sin tokenizar y no llama a la pasarela', rawCard.status === 400
    && sandbox.stats.createRequests === createsBeforeRaw, `HTTP ${rawCard.status} ${rawCard.body.error || ''}`);

  // --- Pago aprobado --------------------------------------------------------------------
  const approvedPurchase = await reserve(owner, departureId, fareClass);
  const approvedStart = await startPayment(owner, approvedPurchase.reservationId);
  const approvedTx = approvedStart.body.transaction || {};
  const purchaseTotal = sqlValue(container, `SELECT total FROM compra WHERE id=${Number(approvedPurchase.reservationId)};`);
  report.check('U9-04', 'Cada transacción tiene UUID v4, importe de la compra y estado CREADA', approvedStart.status === 201
    && uuidV4.test(approvedTx.id || '') && Number(approvedTx.amount) === Number(purchaseTotal) && approvedTx.status === 'CREADA',
  `uuid=${approvedTx.id}, importe=${approvedTx.amount}`);

  const approved = await payCard(owner, approvedTx.id, 'APRO');
  const approvedBody = approved.body.transaction || {};
  const approvedPago = sql(container, `SELECT estado, id_transaccion_pasarela, marca_tarjeta, ultimos_4, medio
    FROM pago WHERE compra_id=${Number(approvedPurchase.reservationId)};`);
  report.check('U9-05', 'Aprobado: confirma la compra, emite pasajes y registra el pago', approved.status === 200
    && approvedBody.status === 'APROBADA' && approvedBody.purchaseStatus === 'CONFIRMADA'
    && Number(sqlValue(container, `SELECT COUNT(*) FROM pasaje WHERE compra_id=${Number(approvedPurchase.reservationId)} AND estado='EMITIDO';`)) === 1
    && approvedPago.length === 1 && approvedPago[0][0] === 'APROBADO' && approvedPago[0][1] === `MP-${approvedBody.gatewayPaymentId}`
    && approvedPago[0][2] === 'VISA' && approvedPago[0][3] === '3704' && approvedPago[0][4] === 'TARJETA_CREDITO'
    && Number(sqlValue(container, `SELECT COUNT(*) FROM notificacion WHERE compra_id=${Number(approvedPurchase.reservationId)} AND tipo='CONFIRMACION' AND canal='EMAIL';`)) === 1,
  `HTTP ${approved.status}, ${approvedBody.status}/${approvedBody.purchaseStatus}, pago=${approvedPago[0]?.join(' ')}`);

  const storedPan = Number(sqlValue(container, `SELECT
      (SELECT COUNT(*) FROM auditoria WHERE detalles LIKE '%${VISA}%')
    + (SELECT COUNT(*) FROM transaccion_pago WHERE CONCAT_WS('|', uuid, id_pago_pasarela, estado_pasarela, detalle_estado) LIKE '%${VISA}%')
    + (SELECT COUNT(*) FROM pago WHERE CONCAT_WS('|', id_transaccion_pasarela, marca_tarjeta, ultimos_4) LIKE '%${VISA}%');`));
  const sensitiveColumns = Number(sqlValue(container, `SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='aeronet' AND (column_name LIKE '%cvv%' OR column_name LIKE '%card_number%'
      OR column_name LIKE '%numero_tarjeta%' OR column_name LIKE '%codigo_seguridad%' OR column_name LIKE '%vencimiento%');`));
  report.check('U9-06', 'La base no guarda PAN ni CVV: solo marca y últimos 4 dígitos', storedPan === 0 && sensitiveColumns === 0,
    `coincidencias PAN=${storedPan}, columnas sensibles=${sensitiveColumns}`);

  const paymentsBeforeReplay = sandbox.stats.paymentsCreated;
  const replay = await payCard(owner, approvedTx.id, 'APRO');
  report.check('U9-07', 'Reenviar el mismo pago (mismo UUID) no genera un segundo cobro', replay.status === 200
    && replay.body.transaction?.status === 'APROBADA'
    && replay.body.transaction?.gatewayPaymentId === approvedBody.gatewayPaymentId
    && sandbox.stats.paymentsCreated === paymentsBeforeReplay && paymentRows(approvedPurchase.reservationId) === 1
    && sandbox.tokens.get(replay.cardToken)?.used === false,
  `pagos en pasarela ${paymentsBeforeReplay} -> ${sandbox.stats.paymentsCreated}`);

  const restart = await startPayment(owner, approvedPurchase.reservationId);
  report.check('U9-08', 'Una compra pagada devuelve su transacción aprobada en vez de abrir otra', restart.status === 201
    && restart.body.transaction?.id === approvedTx.id && restart.body.transaction?.status === 'APROBADA',
  `HTTP ${restart.status}, uuid=${restart.body.transaction?.id}`);

  // --- Doble clic / solicitudes simultáneas ---------------------------------------------
  const concurrentPurchase = await reserve(owner, departureId, fareClass);
  const concurrentTx = (await startPayment(owner, concurrentPurchase.reservationId)).body.transaction;
  const paymentsBeforeConcurrent = sandbox.stats.paymentsCreated;
  const tokens = await Promise.all(Array.from({ length: 5 }, () => tokenize('APRO')));
  const concurrent = await Promise.all(tokens.map((token) => payCard(owner, concurrentTx.id, 'APRO', { token })));
  const finalConcurrent = (await transactionStatus(owner, concurrentTx.id)).body.transaction;
  report.check('U9-09', '5 envíos simultáneos del mismo pago producen un único cobro', concurrent.every((r) => r.status === 200)
    && finalConcurrent?.status === 'APROBADA' && sandbox.stats.paymentsCreated === paymentsBeforeConcurrent + 1
    && paymentRows(concurrentPurchase.reservationId) === 1,
  `respuestas=${concurrent.map((r) => r.body.transaction?.status || r.status).join(',')}, cobros=${sandbox.stats.paymentsCreated - paymentsBeforeConcurrent}`);

  // --- Rechazos -------------------------------------------------------------------------
  const seatsBeforeReject = soldSeats(departureId, fareClass);
  const rejectedPurchase = await reserve(owner, departureId, fareClass, 2);
  const seatsReserved = soldSeats(departureId, fareClass);
  const rejectedTx = (await startPayment(owner, rejectedPurchase.reservationId)).body.transaction;
  const rejected = await payCard(owner, rejectedTx.id, 'OTHE', { cardNumber: MASTERCARD });
  const rejectedBody = rejected.body.transaction || {};
  report.check('U9-10', 'Rechazado: cancela la compra y libera las reservas', rejected.status === 200
    && rejectedBody.status === 'RECHAZADA' && rejectedBody.purchaseStatus === 'CANCELADA'
    && rejectedBody.statusDetail === 'cc_rejected_other_reason' && /Liberamos los asientos/.test(rejectedBody.message || '')
    && seatsReserved === seatsBeforeReject + 2 && soldSeats(departureId, fareClass) === seatsBeforeReject
    && Number(sqlValue(container, `SELECT COUNT(*) FROM pasaje WHERE compra_id=${Number(rejectedPurchase.reservationId)} AND estado<>'CANCELADO';`)) === 0,
  `vendidos ${seatsBeforeReject} -> ${seatsReserved} -> ${soldSeats(departureId, fareClass)}; ${rejectedBody.message}`);

  const fundsPurchase = await reserve(owner, departureId, fareClass);
  const fundsTx = (await startPayment(owner, fundsPurchase.reservationId)).body.transaction;
  const funds = (await payCard(owner, fundsTx.id, 'FUND')).body.transaction || {};
  report.check('U9-11', 'El rechazo informa el motivo al usuario (fondos insuficientes)', funds.status === 'RECHAZADA'
    && /fondos suficientes/.test(funds.message || ''), funds.message);

  // --- Pendiente con confirmación asincrónica (webhook) ----------------------------------
  const pendingPurchase = await reserve(owner, departureId, fareClass);
  const pendingTx = (await startPayment(owner, pendingPurchase.reservationId)).body.transaction;
  const pending = (await payCard(owner, pendingTx.id, 'CONT')).body.transaction || {};
  const pendingState = purchaseState(pendingPurchase.reservationId);
  const resolution = await sandboxCall(`/__sandbox/payments/${pending.gatewayPaymentId}/resolve`, { status: 'approved' });
  const afterWebhook = (await transactionStatus(owner, pendingTx.id)).body.transaction || {};
  report.check('U9-12', 'Pendiente: conserva la reserva y el webhook firmado la confirma', pending.status === 'PENDIENTE'
    && pendingState === 'PENDIENTE_PAGO' && resolution.webhook?.status === 200
    && afterWebhook.status === 'APROBADA' && afterWebhook.purchaseStatus === 'CONFIRMADA',
  `${pending.status} (${pending.statusDetail}) -> webhook HTTP ${resolution.webhook?.status} -> ${afterWebhook.status}`);

  const duplicate = await sandboxCall(`/__sandbox/payments/${pending.gatewayPaymentId}/notify`);
  report.check('U9-13', 'Un webhook repetido es idempotente', duplicate.webhook?.status === 200
    && paymentRows(pendingPurchase.reservationId) === 1 && purchaseState(pendingPurchase.reservationId) === 'CONFIRMADA',
  `HTTP ${duplicate.webhook?.status}, pagos=${paymentRows(pendingPurchase.reservationId)}`);

  const tampered = await sandboxCall(`/__sandbox/payments/${pending.gatewayPaymentId}/notify`, { tamper: true });
  const unsigned = await fetch(`${apiUrl}/webhooks/payments/mercadopago?data.id=${pending.gatewayPaymentId}&type=payment`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'payment', data: { id: pending.gatewayPaymentId } }),
  });
  report.check('U9-14', 'Webhooks sin firma o con firma inválida se rechazan', tampered.webhook?.status === 401 && unsigned.status === 401,
    `firma alterada HTTP ${tampered.webhook?.status}, sin firma HTTP ${unsigned.status}`);

  // --- Pendiente resuelto por polling (sin webhook) --------------------------------------
  const pollingPurchase = await reserve(owner, departureId, fareClass);
  const pollingTx = (await startPayment(owner, pollingPurchase.reservationId)).body.transaction;
  const pollingPending = (await payCard(owner, pollingTx.id, 'CONT')).body.transaction || {};
  await sandboxCall(`/__sandbox/payments/${pollingPending.gatewayPaymentId}/resolve`, { status: 'rejected', status_detail: 'cc_rejected_other_reason', notify: false });
  const polled = await waitFor(async () => {
    const tx = (await transactionStatus(owner, pollingTx.id)).body.transaction;
    return tx?.status === 'RECHAZADA' ? tx : null;
  }, 75000);
  report.check('U9-15', 'Polling: el conciliador obtiene el rechazo sin webhook y libera la reserva', Boolean(polled)
    && polled.purchaseStatus === 'CANCELADA', polled ? `${polled.status}/${polled.purchaseStatus}` : 'sin resolver en 75 s');

  // --- Respuesta perdida: conciliación por external_reference ----------------------------
  const lostPurchase = await reserve(owner, departureId, fareClass);
  const lostTx = (await startPayment(owner, lostPurchase.reservationId)).body.transaction;
  await sandboxCall('/__sandbox/fail-next', { status: 500, times: 1 });
  const lost = (await payCard(owner, lostTx.id, 'APRO')).body.transaction || {};
  const recovered = await waitFor(async () => {
    const tx = (await transactionStatus(owner, lostTx.id)).body.transaction;
    return tx?.status === 'APROBADA' ? tx : null;
  }, 75000);
  report.check('U9-16', 'Si se pierde la respuesta de la pasarela, el conciliador la recupera por UUID', lost.status === 'PROCESANDO'
    && Boolean(recovered) && recovered.purchaseStatus === 'CONFIRMADA' && paymentRows(lostPurchase.reservationId) === 1,
  `${lost.status} -> ${recovered ? recovered.status : 'sin resolver en 75 s'}`);

  // --- Propiedad y vencimiento -----------------------------------------------------------
  const foreignStatus = await transactionStatus(other, approvedTx.id);
  const foreignStart = await startPayment(other, concurrentPurchase.reservationId);
  const foreignPay = await payCard(other, approvedTx.id, 'APRO');
  report.check('U9-17', 'Otro usuario no puede ver ni pagar una transacción ajena', foreignStatus.status === 404
    && foreignStart.status === 404 && foreignPay.status === 404,
  `GET ${foreignStatus.status}, POST ${foreignStart.status}, pagar ${foreignPay.status}`);

  const expiringPurchase = await reserve(owner, departureId, fareClass);
  sql(container, `UPDATE compra SET expira_en = NOW() + INTERVAL 10 SECOND WHERE id=${Number(expiringPurchase.reservationId)};`);
  const expiring = await startPayment(owner, expiringPurchase.reservationId);
  report.check('U9-18', 'No se inicia el cobro de una reserva vencida o por vencer', expiring.status === 409,
    `HTTP ${expiring.status} ${expiring.body.error || ''}`);

  // --- Aprobación tardía: reembolso automático ------------------------------------------
  const latePurchase = await reserve(owner, departureId, fareClass);
  const lateTx = (await startPayment(owner, latePurchase.reservationId)).body.transaction;
  const latePending = (await payCard(owner, lateTx.id, 'CONT')).body.transaction || {};
  sql(container, `UPDATE compra SET expira_en = NOW() - INTERVAL 1 SECOND WHERE id=${Number(latePurchase.reservationId)};
    CALL liberar_reservas_vencidas();`);
  const lateResolution = await sandboxCall(`/__sandbox/payments/${latePending.gatewayPaymentId}/resolve`, { status: 'approved' });
  const refunded = await waitFor(async () => {
    const tx = (await transactionStatus(owner, lateTx.id)).body.transaction;
    return tx?.status === 'REEMBOLSADA' ? tx : null;
  }, 30000);
  report.check('U9-19', 'Pago aprobado tras vencer la reserva: compra EXPIRADA y reembolso automático', lateResolution.webhook?.status === 200
    && Boolean(refunded) && purchaseState(latePurchase.reservationId) === 'EXPIRADA'
    && sqlValue(container, `SELECT estado FROM pago WHERE compra_id=${Number(latePurchase.reservationId)};`) === 'REEMBOLSADO'
    && sandbox.payments.get(String(latePending.gatewayPaymentId))?.status === 'refunded',
  refunded ? `${refunded.status}; ${refunded.message}` : 'sin reembolso en 30 s');

  // --- Error definitivo de la pasarela y reintento ---------------------------------------
  const retryPurchase = await reserve(owner, departureId, fareClass);
  const firstAttempt = (await startPayment(owner, retryPurchase.reservationId)).body.transaction;
  const failed = (await payCard(owner, firstAttempt.id, 'APRO', { token: approved.cardToken })).body.transaction || {};
  const secondAttempt = (await startPayment(owner, retryPurchase.reservationId)).body.transaction || {};
  const retried = (await payCard(owner, secondAttempt.id, 'APRO')).body.transaction || {};
  report.check('U9-20', 'Un token rechazado deja la transacción en ERROR y permite reintentar con otro UUID', failed.status === 'ERROR'
    && failed.purchaseStatus === 'PENDIENTE_PAGO' && secondAttempt.id && secondAttempt.id !== firstAttempt.id
    && retried.status === 'APROBADA' && paymentRows(retryPurchase.reservationId) === 1,
  `${failed.status} (${failed.statusDetail}) -> nueva transacción ${retried.status}`);

  // --- Trazabilidad ------------------------------------------------------------------------
  const trail = sqlValue(container, `SELECT GROUP_CONCAT(JSON_UNQUOTE(JSON_EXTRACT(detalles, '$.estado')) ORDER BY id SEPARATOR ' -> ')
    FROM auditoria WHERE entidad='transaccion_pago' AND JSON_UNQUOTE(JSON_EXTRACT(detalles, '$.uuid'))='${approvedTx.id}';`);
  const pendingTrail = sqlValue(container, `SELECT GROUP_CONCAT(JSON_UNQUOTE(JSON_EXTRACT(detalles, '$.estado')) ORDER BY id SEPARATOR ' -> ')
    FROM auditoria WHERE entidad='transaccion_pago' AND JSON_UNQUOTE(JSON_EXTRACT(detalles, '$.uuid'))='${pendingTx.id}';`);
  report.check('U9-21', 'Cada transacción deja rastro de UUID, importe y estados en auditoría', trail === 'CREADA -> PROCESANDO -> APROBADA'
    && pendingTrail === 'CREADA -> PROCESANDO -> PENDIENTE -> APROBADA', `${trail} | ${pendingTrail}`);
} catch (error) {
  console.error(`\nLa prueba se interrumpió: ${error.message}`);
  report.check('U9-XX', 'Ejecución completa de la prueba', false, error.message);
} finally {
  if (sandbox) await sandbox.close();
  report.finish();
}
