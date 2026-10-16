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

- **Parcial — Configuración productiva y SLA del proveedor.** Se implementó el adaptador SendGrid Mail Send v3 con adjuntos y `custom_args.notification_id`; `POST /webhooks/email/sendgrid/` valida la firma ECDSA, deduplica por `sg_event_id` y procesa entregas, rebotes y descartes. SMTP sigue disponible para desarrollo y el webhook normalizado se conserva. La prueba integrada SMTP pasó 18/18 en la base aislada; la entrega simulada fue a los 33 segundos. Falta activar SendGrid con una cuenta/API key, configurar el Event Webhook firmado con su clave pública, publicar SPF/DKIM/DMARC para el dominio real y medir el SLA con entregas reales.
