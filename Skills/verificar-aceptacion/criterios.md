# Catálogo de criterios de aceptación

Este catálogo conserva los criterios de los Sprints 2 y 3 para verificaciones futuras. Fuentes principales: `plan_de_desarrollo_sprint_2.md` (US8, US11, US9, US10) y `plan_de_desarrollo_sprint_3.txt`, sección 4.2 (US6, US15, US12, US13, US14, US16, US19). `Skills/tareas.md` sirve como referencia secundaria para detectar cambios o discrepancias.

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

## US6 — Modificación y cancelación de vuelos

Fuente: Plan Sprint 3, sección 4.2.

- **US6-AC1:** El administrador modifica horarios, días de operación, período de venta, capacidades y precios con las mismas validaciones del alta.
- **US6-AC2:** No se puede reducir la capacidad de una clase por debajo de los pasajes ya vendidos.
- **US6-AC3:** Un cambio de precio no modifica el importe de los pasajes ya comprados.
- **US6-AC4:** Se cancela un vuelo completo o una salida puntual con motivo; las compras pendientes de pago se cancelan y la salida deja de aparecer en la búsqueda.
- **US6-AC5:** Cada modificación y cancelación queda en la auditoría con el usuario que la hizo.
- **US6-T4 (tarea):** Impedir los cambios que dejen sin lugar a pasajes ya vendidos (incluye período y días de operación, no solo capacidad).

## US15 — Notificaciones de cambios y cancelaciones

Fuente: Plan Sprint 3, sección 4.2.

- **US15-AC1:** Ante un cambio de horario, cada pasajero con compra confirmada recibe un correo con el horario anterior y el nuevo.
- **US15-AC2:** Ante la cancelación de un vuelo o salida, cada pasajero afectado recibe un correo con el motivo.
- **US15-AC3:** En las pruebas, el aviso llega dentro de los 2 minutos posteriores al cambio.
- **US15-AC4:** Un envío fallido se reintenta automáticamente y queda registrado el estado de cada aviso (entregado, rebotado o fallido).
- **US15-AC5:** Los cambios que no afectan el viaje (por ejemplo, de precio) no generan avisos.

## US12 — Venta de pasajes desde el mostrador

Fuente: Plan Sprint 3, sección 4.2.

- **US12-AC1:** El empleado busca vuelos con los mismos criterios que la web y ve la disponibilidad actualizada.
- **US12-AC2:** Vende de 1 a 9 pasajes por transacción a un pasajero con o sin cuenta, cargando los datos de cada pasajero.
- **US12-AC3:** El cobro se registra en efectivo o con tarjeta; al registrarlo la compra queda confirmada y se emiten pasajes y factura.
- **US12-AC4:** La venta respeta el control de disponibilidad: nunca se vende más que la capacidad declarada.
- **US12-AC5:** Cada venta queda asociada al empleado que la hizo.

## US13 — Consulta de compras y reenvío de documentación

Fuente: Plan Sprint 3, sección 4.2.

- **US13-AC1:** El empleado busca compras por código de compra, documento, apellido o email del pasajero.
- **US13-AC2:** Ve el detalle de cada compra: vuelo, fecha, pasajeros, clase, importe y estado.
- **US13-AC3:** Reenvía pasajes y factura de una compra confirmada al email registrado o al que indique el pasajero.
- **US13-AC4:** Cada reenvío queda registrado con el empleado que lo pidió.

## US14 — Reportes de ocupación

Fuente: Plan Sprint 3, sección 4.2.

- **US14-AC1:** El administrador filtra la ocupación por vuelo, clase y rango de fechas.
- **US14-AC2:** Por salida se muestran capacidad, pasajes vendidos, reservas pendientes, asientos disponibles, porcentaje de ocupación y recaudado.
- **US14-AC3:** Las cifras coinciden con las ventas registradas (verificado con datos de prueba conocidos).
- **US14-AC4:** El reporte se puede exportar a CSV.
- **US14-AC5:** Solo los administradores pueden ver los reportes.

## US16 — Administración de cuentas de usuarios internos

Fuente: Plan Sprint 3, sección 4.2.

- **US16-AC1:** El administrador crea cuentas de mostrador y de administrador con nombre, email y contraseña inicial.
- **US16-AC2:** Puede modificar los datos y el perfil de una cuenta interna.
- **US16-AC3:** Una cuenta deshabilitada no puede iniciar sesión y sus sesiones activas se cierran.
- **US16-AC4:** Un administrador no puede deshabilitar su propia cuenta.
- **US16-AC5:** Cada alta, modificación y deshabilitación queda registrada en la auditoría.

## US19 — Pruebas de carga del módulo de búsqueda y compra

Fuente: Plan Sprint 3, sección 4.2.

- **US19-AC1:** Se simulan al menos 200 usuarios concurrentes buscando vuelos y comprando pasajes.
- **US19-AC2:** El 95 % de las búsquedas y de las compras responde en menos de 3 segundos.
- **US19-AC3:** Durante la prueba no hay sobreventa ni errores del servidor.
- **US19-AC4:** Los resultados (tiempos, errores y cambios hechos) quedan documentados.
