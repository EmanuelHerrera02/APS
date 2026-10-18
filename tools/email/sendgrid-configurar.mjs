// Configura SendGrid para AeroNet (US10) mediante su API v3. Node 18+, sin dependencias.
//
//   dominio  Crea (o reutiliza) la autenticación del dominio con DKIM y return-path
//            automáticos e imprime los registros DNS a publicar, más el DMARC sugerido.
//   validar  Pide a SendGrid que valide los registros publicados.
//   webhook  Activa el Event Webhook (delivered, bounce, dropped) firmado e imprime la
//            clave pública para AERONET_SENDGRID_WEBHOOK_PUBLIC_KEY.
//
//   $env:SENDGRID_API_KEY = "<key administrativa: Sender Authentication y Event Webhook>"
//   node tools/email/sendgrid-configurar.mjs dominio --dominio aeronet.com.ar [--subdominio em] [--rua dmarc@aeronet.com.ar]
//   node tools/email/sendgrid-configurar.mjs validar --dominio aeronet.com.ar
//   node tools/email/sendgrid-configurar.mjs webhook --url https://api.aeronet.com.ar/webhooks/email/sendgrid/
//
// --dry-run muestra las solicitudes sin enviarlas. La API key nunca se imprime.
const [command, ...args] = process.argv.slice(2);
const option = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const dryRun = args.includes('--dry-run');
const apiUrl = (process.env.SENDGRID_API_URL || 'https://api.sendgrid.com').replace(/\/$/, '');
const apiKey = process.env.SENDGRID_API_KEY || process.env.AERONET_SENDGRID_API_KEY || '';

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sendgrid(method, path, body) {
  if (dryRun) {
    console.log(`[dry-run] ${method} ${apiUrl}${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
    return null;
  }
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const detail = parsed.errors?.map((error) => error.message).join('; ') || text;
    fail(`SendGrid respondió HTTP ${response.status} a ${method} ${path}: ${detail}`);
  }
  return parsed;
}

const printRecords = (authenticated) => {
  const records = Object.entries(authenticated.dns || {}).map(([name, record]) => ({ name, ...record }));
  console.log(`\nAutenticación de dominio #${authenticated.id} para ${authenticated.domain} (válida: ${authenticated.valid ? 'sí' : 'no'})`);
  console.log('Publicá estos registros en el DNS del dominio:\n');
  for (const record of records) {
    console.log(`  ${String(record.type).toUpperCase().padEnd(6)} ${record.host}\n         → ${record.data}${record.valid ? '   (ya validado)' : ''}`);
  }
};

const dmarcRecord = (domain) => `v=DMARC1; p=none; rua=mailto:${option('rua', `dmarc@${domain}`)}; adkim=r; aspf=r; fo=1`;

if (!['dominio', 'validar', 'webhook'].includes(command)) {
  fail('Uso: node tools/email/sendgrid-configurar.mjs <dominio|validar|webhook> [opciones] [--dry-run]');
}
if (!apiKey && !dryRun) fail('Definí SENDGRID_API_KEY (o AERONET_SENDGRID_API_KEY) en la sesión; no la guardes en el repositorio.');

if (command === 'dominio' || command === 'validar') {
  const domain = option('dominio').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) fail('Indicá --dominio <dominio del remitente>.');
  const existing = await sendgrid('GET', `/v3/whitelabel/domains?domain=${encodeURIComponent(domain)}&limit=50`);
  let authenticated = Array.isArray(existing) ? existing.find((item) => item.domain === domain) : null;

  if (command === 'dominio') {
    if (!authenticated) {
      authenticated = await sendgrid('POST', '/v3/whitelabel/domains', {
        domain, subdomain: option('subdominio', 'em'), automatic_security: true, custom_spf: false, default: true,
      });
    }
    if (authenticated) {
      printRecords(authenticated);
      console.log(`  TXT    _dmarc.${domain}\n         → ${dmarcRecord(domain)}`);
      console.log('\nCon "automatic_security", SendGrid publica SPF y DKIM detrás de los CNAME: no agregues otro SPF.');
      console.log('Si el dominio ya tiene un TXT _dmarc, conservá ese único registro y sumale el rua.');
      console.log(`Después: node tools/email/sendgrid-configurar.mjs validar --dominio ${domain}`);
      console.log(`         node tools/email/verificar-dns-correo.mjs --dominio ${domain} --proveedor sendgrid --return-path ${authenticated.subdomain || 'em'}`);
    }
  } else {
    if (!authenticated && !dryRun) fail(`No hay autenticación de dominio para ${domain}: ejecutá primero el comando "dominio".`);
    const validation = await sendgrid('POST', `/v3/whitelabel/domains/${authenticated?.id ?? '<id>'}/validate`);
    if (validation) {
      console.log(`\nValidación de ${domain}: ${validation.valid ? 'VÁLIDA' : 'PENDIENTE'}`);
      for (const [name, result] of Object.entries(validation.validation_results || {})) {
        console.log(`  ${result.valid ? 'PASA ' : 'FALLA'}  ${name}${result.reason ? ` — ${result.reason}` : ''}`);
      }
      process.exitCode = validation.valid ? 0 : 1;
    }
  }
}

if (command === 'webhook') {
  const url = option('url');
  if (!/^https:\/\/[^\s]+\/webhooks\/email\/sendgrid\/$/.test(url)) {
    fail('Indicá --url https://<api pública>/webhooks/email/sendgrid/ (HTTPS y con la barra final).');
  }
  await sendgrid('PATCH', '/v3/user/webhooks/event/settings', {
    enabled: true, url,
    delivered: true, bounce: true, dropped: true,
    deferred: false, processed: false, open: false, click: false, spam_report: false,
    unsubscribe: false, group_unsubscribe: false, group_resubscribe: false,
  });
  const signed = await sendgrid('PATCH', '/v3/user/webhooks/event/settings/signed', { enabled: true });
  console.log(`\nEvent Webhook activo hacia ${url} (delivered, bounce, dropped) con firma ECDSA.`);
  if (signed?.public_key) {
    console.log('Configurá en el backend (gestor de secretos o .env local):');
    console.log(`AERONET_SENDGRID_WEBHOOK_PUBLIC_KEY=${signed.public_key}`);
  }
}
