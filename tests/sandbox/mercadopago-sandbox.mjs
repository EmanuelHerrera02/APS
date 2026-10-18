// Sandbox local de Mercado Pago para desarrollo y pruebas de la US9 (Node 18+, sin dependencias).
//
// Reproduce la parte de la API que usa AeroNet:
//   POST /v1/card_tokens            tokenización desde el navegador (como el SDK real)
//   POST /v1/payments               cobro con token; exige X-Idempotency-Key y deduplica por ella
//   GET  /v1/payments/:id           consulta de un pago
//   GET  /v1/payments/search        búsqueda por external_reference
//   POST /v1/payments/:id/refunds   reembolso total
//   GET  /sdk/js/v2                 SDK de prueba con el Brick "cardPayment"
// y endpoints de control (/__sandbox/...) para resolver pagos pendientes y enviar webhooks
// firmados con x-signature igual que Mercado Pago.
//
// El estado del pago depende del nombre del titular, como en las tarjetas de prueba de Mercado Pago:
//   APRO aprobado · OTHE rechazado · CONT pendiente · CALL autorizar · FUND fondos insuficientes
//   SECU código de seguridad · EXPI vencimiento · FORM error de formulario · otro nombre: aprobado
//
// Uso independiente (para probar la interfaz sin credenciales):
//   node tests/sandbox/mercadopago-sandbox.mjs
// Variables: MP_SANDBOX_PORT (8090), MP_SANDBOX_ACCESS_TOKEN, MP_SANDBOX_PUBLIC_KEY,
//   MP_SANDBOX_WEBHOOK_URL, MP_SANDBOX_WEBHOOK_SECRET, MP_SANDBOX_PENDING_SECONDS (20).
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const outcomes = {
  APRO: ['approved', 'accredited'],
  OTHE: ['rejected', 'cc_rejected_other_reason'],
  CONT: ['in_process', 'pending_contingency'],
  CALL: ['rejected', 'cc_rejected_call_for_authorize'],
  FUND: ['rejected', 'cc_rejected_insufficient_amount'],
  SECU: ['rejected', 'cc_rejected_bad_filled_security_code'],
  EXPI: ['rejected', 'cc_rejected_bad_filled_date'],
  FORM: ['rejected', 'cc_rejected_bad_filled_other'],
};

const luhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
};

export const paymentMethodForBin = (cardNumber) => {
  if (/^3[47]/.test(cardNumber)) return 'amex';
  if (/^4/.test(cardNumber)) return 'visa';
  if (/^5/.test(cardNumber)) return 'master';
  return 'visa';
};

export function signWebhook(secret, dataId, requestId, ts) {
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac('sha256', secret).update(manifest).digest('hex');
}

const sdkSource = (origin) => `(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  function detect(number) {
    if (/^3[47]/.test(number)) return 'amex';
    if (/^5/.test(number)) return 'master';
    return 'visa';
  }
  function field(label, name, attrs) {
    return '<label style="display:grid;gap:4px;min-width:0;font-size:13px;font-weight:600;color:#334155">' + label +
      '<input name="' + name + '" ' + (attrs || '') + ' style="width:100%;min-width:0;box-sizing:border-box;padding:9px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" /></label>';
  }
  function MercadoPago(publicKey, options) {
    this.publicKey = publicKey;
    this.options = options || {};
  }
  MercadoPago.prototype.bricks = function () {
    var self = this;
    return {
      create: function (type, containerId, settings) {
        return new Promise(function (resolve, reject) {
          if (type !== 'cardPayment') return reject(new Error('El sandbox local solo implementa el Brick cardPayment'));
          var container = document.getElementById(containerId);
          if (!container) return reject(new Error('No existe el contenedor ' + containerId));
          var init = (settings && settings.initialization) || {};
          var callbacks = (settings && settings.callbacks) || {};
          var email = (init.payer && init.payer.email) || '';
          container.innerHTML = '<form novalidate style="display:grid;gap:10px;padding:16px;border:1px dashed #0ea5e9;border-radius:12px;background:#f8fafc">' +
            '<p style="margin:0;font-size:12px;color:#0369a1"><strong>Sandbox local de Mercado Pago.</strong> Los datos se envían solo a ' + ORIGIN + ' para obtener un token.</p>' +
            field('Número de tarjeta', 'card_number', 'inputmode="numeric" autocomplete="cc-number" placeholder="4509 9535 6623 3704"') +
            '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px">' +
              field('Vencimiento (MM/AA)', 'expiration', 'autocomplete="cc-exp" placeholder="11/30"') +
              field('Código de seguridad', 'security_code', 'inputmode="numeric" autocomplete="cc-csc" placeholder="123"') +
            '</div>' +
            field('Titular (APRO, OTHE, CONT…)', 'holder', 'autocomplete="cc-name" placeholder="APRO"') +
            '<div style="display:grid;grid-template-columns:minmax(0,110px) minmax(0,1fr);gap:10px">' +
              field('Documento', 'doc_type', 'value="DNI"') + field('Número', 'doc_number', 'inputmode="numeric" placeholder="12345678"') +
            '</div>' +
            field('Email', 'email', 'type="email" autocomplete="email" value="' + String(email).replace(/"/g, '&quot;') + '"') +
            '<p data-role="error" role="alert" style="margin:0;color:#b91c1c;font-size:13px"></p>' +
            '<button type="submit" style="padding:11px;border:0;border-radius:8px;background:#009ee3;color:#fff;font-weight:700;cursor:pointer">Pagar</button>' +
          '</form>';
          var form = container.querySelector('form');
          var error = container.querySelector('[data-role="error"]');
          var button = form.querySelector('button');
          form.addEventListener('submit', function (event) {
            event.preventDefault();
            error.textContent = '';
            var values = {};
            Array.prototype.forEach.call(form.elements, function (element) { if (element.name) values[element.name] = element.value.trim(); });
            var number = values.card_number.replace(/\\D/g, '');
            var expiry = values.expiration.split('/');
            button.disabled = true;
            fetch(ORIGIN + '/v1/card_tokens?public_key=' + encodeURIComponent(self.publicKey), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                card_number: number,
                security_code: values.security_code,
                expiration_month: Number(expiry[0]),
                expiration_year: Number(expiry[1] && expiry[1].length === 2 ? '20' + expiry[1] : expiry[1]),
                cardholder: { name: values.holder, identification: { type: values.doc_type, number: values.doc_number } }
              })
            }).then(function (response) {
              return response.json().then(function (body) {
                if (!response.ok) throw new Error(body.message || 'No se pudo tokenizar la tarjeta');
                return body;
              });
            }).then(function (token) {
              form.elements.card_number.value = '';
              form.elements.security_code.value = '';
              return callbacks.onSubmit({
                token: token.id,
                issuer_id: '310',
                payment_method_id: detect(number),
                transaction_amount: init.amount,
                installments: 1,
                payer: { email: values.email, identification: { type: values.doc_type, number: values.doc_number } }
              });
            }).catch(function (err) {
              error.textContent = err && err.message ? err.message : 'No se pudo procesar el pago';
              if (callbacks.onError) callbacks.onError({ type: 'non_critical', message: error.textContent });
            }).finally(function () { button.disabled = false; });
          });
          if (callbacks.onReady) callbacks.onReady();
          resolve({ unmount: function () { container.innerHTML = ''; } });
        });
      }
    };
  };
  window.MercadoPago = MercadoPago;
})();
`;

export async function startMercadoPagoSandbox({
  port = 8090,
  host = '127.0.0.1',
  accessToken = 'TEST-aeronet-sandbox-access-token',
  publicKey = 'TEST-aeronet-sandbox-public-key',
  webhookUrl = '',
  webhookSecret = '',
  autoNotify = false,
  pendingResolveSeconds = 0,
} = {}) {
  const tokens = new Map();
  const payments = new Map();
  const byIdempotencyKey = new Map();
  const refundsByKey = new Map();
  const stats = { createRequests: 0, paymentsCreated: 0, refunds: 0, webhooksSent: 0, tokensCreated: 0, apiCallsWithoutAuth: 0 };
  // Ids únicos entre ejecuciones (como en Mercado Pago): la base exige id de pasarela único.
  let nextPaymentId = Date.now();
  let failNext = null;
  const origin = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };
  const error = (res, status, message, cause) => send(res, status, {
    message, error: status === 404 ? 'not_found' : 'bad_request', status, cause: cause ? [cause] : [],
  });
  const readBody = (req) => new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); } });
  });
  const authorized = (req) => {
    const ok = req.headers.authorization === `Bearer ${accessToken}`;
    if (!ok) stats.apiCallsWithoutAuth += 1;
    return ok;
  };

  async function notify(paymentId, { requestId = crypto.randomUUID(), tamper = false } = {}) {
    if (!webhookUrl) return { status: 0, skipped: true };
    const ts = String(Date.now());
    const signature = signWebhook(webhookSecret || 'sin-secreto', String(paymentId), requestId, ts);
    const url = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}data.id=${paymentId}&type=payment`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${tamper ? signature.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : signature}`,
      },
      body: JSON.stringify({
        action: 'payment.updated', api_version: 'v1', data: { id: String(paymentId) },
        date_created: new Date().toISOString(), id: Date.now(), live_mode: false, type: 'payment', user_id: '123456789',
      }),
    }).catch((err) => ({ status: 0, error: err.message }));
    stats.webhooksSent += 1;
    return { status: response.status, body: response.json ? await response.json().catch(() => ({})) : {} };
  }

  function resolvePayment(payment, status, statusDetail) {
    if (!['pending', 'in_process', 'authorized'].includes(payment.status)) return false;
    payment.status = status;
    payment.status_detail = statusDetail || (status === 'approved' ? 'accredited' : 'cc_rejected_other_reason');
    payment.date_last_updated = new Date().toISOString();
    if (status === 'approved') payment.date_approved = payment.date_last_updated;
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
      });
      return res.end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && url.pathname === '/sdk/js/v2') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(sdkSource(origin));
    }

    if (req.method === 'POST' && url.pathname === '/v1/card_tokens') {
      if (url.searchParams.get('public_key') !== publicKey) return error(res, 401, 'invalid public_key');
      const body = await readBody(req);
      const number = String(body?.card_number || '').replace(/\D/g, '');
      const month = Number(body?.expiration_month);
      const year = Number(body?.expiration_year);
      const holder = String(body?.cardholder?.name || '').trim();
      if (number.length < 13 || number.length > 19 || !luhn(number)) return error(res, 400, 'invalid card_number', { code: 'E301', description: 'invalid card_number' });
      if (!(month >= 1 && month <= 12) || !(year >= new Date().getFullYear())) return error(res, 400, 'invalid expiration date', { code: '325', description: 'invalid expiration_month' });
      if (!/^\d{3,4}$/.test(String(body?.security_code || ''))) return error(res, 400, 'invalid security_code', { code: 'E302', description: 'invalid security_code' });
      if (!holder) return error(res, 400, 'invalid cardholder name', { code: '221', description: 'invalid cardholder.name' });
      const id = crypto.randomBytes(16).toString('hex');
      tokens.set(id, {
        firstSix: number.slice(0, 6), lastFour: number.slice(-4), holder: holder.toUpperCase(),
        used: false, createdAt: Date.now(),
      });
      stats.tokensCreated += 1;
      return send(res, 201, {
        id, first_six_digits: number.slice(0, 6), last_four_digits: number.slice(-4),
        expiration_month: month, expiration_year: year, cardholder: { name: holder }, live_mode: false,
      });
    }

    if (url.pathname.startsWith('/v1/') && !authorized(req)) return error(res, 401, 'invalid access token');

    if (req.method === 'POST' && url.pathname === '/v1/payments') {
      stats.createRequests += 1;
      const key = req.headers['x-idempotency-key'];
      // Se lee el cuerpo antes de consultar la clave: desde acá hasta registrarla no hay await,
      // así dos solicitudes simultáneas con la misma clave no crean dos pagos.
      const body = await readBody(req);
      if (!key) return error(res, 400, 'X-Idempotency-Key header is required');
      if (byIdempotencyKey.has(key)) return send(res, 200, payments.get(byIdempotencyKey.get(key)));
      if (!body) return error(res, 400, 'invalid json');
      const token = tokens.get(body.token);
      if (!token || token.used) return error(res, 400, 'invalid card token', { code: '2006', description: 'Card Token not found' });
      if (!(Number(body.transaction_amount) > 0)) return error(res, 400, 'invalid transaction_amount', { code: '4037', description: 'Invalid transaction_amount' });
      if (!body.payment_method_id) return error(res, 400, 'payment_method_id required', { code: '4020', description: 'payment_method_id required' });
      if (!body.payer?.email) return error(res, 400, 'payer.email required', { code: '4050', description: 'payer.email must be a valid email' });
      token.used = true;
      const [status, statusDetail] = outcomes[token.holder] || outcomes.APRO;
      const now = new Date().toISOString();
      const payment = {
        id: nextPaymentId++, status, status_detail: statusDetail, live_mode: false,
        transaction_amount: Number(body.transaction_amount), currency_id: 'ARS',
        description: body.description || null, external_reference: body.external_reference || null,
        payment_method_id: body.payment_method_id,
        payment_type_id: String(body.payment_method_id).startsWith('deb') ? 'debit_card' : 'credit_card',
        installments: Number(body.installments) || 1, issuer_id: body.issuer_id ?? null,
        statement_descriptor: body.statement_descriptor || null, notification_url: body.notification_url || null,
        payer: { email: body.payer.email, identification: body.payer.identification || null },
        card: { first_six_digits: token.firstSix, last_four_digits: token.lastFour, cardholder: { name: token.holder } },
        date_created: now, date_last_updated: now, date_approved: status === 'approved' ? now : null,
        refunds: [],
      };
      payments.set(String(payment.id), payment);
      byIdempotencyKey.set(key, String(payment.id));
      stats.paymentsCreated += 1;
      if (pendingResolveSeconds > 0 && status === 'in_process') {
        setTimeout(() => { if (resolvePayment(payment, 'approved', 'accredited')) notify(payment.id); }, pendingResolveSeconds * 1000).unref();
      }
      if (autoNotify) setTimeout(() => notify(payment.id), 300).unref();
      if (failNext && failNext.times > 0) {
        failNext.times -= 1;
        // Simula que la pasarela procesó el cobro pero la respuesta se perdió (timeout/5xx).
        return send(res, failNext.status, { message: 'internal_error', error: 'internal_error', status: failNext.status, cause: [] });
      }
      return send(res, 201, payment);
    }

    if (req.method === 'GET' && url.pathname === '/v1/payments/search') {
      const reference = url.searchParams.get('external_reference');
      const results = [...payments.values()]
        .filter((payment) => !reference || payment.external_reference === reference)
        .sort((a, b) => b.id - a.id);
      return send(res, 200, { paging: { total: results.length, limit: 30, offset: 0 }, results });
    }

    const paymentMatch = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (req.method === 'GET' && paymentMatch) {
      const payment = payments.get(paymentMatch[1]);
      return payment ? send(res, 200, payment) : error(res, 404, 'Payment not found');
    }

    const refundMatch = url.pathname.match(/^\/v1\/payments\/(\d+)\/refunds$/);
    if (req.method === 'POST' && refundMatch) {
      const key = req.headers['x-idempotency-key'];
      if (!key) return error(res, 400, 'X-Idempotency-Key header is required');
      if (refundsByKey.has(key)) return send(res, 201, refundsByKey.get(key));
      const payment = payments.get(refundMatch[1]);
      if (!payment) return error(res, 404, 'Payment not found');
      if (payment.status === 'refunded') return error(res, 400, 'Payment already refunded');
      if (payment.status !== 'approved') return error(res, 400, 'Payment must be approved to be refunded');
      const refund = { id: Date.now(), payment_id: payment.id, amount: payment.transaction_amount, status: 'approved', date_created: new Date().toISOString() };
      payment.status = 'refunded';
      payment.status_detail = 'refunded';
      payment.refunds.push(refund);
      refundsByKey.set(key, refund);
      stats.refunds += 1;
      return send(res, 201, refund);
    }

    // ----- Control del sandbox (no existe en Mercado Pago) -----
    if (req.method === 'GET' && url.pathname === '/__sandbox/stats') return send(res, 200, { ...stats, payments: payments.size });
    if (req.method === 'POST' && url.pathname === '/__sandbox/fail-next') {
      const body = await readBody(req);
      failNext = { status: Number(body?.status) || 500, times: Number(body?.times) || 1 };
      return send(res, 200, { armed: failNext });
    }
    const resolveMatch = url.pathname.match(/^\/__sandbox\/payments\/(\d+)\/resolve$/);
    if (req.method === 'POST' && resolveMatch) {
      const payment = payments.get(resolveMatch[1]);
      if (!payment) return error(res, 404, 'Payment not found');
      const body = await readBody(req);
      const changed = resolvePayment(payment, body?.status === 'rejected' ? 'rejected' : 'approved', body?.status_detail);
      const delivery = body?.notify === false ? null : await notify(payment.id);
      return send(res, 200, { changed, payment, webhook: delivery });
    }
    const notifyMatch = url.pathname.match(/^\/__sandbox\/payments\/(\d+)\/notify$/);
    if (req.method === 'POST' && notifyMatch) {
      if (!payments.has(notifyMatch[1])) return error(res, 404, 'Payment not found');
      const body = await readBody(req);
      return send(res, 200, { webhook: await notify(notifyMatch[1], { requestId: body?.requestId, tamper: body?.tamper === true }) });
    }

    return error(res, 404, 'resource not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return {
    origin, stats, payments, tokens,
    notify,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sandbox = await startMercadoPagoSandbox({
    port: Number(process.env.MP_SANDBOX_PORT || 8090),
    accessToken: process.env.MP_SANDBOX_ACCESS_TOKEN || 'TEST-aeronet-sandbox-access-token',
    publicKey: process.env.MP_SANDBOX_PUBLIC_KEY || 'TEST-aeronet-sandbox-public-key',
    webhookUrl: process.env.MP_SANDBOX_WEBHOOK_URL || 'http://localhost:8080/webhooks/payments/mercadopago',
    webhookSecret: process.env.MP_SANDBOX_WEBHOOK_SECRET || '',
    autoNotify: true,
    pendingResolveSeconds: Number(process.env.MP_SANDBOX_PENDING_SECONDS || 20),
  });
  console.log(`Sandbox de Mercado Pago escuchando en ${sandbox.origin}`);
  console.log(`SDK de prueba: ${sandbox.origin}/sdk/js/v2 — los pagos CONT se aprueban solos a los ${process.env.MP_SANDBOX_PENDING_SECONDS || 20} s`);
}
