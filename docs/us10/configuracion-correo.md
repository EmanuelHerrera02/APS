# Configuración del correo (US10)

El backend toma el proveedor de correo desde variables de entorno; no se guardan credenciales en el código ni en la base. Para desarrollo, copiá `.env.example` a `.env` y completá valores locales. El proceso que inicia el backend debe recibir esas variables (SBT no carga `.env` automáticamente). En producción, cargalas en el gestor de secretos del runtime.

Pasos para dejar el envío listo:

1. **Desarrollo:** usar el servidor SMTP local (Mailpit) de la sección siguiente.
2. **Producción:** autenticar el dominio en SendGrid y publicar los registros DNS con `tools/email/sendgrid-configurar.mjs`.
3. Verificar SPF, DKIM y DMARC con `tools/email/verificar-dns-correo.mjs`.
4. Activar el Event Webhook firmado y cargar su clave pública en la API.
5. Revisar al iniciar la API que no aparezcan avisos `Configuración de correo:` en el log.

## Servidor de correo local (desarrollo)

`docker-compose.yml` incluye Mailpit en el perfil opcional `correo`: recibe los correos del worker sin entregarlos a buzones reales y muestra una bandeja web.

```powershell
docker compose --profile correo up -d mail
$env:AERONET_EMAIL_PROVIDER = "smtp"
$env:AERONET_SMTP_HOST = "localhost"
$env:AERONET_SMTP_PORT = "1025"
$env:AERONET_SMTP_FROM = "no-reply@aeronet.test"
$env:AERONET_SMTP_STARTTLS = "false"
```

La bandeja queda en `http://localhost:8025` y su API (`/api/v1/messages`) permite comprobar asunto, destinatario, adjuntos y el header `X-Aeronet-Notification-ID`. En la verificación del 2026-10-18 una compra pagada con tarjeta llegó a Mailpit 10,5 s después del pago, con la factura y los dos pasajes en PDF.

## Proveedor y variables

`AERONET_EMAIL_PROVIDER=smtp` conserva el transporte SMTP y es el valor predeterminado. Para producción se puede seleccionar `sendgrid`; el worker usa Mail Send API v3, adjunta los PDFs, envía `X-Aeronet-Notification-ID` y agrega `notification_id` como `custom_args` para correlacionar eventos sin PII. SendGrid responde HTTP 202 cuando acepta el mensaje; esto no prueba la entrega final. La API requiere una API key restringida al permiso Mail Send.

| Variable | Uso | Valor habitual |
| --- | --- | --- |
| `AERONET_SMTP_HOST` | Host del proveedor SMTP | provisto por el proveedor |
| `AERONET_SMTP_PORT` | Puerto SMTP | `587` con STARTTLS o `465` con TLS implícito |
| `AERONET_SMTP_FROM` | Dirección remitente verificada (también la usan `sendgrid` y el `Message-ID`) | dirección del dominio propio |
| `AERONET_SMTP_USER` / `AERONET_SMTP_PASSWORD` | Credenciales, si el proveedor exige autenticación | secretos del proveedor |
| `AERONET_SMTP_STARTTLS` | Negociar TLS con STARTTLS | `true` |
| `AERONET_SMTP_SSL` | TLS implícito | `false` para puerto 587 |
| `AERONET_SMTP_EHLO_NAME` | Nombre que se anuncia en `EHLO` | por defecto, el dominio de `AERONET_SMTP_FROM` |
| `AERONET_EMAIL_DOMAIN` | Dominio autenticado (SPF/DKIM); el arranque avisa si el remitente no está alineado | dominio propio |
| `AERONET_EMAIL_WORKER_ENABLED` | Habilitar el worker | `true` |
| `AERONET_EMAIL_WEBHOOK_SECRET` | Secreto compartido para autenticar eventos del proveedor (mínimo 32 caracteres) | secreto aleatorio del gestor de secretos |
| `AERONET_SENDGRID_API_KEY` | API key de SendGrid con permiso Mail Send (solo con `sendgrid`) | gestor de secretos |
| `AERONET_SENDGRID_WEBHOOK_PUBLIC_KEY` | Clave pública EC para validar Signed Event Webhook | la imprime `sendgrid-configurar.mjs webhook` |

La URL, usuario y contraseña de la base se configuran con `AERONET_JDBC_URL`, `AERONET_DB_USER` y `AERONET_DB_PASSWORD`. No reutilices credenciales de desarrollo en producción. Si faltan el host o el remitente, el worker no arranca y deja un aviso sin revelar secretos.

### Avisos al iniciar

Con el worker activo, la API registra `Configuración de correo: …` cuando algo impide cumplir parte de la US10 aunque el envío funcione: falta la clave pública del webhook de SendGrid o el secreto del webhook normalizado (las notificaciones quedarían en `ENVIADA` sin estado final), SMTP hacia un host remoto sin STARTTLS ni TLS, o un remitente fuera de `AERONET_EMAIL_DOMAIN` (DMARC no alineado).

### Rendimiento del envío SMTP

El worker fija `mail.from` y `mail.smtp.localhost` (`EHLO`). Sin esos valores JavaMail resuelve el nombre canónico del equipo por DNS inverso en cada mensaje; en el entorno de desarrollo eso llevaba cada envío a ~19 s y una cola de 20 correos excedía el SLA de 2 minutos. Con la configuración actual cada envío a Mailpit tarda ~40 ms. Los adjuntos se envían como `application/pdf`.

## Autenticación del dominio en SendGrid (SPF, DKIM, DMARC)

`tools/email/sendgrid-configurar.mjs` usa la API v3 de SendGrid. La API key se toma de `SENDGRID_API_KEY` (o `AERONET_SENDGRID_API_KEY`) y nunca se imprime; para estos comandos usá una key administrativa aparte, con permisos de *Sender Authentication* y de configuración del Event Webhook; la API sigue usando la key restringida a Mail Send.

```powershell
$env:SENDGRID_API_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "API key de SendGrid" -AsSecureString)).Password
node tools/email/sendgrid-configurar.mjs dominio --dominio aeronet.com.ar --rua dmarc@aeronet.com.ar
```

El comando crea (o reutiliza) la autenticación del dominio con seguridad automática e imprime los registros a publicar:

- `CNAME em1234.<dominio>` → return-path de SendGrid. SPF se evalúa sobre este subdominio, así que no hace falta otro registro SPF.
- `CNAME s1._domainkey.<dominio>` y `CNAME s2._domainkey.<dominio>` → claves DKIM que SendGrid rota.
- `TXT _dmarc.<dominio>` → política DMARC inicial `v=DMARC1; p=none; rua=mailto:…; adkim=r; aspf=r; fo=1`.

Si el dominio ya tiene un TXT `_dmarc`, conservá ese único registro y agregale el `rua`. Si ya existe un SPF en el dominio raíz, no publiques otro: debe haber uno solo.

Una vez publicados los registros en el DNS:

```powershell
node tools/email/sendgrid-configurar.mjs validar --dominio aeronet.com.ar
node tools/email/verificar-dns-correo.mjs --dominio aeronet.com.ar --proveedor sendgrid --return-path em1234
```

`verificar-dns-correo.mjs` consulta el DNS público y muestra `PASA`/`FALLA`/`AVISO` para SPF (registro único, mecanismo esperado, límite de 10 consultas), return-path, cada selector DKIM, la política DMARC y la alineación del remitente de `AERONET_SMTP_FROM`. Sale con código 1 si algún control falla. Con otro proveedor SMTP se indican sus selectores y el include de SPF, por ejemplo `--selectores google --spf-include _spf.google.com`. Después de revisar los reportes DMARC durante unas semanas, subir la política a `quarantine` y luego a `reject`.

## Webhook de eventos y estados de entrega

```powershell
node tools/email/sendgrid-configurar.mjs webhook --url https://api.aeronet.com.ar/webhooks/email/sendgrid/
```

Activa el Event Webhook con los eventos delivered, bounce (incluye blocked) y dropped, habilita la firma ECDSA e imprime `AERONET_SENDGRID_WEBHOOK_PUBLIC_KEY` para cargar en la API. El endpoint `POST /webhooks/email/sendgrid/` valida la firma sobre el timestamp y el cuerpo originales, toma `sg_event_id` como clave idempotente y lee `notification_id` de `custom_args`. La ruta `/webhooks/email/` sigue disponible para integraciones normalizadas/proxies autenticados con `X-Aeronet-Webhook-Secret`. Los eventos finales solo actualizan notificaciones `ENVIADA` de confirmación/reenvío; deferred/processed y eventos de interacción se ignoran.

## Cola y reintentos

El worker toma lotes de hasta 10 correos cada 5 segundos (`FOR UPDATE SKIP LOCKED`), espera a que estén generados la factura y los pasajes, y reintenta los fallos temporales a los 30 s, 2 min, 10 min y 30 min, hasta 5 intentos. Un rechazo permanente del destinatario queda `REBOTADA`; los intentos agotados quedan `FALLIDA` y se registran en el log. Un correo que quedó `PROCESANDO` por un corte del proceso se retoma a los 2 minutos.

## Observabilidad

Cada email aceptado registra `notification_id`, número de intento y tiempo de procesamiento; los fallos registran el ID y el error sin destinatario ni credenciales. Cada minuto se emite `email_queue_metrics` con cantidad activa, antigüedad máxima, aceptaciones y latencia media de la última hora, entregas confirmadas en menos de 2 minutos, rebotes/fallos de 24 horas y casos con reintentos agotados. `ENVIADA` mide aceptación del proveedor; `ENTREGADA`, `REBOTADA` o `FALLIDA` llegan por los webhooks autenticados.

El tiempo `created_at` → `enviada_en` mide aceptación, no entrega final; medí la entrega con `received_at` del evento y `created_at` para evaluar el SLA inferior a 120 segundos.

## Pendiente fuera del repositorio

Estos pasos requieren recursos que el repositorio no tiene y debe hacerlos quien administre la cuenta y el dominio: crear la cuenta de SendGrid y su API key, ejecutar los comandos `dominio`, `validar` y `webhook` con el dominio real, publicar los registros en el DNS del dominio y medir el SLA con entregas reales en un buzón de prueba.
