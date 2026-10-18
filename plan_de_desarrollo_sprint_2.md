# Plan de Desarrollo - Sprint 2: Sistema de Aerolínea

Este documento detalla la distribución de tareas para el Sprint 2. Está dividido en 4 módulos de trabajo. Se recomienda asignar los Módulos 1, 2 y 3 a cada uno de los tres desarrolladores inicialmente. El Módulo 4 será tomado por el desarrollador que finalice primero su módulo asignado.

---

<!-- INICIO DEL MÓDULO 1 -->
## Módulo 1: Flujo de Compra de Pasajes
**Carga estimada:** 24 horas
**Historia de Usuario:** US 8 - Compra de pasajes

**Objetivo:** Permitir al pasajero seleccionar clase, cantidad de pasajes (máximo 9) y cargar datos de los acompañantes, generando un resumen antes del pago.

### Tareas a Implementar:
- [x] Diseñar el flujo de compra (vuelo y fecha, clase, cantidad y datos de los pasajeros). *(4 horas)*
- [x] Implementar la selección de clase (Economy/Primera) y cantidad de pasajes, aplicando límite de 9 por transacción. *(5 horas)*
- [x] Implementar la carga de datos de cada pasajero (nombre, apellido, documento) con validaciones. *(4 horas)*
- [x] Implementar el resumen de compra (vuelo, fecha, horario, clase, cantidad, importe total). *(4 horas)*
- [x] Registrar la compra en estado "pendiente de pago". *(3 horas)*
- [x] Escribir y ejecutar pruebas de compra (casos válidos e inválidos, validación de períodos de venta). *(4 horas)*

### Criterios de Aceptación:
- Compra limitada a un rango de 1 a 9 pasajes por transacción.
- Cálculo de importe según clase seleccionada (Economy o Primera).
- Datos requeridos por cada pasajero previo al pago.
- Resumen previo al pago completo (vuelo, fecha, horario, clase, cantidad, total).
- Validación de que los vuelos estén dentro del período de venta y días de operación.
<!-- FIN DEL MÓDULO 1 -->

---

<!-- INICIO DEL MÓDULO 2 -->
## Módulo 2: Control de Disponibilidad y Sobreventa
**Carga estimada:** 21 horas
**Historia de Usuario:** US 11 - Control de disponibilidad y sobreventa

**Objetivo:** Garantizar la integridad de los asientos disponibles, implementando reservas temporales y bloqueos de concurrencia para evitar sobreventa.

### Tareas a Implementar:
- [x] Diseñar el control de disponibilidad por vuelo, fecha y clase. *(3 horas)*
- [x] Implementar reserva temporal de asientos durante el flujo de pago con liberación automática (TTL de 10 minutos). *(6 horas)*
- [x] Implementar la confirmación atómica de compra contra el inventario de disponibilidad. *(5 horas)*
- [x] Agregar restricciones a nivel de base de datos para impedir superar la capacidad declarada. *(2 horas)*
- [x] Realizar pruebas de estrés/concurrencia con compras simultáneas sobre los últimos asientos. *(5 horas)*

### Criterios de Aceptación:
- Ninguna compra simultánea puede confirmar más pasajes que la capacidad real.
- Asientos reservados temporalmente durante el pago; liberación automática tras 10 minutos si no hay confirmación.
- Aviso en pantalla si no hay disponibilidad suficiente antes del pago.
- La búsqueda de vuelos debe descontar tanto ventas confirmadas como reservas vigentes.
<!-- FIN DEL MÓDULO 2 -->

---

<!-- INICIO DEL MÓDULO 3 -->
## Módulo 3: Pasarela de Pago en Línea
**Carga estimada:** 32 horas
**Historia de Usuario:** US 9 - Pago en línea

**Objetivo:** Integrar una pasarela de pago segura, manejar transacciones únicas y procesar los estados de los pagos sin guardar datos sensibles de tarjetas.

### Tareas a Implementar:
- [ ] Seleccionar y configurar entorno de pruebas de la pasarela de pagos. *(4 horas)*
- [ ] Desarrollar módulo de integración aislado para la pasarela de pagos. *(8 horas)*
- [ ] Generar e implementar identificadores únicos (UUID) por transacción para evitar cobros duplicados. *(5 horas)*
- [ ] Implementar Webhooks/Polling para confirmación asincrónica de pago y estados (aprobado, rechazado, pendiente). *(6 horas)*
- [ ] Desarrollar UI de pago seguro y mensajes de feedback al usuario. *(4 horas)*
- [ ] Probar flujo completo con tarjetas de prueba (aprobación, rechazo, pendiente). *(5 horas)*

### Criterios de Aceptación:
- Datos de tarjeta procesados directamente en la pasarela (sistema local no guarda PAN ni CVV).
- Transacciones con ID único, importe y estado rastreable.
- Bloqueo de doble procesamiento (idempotencia en el pago).
- Actualización de estado de la compra: aprobada confirma pasajes; rechazada libera reservas.
- Pruebas exitosas contra el entorno sandbox de la pasarela.
<!-- FIN DEL MÓDULO 3 -->

---

<!-- INICIO DEL MÓDULO 4 -->
## Módulo 4: Emisión de Pasajes, Facturación y Notificaciones
**Carga estimada:** 17 horas
**Historia de Usuario:** US 10 - Emisión y envío de pasajes y factura

**Objetivo:** Automatizar la generación de tickets electrónicos y facturas, y asegurar su entrega por email tras la confirmación del pago.

### Tareas a Implementar:
- [x] Diseñar templates (PDF/HTML) para pasaje electrónico y factura. *(3 horas)*
- [x] Desarrollar la lógica de generación de pasajes y factura post-confirmación de pago. *(5 horas)*
- [ ] Configurar servidor/servicio de envío de correos (SPF, DKIM, DMARC) y sistema de colas/reintentos. *(4 horas)* Código de cola, reintentos y callbacks implementado; falta configurar proveedor real y publicar SPF/DKIM/DMARC del dominio.
- [x] Implementar endpoint y UI para descarga manual de pasajes/factura desde la web. *(2 horas)*
- [x] Escribir y ejecutar pruebas de emisión, envío asíncrono, descargas y manejo de correos fallidos. *(3 horas)* Prueba integrada: 18/18 casos aprobados.

### Criterios de Aceptación:
- Envío automático de pasajes (con detalle de pasajero, vuelo, fecha, horario, clase) y factura por email al confirmar pago.
- SLA de envío: email entregado en menos de 2 minutos tras confirmación.
- Cola de reintentos automáticos para correos fallidos y registro de estados (entregado, rebotado, fallido).
- Opción de descarga directa desde el portal web como alternativa al correo.
<!-- FIN DEL MÓDULO 4 -->
