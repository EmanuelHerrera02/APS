# Tareas pendientes y parciales

**Revisión:** 2026-11-01 · Alcance: `plan_de_desarrollo_sprint_3.txt`. Se revisaron ambos documentos de alcance; `Skills/tareas.md` corresponde al Sprint 2, por lo que este informe se limita al plan Sprint 3 indicado. Se contrastó ese plan con el código, la configuración y las pruebas disponibles. No se encontró `AGENTS.md` en el repositorio. No se ejecutaron pruebas funcionales durante esta revisión.

## US6 — Modificación y cancelación de vuelos

- **Parcial — Falta verificación integrada.** `AdminController.scala`, `FlightRepository.scala` y `AdminFlightManagementPage.jsx` implementan consulta, edición y cancelación; usan `flight:edit`, validan los datos, registran auditoría y gestionan cambios de horarios/capacidad y cancelaciones. La migración `db/migrations/20261101_us6_edicion_cancelacion_vuelos.sql` se aplicó a la base aislada. `tests/http/us6-modificacion-cancelacion.mjs` cubre capacidad vendida, precio histórico, horario, cancelación puntual/completa, búsqueda y auditoría. **Pendiente:** ejecutar el flujo integrado con API y cuenta administrativa. La compilación backend no pudo completar porque Windows denegó el reemplazo de un JAR en `backend/target`.

## US15 — Notificaciones de cambios y cancelaciones

- **Parcial — Falta aplicar migración y verificar envíos.** `trg_salida_au` encola avisos ante cambios de horario y cancelaciones; `EmailQueueWorker` implementa reintentos y estado, y la compra del pasajero muestra avisos. Existe `db/migrations/20261101_us15_notificaciones_cambios_cancelaciones.sql`, pero no hay evidencia de que se haya aplicado. `tests/http/us15-cambios-cancelaciones.mjs` prepara el flujo con la API y un SMTP de prueba. **Pendiente:** aplicar la migración y ejecutar la prueba para verificar motivo, horario anterior/nuevo, reintento y SLA de 2 minutos.

## US12 — Venta de pasajes desde el mostrador

- **Parcial — Falta verificación integrada.** `EmployeeController.scala` protege `POST /employee/sales` con `payment:process`; `CounterSaleRepository.scala` ejecuta alta y cobro dentro de una transacción y registra canal y empleado. `EmployeeSalesPage.jsx` permite buscar vuelos, vender de 1 a 9 pasajes, cargar datos individuales y cobrar en efectivo o con autorización de terminal. La confirmación genera pasajes, factura y email en cola. `tests/http/us12-venta-mostrador.mjs` cubre ventas con/sin cuenta, medios de pago, datos sensibles y disponibilidad. El build de frontend pasó. **Pendiente:** ejecutar la prueba integrada con API, base y cuenta de mostrador activas.

## US13 — Consulta de compras y reenvío de documentación

- **Parcial — Falta verificación integrada.** `EmployeeController.scala` y `EmployeePurchaseRepository.scala` implementan búsqueda por código, documento, apellido o email, detalle de compra y reenvío al correo registrado o alternativo con registro del empleado. `EmployeePurchasesPage.jsx` presenta los datos de compra. `tests/http/us13-consulta-reenvio.mjs` cubre criterios de búsqueda, detalle, reenvío, resultados vacíos y rechazo de compra pendiente. **Pendiente:** ejecutar el flujo integrado con API y base aislada.

## US14 — Reportes de ocupación

- **Parcial — Falta verificación integrada.** `OccupancyReportRepository.scala` consulta `v_ocupacion` por vuelo, clase y rango de fechas; `AdminController.scala` limita consulta y CSV a administradores con permiso financiero. `AdminOccupancyReportsPage.jsx` muestra capacidad, emitidos, reservas, disponibilidad, ocupación y recaudación, y permite exportar CSV. `tests/http/us14-reportes-ocupacion.mjs` compara una venta conocida con la vista SQL, comprueba acceso denegado a mostrador y valida CSV. El build de frontend pasó. **Pendiente:** ejecutar el script con API, base aislada y cuentas ADMIN/MOSTRADOR activas.

## US16 — Administración de cuentas de usuarios internos

- **Parcial — Falta verificación integrada.** `AdminUsersPage.jsx`, `AdminController.scala` y `UserRepository.scala` implementan alta, edición, cambio de perfil, auditoría, deshabilitación y revocación de sesiones; se impide la auto-deshabilitación. `tests/http/us16-cuentas-internas.mjs` cubre credenciales, auditoría y acceso/revocación. **Pendiente:** ejecutar el flujo integrado con API, cuenta administrativa y base aislada. La compilación backend quedó bloqueada por acceso denegado al JAR en `backend/target`.

## US19 — Pruebas de carga del módulo de búsqueda y compra

- **Parcial — Escenario preparado; resultados pendientes.** `tests/load/us19-busqueda-compra.mjs` y `tests/load/README.md` preparan un escenario de 200 usuarios, búsquedas y reservas, control de sobreventa, p95, errores e informe JSON. **Pendiente:** ejecutar en una base descartable, documentar las mediciones, corregir los cuellos de botella que aparezcan y repetir la prueba.

## US20 — Integración del incremento y preparación de la demo

- **No verificable — Falta evidencia de integración/demo.** El plan reserva 4 horas para probar e integrar el incremento y preparar la demo. No se encontró un registro de esa revisión ni un recorrido de demo. **Pendiente:** documentar la integración y el guion/recorrido preparado.
