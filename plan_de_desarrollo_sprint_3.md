# Plan de desarrollo — Sprint 3

## 4. Planificación del Sprint 3

### Objetivo

Que el administrador pueda modificar y cancelar vuelos con aviso automático a los pasajeros afectados; que el personal de mostrador pueda vender pasajes y atender consultas; que el administrador consulte la ocupación y gestione las cuentas internas; y validar, mediante pruebas de carga, que la búsqueda y la compra respondan en menos de 3 segundos con 200 usuarios concurrentes.

### Capacidad del sprint

La velocidad real del Sprint 2 fue de **34 story points (SP)**, con **108 horas** de trabajo. Para el Sprint 3 se planifican **31 SP**:

| Concepto | Horas |
|---|---:|
| Historias de usuario | 98 |
| Testeo, integración y preparación de la demo (US20) | 4 |
| Reserva para imprevistos | 5 |
| **Total planificado** | **107** |

### 4.1 Historias seleccionadas

| US | Historia | SP | Valor de negocio | Motivo de selección |
|---|---|---:|---:|---|
| US6 | Modificación y cancelación de vuelos | 5 | 8 | Completa la administración de vuelos iniciada con US5 y sirve de base para los avisos de US15. |
| US15 | Notificaciones de cambios y cancelaciones | 5 | 13 | Es la historia de mayor valor del sprint y depende de US6. Usa la cola de correos con reintentos de US10 (Riesgo 4). |
| US12 | Venta de pasajes desde el mostrador | 5 | 8 | Reutiliza la búsqueda (US7), la compra (US8) y el control de disponibilidad (US11) desde una interfaz para el empleado. |
| US13 | Consulta de compras y reenvío de documentación | 3 | 5 | Completa la atención en mostrador junto con US12 y reutiliza los documentos de US10. |
| US14 | Reportes de ocupación | 5 | 8 | Las ventas del Sprint 2 proporcionan datos de ocupación para mostrar. |
| US16 | Administración de cuentas de usuarios internos | 3 | 5 | Se adelanta desde después del Sprint 3: completa los perfiles internos de US12, US13 y US14, y se apoya en la gestión de usuarios de US4. |
| US19 | Pruebas de carga del módulo de búsqueda y compra | 5 | 5 | Atiende el Riesgo 2 y el objetivo 7 del POS, ahora que la búsqueda y la compra están terminadas. |
| **Total** |  | **31** |  | Por debajo de la velocidad real del Sprint 2 (34 SP). |

### 4.2 Historias, tareas y criterios de aceptación

#### US6 — Modificación y cancelación de vuelos

**Como:** Administrador
**Quiero:** Modificar los datos de un vuelo existente o cancelarlo.
**De forma que:** La oferta de vuelos refleje en todo momento la operación real de la aerolínea.

**Estimación:** 5 SP · **Valor de negocio:** 8

**Tareas**

| Tarea | Horas |
|---|---:|
| Diseñar la pantalla de edición y cancelación de vuelos a partir del formulario de alta. | 2 |
| Implementar la modificación de horarios, días de operación, período de venta, capacidades y precios, con las mismas validaciones del alta. | 5 |
| Implementar la cancelación de un vuelo completo o de una salida puntual, con su motivo, cancelando las compras pendientes de pago. | 4 |
| Impedir los cambios que dejen sin lugar a pasajes ya vendidos. | 2 |
| Probar modificaciones y cancelaciones sobre vuelos con y sin pasajes vendidos. | 3 |
| **Total** | **16** |

**Criterios de aceptación**

- El administrador puede modificar horarios, días de operación, período de venta, capacidades y precios, con las mismas validaciones que en el alta.
- No se puede reducir la capacidad de una clase por debajo de los pasajes ya vendidos.
- Un cambio de precio no modifica el importe de los pasajes ya comprados.
- El administrador puede cancelar un vuelo completo o una salida puntual indicando el motivo; las compras pendientes de pago se cancelan y la salida deja de aparecer en la búsqueda.
- Cada modificación y cancelación queda registrada en la auditoría con el usuario que la realizó.

#### US15 — Notificaciones de cambios y cancelaciones

**Como:** Pasajero
**Quiero:** Recibir alertas por email cuando se modifique el horario de mi vuelo o se cancele.
**De forma que:** Me entere a tiempo de los cambios que afectan mi viaje.

**Estimación:** 5 SP · **Valor de negocio:** 13

**Tareas**

| Tarea | Horas |
|---|---:|
| Diseñar los correos de cambio de horario y de cancelación. | 2 |
| Detectar a los pasajeros afectados por cada cambio o cancelación y encolar un aviso por compra. | 4 |
| Enviar los avisos con la cola de correos, con reintentos y registro del estado de cada envío. | 4 |
| Mostrar el aviso del cambio en las compras del pasajero, en la web. | 3 |
| Probar los avisos con cambios de horario, cancelaciones y envíos fallidos. | 3 |
| **Total** | **16** |

**Criterios de aceptación**

- Cuando se modifica el horario de una salida, cada pasajero con una compra confirmada recibe un correo con el horario anterior y el nuevo.
- Cuando se cancela un vuelo o una salida, cada pasajero afectado recibe un correo con el motivo de la cancelación.
- En las pruebas, el aviso llega dentro de los 2 minutos posteriores al cambio.
- Si un envío falla, se reintenta automáticamente y queda registrado el estado de cada aviso (entregado, rebotado o fallido).
- Los cambios que no afectan el viaje, como un cambio de precio, no generan avisos.

#### US12 — Venta de pasajes desde el mostrador

**Como:** Empleado de mostrador
**Quiero:** Buscar vuelos y vender pasajes desde una interfaz propia.
**De forma que:** Pueda atender a los pasajeros que compran presencialmente en el aeropuerto.

**Estimación:** 5 SP · **Valor de negocio:** 8

**Tareas**

| Tarea | Horas |
|---|---:|
| Diseñar la pantalla de venta del mostrador a partir de la búsqueda y la compra de la web. | 2 |
| Implementar la venta a pasajeros con o sin cuenta, registrando al empleado que vende. | 5 |
| Registrar el cobro en efectivo o con tarjeta en el mostrador y confirmar la compra. | 4 |
| Entregar los pasajes y la factura al finalizar la venta (impresión o envío por correo). | 2 |
| Probar la venta con distintos medios de pago y sin disponibilidad. | 3 |
| **Total** | **16** |

**Criterios de aceptación**

- El empleado busca vuelos con los mismos criterios que en la web y ve la disponibilidad actualizada.
- Puede vender de 1 a 9 pasajes por transacción a un pasajero con o sin cuenta, cargando los datos de cada pasajero.
- El cobro se registra en efectivo o con tarjeta y, al registrarlo, la compra queda confirmada y se emiten los pasajes y la factura.
- La venta respeta el control de disponibilidad: nunca se vende más que la capacidad declarada.
- Cada venta queda asociada al empleado que la hizo.

#### US13 — Consulta de compras y reenvío de documentación

**Como:** Empleado de mostrador
**Quiero:** Consultar las compras de un pasajero y reenviarle sus pasajes y factura.
**De forma que:** Pueda resolver consultas y reclamos presenciales de los pasajeros.

**Estimación:** 3 SP · **Valor de negocio:** 5

**Tareas**

| Tarea | Horas |
|---|---:|
| Diseñar la pantalla de consulta de compras. | 2 |
| Implementar la búsqueda de compras por código, documento, apellido o email del pasajero. | 3 |
| Implementar el reenvío de los pasajes y la factura al email registrado o a uno nuevo. | 2 |
| Probar consultas y reenvíos, incluidos los casos sin resultados. | 2 |
| **Total** | **9** |

**Criterios de aceptación**

- El empleado busca compras por código de compra, documento, apellido o email del pasajero.
- Ve el detalle de cada compra: vuelo, fecha, pasajeros, clase, importe y estado.
- Puede reenviar los pasajes y la factura de una compra confirmada al email registrado o al que indique el pasajero.
- Cada reenvío queda registrado con el empleado que lo pidió.

#### US14 — Reportes de ocupación

**Como:** Administrador
**Quiero:** Consultar reportes de ocupación filtrados por vuelo, clase y fecha.
**De forma que:** Conozca la ocupación real de cada vuelo y pueda tomar decisiones comerciales.

**Estimación:** 5 SP · **Valor de negocio:** 8

**Tareas**

| Tarea | Horas |
|---|---:|
| Diseñar la pantalla de reportes y sus filtros. | 3 |
| Implementar la consulta de ocupación por vuelo, clase y rango de fechas. | 4 |
| Mostrar el porcentaje de ocupación, los asientos vendidos, reservados y disponibles, y lo recaudado. | 4 |
| Permitir exportar el reporte a CSV. | 2 |
| Probar los reportes contra datos de ventas conocidos. | 3 |
| **Total** | **16** |

**Criterios de aceptación**

- El administrador filtra la ocupación por vuelo, clase y rango de fechas.
- Para cada salida se muestran la capacidad, los pasajes vendidos, las reservas pendientes, los asientos disponibles, el porcentaje de ocupación y lo recaudado.
- Las cifras coinciden con las ventas registradas (se verifica con datos de prueba conocidos).
- El reporte se puede exportar a CSV.
- Solo los administradores pueden ver los reportes.

#### US16 — Administración de cuentas de usuarios internos

**Como:** Administrador
**Quiero:** Crear, modificar y deshabilitar cuentas de empleados de mostrador y de otros administradores.
**De forma que:** Se controle quién tiene acceso a las funciones internas del sistema.

**Estimación:** 3 SP · **Valor de negocio:** 5

**Tareas**

| Tarea | Horas |
|---|---:|
| Diseñar la pantalla de administración de cuentas internas. | 2 |
| Implementar el alta y la modificación de empleados de mostrador y administradores. | 3 |
| Implementar la deshabilitación de cuentas, cerrando sus sesiones activas. | 2 |
| Probar los accesos con cuentas habilitadas y deshabilitadas. | 2 |
| **Total** | **9** |

**Criterios de aceptación**

- El administrador crea cuentas de mostrador y de administrador con nombre, email y contraseña inicial.
- Puede modificar los datos y el perfil de una cuenta interna.
- Una cuenta deshabilitada no puede iniciar sesión y sus sesiones activas se cierran.
- Un administrador no puede deshabilitar su propia cuenta.
- Cada alta, modificación y deshabilitación queda registrada en la auditoría.

#### US19 — Pruebas de carga del módulo de búsqueda y compra

**Como:** Miembro del equipo de desarrollo
**Quiero:** Ejecutar pruebas de carga con al menos 200 usuarios concurrentes sobre la búsqueda y la compra.
**De forma que:** Se valide el objetivo de tiempo de respuesta menor a 3 segundos definido en el StartUp.

**Estimación:** 5 SP · **Valor de negocio:** 5

**Tareas**

| Tarea | Horas |
|---|---:|
| Elegir la herramienta de carga y preparar el entorno y los datos de prueba. | 4 |
| Escribir los escenarios de búsqueda y de compra con 200 usuarios concurrentes. | 4 |
| Ejecutar las pruebas y medir los tiempos de respuesta y los errores. | 3 |
| Corregir los cuellos de botella encontrados (índices, consultas y conexiones). | 3 |
| Documentar los resultados y repetir la prueba después de las correcciones. | 2 |
| **Total** | **16** |

**Criterios de aceptación**

- Se simulan al menos 200 usuarios concurrentes buscando vuelos y comprando pasajes.
- El 95 % de las búsquedas y de las compras responde en menos de 3 segundos.
- Durante la prueba no hay sobreventa ni errores del servidor.
- Los resultados (tiempos, errores y cambios hechos) quedan documentados.

### 4.3 Tareas de integración y reserva

| Tarea | Horas |
|---|---:|
| Testear el incremento, integrarlo y preparar la demo (US20). | 4 |
| Reserva para imprevistos. | 5 |
| **Total del Sprint 3 (historias: 98 h)** | **107** |

### 4.4 Riesgos a supervisar en este sprint

| Riesgo (exposición) | Cómo se atiende en el Sprint 3 |
|---|---|
| Riesgo 1: sobreventa por concurrencia (12) | La venta del mostrador (US12) usa la misma reserva temporal y confirmación atómica que la web, y US6 impide reducir la capacidad por debajo de lo vendido. US19 verifica que no haya sobreventa bajo carga. |
| Riesgo 2: tiempos de respuesta bajo carga | US19 prepara el entorno de pruebas de carga el primer día, mide la búsqueda y la compra con 200 usuarios concurrentes y deja tiempo para corregir lo que no llegue a los 3 segundos. |
| Riesgo 4: no entrega de correos (9) | Los avisos de US15 y los reenvíos de US13 usan la cola de correos con reintentos y registro de estado de US10. |
| Riesgo 5: fecha de entrega comprometida (9) | Es el último sprint de la materia: se revisa el avance en el hito del lunes 26/10 y, si hay un atraso importante, se renegocia el alcance con el equipo implementador. La primera historia a postergar es US16, la de menor prioridad. |

### 4.5 Plan de release actualizado

| Sprint | Historias (SP) | Estado |
|---|---|---|
| Sprint 1 (22/09 al 05/10) | US1, US2, US4, US5 y US7, más US3 resuelta con US4 (34 SP) | Terminado |
| Sprint 2 (06/10 al 19/10) | US8, US11, US9 y US10 (34 SP) | Terminado |
| Sprint 3 (20/10 al 02/11) | US6, US15, US12, US13, US14, US16 y US19 (31 SP) | Planificado |
| Después de la materia | US17 y US18: aplicación móvil (21 SP) | Sin planificar |
| Todos los sprints | US20: testeo del incremento antes de cada demo (3 SP) | En curso |

## 5. Código del equipo implementador

**Repositorio:** [https://github.com/EmanuelHerrera02/APS](https://github.com/EmanuelHerrera02/APS)

## Uso de inteligencia artificial

**Prompt usado:**

> “Formatea la nueva entrega ‘Sprint 2.docx’ igual como está formateado el documento del sprint anterior”. Se proporcionaron el documento “Sprint 2.docx” completo y el documento “Sprint_1_APS.docx”.
