# US5 — Pruebas del alta de vuelos

Las pruebas ejercitan el endpoint real `POST /admin/flights` (controlador, `FlightRepository` y base de
datos) con las cuentas de desarrollo de los tres roles. Están en
[tests/http/us5-alta-vuelos.mjs](../tests/http/us5-alta-vuelos.mjs) y requieren Node 18 o posterior.

## Casos

| Grupo | Casos | Resultado esperado |
|---|---|---|
| Acceso | A01–A06 | Sin sesión → 401. `PASAJERO` y `MOSTRADOR` → 403 en el alta y en `/admin/airports`. `ADMIN` ve solo aeropuertos activos. Ninguna denegación escribe datos. |
| Datos inválidos | V01–V26 | HTTP 400 con un mensaje concreto para: código, aeropuertos faltantes, iguales, inexistentes o deshabilitados, horarios, desfase, formato y orden de fechas, inicio pasado, período mayor a 366 días, días vacíos, fuera de rango o repetidos, período sin ningún día de operación, clases vacías, desconocidas o repetidas, capacidad cero, precio cero, con tres decimales o mayor al límite de `DECIMAL(12,2)`, JSON mal formado y campo faltante. Ninguna solicitud escribe datos. |
| Alta válida | C01–C08 | HTTP 201. Persisten vuelo, días, clases (capacidad y precio), una salida por cada día de operación del período, `salida_clase` con la capacidad del vuelo y `vendidos = 0`, y la auditoría `flight.created` con el actor. El vuelo aparece en la búsqueda pública. |
| Duplicado | D01–D03 | Mismo código (también en minúsculas) → 409 `Ya existe un vuelo con ese código`, sin datos parciales. |
| Atomicidad | T01–T03 | Un fallo inyectado al generar las salidas responde 500 y no deja vuelo, días, clases, salidas, capacidades ni auditoría. |

La atomicidad se prueba con [db/us5_test_fixture.sql](../db/us5_test_fixture.sql): agrega un trigger que
falla al crear las capacidades de las salidas del vuelo `ZF9001`, después de que ya se insertaron el
vuelo, sus días, sus clases y sus salidas. También crea el aeropuerto deshabilitado `XIN`.

## Preparación

Las altas válidas dejan vuelos permanentes (no hay borrado físico), por eso se usa una instancia
aislada en el puerto `3308`. Desde la raíz del repositorio, en PowerShell:

```powershell
$env:AERONET_DB_PORT = '3308'
docker compose -f docker-compose.yml -f docker-compose.us5.yml -p aeronet-us5 up -d db
docker compose -f docker-compose.yml -f docker-compose.us5.yml -p aeronet-us5 exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/us5_test_fixture.sql'
Remove-Item Env:AERONET_DB_PORT
```

Crear las cuentas de desarrollo en esa instancia como indica [ejecucion-local.md](ejecucion-local.md),
con `AERONET_JDBC_URL = "jdbc:mariadb://localhost:3308/aeronet"`, e iniciar la API con la misma URL.
Con la API levantada y las contraseñas de las cuentas en `AERONET_DEV_ADMIN_PASSWORD`,
`AERONET_DEV_PASAJERO_PASSWORD` y `AERONET_DEV_MOSTRADOR_PASSWORD`:

```powershell
node tests/http/us5-alta-vuelos.mjs
```

El script termina con código distinto de 0 si alguna comprobación falla. Variables opcionales:
`AERONET_API_URL` (por defecto `http://localhost:8080`) y `AERONET_TEST_DB_CONTAINER` (por defecto
`aeronet-us5-db`). Al terminar: `docker compose -f docker-compose.yml -f docker-compose.us5.yml -p aeronet-us5 down -v`.

La página `/admin/flights/test` del frontend conserva las comprobaciones manuales del formulario.
