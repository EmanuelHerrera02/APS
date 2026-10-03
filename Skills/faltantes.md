# Seguimiento de tareas — US2, US4, US5 y US7

**Revisión:** 2026-10-03 · Comparación de `Skills/tareas.md` con código, SQL, documentación, configuración y verificaciones disponibles.

## Pendiente / parcial / no verificable

### US4 — Acceso por roles y permisos

- **Pendiente de pruebas integradas:** comprobar con usuarios ADMIN, PASAJERO y MOSTRADOR el alta, login, refresh, logout y accesos permitidos/denegados. El backend compila, pero no tiene launcher/servidor servlet ni pruebas automatizadas.
- **Parcial — unificación de identificadores:** los nombres de roles y códigos de permisos coinciden entre SQL, Scala y frontend. Sin embargo, el backend sintetiza IDs numéricos de rol (`Authentication.scala`) que no existen como IDs en el esquema SQL; las tareas de diseño/unificación de roles continúan sin marcar en `tareas.md`.

### US5 — Alta de vuelos

- **Parcial — implementación:** hay formulario, validación cliente/servidor, endpoint protegido, transacción de persistencia, generación de salidas y auditoría. `npm run build` y compilación Scala pasan. No se pudo verificar visualmente ni por HTTP: el backend no tiene launcher y Vite en desarrollo devuelve 404 con error de acceso al recorrer directorios.
- **Pendiente de validación backend:** `FlightRepository` no rechaza explícitamente precios con más de dos decimales, aunque el formulario sí los limita. Sus errores SQL de integridad distintos de duplicado se clasifican genéricamente como aeropuerto inválido.
- **Resuelto — compatibilidad de permisos:** `db/05_migration_flight_create_permission.sql` agrega `flight:create` a bases existentes de forma idempotente; debe ejecutarse una vez después de actualizar el repositorio.
- **Pendiente de pruebas integradas:** probar el endpoint HTTP con alta válida/inválida, acceso denegado y rollback del repositorio. Las pruebas SQL existentes no invocan `FlightRepository` ni el endpoint.
- **Lint pendiente:** no existe ESLint declarado ni configuración en el proyecto; `npm run lint` no arranca.

### US7 — Búsqueda de viajes

- **Pendiente de pruebas integradas:** comprobar rutas y rangos con resultados, sin resultados y salidas agotadas. `db/04_tests.sql` no cubre `v_disponibilidad` ni `/passenger/search`.
- **No verificable en ejecución:** el endpoint está implementado, pero no se pudo iniciar el backend por falta de launcher/servidor servlet.

## Comprobado en código y verificaciones

- **US2 — Modelo y base de datos (completado según el alcance confirmado):** restricciones, estados, scripts iniciales y modelo están en `db/01_schema.sql` a `db/04_tests.sql`; `docker-compose.yml` carga la base de desarrollo.
- **US4 — Alta y sesión:** registro con rol PASAJERO, hash de contraseña, login, actualización de último acceso, credenciales de sesión y control de permisos en frontend/backend (`AuthController.scala`, `Authentication.scala`, `AuthorizedAction.scala`, controladores y `AuthContext.jsx`). La verificación integrada sigue pendiente.
- **US5 — Código de alta:** `AdminFlightsPage.jsx` captura código, ruta, horarios, período, días, clases, capacidades y precios. `AdminController.scala` expone `GET /admin/airports` y `POST /admin/flights`; `FlightRepository.scala` valida y guarda vuelo, días y clases en una transacción, genera salidas y registra auditoría. `flight:create` está alineado en SQL, Scala y frontend.
- **US7 — Búsqueda en código:** formulario, estados de carga/error/sin resultados y resultados están en `PassengerDashboard.jsx`; `/passenger/search` consulta `v_disponibilidad` en `PassengerController.scala`.
- `sbt test` compila el backend, pero reporta 0 pruebas configuradas. `npm run build` pasa con Vite 4.5.14.
- `db/04_tests.sql` pasó **26/26 casos** al ejecutarse desde el archivo UTF-8 montado en MariaDB. Se verificó que ADMIN tiene `flight:create` y los otros roles no; una inserción con código repetido fue rechazada por `uq_vuelo_codigo`.
- Una transacción SQL de humo generó 7 salidas y 14 clases y confirmó rollback total. Esto verifica la base y `generar_salidas`, no la llamada desde `FlightRepository`.
