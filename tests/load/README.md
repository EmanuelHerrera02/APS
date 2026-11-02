# Pruebas de carga de US19

El escenario `us19-busqueda-compra.mjs` usa el runtime de Node, sin paquetes adicionales. Prepara 200 cuentas de pasajero y dos vuelos aislados, y ejecuta tres fases con 200 solicitudes simultáneas. El registro de cuentas y la creación de los vuelos quedan fuera de las mediciones.

| Fase | Qué mide | Cómo se aprueba |
|---|---|---|
| 1. Búsqueda | `GET /passenger/search` sobre un vuelo de 220 plazas | p95 < 3000 ms, sin errores |
| 2. Compra web | Por usuario: reserva (`POST /passenger/reservations`) + inicio de la transacción de pago (`POST /payments/transactions`), medidos como una sola compra | p95 < 3000 ms, sin errores |
| 3. Compra confirmada con competencia | 200 ventas completas (`POST /employee/sales`: reserva + cobro + confirmación + emisión) por un vuelo de **150 plazas** | p95 de las confirmadas < 3000 ms; exactamente 150 confirmadas, 50 rechazadas con HTTP 409, `vendidos = 150` y ningún error 5xx |

El cobro con tarjeta se resuelve en la pasarela externa y no se somete a carga: su latencia no depende del sistema y el sandbox limita la cantidad de solicitudes. Si la pasarela no está configurada (`/payments/config` responde 503), la fase 2 mide solo la reserva y el informe lo indica con `includesPaymentStart: false`. La fase 3 cubre la compra confirmada de punta a punta dentro del sistema y la sobreventa: con menos plazas que solicitudes, varias compras compiten por el último asiento.

## Ejecución

Usar una base descartable ya inicializada con `db/01_schema.sql`, `db/02_logic.sql` y `db/03_seed.sql`, la API apuntando a esa base y las cuentas de desarrollo ADMIN y MOSTRADOR activas.

Para que la medición refleje la operación real, levantar la API con los procesos de fondo activos (no definir `AERONET_DOCUMENT_GENERATION_ENABLED`, `AERONET_EMAIL_WORKER_ENABLED` ni `AERONET_PAYMENT_WORKER_ENABLED` en `false`) y el correo apuntando a un SMTP de prueba: la fase 3 confirma 150 compras que generan pasajes, facturas y correos.

En PowerShell:

```powershell
$env:AERONET_API_URL = 'http://localhost:8080'
$env:AERONET_TEST_DB_CONTAINER = 'aeronet-us8-http-db'
$env:AERONET_DEV_ADMIN_PASSWORD = '<contraseña local de admin.dev@aeronet.test>'
$env:AERONET_DEV_MOSTRADOR_PASSWORD = '<contraseña local de mostrador.dev@aeronet.test>'
$env:AERONET_LOAD_WORKERS = 'activos'   # se copia al informe para dejar constancia del entorno
node tests/load/us19-busqueda-compra.mjs
```

El proceso guarda un JSON en `tests/load/results/` (o en la ruta de `AERONET_LOAD_REPORT`) con p95, máximo, errores e inventario de cada vuelo. El proceso termina con código 1 si falla alguna condición de `acceptance`. Los vuelos, cuentas y compras creados se conservan: ejecutar solo contra una base aislada que pueda descartarse.

## Historial de resultados

Las corridas del 2026-11-01 usaron la versión anterior del escenario: solo búsqueda y reserva, con 220 plazas para 200 solicitudes (sin competencia) y los workers de correo y documentos desactivados.

| Informe | Búsqueda p95 | Reserva p95 | Errores | Resultado |
|---|---|---|---|---|
| [`us19-1793565310720.json`](results/us19-1793565310720.json) | 3007 ms | 4457 ms | 0 | No aprobado (línea base) |
| [`us19-1793565495862.json`](results/us19-1793565495862.json) | 2247 ms | 3534 ms | 0 | No aprobado |
| [`us19-1793565749353.json`](results/us19-1793565749353.json) | 2114 ms | 1156 ms | 238 (38 HTTP 500) | No aprobado: errores del servidor |
| [`us19-1793565900451.json`](results/us19-1793565900451.json) | 1301 ms | 2058 ms | 0 | Aprobado, sin sobreventa (220 plazas, 200 reservadas) |

Cambios hechos entre corridas: pool compartido de conexiones MariaDB configurable (`AERONET_DB_POOL_SIZE`, predeterminado 100) y barrido de reservas vencidas limitado a una vez por segundo, para no duplicar trabajo en ráfagas de búsquedas concurrentes.

**Pendiente:** ejecutar el escenario actual (tres fases, workers activos) y agregar su informe a esta tabla. Las corridas anteriores no prueban la compra confirmada ni la competencia por plazas.
