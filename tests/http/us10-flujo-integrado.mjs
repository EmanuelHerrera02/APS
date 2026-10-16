// US10 — Flujo integrado con SMTP falso y base aislada.
// Requiere API AeroNet en http://localhost:8080, configurada para SMTP falso en 127.0.0.1:2525.
// Uso: node tests/http/us10-flujo-integrado.mjs
import net from 'node:net';
import { api, createReport, sql } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US10 — Emisión, correo y descarga');
const messages = [];
let rejectOneRecipient = true;

const smtp = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 aeronet-test ESMTP\r\n');
  let buffer = '';
  let dataMode = false;
  let message = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 2);
      if (dataMode) {
        if (line === '.') {
          dataMode = false;
          messages.push(message);
          message = '';
          socket.write('250 2.0.0 queued\r\n');
        } else message += `${line}\r\n`;
      } else if (/^EHLO\b|^HELO\b/i.test(line)) socket.write('250-aeronet-test\r\n250 SIZE 10000000\r\n');
      else if (/^MAIL FROM:/i.test(line)) socket.write('250 2.1.0 sender ok\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        const recipient = line.match(/<([^>]+)>/)?.[1]?.toLowerCase() || '';
        if (recipient.startsWith('bounce-')) socket.write('550 5.1.1 mailbox unavailable\r\n');
        else if (rejectOneRecipient) {
          rejectOneRecipient = false;
          socket.write('450 4.2.0 temporary test failure\r\n');
        } else socket.write('250 2.1.5 recipient ok\r\n');
      } else if (/^DATA$/i.test(line)) { dataMode = true; socket.write('354 end with <CRLF>.<CRLF>\r\n'); }
      else if (/^RSET$/i.test(line)) socket.write('250 reset\r\n');
      else if (/^QUIT$/i.test(line)) { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
});

const unique = Date.now();
const credentials = (label) => ({
  email: label === 'bounce' ? `bounce-${unique}@aeronet.test` : `us10-${label}-${unique}@aeronet.test`,
  password: `US10-test-${unique}-Password`,
  firstName: 'Prueba', lastName: `US10 ${label}`, phone: '+54 11 5555-0101',
});

async function register(label) {
  const account = credentials(label);
  const result = await api('/auth/register', { method: 'POST', body: account });
  if (result.status !== 201 || !result.body.accessToken) throw new Error(`Registro ${label}: HTTP ${result.status}`);
  return { ...account, token: result.body.accessToken };
}

function payment(purchaseId, state) {
  const row = sql(container, `SELECT total FROM compra WHERE id=${Number(purchaseId)};`)[0];
  if (!row) throw new Error(`No existe la compra ${purchaseId}`);
  return sql(container, `CALL registrar_pago(${Number(purchaseId)}, ${row[0]}, 'EFECTIVO', '${state}', NULL, NULL, NULL, @us10_pago, @us10_resultado); SELECT @us10_resultado;`)[0]?.[0];
}

async function reserve(user, departureId, fareClass, suffix) {
  const response = await api('/passenger/reservations', {
    method: 'POST', token: user.token,
    body: { departureId: Number(departureId), emailContact: user.email, passengers: [{
      firstName: 'Pasajero', lastName: 'Integrado', documentType: 'DNI',
      documentNumber: `U${unique}${suffix}`, class: fareClass,
    }] },
  });
  if (response.status !== 201) throw new Error(`Crear compra: HTTP ${response.status} ${response.body.error || ''}`);
  return response.body.reservation;
}

async function waitFor(check, timeoutMs = 90000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

try {
  await new Promise((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(2525, '127.0.0.1', resolve);
  });

  const owner = await register('owner');
  const other = await register('other');
  const bounceUser = await register('bounce');
  const [candidate] = sql(container, `SELECT salida_id, clase, origen, destino, fecha
    FROM v_disponibilidad WHERE asientos_disponibles>0 AND fecha>=CURDATE()
      AND TIMESTAMP(fecha,hora_partida)>NOW() ORDER BY fecha,hora_partida LIMIT 1;`);
  if (!candidate) throw new Error('No hay salidas futuras disponibles en la base aislada');
  const [departureId, fareClass, origin, destination, date] = candidate;

  const pending = await reserve(other, departureId, fareClass, 'P');
  const pendingDownload = await fetch(`http://localhost:8080/passenger/reservations/${pending.reservationId}/documents/invoice`, {
    headers: { Authorization: `Bearer ${other.token}` },
  });
  report.check('U10-01', 'Una compra pendiente no expone factura', pendingDownload.status === 404, `HTTP ${pendingDownload.status}`);

  const search = await api(`/passenger/search?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&dateFrom=${date}`);
  report.check('U10-02', 'Búsqueda pública encuentra la salida de prueba', search.status === 200
    && search.body.results?.some((row) => String(row.departureId) === departureId), `HTTP ${search.status}`);

  const purchase = await reserve(owner, departureId, fareClass, 'A');
  payment(purchase.reservationId, 'APROBADO');
  const emailRow = await waitFor(() => {
    const rows = sql(container, `SELECT id, estado, intentos, TIMESTAMPDIFF(SECOND, created_at, enviada_en)
      FROM notificacion WHERE compra_id=${Number(purchase.reservationId)} AND canal='EMAIL' ORDER BY id DESC LIMIT 1;`);
    return rows[0]?.[1] === 'ENVIADA' ? rows[0] : null;
  });
  report.check('U10-03', 'Pago aprobado genera factura, pasajes y email tras reintento temporal', Boolean(emailRow)
    && Number(emailRow?.[2]) === 2, emailRow ? `estado=${emailRow[1]}, intentos=${emailRow[2]}, latencia=${emailRow[3]}s` : 'no aceptado en 90s');

  const listing = await api('/passenger/reservations', { token: owner.token });
  const owned = listing.body.reservations?.find((row) => row.id === purchase.reservationId);
  report.check('U10-04', 'La lista autenticada refleja documentos emitidos', listing.status === 200
    && owned?.status === 'CONFIRMADA' && owned.invoiceAvailable && owned.tickets?.some((ticket) => ticket.available), `HTTP ${listing.status}`);

  await new Promise((resolve) => setTimeout(resolve, 12000));
  const documentCounts = sql(container, `SELECT
      (SELECT COUNT(*) FROM factura WHERE compra_id=${Number(purchase.reservationId)}) AS invoices,
      (SELECT COUNT(*) FROM pasaje WHERE compra_id=${Number(purchase.reservationId)} AND estado='EMITIDO' AND ruta_pdf IS NOT NULL) AS tickets;`)[0] || [];
  report.check('U10-05', 'Repetir ciclos de generación no duplica documentos', Number(documentCounts[0]) === 1
    && Number(documentCounts[1]) === 1, `facturas=${documentCounts[0]}, pasajes PDF=${documentCounts[1]}`);

  const invoiceUrl = `/passenger/reservations/${purchase.reservationId}/documents/invoice`;
  const ticketId = owned?.tickets?.find((ticket) => ticket.available)?.id;
  const invoice = await fetch(`http://localhost:8080${invoiceUrl}`, { headers: { Authorization: `Bearer ${owner.token}` } });
  const invoiceBytes = Buffer.from(await invoice.arrayBuffer());
  report.check('U10-06', 'Propietario descarga PDF de factura', invoice.status === 200
    && invoice.headers.get('content-type')?.includes('application/pdf') && invoiceBytes.subarray(0, 4).toString() === '%PDF', `HTTP ${invoice.status}`);

  const foreignInvoice = await fetch(`http://localhost:8080${invoiceUrl}`, { headers: { Authorization: `Bearer ${other.token}` } });
  report.check('U10-07', 'Otro usuario no puede descargar la factura', foreignInvoice.status === 404, `HTTP ${foreignInvoice.status}`);

  const ticket = ticketId ? await fetch(`http://localhost:8080/passenger/reservations/${purchase.reservationId}/documents/tickets/${ticketId}`, {
    headers: { Authorization: `Bearer ${owner.token}` },
  }) : null;
  const ticketBytes = ticket ? Buffer.from(await ticket.arrayBuffer()) : Buffer.alloc(0);
  report.check('U10-08', 'Propietario descarga PDF de pasaje', ticket?.status === 200 && ticketBytes.subarray(0, 4).toString() === '%PDF', `HTTP ${ticket?.status ?? 'sin pasaje'}`);

  const emailData = sql(container, `SELECT estado, intentos FROM notificacion WHERE id=${Number(emailRow?.[0] || 0)};`)[0] || [];
  report.check('U10-09', 'SMTP falso recibió mensaje con ambos adjuntos', messages.some((message) =>
    message.toLowerCase().includes(owner.email.toLowerCase()) && /factura-\d+\.pdf/i.test(message) && /pasaje-\d+\.pdf/i.test(message)),
  `estado DB=${emailData[0] || 'sin registro'}`);

  const bouncePurchase = await reserve(bounceUser, departureId, fareClass, 'B');
  payment(bouncePurchase.reservationId, 'APROBADO');
  const bounced = await waitFor(() => {
    const rows = sql(container, `SELECT estado FROM notificacion WHERE compra_id=${Number(bouncePurchase.reservationId)} AND canal='EMAIL' ORDER BY id DESC LIMIT 1;`);
    return rows[0]?.[0] === 'REBOTADA' ? rows[0] : null;
  }, 45000);
  report.check('U10-10', 'Rechazo SMTP permanente queda como rebotado', Boolean(bounced), bounced?.[0] || 'no rebotó en 45s');

  const rejectedPurchase = await reserve(owner, departureId, fareClass, 'R');
  const rejection = payment(rejectedPurchase.reservationId, 'RECHAZADO');
  const rejectedDocs = Number(sql(container, `SELECT COUNT(*) FROM factura WHERE compra_id=${Number(rejectedPurchase.reservationId)};`)[0][0]);
  report.check('U10-11', 'Pago rechazado no emite factura', rejection === 'CANCELADA' && rejectedDocs === 0,
    `resultado=${rejection}, facturas=${rejectedDocs}`);

  const originalPath = sql(container, `SELECT ruta_pdf FROM factura WHERE compra_id=${Number(purchase.reservationId)};`)[0]?.[0];
  if (originalPath) {
    sql(container, `UPDATE factura SET ruta_pdf='../../escape.pdf' WHERE compra_id=${Number(purchase.reservationId)};`);
    const traversal = await fetch(`http://localhost:8080${invoiceUrl}`, { headers: { Authorization: `Bearer ${owner.token}` } });
    sql(container, `UPDATE factura SET ruta_pdf='${originalPath}' WHERE compra_id=${Number(purchase.reservationId)};`);
    report.check('U10-12', 'Ruta de PDF fuera del almacenamiento queda bloqueada', traversal.status === 404, `HTTP ${traversal.status}`);
  } else report.check('U10-12', 'Ruta de PDF fuera del almacenamiento queda bloqueada', false, 'no se encontró ruta para probar');

  const latency = Number(emailRow?.[3]);
  report.check('U10-13', 'Aceptación SMTP ocurre antes de dos minutos', Number.isFinite(latency) && latency < 120, `${latency}s`);
  report.finish();
} finally {
  smtp.close();
}
