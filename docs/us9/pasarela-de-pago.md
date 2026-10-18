# Pasarela de pago en línea (US9)

## Pasarela elegida: Mercado Pago

Se integró **Mercado Pago** (Checkout API con el *Card Payment Brick*):

- Opera en pesos argentinos con las tarjetas locales, que es el mercado de AeroNet (el seed ya
  registraba pagos con identificadores `MP-…`).
- El Brick tokeniza la tarjeta **en el navegador, contra Mercado Pago**: el backend solo recibe un
  token de un solo uso. AeroNet nunca procesa ni guarda PAN, CVV ni vencimiento.
- La API de pagos acepta `X-Idempotency-Key`: reintentar un cobro con la misma clave devuelve el
  mismo pago en lugar de cobrar otra vez.
- Ofrece webhooks firmados (`x-signature`) y consulta de pagos por id o por `external_reference`,
  lo que permite confirmar en forma asincrónica y conciliar.
- Tiene entorno de pruebas con credenciales de test y tarjetas de prueba cuyo resultado depende del
  nombre del titular (aprobado, rechazado, pendiente).

## Flujo

1. El pasajero crea la compra: queda `PENDIENTE_PAGO` con los asientos reservados por 10 minutos (US8/US11).
2. El frontend pide `GET /payments/config` (clave pública y URL del SDK) y
   `POST /payments/transactions {purchaseId}`. La base crea una `transaccion_pago` con un **UUID v4**
   generado por el backend, o devuelve la transacción activa si ya existía (dos clics → mismo UUID).
3. El Brick tokeniza la tarjeta directamente contra Mercado Pago y devuelve `token`,
   `payment_method_id`, `issuer_id` y datos del pagador.
4. `POST /payments/transactions/{uuid}/card` envía solo esos datos. El backend llama a
   `POST /v1/payments` con `X-Idempotency-Key = uuid` y `external_reference = uuid`.
5. El resultado se aplica con `resolver_transaccion_pago()`:
   - `approved` → transacción `APROBADA`, compra `CONFIRMADA` (pasajes emitidos, factura y email, US10).
   - `rejected`/`cancelled` → `RECHAZADA`, compra `CANCELADA` y asientos liberados.
   - `in_process`/`pending` → `PENDIENTE`: la reserva sigue vigente hasta su vencimiento.
6. Confirmación asincrónica:
   - **Webhook** `POST /webhooks/payments/mercadopago`: valida la firma y consulta el pago en la API
     con credenciales propias. El estado nunca se toma del cuerpo recibido.
   - **Polling** (`PaymentLifecycle`): cada `AERONET_PAYMENT_RECONCILE_SECONDS` revisa las
     transacciones `PROCESANDO`/`PENDIENTE` de los últimos 7 días, por id de pago o, si la respuesta
     original se perdió, por `external_reference`. La espera entre consultas crece hasta 5 minutos.
7. Si un pago se aprueba cuando la reserva ya venció, `registrar_pago()` devuelve
   `REQUIERE_REEMBOLSO` y el backend lo reembolsa (`POST /v1/payments/{id}/refunds`, con su propia
   clave de idempotencia). Si el reembolso falla, el conciliador lo reintenta.

## Módulo de integración

| Archivo | Responsabilidad |
| --- | --- |
| `backend/.../payments/PaymentGateway.scala` | Contrato `PaymentGateway`, tipos normalizados y selección de la pasarela por variables de entorno |
| `backend/.../payments/MercadoPagoGateway.scala` | Cliente HTTP de Mercado Pago (cobro, consulta, búsqueda, reembolso) y validación de la firma del webhook |
| `backend/.../payments/PaymentService.scala` | Orquestación: transacciones, envío idempotente, aplicación de resultados, reembolsos y conciliación |
| `backend/.../payments/PaymentLifecycle.scala` | Programa la conciliación periódica |
| `backend/.../controllers/PaymentController.scala` | Endpoints del pasajero (`/payments/*`) |
| `backend/.../controllers/PaymentWebhookController.scala` | Webhook de Mercado Pago (`/webhooks/payments/mercadopago`) |
| `frontend/src/components/passenger/PaymentPanel.jsx` | Formulario seguro (Brick), feedback de estados, cuenta regresiva y polling |
| `db/02_logic.sql` (sección US9) | `iniciar_transaccion_pago`, `tomar_transaccion_pago`, `resolver_transaccion_pago`, `registrar_reembolso_transaccion` |

El resto del sistema solo conoce `PaymentGateway` y `PaymentService`. Cambiar de proveedor implica
una nueva implementación del contrato y su controlador de webhook.

## Endpoints

| Método y ruta | Uso | Respuesta |
| --- | --- | --- |
| `GET /payments/config` | Clave pública, URL del SDK, entorno | 200, o 503 si el pago en línea no está configurado |
| `POST /payments/transactions` | `{ "purchaseId": 123 }` crea o devuelve la transacción | 201 con `transaction`; 404 compra ajena o inexistente; 409 reserva vencida o por vencer |
| `POST /payments/transactions/{uuid}/card` | `{ token, paymentMethodId, issuerId?, installments?, payer? }` | 200 con el estado resultante; 400 si el cuerpo trae datos de tarjeta (`cardNumber`, `securityCode`, `cvv`…) |
| `GET /payments/transactions/{uuid}` | Estado actual (polling del navegador) | 200 o 404 |
| `POST /webhooks/payments/mercadopago` | Notificación de Mercado Pago | 200; 401 con firma inválida; 5xx para que Mercado Pago reintente |

Todas las rutas `/payments/*` exigen sesión: pagar requiere `reservation:create` y consultar
`reservation:view_own`. La transacción incluye `message`, un texto listo para mostrar con el motivo de
rechazo traducido desde `status_detail`.

## Estados de una transacción

| Estado | Significado | Efecto sobre la compra |
| --- | --- | --- |
| `CREADA` | UUID asignado, falta la tarjeta | Ninguno |
| `PROCESANDO` | Enviada a la pasarela, sin respuesta definitiva | Ninguno (el conciliador la resuelve) |
| `PENDIENTE` | La pasarela la dejó en revisión | Sigue `PENDIENTE_PAGO` con la reserva |
| `APROBADA` | Cobro aprobado | `CONFIRMADA` (o `REQUIERE_REEMBOLSO` si la reserva ya venció) |
| `RECHAZADA` | Cobro rechazado | `CANCELADA`, asientos liberados |
| `ERROR` | La pasarela rechazó la solicitud sin crear el pago (p. ej. token inválido) | Ninguno: se puede reintentar con una transacción nueva |
| `REEMBOLSADA` | Aprobación tardía reembolsada | La compra ya estaba `EXPIRADA` |

## Idempotencia y bloqueo de doble procesamiento

- UUID único por transacción (`uq_transaccion_pago_uuid`) usado como clave de idempotencia ante la pasarela.
- Una sola transacción activa o aprobada por compra (`uq_transaccion_pago_compra_activa`).
- `tomar_transaccion_pago` serializa los envíos con `FOR UPDATE`; un reenvío de una transacción ya
  resuelta devuelve su estado sin llamar a la pasarela.
- `resolver_transaccion_pago` es idempotente: respuesta sincrónica, webhooks repetidos y conciliación
  pueden llegar a la vez sin registrar dos pagos. `pago.id_transaccion_pasarela` y
  `transaccion_pago.id_pago_pasarela` son únicos.
- Cada transición queda en `auditoria` (`accion = 'PAGO_TRANSACCION'`) con UUID, importe y estados.

## Configurar el entorno de pruebas de Mercado Pago

1. En [Mercado Pago Developers](https://www.mercadopago.com.ar/developers) ingresar a **Tus
   integraciones** y crear una aplicación de pagos online con Checkout API.
2. En **Credenciales de prueba** copiar la *Public Key* y el *Access Token* (empiezan con `TEST-`).
   Si se usan cuentas de prueba (vendedor y comprador), usar las credenciales de la cuenta vendedora.
3. En **Webhooks** de la aplicación, modo de pruebas, configurar la URL
   `https://<api-pública>/webhooks/payments/mercadopago` con el evento **Pagos** y copiar la **clave
   secreta**. En desarrollo, la API local se expone con un túnel HTTPS (por ejemplo
   `cloudflared tunnel --url http://localhost:8080` o `ngrok http 8080`). Sin webhook el sistema igual
   resuelve los pagos por polling.
4. Definir las variables en el entorno de la API (nunca en el repositorio):

| Variable | Valor |
| --- | --- |
| `AERONET_PAYMENT_PROVIDER` | `mercadopago` (sin esta variable el pago en línea queda deshabilitado) |
| `AERONET_MP_PUBLIC_KEY` | Public Key de prueba |
| `AERONET_MP_ACCESS_TOKEN` | Access Token de prueba (secreto) |
| `AERONET_MP_WEBHOOK_SECRET` | Clave secreta del webhook (mínimo 16 caracteres) |
| `AERONET_MP_ENVIRONMENT` | `sandbox` (muestra el aviso de tarjetas de prueba) o `production` |
| `AERONET_MP_NOTIFICATION_URL` | Opcional: URL de notificación por pago, si no se configura en el panel |
| `AERONET_MP_API_URL` / `AERONET_MP_SDK_URL` | Solo para el sandbox local; por defecto, los de Mercado Pago |
| `AERONET_PAYMENT_RECONCILE_SECONDS` | Intervalo del conciliador (30 por defecto) |
| `AERONET_PAYMENT_WORKER_ENABLED` | `false` desactiva la conciliación |

### Tarjetas de prueba

| Tarjeta | Número | CVV | Vencimiento |
| --- | --- | --- | --- |
| Visa | 4509 9535 6623 3704 | 123 | 11/30 |
| Mastercard | 5031 7557 3453 0604 | 123 | 11/30 |
| American Express | 3711 803032 57522 | 1234 | 11/30 |

El **nombre del titular** define el resultado: `APRO` aprobado, `OTHE` rechazado, `CONT` pendiente,
`CALL` requiere autorización, `FUND` fondos insuficientes, `SECU` código de seguridad inválido,
`EXPI` vencimiento inválido y `FORM` error en el formulario. Documento: DNI 12345678.

## Sandbox local (sin credenciales)

`tests/sandbox/mercadopago-sandbox.mjs` reproduce la parte de la API que usa AeroNet (tokenización,
cobro con idempotencia, consulta, búsqueda, reembolso), envía webhooks firmados como Mercado Pago y
sirve un SDK de prueba con el Brick `cardPayment`. Con él corren las pruebas automáticas y se puede
probar la interfaz sin cuenta. Ver [pruebas-pago-en-linea.md](../pruebas-pago-en-linea.md).

El sandbox local **no reemplaza** la prueba contra el entorno de pruebas real de Mercado Pago, que
requiere las credenciales de la cuenta del equipo.

## Antes de pasar a producción

- Reemplazar las credenciales por las productivas y `AERONET_MP_ENVIRONMENT=production`.
- Configurar el webhook en modo productivo con su propia clave secreta.
- Servir el frontend por HTTPS (requisito de Mercado Pago para el Brick).
- Revisar en los logs `payment_processed`, `payment_result_unknown` y los errores de conciliación.
