# Configuración del correo (US10)

El backend toma el proveedor de correo desde variables de entorno; no se guardan credenciales en el código ni en la base. Para desarrollo, copiá `.env.example` a `.env` y completá valores locales. El proceso que inicia el backend debe recibir esas variables (SBT no carga `.env` automáticamente). En producción, cargalas en el gestor de secretos del runtime.

## Proveedor y variables SMTP

`AERONET_EMAIL_PROVIDER=smtp` conserva el transporte SMTP y es el valor predeterminado. Para producción se puede seleccionar `sendgrid`; el worker usa Mail Send API v3, adjunta los PDFs, envía `X-Aeronet-Notification-ID` y agrega `notification_id` como `custom_args` para correlacionar eventos sin PII. SendGrid responde HTTP 202 cuando acepta el mensaje; esto no prueba la entrega final. La API requiere una API key restringida al permiso Mail Send.

| Variable | Uso | Valor habitual |
| --- | --- | --- |
| `AERONET_SMTP_HOST` | Host del proveedor SMTP | provisto por el proveedor |
| `AERONET_SMTP_PORT` | Puerto SMTP | `587` con STARTTLS o `465` con TLS implícito |
| `AERONET_SMTP_FROM` | Dirección remitente verificada | dirección del dominio propio |
| `AERONET_SMTP_USER` / `AERONET_SMTP_PASSWORD` | Credenciales, si el proveedor exige autenticación | secretos del proveedor |
| `AERONET_SMTP_STARTTLS` | Negociar TLS con STARTTLS | `true` |
| `AERONET_SMTP_SSL` | TLS implícito | `false` para puerto 587 |
| `AERONET_EMAIL_WORKER_ENABLED` | Habilitar el worker | `true` |
| `AERONET_EMAIL_WEBHOOK_SECRET` | Secreto compartido para autenticar eventos del proveedor (mínimo 32 caracteres) | secreto aleatorio del gestor de secretos |
| `AERONET_SENDGRID_API_KEY` | API key de SendGrid con permiso Mail Send (solo con `sendgrid`) | gestor de secretos |
| `AERONET_SENDGRID_WEBHOOK_PUBLIC_KEY` | Clave pública EC para validar Signed Event Webhook | clave descargada de la configuración del webhook |

La URL, usuario y contraseña de la base se configuran con `AERONET_JDBC_URL`, `AERONET_DB_USER` y `AERONET_DB_PASSWORD`. No reutilices credenciales de desarrollo en producción. Si faltan el host o el remitente, el worker no arranca y deja un aviso sin revelar secretos.

## DNS de autenticación

Para habilitar entregas autenticadas, el administrador del dominio debe copiar del proveedor los registros SPF y DKIM exactos (TXT/CNAME según proveedor) y publicar una política DMARC inicial en `_dmarc.<dominio>`, por ejemplo `v=DMARC1; p=none; rua=mailto:<buzon-de-reportes>`. Después de revisar reportes y alinear remitente, DKIM y SPF, avanzar la política según el procedimiento del dominio. No publicar un SPF nuevo si ya existe: combinar los mecanismos en un único registro SPF.

Este repositorio no conoce el dominio, el selector DKIM, los valores del proveedor ni el buzón de reportes, por eso los registros deben generarse desde la consola del proveedor y no se inventan acá.

## Observabilidad

Con el worker activo, cada email aceptado registra `notification_id`, número de intento y tiempo de procesamiento; los fallos registran el ID y el error sin destinatario ni credenciales. Cada minuto se emite `email_queue_metrics` con cantidad activa, antigüedad máxima, aceptaciones y latencia media de la última hora, rebotes/fallos de 24 horas y casos con reintentos agotados. `ENVIADA` mide aceptación SMTP. El endpoint `POST /webhooks/email/` actualiza la notificación a `ENTREGADA`, `REBOTADA` o `FALLIDA` al recibir eventos autenticados del proveedor.

SendGrid debe configurarse con Signed Event Webhook apuntando a `POST /webhooks/email/sendgrid/`, seleccionando delivered, bounce, blocked y dropped. El endpoint valida la firma ECDSA sobre el timestamp y cuerpo originales, toma `sg_event_id` como clave idempotente y lee `notification_id` de `custom_args`. La ruta `/webhooks/email/` sigue disponible para integraciones normalizadas/proxies autenticados con `X-Aeronet-Webhook-Secret`. Los eventos finales solo actualizan notificaciones `ENVIADA` de confirmación/reenvío; deferred/processed y eventos de interacción se ignoran.

Validá en el entorno configurado con un buzón de prueba y la consola del proveedor. El tiempo `created_at` → `enviada_en` mide aceptación, no entrega final; medí la entrega con `received_at` del evento y `created_at` para evaluar el SLA inferior a 120 segundos. La entrega final y SPF/DKIM/DMARC solo se pueden confirmar con el dominio y proveedor reales.
