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

En otra terminal iniciar la interfaz:

```powershell
cd frontend
npm run dev
```

Abrir la URL que informa Vite (normalmente `http://localhost:5173`). La API permite llamadas
desde `localhost:5173` y `127.0.0.1:5173`.

El usuario ADMIN que trae el seed no tiene una contraseña conocida; las contraseñas de ejemplo
no permiten iniciar sesión. Para probar la pantalla protegida de alta de vuelos hace falta contar
con un ADMIN cuyo hash de contraseña sea válido. La página de pruebas está en
`/admin/flights/test` una vez iniciada una sesión con permiso `flight:create`.
