// Verifica la autenticación DNS del dominio remitente de AeroNet (US10): SPF, DKIM y DMARC.
// Node 18+, sin dependencias. Consulta el DNS público, no modifica nada.
//
//   node tools/email/verificar-dns-correo.mjs --dominio aeronet.com.ar --proveedor sendgrid --return-path em1234
//   node tools/email/verificar-dns-correo.mjs --dominio aeronet.com.ar --selectores google --spf-include _spf.google.com
//
// Opciones:
//   --dominio <d>        dominio del remitente (por defecto, el de AERONET_SMTP_FROM)
//   --proveedor <p>      sendgrid | smtp (por defecto AERONET_EMAIL_PROVIDER o smtp)
//   --selectores <a,b>   selectores DKIM (sendgrid: s1,s2)
//   --return-path <sub>  subdominio de rebote de SendGrid (p. ej. em1234), verifica su CNAME
//   --spf-include <inc>  mecanismo que el SPF debe incluir (sendgrid sin return-path: sendgrid.net)
//   --dns <ip>           servidor DNS a usar (p. ej. 8.8.8.8)
// Sale con código 1 si algún control falla.
import dns from 'node:dns/promises';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};

const fromAddress = process.env.AERONET_SMTP_FROM || '';
const fromDomain = fromAddress.includes('@') ? fromAddress.split('@').pop().replace(/>$/, '').trim().toLowerCase() : '';
const domain = (option('dominio', fromDomain) || '').toLowerCase().replace(/\.$/, '');
const provider = (option('proveedor', process.env.AERONET_EMAIL_PROVIDER || 'smtp') || 'smtp').toLowerCase();
const selectors = (option('selectores', provider === 'sendgrid' ? 's1,s2' : '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const returnPath = option('return-path', '');
const spfInclude = option('spf-include', provider === 'sendgrid' && !returnPath ? 'sendgrid.net' : '');
const resolverIp = option('dns', '');

if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
  console.error('Indicá el dominio con --dominio <dominio> o definí AERONET_SMTP_FROM.');
  process.exit(2);
}
if (resolverIp) dns.setServers([resolverIp]);

const results = [];
const report = (state, id, description, detail = '') => {
  results.push(state);
  console.log(`${state.padEnd(5)}  ${id.padEnd(8)} ${description}${detail ? ` — ${detail}` : ''}`);
};
const txt = async (name) => {
  try { return (await dns.resolveTxt(name)).map((chunks) => chunks.join('')); }
  catch (error) { if (['ENODATA', 'ENOTFOUND'].includes(error.code)) return []; throw error; }
};
const cname = async (name) => {
  try { return await dns.resolveCname(name); }
  catch (error) { if (['ENODATA', 'ENOTFOUND'].includes(error.code)) return []; throw error; }
};
const tags = (record) => Object.fromEntries(record.split(';').map((part) => part.trim()).filter(Boolean)
  .map((part) => { const [key, ...value] = part.split('='); return [key.trim().toLowerCase(), value.join('=').trim()]; }));

console.log(`\nAutenticación de correo para ${domain} (proveedor: ${provider})\n${'='.repeat(48 + domain.length)}`);

// SPF: un único registro v=spf1 en el dominio; con SendGrid y return-path propio, el SPF
// se evalúa sobre el subdominio de rebote (CNAME a sendgrid.net).
const spf = (await txt(domain)).filter((record) => /^v=spf1(\s|$)/i.test(record));
if (spf.length === 0) {
  report(returnPath ? 'AVISO' : 'FALLA', 'SPF', 'No hay registro SPF en el dominio', returnPath ? 'SendGrid valida SPF en el return-path' : 'publicá un TXT v=spf1 … ~all');
} else if (spf.length > 1) {
  report('FALLA', 'SPF', 'Hay más de un registro SPF (resultado permerror)', 'combinarlos en un único TXT');
} else {
  const record = spf[0];
  const lookups = (record.match(/\b(include:|a\b|a:|mx\b|mx:|ptr|exists:|redirect=)/gi) || []).length;
  report('PASA', 'SPF', 'Registro SPF único', record);
  if (spfInclude) report(record.toLowerCase().includes(spfInclude.toLowerCase()) ? 'PASA' : 'FALLA', 'SPF-INC', `El SPF autoriza ${spfInclude}`);
  if (!/[~-]all\b/i.test(record)) report('AVISO', 'SPF-ALL', 'El SPF no termina en ~all o -all');
  if (lookups > 10) report('FALLA', 'SPF-DNS', 'El SPF supera 10 consultas DNS', `${lookups} mecanismos`);
}

if (returnPath) {
  const host = returnPath.includes('.') ? returnPath : `${returnPath}.${domain}`;
  const target = await cname(host);
  report(target.some((value) => /sendgrid\.net$/i.test(value)) ? 'PASA' : 'FALLA', 'RETURN', `Return-path ${host} apunta a SendGrid`, target.join(', ') || 'sin CNAME');
}

// DKIM: cada selector debe publicar la clave (TXT v=DKIM1/p=) o un CNAME al proveedor.
if (selectors.length === 0) {
  report('AVISO', 'DKIM', 'No se indicaron selectores DKIM', 'usá --selectores con los que informa el proveedor');
}
for (const selector of selectors) {
  const host = `${selector}._domainkey.${domain}`;
  const target = await cname(host);
  if (target.length) {
    const resolved = await txt(target[0]);
    const hasKey = resolved.some((record) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(record));
    report(hasKey || /sendgrid\.net$/i.test(target[0]) ? 'PASA' : 'FALLA', 'DKIM', `Selector ${selector}`, `CNAME → ${target[0]}${hasKey ? ' (clave publicada)' : ''}`);
  } else {
    const keys = (await txt(host)).filter((record) => /v=DKIM1|(^|;)\s*p=/i.test(record));
    const valid = keys.some((record) => /(^|;)\s*p=[A-Za-z0-9+/=]{20,}/.test(record));
    report(valid ? 'PASA' : 'FALLA', 'DKIM', `Selector ${selector}`, valid ? 'clave TXT publicada' : 'sin clave DKIM');
  }
}

// DMARC: un único TXT v=DMARC1 en _dmarc.<dominio>.
const dmarc = (await txt(`_dmarc.${domain}`)).filter((record) => /^v=DMARC1/i.test(record));
if (dmarc.length !== 1) {
  report('FALLA', 'DMARC', dmarc.length ? 'Hay más de un registro DMARC' : 'No hay registro DMARC',
    `publicá TXT _dmarc.${domain} "v=DMARC1; p=none; rua=mailto:dmarc@${domain}"`);
} else {
  const policy = tags(dmarc[0]);
  report(['none', 'quarantine', 'reject'].includes(policy.p) ? 'PASA' : 'FALLA', 'DMARC', `Política p=${policy.p || '(falta)'}`, dmarc[0]);
  if (policy.p === 'none') report('AVISO', 'DMARC-P', 'Política en monitoreo (p=none)', 'pasar a quarantine/reject tras revisar los reportes');
  if (!policy.rua) report('AVISO', 'DMARC-R', 'Sin rua: no se recibirán reportes agregados');
}

// Alineación: el remitente configurado debe pertenecer al dominio autenticado.
if (fromDomain) {
  const aligned = fromDomain === domain || fromDomain.endsWith(`.${domain}`);
  report(aligned ? 'PASA' : 'FALLA', 'ALINEA', `AERONET_SMTP_FROM (${fromAddress}) está alineado con ${domain}`);
}

const failures = results.filter((state) => state === 'FALLA').length;
console.log(`\n${results.length - failures}/${results.length} controles sin fallas${failures ? '' : ' — el dominio está listo para enviar'}.`);
process.exitCode = failures ? 1 : 0;
