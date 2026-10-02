// Keep these codes identical to usuario.rol / permiso.codigo in the database
// and Roles / Permissions in backend Models.scala.
export const Roles = Object.freeze({
  ADMIN: 'ADMIN',
  EMPLOYEE: 'MOSTRADOR',
  PASSENGER: 'PASAJERO',
});

export const Permissions = Object.freeze({
  AUTH_LOGIN: 'auth:login',
  PROFILE_VIEW_OWN: 'profile:view_own',
  RESERVATION_VIEW_OWN: 'reservation:view_own',
  RESERVATION_CREATE: 'reservation:create',
  RESERVATION_VIEW_ALL: 'reservation:view_all',
  RESERVATION_CONFIRM: 'reservation:confirm',
  PAYMENT_PROCESS: 'payment:process',
  PAYMENT_REGISTER_METHOD: 'payment:register_method',
  REPORT_VIEW_OPERATIONAL: 'report:view_operational',
  ADMIN_PANEL_ACCESS: 'admin:panel_access',
  USER_LIST: 'user:list',
  USER_CREATE: 'user:create',
  USER_EDIT: 'user:edit',
  USER_CHANGE_ROLE: 'user:change_role',
  REPORT_VIEW_FINANCIAL: 'report:view_financial',
  ADMIN_VIEW_AUDIT: 'admin:view_audit',
  ADMIN_CONFIG: 'admin:config',
});
