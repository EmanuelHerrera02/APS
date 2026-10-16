import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(process.argv[2] ?? join(tmpdir(), 'aeronet-us10-template-check'));
const examples = {
  'pasaje.html': {
    ticket_code: 'TK-DEMO-001', purchase_code: 'AB12CD', passenger_name: 'Ana Ejemplo',
    document_type: 'DNI', document_number: '12345678', travel_class: 'Economy',
    origin: 'Buenos Aires', destination: 'Córdoba', flight_code: 'AR-DEMO-01',
    travel_date: '20/11/2026', departure_time: '09:30', arrival_time: '11:00', issued_at: '16/10/2026 12:00'
  },
  'factura.html': {
    issuer_name: 'Aeronet Demo S.A.', issuer_tax_id: 'CUIT 30-12345678-9', invoice_type: 'B',
    invoice_number: 'B-0001-00000042', invoice_date: '16/10/2026', recipient_name: 'Ana Ejemplo',
    recipient_tax_id: 'No informado', purchase_code: 'AB12CD', payment_method: 'Tarjeta',
    description: 'Pasaje Buenos Aires – Córdoba', travel_date: '20/11/2026', travel_class: 'Economy',
    line_total: 'ARS 45.000,00', currency: 'ARS', invoice_total: '45.000,00'
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

await mkdir(output, { recursive: true });
for (const [name, data] of Object.entries(examples)) {
  const template = await readFile(join(here, 'templates', name), 'utf8');
  const rendered = template.replace(/{{([a-z_]+)}}/g, (_, key) => {
    if (!(key in data)) throw new Error(`${name}: falta el dato ${key}`);
    return escapeHtml(data[key]);
  });
  if (/{{[^}]+}}/.test(rendered)) throw new Error(`${name}: quedaron placeholders sin resolver`);
  if (!rendered.includes('Ana Ejemplo') || !rendered.includes('AB12CD')) {
    throw new Error(`${name}: faltan los datos de control de la compra ficticia`);
  }
  await writeFile(join(output, name), rendered, 'utf8');
  console.log(`OK ${name}: ${join(output, name)}`);
}
console.log('Renderizado de ejemplo correcto; solo se usaron datos ficticios.');
