# Autenticación del backend

El backend expone estas rutas bajo `/auth`:

| Método | Ruta | Uso |
|---|---|---|
| POST | `/auth/login` | Validar email, contraseña y estado activo; abrir sesión. |
| POST | `/auth/register` | Crear una cuenta persistente de pasajero y abrir sesión. El rol no se acepta del cliente. |
| POST | `/auth/refresh` | Rotar el refresh token y emitir un nuevo access token. |
| POST | `/auth/logout` | Revocar la sesión identificada por el access token. |
| GET | `/auth/me` | Verificar el access token y devolver roles/permisos vigentes. |

El login y la renovación reciben JSON. El login requiere `email` y `password`; la renovación requiere `refreshToken`. Las rutas protegidas reciben `Authorization: Bearer <accessToken>`. El access token vence en 15 minutos; el refresh token vence en 30 días y cambia en cada renovación. Las credenciales incorrectas y las cuentas inactivas devuelven el mismo error.

Configurar el backend con estas variables:

- `AERONET_JDBC_URL`, por ejemplo `jdbc:mariadb://localhost:3306/aeronet`
- `AERONET_DB_USER`
- `AERONET_DB_PASSWORD`
- `AERONET_JWT_SECRET`, secreto aleatorio de al menos 32 bytes

`db/01_schema.sql` crea `sesion_usuario` y `auditoria`. En una base ya existente, ejecutar los bloques `CREATE TABLE` de ambas tablas antes de iniciar el backend. Los hashes de contraseña aceptados son bcrypt y Argon2; nunca se compara una contraseña en texto plano.

El alta administrativa y las consultas/actualizaciones de usuarios están bajo `/admin/users` y requieren sus permisos correspondientes. Los permisos activos se leen de `rol_permiso` en cada autenticación de access token.
