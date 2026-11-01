# Pruebas de carga de US19

El escenario `us19-busqueda-compra.mjs` usa el runtime de Node, sin paquetes adicionales. Levanta un vuelo aislado con 220 asientos, prepara 200 cuentas de pasajero y ejecuta dos fases con 200 solicitudes simultáneas: búsqueda y creación de compra/reserva. El registro y la creación del fixture quedan fuera de las mediciones.

## Ejecución

Usar una base descartable ya inicializada con `db/01_schema.sql`, `db/02_logic.sql` y `db/03_seed.sql`, la API apuntando a esa base, y una cuenta administrativa de desarrollo activa.

En PowerShell:

```powershell
$env:AERONET_API_URL = 'http://localhost:8080'
$env:AERONET_TEST_DB_CONTAINER = 'aeronet-us8-http-db'
$env:AERONET_DEV_ADMIN_PASSWORD = '<contraseña local de admin.dev@aeronet.test>'
node tests/load/us19-busqueda-compra.mjs
```

El proceso guarda un JSON en `tests/load/results/` (o en la ruta de `AERONET_LOAD_REPORT`) con p95, máximo, errores y capacidad/vendidos. Considera aprobado el criterio de rendimiento solo si el p95 de búsqueda y compra es menor a 3000 ms, no hay fallos de solicitud y vendidos/reservados no supera la capacidad. El vuelo y las cuentas creadas se conservan; ejecutar solo contra una base aislada que pueda descartarse.

El harness mide la creación de la compra temporal mediante `POST /passenger/reservations`, que es el paso concurrente que bloquea plazas; no simula la autorización de una pasarela de pagos externa.

## Resultado Sprint 3 — 2026-11-01

La ejecución final en la base aislada simuló 200 usuarios concurrentes. Las 200 búsquedas y las 200 reservas respondieron sin errores; no hubo sobreventa. p95: **1301 ms** en búsqueda y **2058 ms** en reserva, ambos dentro del objetivo de 3 segundos. Capacidad: 220; reservados: 200. El detalle está en [`results/us19-1793565900451.json`](results/us19-1793565900451.json).

Para esta medición se deshabilitaron los workers de email y generación de documentos para aislar el camino de búsqueda/reserva. Durante el análisis se añadió un pool compartido de conexiones MariaDB configurable (`AERONET_DB_POOL_SIZE`, predeterminado 100) y se limitó el barrido de reservas vencidas a una vez por segundo, evitando trabajo duplicado en ráfagas de búsquedas concurrentes.
