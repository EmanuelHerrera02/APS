# Prueba integrada US10

El script `tests/http/us10-flujo-integrado.mjs` usa una base Docker aislada, una API local y un servidor SMTP falso que vive durante la prueba. Cubre pago aprobado/rechazado, generación idempotente de PDFs, reintento de un fallo SMTP temporal, rebote permanente, descargas de factura/pasaje por el titular, denegación a otro usuario, compra pendiente, escape del almacenamiento y latencia de aceptación.

## Preparación

1. Iniciar la base aislada usada para compra HTTP: `AERONET_DB_PORT=3312 docker compose -f docker-compose.yml -f docker-compose.us8.yml -p aeronet-us8 up -d --wait db` (en PowerShell, asignar `$env:AERONET_DB_PORT = '3312'` antes del comando).
2. Aplicar `db/migrations/20261016_us10_emision_documentos.sql` y `db/migrations/20261016_us10_email_delivery_events.sql` si el volumen no tiene el esquema actualizado.
3. Iniciar `BackendMain` con `AERONET_JDBC_URL=jdbc:mariadb://localhost:3312/aeronet`, usuario/clave de esa base, `AERONET_JWT_SECRET` de al menos 32 bytes, `AERONET_EMAIL_WEBHOOK_SECRET` de al menos 32 caracteres, `AERONET_SMTP_HOST=127.0.0.1`, `AERONET_SMTP_PORT=2525`, `AERONET_SMTP_FROM=no-reply@aeronet.test`, `AERONET_SMTP_STARTTLS=false`, `AERONET_SMTP_SSL=false`, y `AERONET_DOCUMENT_TEMPLATE_DIR` apuntando a `docs/us10/templates`. Para la prueba, usar un `AERONET_DOCUMENT_STORAGE` temporal y no el almacenamiento de producción.
4. Ejecutar `node tests/http/us10-flujo-integrado.mjs` con Node 18 o posterior y Docker disponible. La prueba agrega datos al volumen aislado, así que puede repetirse sin afectar la base compartida; usa emails/documentos con identificadores únicos.

La prueba SMTP simula una aceptación, un error temporal y un rechazo permanente; prueba correlación por `X-Aeronet-Notification-ID`, callback de entrega e idempotencia, rechazo de callback no autorizado y latencia de encolado a entrega simulada. No prueba reputación de dominio, SPF/DKIM/DMARC, entrega a bandeja real ni un proveedor de producción. La marca `ENVIADA` representa aceptación SMTP y `ENTREGADA` requiere el evento autenticado del proveedor.
