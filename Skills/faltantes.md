# Tareas pendientes y parciales

**Revisión:** 2026-10-18 · Sprint 2. Contraste de `Skills/tareas.md`, criterios en `plan_de_desarrollo_sprint_2.md`, código y pruebas existentes.

## US11 — Control de disponibilidad y sobreventa

- **Completado — Control de disponibilidad, TTL de 10 minutos, confirmación atómica y pruebas de concurrencia.** `db/02_logic.sql` y la migración `db/migrations/20261018_us11_disponibilidad_ttl.sql` fijan el TTL de reserva temporal en 10 minutos (`trg_compra_bi`), liberan reservas vencidas por evento cada minuto y antes de buscar/reservar en `PassengerController.scala`, confirman atómicamente contra inventario con `confirmar_compra` y `trg_compra_bu`, muestran alertas previas al pago en `PassengerDashboard.jsx` y cuentan con casos `T36`–`T37` en `db/04_tests.sql` más la suite `tests/http/us11-disponibilidad-concurrencia.mjs` (ver `docs/pruebas-disponibilidad-sobreventa.md`).

## US9 — Pago en línea

- **No verificable — Prueba contra el sandbox real de Mercado Pago (US9-AC5).** La integración (`backend/.../payments`, `PaymentController`, `PaymentWebhookController`, `PaymentPanel.jsx`, `transaccion_pago` y sus procedimientos) pasó `db/04_tests.sql` (47/47, T38–T47) y `tests/http/us9-pago-en-linea.mjs` (21/21) contra el sandbox local `tests/sandbox/mercadopago-sandbox.mjs`, y se verificó la UI en Chrome headless (aprobado y pendiente→aprobado por webhook, sin datos de tarjeta hacia la API). Falta ejecutar el checklist de `docs/pruebas-pago-en-linea.md` (sección 4) con las credenciales de prueba de la cuenta de Mercado Pago del equipo y un webhook expuesto por HTTPS.

## US10 — Emisión de pasajes, facturación y notificaciones

- **Parcial — Configuración productiva y SLA del proveedor.** En el repositorio quedan el adaptador SendGrid (Mail Send v3 + Event Webhook firmado), Mailpit como SMTP de desarrollo, `tools/email/sendgrid-configurar.mjs` (autenticación de dominio, registros DNS y webhook) y `tools/email/verificar-dns-correo.mjs` (SPF/DKIM/DMARC, probado contra DNS público). Con Mailpit el email con factura y pasajes llegó 10,5 s después del pago; se corrigió la demora de ~19 s por correo del worker SMTP. Falta crear la cuenta/API key de SendGrid, ejecutar `dominio`, `validar` y `webhook` con el dominio real, publicar los registros en su DNS y medir el SLA con entregas reales.
- **Discrepancia — `db/03_seed.sql` falla en una base nueva.** En la línea 171 inserta a mano la factura de la compra C1, pero `registrar_pago` ya la emite (`emitir_factura_compra`): `Duplicate entry … uq_factura_compra`. El resto del seed no se carga; el contenedor arranca igual porque al reiniciarse omite la inicialización. Hay que quitar o adaptar las facturas manuales del seed.
