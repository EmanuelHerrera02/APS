# Tareas pendientes — US4 y US7

**Revisión:** 2026-10-02 · Comparación de [tareas.md](tareas.md) con el código disponible.

## Pendiente

### US4 — Roles y permisos

- Implementar registro persistente: validar datos, guardar hash y prohibir que el registro público asigne roles internos. El controlador actual devuelve un ID fijo: [AdminController.scala](../backend/src/main/scala/com/transport/system/controllers/AdminController.scala).
- Completar protección por sesión y perfil: el backend verifica sesiones y permisos, pero falta `AuthContext` y proteger las rutas de la interfaz: [MainLayout.jsx](../frontend/src/components/layouts/MainLayout.jsx), [AuthorizedAction.scala](../backend/src/main/scala/com/transport/system/middleware/AuthorizedAction.scala).
- Conectar registro, login y permisos a la persistencia y reemplazar respuestas de demostración.
- Probar accesos permitidos y denegados para administrador, pasajero y empleado. No hay pruebas de esos flujos.

### US7 — Búsqueda de viajes

- Completar la configuración ejecutable del backend para conectar y montar `GET /passenger/search`. La ruta y consulta están escritas, pero faltan build del backend, dependencia JDBC y arranque/montaje verificables: [PassengerController.scala](../backend/src/main/scala/com/transport/system/controllers/PassengerController.scala).
- Ejecutar pruebas de integración para rutas y fechas con resultados, sin resultados y sin asientos disponibles. La base ya tiene `v_disponibilidad`, pero [04_tests.sql](../db/04_tests.sql) no prueba la búsqueda y no se pudo ejecutar la app.

## Implementado en código

- **US4:** códigos de rol alineados con `usuario.rol`; catálogo y asignaciones de permisos en SQL, con los mismos códigos en Scala y frontend ([01_schema.sql](../db/01_schema.sql), [03_seed.sql](../db/03_seed.sql), [Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala), [Authorization.js](../frontend/src/security/Authorization.js)).
- **US4:** login con validación de contraseña bcrypt/Argon2 y cuenta activa, actualización de `ultimo_acceso`, access token firmado, refresh token rotativo y revocación/verificación de sesión ([AuthController.scala](../backend/src/main/scala/com/transport/system/controllers/AuthController.scala), [Authentication.scala](../backend/src/main/scala/com/transport/system/security/Authentication.scala), [01_schema.sql](../db/01_schema.sql)).
- **US7:** formulario y diseño adaptable con estados de validación, carga, error y sin resultados ([PassengerDashboard.jsx](../frontend/src/components/passenger/PassengerDashboard.jsx), [PassengerDashboard.css](../frontend/src/components/passenger/PassengerDashboard.css)).
- **US7:** presentación de fecha, vuelo, horarios, clases, precios y asientos; queda pendiente verificarla conectada al backend.
- **Base de datos:** `v_disponibilidad` reúne los datos requeridos y excluye salidas canceladas o pasadas ([01_schema.sql](../db/01_schema.sql)).

## Verificación pendiente

`sbt test` compila correctamente el backend, pero no hay pruebas definidas (0 ejecutadas). No se pudieron correr pruebas de integración de autenticación: Docker/MariaDB no están disponibles y el puerto 3306 está cerrado. El build del frontend tampoco pudo ejecutarse porque faltan las dependencias (`vite`).
