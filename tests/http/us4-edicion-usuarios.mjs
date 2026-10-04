// US4 — Pruebas HTTP de la edición de usuarios (PUT /admin/users/:id) con las cuentas de desarrollo.
// Usar una instancia aislada: modifica cuentas y las restaura al final. Uso: node tests/http/us4-edicion-usuarios.mjs
import { api, createReport, login, sql, sqlValue } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us4-db';
const report = createReport('US4 — Edición de usuarios');
const passwords = {
  admin: process.env.AERONET_DEV_ADMIN_PASSWORD,
  passenger: process.env.AERONET_DEV_PASAJERO_PASSWORD,
  counter: process.env.AERONET_DEV_MOSTRADOR_PASSWORD,
};

const userId = (email) => Number(sqlValue(container, `SELECT id FROM usuario WHERE email = '${email}';`));
const adminId = userId('admin.dev@aeronet.test');
const passengerId = userId('pasajero.dev@aeronet.test');
const row = (id) => sql(container, `SELECT nombre, apellido, COALESCE(telefono, ''), activo, rol FROM usuario WHERE id = ${id};`)[0].join(' | ');
const original = sql(container, `SELECT nombre, apellido, telefono, activo, rol FROM usuario WHERE id = ${passengerId};`)[0];
const audits = () => sqlValue(container, `SELECT COUNT(*) FROM auditoria WHERE accion = 'user.updated' AND entidad_id = ${passengerId};`);

const [adminToken, passengerToken, counterToken] = await Promise.all([
  login('admin.dev@aeronet.test', passwords.admin),
  login('pasajero.dev@aeronet.test', passwords.passenger),
  login('mostrador.dev@aeronet.test', passwords.counter),
]);
const edit = (id, body, token = adminToken, rawBody) => api(`/admin/users/${id}`, { method: 'PUT', token, body, rawBody });
const describe = ({ status, body }) => `HTTP ${status}${body.error ? ` ${body.error}` : ''}`;

try {
  // Acceso
  const before = row(passengerId);
  let response = await edit(passengerId, { firstName: 'Intruso' }, null);
  report.check('E01', 'Sin sesión', response.status === 401, describe(response));
  response = await edit(passengerId, { firstName: 'Intruso' }, passengerToken);
  report.check('E02', 'PASAJERO sin user:edit', response.status === 403, describe(response));
  response = await edit(passengerId, { firstName: 'Intruso' }, counterToken);
  report.check('E03', 'MOSTRADOR sin user:edit', response.status === 403, describe(response));
  report.check('E04', 'Las denegaciones no modifican la cuenta', row(passengerId) === before, row(passengerId));

  // Ediciones válidas
  const auditsBefore = Number(audits());
  response = await edit(passengerId, { firstName: ' Paula ', lastName: 'Prueba', phone: '+54 11 5555-0000' });
  report.check('E05', 'Editar nombre, apellido y teléfono', response.status === 200
    && row(passengerId).startsWith('Paula | Prueba | +54 11 5555-0000 | 1 | PASAJERO'), `${describe(response)} · ${row(passengerId)}`);
  report.check('E06', 'La edición queda auditada', Number(audits()) === auditsBefore + 1, `${audits()} filas`);

  response = await edit(passengerId, { active: false });
  const disabledLogin = await api('/auth/login', { method: 'POST', body: { email: 'pasajero.dev@aeronet.test', password: passwords.passenger } });
  report.check('E07', 'Deshabilitar la cuenta impide iniciar sesión', response.status === 200
    && row(passengerId).includes('| 0 |') && disabledLogin.status === 401, `${describe(response)} · login HTTP ${disabledLogin.status}`);

  response = await edit(passengerId, { active: true });
  const enabledLogin = await api('/auth/login', { method: 'POST', body: { email: 'pasajero.dev@aeronet.test', password: passwords.passenger } });
  report.check('E08', 'Rehabilitar la cuenta permite iniciar sesión', response.status === 200 && enabledLogin.status === 200,
    `${describe(response)} · login HTTP ${enabledLogin.status}`);

  response = await edit(passengerId, { role: 'mostrador' });
  const asCounter = await login('pasajero.dev@aeronet.test', passwords.passenger);
  const counterView = await api('/employee/reports', { token: asCounter });
  report.check('E09', 'Cambiar el rol aplica los permisos del nuevo rol', response.status === 200
    && row(passengerId).endsWith('MOSTRADOR') && counterView.status === 200,
  `${describe(response)} · /employee/reports HTTP ${counterView.status}`);
  response = await edit(passengerId, { role: 'PASAJERO' });
  report.check('E10', 'Volver al rol PASAJERO', response.status === 200 && row(passengerId).endsWith('PASAJERO'), describe(response));

  response = await edit(passengerId, {});
  report.check('E11', 'Cuerpo sin cambios', response.status === 200, describe(response));
  response = await edit(passengerId, { phone: null, firstName: 'Paula' });
  report.check('E12', 'Un campo null no se modifica', response.status === 200
    && row(passengerId).includes('+54 11 5555-0000'), `${describe(response)} · ${row(passengerId)}`);

  // Datos inválidos
  const beforeInvalid = row(passengerId);
  const invalid = [
    ['E13', 'Rol inexistente', { role: 'SUPERADMIN' }, 'El rol indicado no es válido'],
    ['E14', 'Nombre vacío', { firstName: '   ' }, 'Revisá nombre, apellido y teléfono'],
    ['E15', 'Teléfono de más de 30 caracteres', { phone: '1'.repeat(31) }, 'Revisá nombre, apellido y teléfono'],
    ['E16', 'active no booleano', { active: 'no' }, 'El cuerpo de la solicitud no es válido'],
    ['E17', 'firstName no textual', { firstName: 42 }, 'El cuerpo de la solicitud no es válido'],
  ];
  for (const [id, description, body, message] of invalid) {
    response = await edit(passengerId, body);
    report.check(id, description, response.status === 400 && response.body.error === message, describe(response));
  }
  response = await edit(passengerId, undefined, adminToken, '{"firstName":');
  report.check('E18', 'JSON mal formado', response.status === 400, describe(response));
  report.check('E19', 'Los rechazos no modifican la cuenta', row(passengerId) === beforeInvalid, row(passengerId));

  // Reglas sobre la propia cuenta y el destino
  response = await edit(adminId, { active: false });
  report.check('E20', 'El admin no puede deshabilitarse', response.status === 400 && row(adminId).includes('| 1 | ADMIN'), describe(response));
  response = await edit(adminId, { role: 'PASAJERO' });
  report.check('E21', 'El admin no puede quitarse el rol ADMIN', response.status === 400 && row(adminId).endsWith('ADMIN'), describe(response));
  response = await edit(999999999, { firstName: 'Nadie' });
  report.check('E22', 'Usuario inexistente', response.status === 404, describe(response));
  response = await edit('abc', { firstName: 'Nadie' });
  report.check('E23', 'Id no numérico', response.status === 400, describe(response));
} finally {
  // Deja la cuenta de pasajero como estaba, aunque alguna comprobación haya fallado a mitad.
  const [nombre, apellido, telefono, activo, rol] = original;
  const quote = (value) => (value === 'NULL' ? 'NULL' : `'${value.replaceAll("'", "''")}'`);
  sql(container, `UPDATE usuario SET nombre = ${quote(nombre)}, apellido = ${quote(apellido)}, telefono = ${quote(telefono)},
    activo = ${activo}, rol = '${rol}' WHERE id = ${passengerId};`);
}

report.finish();
