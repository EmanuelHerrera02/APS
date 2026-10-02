# Tareas pendientes — US4 y US7

**Revisión:** 2026-10-02 · Comparación de [tareas.md](tareas.md) con el código disponible.

## Pendiente

### US4 — Roles y permisos

- Implementar registro persistente: validar datos, guardar hash y prohibir que el registro público asigne roles internos. El controlador actual devuelve un ID fijo: [AdminController.scala](../backend/src/main/scala/com/transport/system/controllers/AdminController.scala).
- Implementar inicio de sesión: validar credenciales y estado de cuenta, actualizar último acceso y emitir/verificar la sesión. No hay endpoint ni lógica de autenticación disponibles.
- Proteger rutas del frontend y endpoints del backend. El menú solo oculta opciones; falta `AuthContext` y no está el código de `AuthorizedAction`: [MainLayout.jsx](../frontend/src/components/layouts/MainLayout.jsx), [PassengerController.scala](../backend/src/main/scala/com/transport/system/controllers/PassengerController.scala).
- Conectar registro, login y permisos a la persistencia y reemplazar respuestas de demostración.
- Probar accesos permitidos y denegados para administrador, pasajero y empleado. No hay pruebas de esos flujos.

### US7 — Búsqueda de viajes

- Completar la configuración ejecutable del backend para conectar y montar `GET /passenger/search`. La ruta y consulta están escritas, pero faltan build del backend, dependencia JDBC y arranque/montaje verificables: [PassengerController.scala](../backend/src/main/scala/com/transport/system/controllers/PassengerController.scala).
- Ejecutar pruebas de integración para rutas y fechas con resultados, sin resultados y sin asientos disponibles. La base ya tiene `v_disponibilidad`, pero [04_tests.sql](../db/04_tests.sql) no prueba la búsqueda y no se pudo ejecutar la app.

## Implementado en código

- **US4:** códigos de rol alineados con `usuario.rol`; catálogo y asignaciones de permisos en SQL, con los mismos códigos en Scala y frontend ([01_schema.sql](../db/01_schema.sql), [03_seed.sql](../db/03_seed.sql), [Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala), [Authorization.js](../frontend/src/security/Authorization.js)).
- **US7:** formulario y diseño adaptable con estados de validación, carga, error y sin resultados ([PassengerDashboard.jsx](../frontend/src/components/passenger/PassengerDashboard.jsx), [PassengerDashboard.css](../frontend/src/components/passenger/PassengerDashboard.css)).
- **US7:** presentación de fecha, vuelo, horarios, clases, precios y asientos; queda pendiente verificarla conectada al backend.
- **Base de datos:** `v_disponibilidad` reúne los datos requeridos y excluye salidas canceladas o pasadas ([01_schema.sql](../db/01_schema.sql)).

## Verificación bloqueada

No se pudieron ejecutar pruebas de extremo a extremo: no hay build del backend, Docker/MariaDB no están disponibles y faltan Vite/ESLint instalados en el frontend.
