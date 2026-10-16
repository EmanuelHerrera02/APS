# Configuración del correo (US10)

El backend toma SMTP desde variables de entorno; no se guardan credenciales en el código ni en la base. Para desarrollo, copiá `.env.example` a `.env` y completá valores locales. El proceso que inicia el backend debe recibir esas variables (SBT no carga `.env` automáticamente). En producción, cargalas en el gestor de secretos del runtime.

## Variables SMTP

| Variable | Uso | Valor habitual |
| --- | --- | --- |
| `AERONET_SMTP_HOST` | Host del proveedor SMTP | provisto por el proveedor |
| `AERONET_SMTP_PORT` | Puerto SMTP | `587` con STARTTLS o `465` con TLS implícito |
| `AERONET_SMTP_FROM` | Dirección remitente verificada | dirección del dominio propio |
| `AERONET_SMTP_USER` / `AERONET_SMTP_PASSWORD` | Credenciales, si el proveedor exige autenticación | secretos del proveedor |
| `AERONET_SMTP_STARTTLS` | Negociar TLS con STARTTLS | `true` |
| `AERONET_SMTP_SSL` | TLS implícito | `false` para puerto 587 |
| `AERONET_EMAIL_WORKER_ENABLED` | Habilitar el worker | `true` |

La URL, usuario y contraseña de la base se configuran con `AERONET_JDBC_URL`, `AERONET_DB_USER` y `AERONET_DB_PASSWORD`. No reutilices credenciales de desarrollo en producción. Si faltan el host o el remitente, el worker no arranca y deja un aviso sin revelar secretos.

## DNS de autenticación

Para habilitar entregas autenticadas, el administrador del dominio debe copiar del proveedor los registros SPF y DKIM exactos (TXT/CNAME según proveedor) y publicar una política DMARC inicial en `_dmarc.<dominio>`, por ejemplo `v=DMARC1; p=none; rua=mailto:<buzon-de-reportes>`. Después de revisar reportes y alinear remitente, DKIM y SPF, avanzar la política según el procedimiento del dominio. No publicar un SPF nuevo si ya existe: combinar los mecanismos en un único registro SPF.

Este repositorio no conoce el dominio, el selector DKIM, los valores del proveedor ni el buzón de reportes, por eso los registros deben generarse desde la consola del proveedor y no se inventan acá.

## Observabilidad

Con el worker activo, cada email aceptado registra `notification_id`, número de intento y tiempo de procesamiento; los fallos registran el ID y el error sin destinatario ni credenciales. Cada minuto se emite `email_queue_metrics` con cantidad activa, antigüedad máxima, aceptaciones y latencia media de la última hora, rebotes/fallos de 24 horas y casos con reintentos agotados. `ENVIADA` mide aceptación SMTP; `ENTREGADA` requiere un webhook/evento de entrega del proveedor, aún no conectado.

Validá en el entorno configurado con un buzón de prueba y la consola del proveedor. El tiempo `created_at` → `enviada_en` queda disponible como latencia de aceptación; la entrega final y SPF/DKIM/DMARC solo se pueden confirmar con el dominio y proveedor reales.
