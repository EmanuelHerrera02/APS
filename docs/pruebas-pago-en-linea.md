# Pruebas del pago en línea (US9)

Cómo verificar el Módulo 3 en tres niveles: reglas de la base, flujo HTTP completo contra el sandbox
local de Mercado Pago y prueba manual desde la interfaz (con el sandbox local o con el entorno de
pruebas real de Mercado Pago). La configuración de la pasarela está en
[us9/pasarela-de-pago.md](us9/pasarela-de-pago.md).

## Criterios de aceptación y evidencia

| Criterio | Cómo se verifica |
| --- | --- |
| **US9-AC1** Datos de tarjeta procesados en la pasarela; no se guarda PAN ni CVV | U9-03 (la API rechaza `cardNumber`/`securityCode` sin llamar a la pasarela), U9-06 (ni PAN ni columnas sensibles en la base; solo marca y últimos 4) y la UI, donde la tarjeta se escribe en el formulario de la pasarela |
| **US9-AC2** Transacciones con ID único, importe y estado rastreable | T38, T47, U9-04, U9-21 (UUID v4, importe igual al total, transiciones en `auditoria`) |
| **US9-AC3** Bloqueo de doble procesamiento | T39, T40, U9-07, U9-08, U9-09 (mismo UUID, 5 envíos simultáneos → un único cobro), U9-13 (webhook repetido) |
| **US9-AC4** Aprobada confirma pasajes; rechazada libera reservas | T40–T42, U9-05, U9-10, U9-11, U9-12, U9-15, U9-16 |
| **US9-AC5** Pruebas exitosas contra el sandbox de la pasarela | Sandbox local: U9-01…U9-21. Entorno de pruebas real de Mercado Pago: checklist manual de la sección 4 (requiere credenciales de la cuenta del equipo) |

## 1. Reglas de la base (`04_tests.sql`)

Los casos T38–T47 cubren creación idempotente de transacciones, el índice que bloquea dos
transacciones activas, aprobado/rechazado/pendiente, importe inválido, reembolso tardío, compra
ajena, máquina de estados y auditoría.

```powershell
$env:AERONET_DB_PORT = '3314'
docker compose -f docker-compose.yml -f docker-compose.us9.yml -p aeronet-us9 up -d --wait db
docker exec aeronet-us9-db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/04_tests.sql'
```

Resultado esperado: `47  47  0  TODOS LOS CASOS PASAN`.

Si el volumen es anterior a US9, aplicar antes la migración (es idempotente):

```powershell
docker exec aeronet-us9-db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/migrations/20261018_us9_pago_en_linea.sql'
```

## 2. Flujo HTTP completo (`tests/http/us9-pago-en-linea.mjs`)

La prueba levanta el sandbox local de Mercado Pago en el puerto 8090 y necesita la API apuntando a
él y a la base aislada.

**Terminal 1 — API:**

```powershell
$env:AERONET_JDBC_URL = "jdbc:mariadb://localhost:3314/aeronet"
$env:AERONET_DB_USER = "aeronet_app"
$env:AERONET_DB_PASSWORD = "aeronet_app_dev"
$env:AERONET_JWT_SECRET = "clave-local-de-pruebas-us9-cambiar-123456"
$env:AERONET_PAYMENT_PROVIDER = "mercadopago"
$env:AERONET_MP_API_URL = "http://127.0.0.1:8090"
$env:AERONET_MP_SDK_URL = "http://localhost:8090/sdk/js/v2"
$env:AERONET_MP_ACCESS_TOKEN = "TEST-aeronet-sandbox-access-token"
$env:AERONET_MP_PUBLIC_KEY = "TEST-aeronet-sandbox-public-key"
$env:AERONET_MP_WEBHOOK_SECRET = "us9-webhook-secret-de-prueba-0123456789"
$env:AERONET_PAYMENT_RECONCILE_SECONDS = "5"
$env:AERONET_EMAIL_WORKER_ENABLED = "false"
cd backend
sbt "runMain com.transport.system.BackendMain"
```

**Terminal 2 — prueba:**

```powershell
$env:AERONET_MP_WEBHOOK_SECRET = "us9-webhook-secret-de-prueba-0123456789"
node tests/http/us9-pago-en-linea.mjs
```

Resultado esperado (tarda alrededor de un minuto por los casos de polling):

```text
PASA   U9-01 La API expone solo la clave pública y el SDK de la pasarela
PASA   U9-02 Los endpoints de pago exigen sesión
PASA   U9-03 El backend rechaza PAN/CVV sin tokenizar y no llama a la pasarela
PASA   U9-04 Cada transacción tiene UUID v4, importe de la compra y estado CREADA
PASA   U9-05 Aprobado: confirma la compra, emite pasajes y registra el pago
PASA   U9-06 La base no guarda PAN ni CVV: solo marca y últimos 4 dígitos
PASA   U9-07 Reenviar el mismo pago (mismo UUID) no genera un segundo cobro
PASA   U9-08 Una compra pagada devuelve su transacción aprobada en vez de abrir otra
PASA   U9-09 5 envíos simultáneos del mismo pago producen un único cobro
PASA   U9-10 Rechazado: cancela la compra y libera las reservas
PASA   U9-11 El rechazo informa el motivo al usuario (fondos insuficientes)
PASA   U9-12 Pendiente: conserva la reserva y el webhook firmado la confirma
PASA   U9-13 Un webhook repetido es idempotente
PASA   U9-14 Webhooks sin firma o con firma inválida se rechazan
PASA   U9-15 Polling: el conciliador obtiene el rechazo sin webhook y libera la reserva
PASA   U9-16 Si se pierde la respuesta de la pasarela, el conciliador la recupera por UUID
PASA   U9-17 Otro usuario no puede ver ni pagar una transacción ajena
PASA   U9-18 No se inicia el cobro de una reserva vencida o por vencer
PASA   U9-19 Pago aprobado tras vencer la reserva: compra EXPIRADA y reembolso automático
PASA   U9-20 Un token rechazado deja la transacción en ERROR y permite reintentar con otro UUID
PASA   U9-21 Cada transacción deja rastro de UUID, importe y estados en auditoría

21/21 comprobaciones aprobadas.
```

La prueba agrega datos con correos únicos, así que se puede repetir sobre el mismo volumen.

## 3. Prueba manual con el sandbox local

1. Iniciar el sandbox: `node tests/sandbox/mercadopago-sandbox.mjs` con
   `$env:MP_SANDBOX_WEBHOOK_SECRET` igual a `AERONET_MP_WEBHOOK_SECRET`. Envía webhooks a
   `http://localhost:8080/webhooks/payments/mercadopago` y aprueba solos los pagos `CONT` a los 20 s
   (`MP_SANDBOX_PENDING_SECONDS`).
2. Iniciar la API como en la sección 2 y el frontend con `npm run dev` en `frontend/`.
3. Ingresar como pasajero, buscar un vuelo, cargar los pasajeros y pulsar **Confirmar y reservar
   asientos**. Debajo del resumen aparece **Pagá con tarjeta** con el importe, el UUID de la
   transacción y la cuenta regresiva de la reserva.
4. Completar el formulario con una tarjeta de prueba y probar los titulares:
   - `APRO`: "¡Pago aprobado!"; la compra pasa a `CONFIRMADA` y aparecen los documentos.
   - `OTHE` o `FUND`: mensaje de rechazo con el motivo; la compra queda `CANCELADA` y los asientos vuelven a la búsqueda.
   - `CONT`: "El pago quedó en revisión"; a los 20 s el webhook lo aprueba y la pantalla se actualiza sola.
5. Una compra `PENDIENTE_PAGO` también puede pagarse desde **Compras y documentos** con el botón **Pagar**.

En las herramientas de red del navegador se ve que el número de tarjeta solo viaja al sandbox
(`/v1/card_tokens`); a la API de AeroNet llega únicamente el token.

## 4. Prueba contra el entorno de pruebas real de Mercado Pago

1. Configurar las credenciales de prueba y el webhook como indica
   [us9/pasarela-de-pago.md](us9/pasarela-de-pago.md). No definir `AERONET_MP_API_URL` ni
   `AERONET_MP_SDK_URL`, así se usan la API y el SDK reales.
2. Exponer la API con un túnel HTTPS y registrar esa URL en el webhook de la aplicación.
3. Repetir el paso 4 de la sección 3 con las tarjetas de prueba de Mercado Pago (`APRO`, `OTHE`, `CONT`).
4. Verificar en la base:

```sql
SELECT t.uuid, t.monto, t.estado, t.estado_pasarela, t.detalle_estado, t.id_pago_pasarela,
       c.codigo, c.estado AS compra, p.estado AS pago, p.marca_tarjeta, p.ultimos_4
FROM transaccion_pago t JOIN compra c ON c.id = t.compra_id LEFT JOIN pago p ON p.id = t.pago_id
ORDER BY t.id DESC LIMIT 10;
```

5. Contrastar `id_pago_pasarela` con la actividad de la cuenta de prueba en Mercado Pago y guardar
   el resultado como evidencia de US9-AC5.

Las pruebas automáticas usan los endpoints de control del sandbox local (resolver pagos pendientes,
simular respuestas perdidas), que no existen en Mercado Pago; por eso el entorno real se verifica con
este checklist.
