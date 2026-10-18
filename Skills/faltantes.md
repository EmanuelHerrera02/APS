# Tareas pendientes y parciales

**Revisión:** 2026-10-18 · Sprint 2. Contraste de `Skills/tareas.md`, criterios en `plan_de_desarrollo_sprint_2.md`, código y pruebas existentes.

## US11 — Control de disponibilidad y sobreventa

- **Completado — Control de disponibilidad, TTL de 10 minutos, confirmación atómica y pruebas de concurrencia.** `db/02_logic.sql` y la migración `db/migrations/20261018_us11_disponibilidad_ttl.sql` fijan el TTL de reserva temporal en 10 minutos (`trg_compra_bi`), liberan reservas vencidas por evento cada minuto y antes de buscar/reservar en `PassengerController.scala`, confirman atómicamente contra inventario con `confirmar_compra` y `trg_compra_bu`, muestran alertas previas al pago en `PassengerDashboard.jsx` y cuentan con casos `T36`–`T37` en `db/04_tests.sql` más la suite `tests/http/us11-disponibilidad-concurrencia.mjs` (ver `docs/pruebas-disponibilidad-sobreventa.md`).

## US9 — Pago en línea

- **Pendiente — Pasarela sandbox e integración.** No hay SDK/cliente de proveedor ni configuración sandbox en `backend` o `frontend`.
- **Parcial — ID único e idempotencia con proveedor.** `pago.id_transaccion_pasarela` tiene índice único; falta integración con el proveedor y verificar el procesamiento idempotente de callbacks/reintentos.
- **Parcial — Recepción asíncrona del resultado.** `registrar_pago` confirma o cancela compras al recibir el resultado, pero no hay endpoint webhook/polling que lo reciba y valide desde la pasarela.
- **Pendiente — UI de pago seguro.** No se encontró flujo de ingreso/tokenización de tarjeta ni feedback de estado en `frontend/src`.
- **Pendiente — Pruebas con tarjetas sandbox.** No hay evidencia de flujo aprobado, rechazado y pendiente contra un proveedor sandbox.
- **Parcial — Tratamiento de datos de tarjeta.** El esquema no almacena PAN/CVV y conserva marca/últimos cuatro; falta demostrar que los datos se procesan directamente en una pasarela, que aún no está integrada.

## US10 — Emisión de pasajes, facturación y notificaciones

- **Parcial — Configuración productiva y SLA del proveedor.** Se implementó el adaptador SendGrid Mail Send v3 con adjuntos y `custom_args.notification_id`; `POST /webhooks/email/sendgrid/` valida la firma ECDSA, deduplica por `sg_event_id` y procesa entregas, rebotes y descartes. SMTP sigue disponible para desarrollo y el webhook normalizado se conserva. La prueba integrada SMTP pasó 18/18 en la base aislada; la entrega simulada fue a los 33 segundos. Falta activar SendGrid con una cuenta/API key, configurar el Event Webhook firmado con su clave pública, publicar SPF/DKIM/DMARC para el dominio real y medir el SLA con entregas reales.
