# Plan de Desarrollo — Sprint 3

Este documento reúne las historias planificadas para el Sprint 3, sus tareas, estimaciones y criterios de aceptación.

## 4.1 Historias de usuario

### User story 6: Modificación y cancelación de vuelos

**Como:** Administrador  
**Quiero:** Modificar los datos de un vuelo existente o cancelarlo  
**De forma que:** La oferta de vuelos refleje en todo momento la operación real de la aerolínea

**Story points:** 5 · **Business value:** 8  
**Estimación:** 16 horas

#### Tareas

- Diseñar la pantalla de edición y cancelación de vuelos, a partir del formulario de alta (2 horas).
- Implementar la modificación de horarios, días de operación, período de venta, capacidades y precios, con las mismas validaciones del alta (5 horas).
- Implementar la cancelación de un vuelo completo o de una salida puntual, con su motivo, cancelando las compras pendientes de pago (4 horas).
- Impedir los cambios que dejen sin lugar a pasajes ya vendidos (2 horas).
- Probar modificaciones y cancelaciones sobre vuelos con y sin pasajes vendidos (3 horas).

#### Criterios de aceptación

- El administrador puede modificar los horarios, los días de operación, el período de venta, las capacidades y los precios de un vuelo, con las mismas validaciones que en el alta.
- No se puede reducir la capacidad de una clase por debajo de los pasajes ya vendidos.
- Un cambio de precio no modifica el importe de los pasajes ya comprados.
- El administrador puede cancelar un vuelo completo o una salida puntual indicando el motivo; las compras pendientes de pago se cancelan y la salida deja de aparecer en la búsqueda.
- Cada modificación y cada cancelación quedan registradas en la auditoría con el usuario que las hizo.

### User story 15: Notificaciones de cambios y cancelaciones

**Como:** Pasajero  
**Quiero:** Recibir alertas por email cuando se modifique el horario de mi vuelo o se cancele  
**De forma que:** Me entere a tiempo de los cambios que afectan mi viaje

**Story points:** 5 · **Business value:** 13  
**Estimación:** 16 horas

#### Tareas

- Diseñar los correos de cambio de horario y de cancelación (2 horas).
- Detectar a los pasajeros afectados por cada cambio o cancelación y encolar un aviso por compra (4 horas).
- Enviar los avisos con la cola de correos, con reintentos y registro del estado de cada envío (4 horas).
- Mostrar el aviso del cambio en las compras del pasajero, en la web (3 horas).
- Probar los avisos con cambios de horario, cancelaciones y envíos fallidos (3 horas).

#### Criterios de aceptación

- Cuando se modifica el horario de una salida, cada pasajero con una compra confirmada recibe un correo con el horario anterior y el nuevo.
- Cuando se cancela un vuelo o una salida, cada pasajero afectado recibe un correo con el motivo de la cancelación.
- En las pruebas, el aviso llega dentro de los 2 minutos posteriores al cambio.
- Si un envío falla, se reintenta automáticamente y queda registrado el estado de cada aviso (entregado, rebotado o fallido).
- Los cambios que no afectan el viaje, como un cambio de precio, no generan avisos.

### User story 12: Venta de pasajes desde el mostrador

**Como:** Empleado de mostrador  
**Quiero:** Buscar vuelos y vender pasajes desde una interfaz propia  
**De forma que:** Pueda atender a los pasajeros que compran presencialmente en el aeropuerto

**Story points:** 5 · **Business value:** 8  
**Estimación:** 16 horas

#### Tareas

- Diseñar la pantalla de venta del mostrador, a partir de la búsqueda y la compra de la web (2 horas).
- Implementar la venta a pasajeros con o sin cuenta, registrando al empleado que vende (5 horas).
- Registrar el cobro en efectivo o con tarjeta en el mostrador y confirmar la compra (4 horas).
- Entregar los pasajes y la factura al finalizar la venta (impresión o envío por correo) (2 horas).
- Probar la venta con distintos medios de pago y sin disponibilidad (3 horas).

#### Criterios de aceptación

- El empleado busca vuelos con los mismos criterios que en la web y ve la disponibilidad actualizada.
- Puede vender de 1 a 9 pasajes por transacción a un pasajero con o sin cuenta, cargando los datos de cada pasajero.
- El cobro se registra en efectivo o con tarjeta y, al registrarlo, la compra queda confirmada y se emiten los pasajes y la factura.
- La venta respeta el control de disponibilidad: nunca se vende más que la capacidad declarada.
- Cada venta queda asociada al empleado que la hizo.

### User story 13: Consulta de compras y reenvío de documentación

**Como:** Empleado de mostrador  
**Quiero:** Consultar las compras de un pasajero y reenviarle sus pasajes y factura  
**De forma que:** Pueda resolver consultas y reclamos presenciales de los pasajeros

**Story points:** 3 · **Business value:** 5  
**Estimación:** 9 horas

#### Tareas

- Diseñar la pantalla de consulta de compras (2 horas).
- Implementar la búsqueda de compras por código, documento, apellido o email del pasajero (3 horas).
- Implementar el reenvío de los pasajes y la factura, al email registrado o a uno nuevo (2 horas).
- Probar consultas y reenvíos, incluidos los casos sin resultados (2 horas).

#### Criterios de aceptación

- El empleado busca compras por código de compra, documento, apellido o email del pasajero.
- Ve el detalle de cada compra: vuelo, fecha, pasajeros, clase, importe y estado.
- Puede reenviar los pasajes y la factura de una compra confirmada al email registrado o al que indique el pasajero.
- Cada reenvío queda registrado con el empleado que lo pidió.

### User story 14: Reportes de ocupación

**Como:** Administrador  
**Quiero:** Consultar reportes de ocupación filtrados por vuelo, clase y fecha  
**De forma que:** Conozca la ocupación real de cada vuelo y pueda tomar decisiones comerciales

**Story points:** 5 · **Business value:** 8  
**Estimación:** 16 horas

#### Tareas

- Diseñar la pantalla de reportes y sus filtros (3 horas).
- Implementar la consulta de ocupación por vuelo, clase y rango de fechas (4 horas).
- Mostrar el porcentaje de ocupación, los asientos vendidos, reservados y disponibles, y lo recaudado (4 horas).
- Permitir exportar el reporte a CSV (2 horas).
- Probar los reportes contra datos de ventas conocidos (3 horas).

#### Criterios de aceptación

- El administrador filtra la ocupación por vuelo, clase y rango de fechas.
- Para cada salida se muestran la capacidad, los pasajes vendidos, las reservas pendientes, los asientos disponibles, el porcentaje de ocupación y lo recaudado.
- Las cifras coinciden con las ventas registradas (se verifica con datos de prueba conocidos).
- El reporte se puede exportar a CSV.
- Solo los administradores pueden ver los reportes.

### User story 16: Administración de cuentas de usuarios internos

**Como:** Administrador  
**Quiero:** Crear, modificar y deshabilitar cuentas de empleados de mostrador y de otros administradores  
**De forma que:** Se controle quién tiene acceso a las funciones internas del sistema

**Story points:** 3 · **Business value:** 5  
**Estimación:** 9 horas

#### Tareas

- Diseñar la pantalla de administración de cuentas internas (2 horas).
- Implementar el alta y la modificación de empleados de mostrador y administradores (3 horas).
- Implementar la deshabilitación de cuentas, cerrando sus sesiones activas (2 horas).
- Probar los accesos con cuentas habilitadas y deshabilitadas (2 horas).

#### Criterios de aceptación

- El administrador crea cuentas de mostrador y de administrador con nombre, email y contraseña inicial.
- Puede modificar los datos y el perfil de una cuenta interna.
- Una cuenta deshabilitada no puede iniciar sesión y sus sesiones activas se cierran.
- Un administrador no puede deshabilitar su propia cuenta.
- Cada alta, modificación y deshabilitación queda registrada en la auditoría.

### User story 19: Pruebas de carga del módulo de búsqueda y compra

**Como:** Miembro del equipo de desarrollo  
**Quiero:** Ejecutar pruebas de carga con al menos 200 usuarios concurrentes sobre la búsqueda y la compra  
**De forma que:** Se valide el objetivo de tiempo de respuesta menor a 3 segundos definido en el StartUp

**Story points:** 5 · **Business value:** 5  
**Estimación:** 16 horas

#### Tareas

- Elegir la herramienta de carga y preparar el entorno y los datos de prueba (4 horas).
- Escribir los escenarios de búsqueda y de compra con 200 usuarios concurrentes (4 horas).
- Ejecutar las pruebas y medir los tiempos de respuesta y los errores (3 horas).
- Corregir los cuellos de botella encontrados (índices, consultas y conexiones) (3 horas).
- Documentar los resultados y repetir la prueba después de las correcciones (2 horas).

#### Criterios de aceptación

- Se simulan al menos 200 usuarios concurrentes buscando vuelos y comprando pasajes.
- El 95 % de las búsquedas y de las compras responde en menos de 3 segundos.
- Durante la prueba no hay sobreventa ni errores del servidor.
- Los resultados (tiempos, errores y cambios hechos) quedan documentados.

## 4.3 Tareas de integración y reserva

| Tarea | Horas |
|---|---:|
| Testear el incremento, integrarlo y preparar la demo (US20) | 4 |
| Reserva para imprevistos | 5 |
| **Total de tareas de integración y reserva** | **9** |
| Historias de usuario (US6, US15, US12, US13, US14, US16 y US19) | 98 |
| **Total del Sprint 3** | **107** |

## 4.4 Riesgos a supervisar en este sprint

| Riesgo (exposición) | Cómo lo atendemos en el Sprint 3 |
|---|---|
| Riesgo 1: sobreventa por concurrencia (12) | La venta del mostrador (US12) usa la misma reserva temporal y confirmación atómica que la web, y la US6 impide reducir la capacidad por debajo de lo vendido. La US19 verifica que no haya sobreventa bajo carga. |
| Riesgo 2: tiempos de respuesta bajo carga | La US19 prepara el entorno de pruebas de carga el primer día, mide la búsqueda y la compra con 200 usuarios concurrentes y deja tiempo para corregir lo que no llegue a los 3 segundos. |
| Riesgo 4: no entrega de correos (9) | Los avisos de la US15 y los reenvíos de la US13 usan la cola de correos con reintentos y registro de estado de la US10. |
| Riesgo 5: fecha de entrega comprometida (9) | Es el último sprint de la materia: se revisa el avance en el hito del lunes 26/10 y, si hay un atraso importante, se renegocia el alcance con el equipo implementador. La primera historia a postergar es la US16, la de menor prioridad. |

## 4.5 Plan de release actualizado

| Sprint | Historias (SP) | Estado |
|---|---|---|
| Sprint 1 (22/09 al 05/10) | US1, US2, US4, US5 y US7, más la US3 resuelta con la US4 (34 SP) | Terminado |
| Sprint 2 (06/10 al 19/10) | US8, US11, US9 y US10 (34 SP) | Terminado |
| Sprint 3 (20/10 al 02/11) | US6, US15, US12, US13, US14, US16 y US19 (31 SP) | Planificado |
| Después de la materia | US17 y US18: aplicación móvil (21 SP) | Sin planificar |
| Todos los sprints | US20: testeo del incremento antes de cada demo (3 SP) | En curso |
