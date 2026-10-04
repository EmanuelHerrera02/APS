# Ejecutar AeroNet para pruebas locales

Requisitos: Docker Desktop, JDK 17 o posterior, sbt y Node.js.

Desde la raíz del repositorio, iniciar MariaDB (si todavía no está activa):

```powershell
docker compose up -d db
```

En una terminal, iniciar la API:

```powershell
$env:AERONET_JDBC_URL = "jdbc:mariadb://localhost:3306/aeronet"
$env:AERONET_DB_USER = "aeronet_app"
$env:AERONET_DB_PASSWORD = "aeronet_app_dev"
$env:AERONET_JWT_SECRET = "clave-local-de-pruebas-cambiar-123456"
cd backend
sbt run
```

La API queda en `http://localhost:8080`. Para cambiar el puerto, definir
`$env:AERONET_HTTP_PORT` antes de `sbt run`.

Si la base ya existía antes de agregar el alta de vuelos, aplicar la migración del permiso
`flight:create` una vez desde la raíz:

```powershell
docker compose exec -T db mariadb -uaeronet_app -paeronet_app_dev aeronet -e "SOURCE /aeronet/db/05_migration_flight_create_permission.sql"
```

Del mismo modo, si la base es anterior a la máquina de estados de pagos, aplicar una vez:

```powershell
docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/06_migration_pago_estados.sql'
```

En otra terminal iniciar la interfaz:

```powershell
cd frontend
npm run dev
```

Abrir la URL que informa Vite (normalmente `http://localhost:5173`). La API permite llamadas
desde `localhost:5173` y `127.0.0.1:5173`.

### Cuentas locales para probar los tres roles

El seed incluye usuarios de ejemplo cuyos hashes no permiten iniciar sesión. Para preparar
cuentas de desarrollo reproducibles, elegir tres contraseñas distintas (12 a 256 caracteres)
en la sesión actual de PowerShell y ejecutar el seeder. Las contraseñas se solicitan sin eco,
se usan para generar hashes Argon2 y no se guardan en el repositorio.

```powershell
$env:AERONET_DEV_ACCOUNTS_ENABLED = "true"
$env:AERONET_DEV_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host "Contraseña ADMIN" -AsSecureString)).Password
$env:AERONET_DEV_PASAJERO_PASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host "Contraseña PASAJERO" -AsSecureString)).Password
$env:AERONET_DEV_MOSTRADOR_PASSWORD = [System.Net.NetworkCredential]::new("", (Read-Host "Contraseña MOSTRADOR" -AsSecureString)).Password
Push-Location backend
sbt "runMain com.transport.system.DevAccounts"
Pop-Location
Remove-Item Env:AERONET_DEV_ACCOUNTS_ENABLED, Env:AERONET_DEV_ADMIN_PASSWORD, Env:AERONET_DEV_PASAJERO_PASSWORD, Env:AERONET_DEV_MOSTRADOR_PASSWORD
```

El comando crea o renueva `admin.dev@aeronet.test`, `pasajero.dev@aeronet.test` y
`mostrador.dev@aeronet.test`. Se conecta con `AERONET_JDBC_URL`, `AERONET_DB_USER` y
`AERONET_DB_PASSWORD` configurados para la API. Repetirlo rota las contraseñas por las ingresadas.
La página de pruebas de vuelos está en `/admin/flights/test` al iniciar sesión con la cuenta ADMIN.

Las pruebas HTTP automatizadas usan instancias aisladas de la base: ver
[pruebas-alta-vuelos.md](pruebas-alta-vuelos.md) (US5) y [pruebas-busqueda-viajes.md](pruebas-busqueda-viajes.md) (US7).

La edición de usuarios (US4) se prueba igual, en el puerto `3309`: levantar
`docker compose -f docker-compose.yml -f docker-compose.us4.yml -p aeronet-us4 up -d db` con
`$env:AERONET_DB_PORT = '3309'`, crear las cuentas de desarrollo en esa instancia, iniciar la API
contra ella y ejecutar `node tests/http/us4-edicion-usuarios.mjs` con las mismas variables
`AERONET_DEV_*_PASSWORD`. El script modifica la cuenta de pasajero y la restaura al final.
