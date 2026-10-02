# Tareas pendientes — US4 y US7

**Revisión:** 2026-10-02 · Comparación de [tareas.md](tareas.md) con el código disponible.

## Pendiente

### US4 — Roles y permisos

- Ejecutar verificación integrada de registro, login, renovación/revocación y accesos permitidos/denegados con la base de datos disponible.

### US7 — Búsqueda de viajes

- Completar la configuración ejecutable del backend para conectar y montar `GET /passenger/search`. La ruta y consulta están escritas, pero faltan build del backend, dependencia JDBC y arranque/montaje verificables: [PassengerController.scala](../backend/src/main/scala/com/transport/system/controllers/PassengerController.scala).
- Ejecutar pruebas de integración para rutas y fechas con resultados, sin resultados y sin asientos disponibles. La base ya tiene `v_disponibilidad`, pero [04_tests.sql](../db/04_tests.sql) no prueba la búsqueda y no se pudo ejecutar la app.

## Implementado en código

- **US4:** códigos de rol alineados con `usuario.rol`; catálogo y asignaciones de permisos en SQL, con los mismos códigos en Scala y frontend ([01_schema.sql](../db/01_schema.sql), [03_seed.sql](../db/03_seed.sql), [Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala), [Authorization.js](../frontend/src/security/Authorization.js)).
- **US4:** registro persistente con hash Argon2 y rol público fijo de pasajero; gestión administrativa persistente de usuarios; login con validación de contraseña bcrypt/Argon2 y cuenta activa, actualización de `ultimo_acceso`, token firmado, refresh rotativo y revocación/verificación de sesión ([AuthController.scala](../backend/src/main/scala/com/transport/system/controllers/AuthController.scala), [Authentication.scala](../backend/src/main/scala/com/transport/system/security/Authentication.scala), [UserRepository.scala](../backend/src/main/scala/com/transport/system/security/UserRepository.scala), [01_schema.sql](../db/01_schema.sql)).
- **US4:** permisos leídos de la base de datos, protección de rutas frontend y endpoints, paneles con indicadores persistidos y auditoría de altas, cambios e inicio/cierre de sesión ([AuthContext.jsx](../frontend/src/contexts/AuthContext.jsx), [App.jsx](../frontend/src/App.jsx), [AdminController.scala](../backend/src/main/scala/com/transport/system/controllers/AdminController.scala)).
- **US7:** formulario y diseño adaptable con estados de validación, carga, error y sin resultados ([PassengerDashboard.jsx](../frontend/src/components/passenger/PassengerDashboard.jsx), [PassengerDashboard.css](../frontend/src/components/passenger/PassengerDashboard.css)).
- **US7:** presentación de fecha, vuelo, horarios, clases, precios y asientos; queda pendiente verificarla conectada al backend.
- **Base de datos:** `v_disponibilidad` reúne los datos requeridos y excluye salidas canceladas o pasadas ([01_schema.sql](../db/01_schema.sql)).

## Verificación pendiente

No se ejecutaron pruebas en esta tarea. La verificación integrada requiere MariaDB con el esquema actualizado; el build del frontend requiere instalar las dependencias del proyecto (`vite` no está disponible en `node_modules`).
