// US16 — Alta, edición, roles, baja de sesión y auditoría de cuentas internas.
// Requiere API y base aislada. Uso: node tests/http/us16-cuentas-internas.mjs
import { api, createReport, login, sql, sqlValue } from './lib.mjs';

const container = process.env.AERONET_TEST_DB_CONTAINER || 'aeronet-us8-http-db';
const report = createReport('US16 — Cuentas de usuarios internos');
const adminEmail = process.env.AERONET_DEV_ADMIN_EMAIL || 'admin.dev@aeronet.test';
const adminToken = await login(adminEmail, process.env.AERONET_DEV_ADMIN_PASSWORD);
const adminId = Number(sqlValue(container, `SELECT id FROM usuario WHERE email='${adminEmail.replaceAll("'", "''")}';`));
const unique = Date.now();
const originalPassword = `US16-start-${unique}-Pass`;
const changedPassword = `US16-changed-${unique}-Pass`;
let internalEmail = `us16-counter-${unique}@aeronet.test`;
const editedEmail = `us16-admin-${unique}@aeronet.test`;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const create = await api('/admin/users', { method: 'POST', token: adminToken, body: {
  email: internalEmail, password: originalPassword, firstName: 'Mostrador', lastName: 'US16',
  phone: '+54 11 5555-1616', role: 'MOSTRADOR',
} });
if (create.status !== 201) throw new Error(`Alta de cuenta interna: HTTP ${create.status} ${create.body.error || ''}`);
const createdId = Number(create.body.userId);
const initialAudits = Number(sqlValue(container, `SELECT COUNT(*) FROM auditoria WHERE actor_usuario_id=${adminId}
  AND entidad='usuario' AND entidad_id=${createdId} AND accion='user.created';`));
report.check('US16-01', 'Crear empleado de mostrador y auditar el alta', createdId > 0 && initialAudits === 1,
  `HTTP ${create.status}, auditoría=${initialAudits}`);

let employeeLogin = await api('/auth/login', { method: 'POST', body: { email: internalEmail, password: originalPassword } });
report.check('US16-02', 'La cuenta nueva puede iniciar sesión', employeeLogin.status === 200 && Boolean(employeeLogin.body.accessToken),
  `HTTP ${employeeLogin.status}`);
const currentId = createdId;
const change = await api(`/admin/users/${createdId}`, { method: 'PUT', token: adminToken, body: {
  email: editedEmail, password: changedPassword, firstName: 'Admin', lastName: 'US16 editado',
  phone: '+54 11 5555-1717', role: 'ADMIN',
} });
internalEmail = editedEmail;
report.check('US16-03', 'Editar datos, email, contraseña y perfil interno', change.status === 200
  && sqlValue(container, `SELECT CONCAT(nombre,'|',apellido,'|',telefono,'|',rol) FROM usuario WHERE id=${currentId};`)
    === 'Admin|US16 editado|+54 11 5555-1717|ADMIN', `HTTP ${change.status} ${change.body.error || ''}`);

const oldLogin = await api('/auth/login', { method: 'POST', body: { email: internalEmail, password: originalPassword } });
const newLogin = await api('/auth/login', { method: 'POST', body: { email: internalEmail, password: changedPassword } });
report.check('US16-04', 'Aplicar la nueva contraseña y dejar de aceptar la anterior', oldLogin.status === 401
  && newLogin.status === 200 && Boolean(newLogin.body.accessToken), `anterior=${oldLogin.status}, nueva=${newLogin.status}`);

const ownDisable = await api(`/admin/users/${adminId}`, { method: 'PUT', token: adminToken, body: { active: false } });
report.check('US16-05', 'Impedir que el administrador deshabilite su propia cuenta', ownDisable.status === 400
  && sqlValue(container, `SELECT activo FROM usuario WHERE id=${adminId};`) === '1', `HTTP ${ownDisable.status}`);

const freshAdminToken = newLogin.body.accessToken;
const disabled = await api(`/admin/users/${createdId}`, { method: 'PUT', token: adminToken, body: { active: false } });
const revokedSession = await api('/admin/users', { token: freshAdminToken });
const disabledLogin = await api('/auth/login', { method: 'POST', body: { email: internalEmail, password: changedPassword } });
const revokedCount = Number(sqlValue(container, `SELECT COUNT(*) FROM sesion_usuario WHERE usuario_id=${createdId}
  AND revocada_en IS NOT NULL;`));
report.check('US16-06', 'Deshabilitar bloquea nuevo acceso y revoca sesiones activas', disabled.status === 200
  && revokedSession.status === 401 && disabledLogin.status === 401 && revokedCount >= 1,
  `PUT=${disabled.status}, sesión=${revokedSession.status}, login=${disabledLogin.status}, revocadas=${revokedCount}`);

const audits = Number(sqlValue(container, `SELECT COUNT(*) FROM auditoria WHERE actor_usuario_id=${adminId}
  AND entidad='usuario' AND entidad_id=${createdId} AND accion IN ('user.created','user.updated');`));
report.check('US16-07', 'Registrar las modificaciones en auditoría', audits >= 2, `${audits} eventos`);

// La cuenta creada queda deshabilitada como parte de la prueba; no borrar datos de auditoría.
report.finish();
