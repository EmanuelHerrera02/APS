# Catálogo de criterios de aceptación

Este catálogo conserva los criterios actuales del Sprint 2 para verificaciones futuras. Fuente principal: `plan_de_desarrollo_sprint_2.md`, criterios de aceptación de cada módulo. `Skills/tareas.md` sirve como referencia secundaria para detectar cambios o discrepancias.

## US8 — Compra de pasajes

Fuente: Plan de Desarrollo, Módulo 1.

- **US8-AC1:** Compra limitada a un rango de 1 a 9 pasajes por transacción.
- **US8-AC2:** Cálculo de importe según clase seleccionada (Economy o Primera).
- **US8-AC3:** Datos requeridos por cada pasajero previo al pago.
- **US8-AC4:** Resumen previo al pago completo (vuelo, fecha, horario, clase, cantidad, total).
- **US8-AC5:** Validación de que los vuelos estén dentro del período de venta y días de operación.

## US11 — Control de disponibilidad y sobreventa

Fuente: Plan de Desarrollo, Módulo 2.

- **US11-AC1:** Ninguna compra simultánea puede confirmar más pasajes que la capacidad real.
- **US11-AC2:** Asientos reservados temporalmente durante el pago; liberación automática tras 10 minutos si no hay confirmación.
- **US11-AC3:** Aviso en pantalla si no hay disponibilidad suficiente antes del pago.
- **US11-AC4:** La búsqueda de vuelos debe descontar tanto ventas confirmadas como reservas vigentes.

## US9 — Pasarela de pago en línea

Fuente: Plan de Desarrollo, Módulo 3.

- **US9-AC1:** Datos de tarjeta procesados directamente en la pasarela (sistema local no guarda PAN ni CVV).
- **US9-AC2:** Transacciones con ID único, importe y estado rastreable.
- **US9-AC3:** Bloqueo de doble procesamiento (idempotencia en el pago).
- **US9-AC4:** Actualización de estado de la compra: aprobada confirma pasajes; rechazada libera reservas.
- **US9-AC5:** Pruebas exitosas contra el entorno sandbox de la pasarela.

## US10 — Emisión y envío de pasajes y factura

Fuente: Plan de Desarrollo, Módulo 4.

- **US10-AC1:** Envío automático de pasajes (con detalle de pasajero, vuelo, fecha, horario, clase) y factura por email al confirmar pago.
- **US10-AC2:** SLA de envío: email entregado en menos de 2 minutos tras confirmación.
- **US10-AC3:** Cola de reintentos automáticos para correos fallidos y registro de estados (entregado, rebotado, fallido).
- **US10-AC4:** Opción de descarga directa desde el portal web como alternativa al correo.
