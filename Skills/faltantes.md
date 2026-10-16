# Tareas pendientes y parciales

**Revisión:** 2026-10-16 · Sprint 2. Contraste de `Skills/tareas.md`, criterios en `plan_de_desarrollo_sprint_2.md`, código y pruebas existentes.

## US11 — Control de disponibilidad y sobreventa

- **Parcial — Evitar sobreventa en compras simultáneas.** `db/02_logic.sql` reserva con actualización condicional en `reservar_asientos`, confirma la compra bajo bloqueo y `db/01_schema.sql` limita `vendidos <= capacidad`. `db/04_tests.sql` valida capacidad y atomicidad en casos secuenciales; no hay prueba concurrente sobre los últimos asientos.
- **Pendiente — TTL de 10 minutos.** `db/02_logic.sql` asigna 15 minutos (`trg_compra_bi`); ajustar a 10 y verificar liberación automática.
- **Parcial — Aviso de disponibilidad insuficiente antes del pago.** `v_disponibilidad` devuelve plazas vigentes y la UI limita la cantidad seleccionable y muestra errores de reserva, incluido el conflicto de disponibilidad. Falta ejecutar el flujo HTTP cuando la disponibilidad cambia entre búsqueda y reserva.

## US9 — Pago en línea

- **Pendiente — Pasarela sandbox e integración.** No hay SDK/cliente de proveedor ni configuración sandbox en `backend` o `frontend`.
- **Parcial — ID único e idempotencia con proveedor.** `pago.id_transaccion_pasarela` tiene índice único; falta integración con el proveedor y verificar el procesamiento idempotente de callbacks/reintentos.
- **Parcial — Recepción asíncrona del resultado.** `registrar_pago` confirma o cancela compras al recibir el resultado, pero no hay endpoint webhook/polling que lo reciba y valide desde la pasarela.
- **Pendiente — UI de pago seguro.** No se encontró flujo de ingreso/tokenización de tarjeta ni feedback de estado en `frontend/src`.
- **Pendiente — Pruebas con tarjetas sandbox.** No hay evidencia de flujo aprobado, rechazado y pendiente contra un proveedor sandbox.
- **Parcial — Tratamiento de datos de tarjeta.** El esquema no almacena PAN/CVV y conserva marca/últimos cuatro; falta demostrar que los datos se procesan directamente en una pasarela, que aún no está integrada.

## US10 — Emisión de pasajes, facturación y notificaciones

- **Parcial — Emisión de pasajes y factura.** `db/02_logic.sql` emite pasajes y metadatos de factura al aprobar el pago; `DocumentIssuanceService` genera PDFs privados y persiste las rutas. `db/04_tests.sql` pasó 35/35 casos, incluidos pago rechazado sin factura y aprobado con factura. Falta ejecutar la generación PDF contra una compra real del entorno aislado; `INT-*` requiere configuración fiscal antes de usarlo como comprobante oficial.
- **Parcial — Email, estados y SLA.** `EmailQueueWorker` adjunta PDFs, reclama la cola, reintenta errores transitorios hasta 5 veces y registra rebotes/fallos; SMTP se configura por variables y hay logs de cola. `ENVIADA` solo prueba aceptación SMTP; falta evento del proveedor para `ENTREGADA`, configuración real SPF/DKIM/DMARC y medir menos de 2 minutos en un entorno con proveedor.
- **Parcial — Descarga manual de documentos.** `PassengerDocumentService` y endpoints de `PassengerController` filtran por titular y compra confirmada, y verifican que el PDF esté dentro del almacenamiento privado. `PassengerDashboard` lista documentos disponibles. Compilación Scala y build de frontend pasaron; falta prueba HTTP de propietario, otro usuario, compra pendiente y traversal.
- **Parcial — Prueba integrada y manejo de fallos.** `tests/http/us10-flujo-integrado.mjs` pasa `node --check`, y una copia temporal del backend compiló correctamente. No se ejecutó el flujo: sbt en la copia temporal devolvió código 0 sin ejecutar `runMain`, y el backend no quedó escuchando en `localhost:8080`. Siguen sin evidencia integrada el envío/reintento/rebote, la descarga y la latencia.
