# Tareas pendientes y parciales

**Revisión:** 2026-11-02 · **Alcance:** Sprint 3 (`plan_de_desarrollo_sprint_3.txt`).

Las correcciones de código están hechas y el backend compila. Falta ejecutar las pruebas actualizadas contra una base aislada; hasta entonces, estos ítems quedan **no verificados**:

| US | Pendiente | Evidencia esperada |
|---|---|---|
| US6 | Ejecutar `tests/http/us6-modificacion-cancelacion.mjs` con la nueva comprobación `US6-08` (rechazar cambios de período o días que dejan fuera pasajes vendidos). | 8/8 comprobaciones |
| US16 | Ejecutar `tests/http/us16-cuentas-internas.mjs` con `US16-07` actualizado (`user.created`, `user.updated` y `user.disabled` por separado). | 7/7 comprobaciones |
| US19 | Ejecutar `tests/load/us19-busqueda-compra.mjs` (tres fases) con los workers activos y registrar el informe en `tests/load/README.md`. | Todas las condiciones de `acceptance` en `true` |
| US20 | Volver a ejecutar `tests/http/us4-edicion-usuarios.mjs` como regresión del cambio de auditoría de usuarios. | Sin regresiones |
