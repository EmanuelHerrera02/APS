# Tareas pendientes y parciales

**Revisión:** 2026-10-03 · Comparación de `Skills/tareas.md` con código, SQL, configuración, documentación y resultados HTTP de US7.

## US5 — Alta de vuelos

- **Parcial:** el formulario y las validaciones cliente están en `frontend/src/pages/AdminFlightsPage.jsx` y `frontend/src/utils/flightValidation.js`. El endpoint protegido, las validaciones de negocio, la transacción, generación de salidas y auditoría están en `AdminController.scala` y `FlightRepository.scala`.
- **Pendiente de verificación integrada:** probar por HTTP altas válidas e inválidas, duplicación de código, denegación por permisos y rollback completo ante fallos. `db/04_tests.sql` cubre lógica SQL, pero no ejecuta `FlightRepository` ni el endpoint.
