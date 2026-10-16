# US8 — Prueba integrada de compra de pasajes

La prueba automatizada `tests/http/us8-compra.mjs` valida búsqueda, autenticación, compra pendiente, total, reserva de asiento, datos inválidos y rechazos por fechas fuera del período o días sin operación. Requiere Node 18 o posterior, Docker y sbt.

## Preparación

Desde la raíz del repositorio, inicia una base aislada con puerto y volumen propios:

```powershell
$env:AERONET_DB_PORT = '3312'
docker compose -f docker-compose.yml -f docker-compose.us8.yml -p aeronet-us8 up -d --wait db
```

En otra terminal, inicia la API contra esa instancia. `AERONET_JWT_SECRET` debe tener al menos 32 bytes:

```powershell
cd backend
$env:AERONET_JDBC_URL = 'jdbc:mariadb://localhost:3312/aeronet'
$env:AERONET_DB_USER = 'aeronet_app'
$env:AERONET_DB_PASSWORD = 'aeronet_app_dev'
$env:AERONET_JWT_SECRET = 'clave-local-de-prueba-con-al-menos-32-bytes'
$env:AERONET_HTTP_PORT = '8080'
sbt --server --batch 'runMain com.transport.system.BackendMain'
```

Desde una tercera terminal en la raíz, ejecuta la matriz:

```powershell
node tests/http/us8-compra.mjs
```

Resultado verificado el 2026-10-16: **10/10 casos HTTP aprobados**. La suite SQL `db/04_tests.sql` también pasó **35/35**, incluidos T34 y T35.

## Limpieza

Detén la API con Ctrl+C y elimina solo la base aislada de US8:

```powershell
$env:AERONET_DB_PORT = '3312'
docker compose -f docker-compose.yml -f docker-compose.us8.yml -p aeronet-us8 down -v
```
