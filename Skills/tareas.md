Ok, # Tareas a realizar — Sprint 2

## US8 — Compra de pasajes

**Carga estimada:** 24 horas

- [ ] Diseñar el flujo de compra (vuelo y fecha, clase, cantidad y datos de los pasajeros) (4 horas).
- [ ] Implementar la selección de clase (Economy/Primera) y cantidad de pasajes, aplicando límite de 9 por transacción (5 horas).
- [ ] Implementar la carga de datos de cada pasajero (nombre, apellido, documento) con validaciones (4 horas).
- [ ] Implementar el resumen de compra (vuelo, fecha, horario, clase, cantidad, importe total) (4 horas).
- [ ] Registrar la compra en estado «pendiente de pago» (3 horas).
- [ ] Escribir y ejecutar pruebas de compra (casos válidos e inválidos, validación de períodos de venta) (4 horas).

**Criterios de aceptación:**

- Compra limitada a un rango de 1 a 9 pasajes por transacción.
- Cálculo de importe según clase seleccionada (Economy o Primera).
- Datos requeridos por cada pasajero previo al pago.
- Resumen previo al pago completo (vuelo, fecha, horario, clase, cantidad, total).
- Validación de que los vuelos estén dentro del período de venta y días de operación.

## US11 — Control de disponibilidad y sobreventa

**Carga estimada:** 21 horas

- [ ] Diseñar el control de disponibilidad por vuelo, fecha y clase (3 horas).
- [ ] Implementar reserva temporal de asientos durante el flujo de pago con liberación automática (TTL de 10 minutos) (6 horas).
- [ ] Implementar la confirmación atómica de compra contra el inventario de disponibilidad (5 horas).
- [ ] Agregar restricciones a nivel de base de datos para impedir superar la capacidad declarada (2 horas).
- [ ] Realizar pruebas de estrés/concurrencia con compras simultáneas sobre los últimos asientos (5 horas).

**Criterios de aceptación:**

- Ninguna compra simultánea puede confirmar más pasajes que la capacidad real.
- Asientos reservados temporalmente durante el pago; liberación automática tras 10 minutos si no hay confirmación.
- Aviso en pantalla si no hay disponibilidad suficiente antes del pago.
- La búsqueda de vuelos debe descontar tanto ventas confirmadas como reservas vigentes.

## US9 — Pago en línea

**Carga estimada:** 32 horas

- [ ] Seleccionar y configurar entorno de pruebas de la pasarela de pagos (4 horas).
- [ ] Desarrollar módulo de integración aislado para la pasarela de pagos (8 horas).
- [ ] Generar e implementar identificadores únicos (UUID) por transacción para evitar cobros duplicados (5 horas).
- [ ] Implementar Webhooks/Polling para confirmación asincrónica de pago y estados (aprobado, rechazado, pendiente) (6 horas).
- [ ] Desarrollar UI de pago seguro y mensajes de feedback al usuario (4 horas).
- [ ] Probar flujo completo con tarjetas de prueba (aprobación, rechazo, pendiente) (5 horas).

**Criterios de aceptación:**

- Datos de tarjeta procesados directamente en la pasarela (sistema local no guarda PAN ni CVV).
- Transacciones con ID único, importe y estado rastreable.
- Bloqueo de doble procesamiento (idempotencia en el pago).
- Actualización de estado de la compra: aprobada confirma pasajes; rechazada libera reservas.
- Pruebas exitosas contra el entorno sandbox de la pasarela.

## US10 — Emisión de pasajes, facturación y notificaciones

**Carga estimada:** 17 horas

- [ ] Diseñar templates (PDF/HTML) para pasaje electrónico y factura (3 horas).
- [ ] Desarrollar la lógica de generación de pasajes y factura post-confirmación de pago (5 horas).
- [ ] Configurar servidor/servicio de envío de correos (SPF, DKIM, DMARC) y sistema de colas/reintentos (4 horas).
- [ ] Implementar endpoint y UI para descarga manual de pasajes/factura desde la web (2 horas).
- [ ] Escribir y ejecutar pruebas de emisión, envío asíncrono, descargas y manejo de correos fallidos (3 horas).

**Criterios de aceptación:**

- Envío automático de pasajes (con detalle de pasajero, vuelo, fecha, horario, clase) y factura por email al confirmar pago.
- SLA de envío: email entregado en menos de 2 minutos tras confirmación.
- Cola de reintentos automáticos para correos fallidos y registro de estados (entregado, rebotado, fallido).
- Opción de descarga directa desde el portal web como alternativa al correo.
