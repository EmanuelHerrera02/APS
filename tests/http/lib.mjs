// Utilidades compartidas por las pruebas HTTP (Node 18 o posterior, sin dependencias).
import { spawnSync } from 'node:child_process';

export const apiUrl = process.env.AERONET_API_URL || 'http://localhost:8080';

// Ejecuta SQL como root dentro del contenedor de MariaDB y devuelve las filas como arrays de texto.
export function sql(container, query) {
  const result = spawnSync('docker', ['exec', '-i', container, 'sh', '-c',
    'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -B aeronet'], { input: query, encoding: 'utf8' });
  if (result.error) throw new Error(`No se pudo ejecutar docker: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Falló la consulta SQL en ${container}: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split('\t'));
}

export const sqlValue = (container, query) => sql(container, query)[0]?.[0];

export async function api(path, { method = 'GET', token, body, rawBody } = {}) {
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: payload,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

export async function login(email, password) {
  if (!password) throw new Error(`Falta la contraseña de ${email} en las variables de entorno`);
  const { status, body } = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200 || !body.accessToken) throw new Error(`No se pudo iniciar sesión con ${email}: HTTP ${status} ${body.error || ''}`);
  return body.accessToken;
}

// Fecha de hoy en Argentina como AAAA-MM-DD (la misma zona que usa el backend).
export function argentinaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 1 = lunes … 7 = domingo, igual que vuelo_dia_operacion.dia_semana.
export function isoWeekday(isoDate) {
  return ((new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function createReport(title) {
  const results = [];
  console.log(`\n${title}\n${'='.repeat(title.length)}`);
  return {
    check(id, description, passed, detail = '') {
      results.push({ id, passed });
      console.log(`${passed ? 'PASA ' : 'FALLA'}  ${id.padEnd(5)} ${description}${detail ? ` — ${detail}` : ''}`);
    },
    finish() {
      const failed = results.filter((result) => !result.passed).length;
      console.log(`\n${results.length - failed}/${results.length} comprobaciones aprobadas.`);
      process.exitCode = failed === 0 ? 0 : 1;
    },
  };
}
