# Estado de tareas pendientes — acceso por roles

**Ultima revision:** 2026-09-28  
**Alcance revisado:** [tareas.md](tareas.md)  
**Metodo:** inspeccion de los archivos presentes en frontend, backend, base de datos y documentacion del repositorio.

## Pendiente o parcial

1. **Alta de usuarios — pendiente.** La base tiene la tabla `usuario` y el manual muestra SQL de ejemplo para insertar usuarios, pero no se encontro un flujo de registro implementado que persista el alta. El `POST /admin/users` devuelve un ID fijo; no inserta una cuenta. Referencias: [01_schema.sql](../db/01_schema.sql), [manual-base-de-datos.md](../docs/manual-base-de-datos.md), [AdminController.scala](../backend/src/main/scala/com/transport/system/controllers/AdminController.scala).
2. **Inicio de sesion — pendiente.** Existen modelos `LoginRequest`, `LoginResponse` y `JwtPayload`, pero no se encontro endpoint ni logica que consulte la cuenta, verifique el hash, rechace usuarios inactivos, actualice el ultimo acceso o emita y valide tokens. El manual describe esas responsabilidades como trabajo del backend. Referencias: [Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala), [manual-base-de-datos.md](../docs/manual-base-de-datos.md).
3. **Autorizacion efectiva del backend — no verificable y aparentemente incompleta.** Los controladores usan `AuthorizedAction`, `hasPermission` y `hasRole`, pero no se encontro la implementacion de `com.transport.system.middleware.AuthorizedAction` ni de la validacion de credenciales. Los controladores visibles devuelven listas vacias y valores de demostracion. Referencias: [PassengerController.scala](../backend/src/main/scala/com/transport/system/controllers/PassengerController.scala), [AdminController.scala](../backend/src/main/scala/com/transport/system/controllers/AdminController.scala), [EmployeeController.scala](../backend/src/main/scala/com/transport/system/controllers/EmployeeController.scala).
4. **Proteccion de rutas del frontend — pendiente/no verificable.** Los paneles importan `contexts/AuthContext`, pero ese archivo no aparece en el codigo disponible. Tampoco se encontraron rutas protegidas que impidan entrar directamente a una pantalla. El menu filtra elementos visuales, lo cual no sustituye la autorizacion del servidor. Referencia: [MainLayout.jsx](../frontend/src/components/layouts/MainLayout.jsx).
5. **Permisos frontend/backend — pendiente.** La interfaz comprueba claves como `reservation:create`, `user:list` y `admin:panel_access`; Scala define claves como `book_tickets`, `manage_users` y `manage_system`. No coinciden, por lo que no hay un contrato comun comprobable. Referencias: [MainLayout.jsx](../frontend/src/components/layouts/MainLayout.jsx), [Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala).
6. **Mapeo de roles y usuario — pendiente.** La base usa `ADMIN`, `MOSTRADOR` y `PASAJERO`; Scala usa `admin`, `counter_employee` y `passenger`. Tambien varian los campos: por ejemplo `activo` booleano en la base frente a `status` texto en el modelo. La documentacion reconoce que falta alinear el backend con la base. Referencias: [01_schema.sql](../db/01_schema.sql), [Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala), [modelo-datos.md](../docs/modelo-datos.md).
7. **Integracion funcional y verificacion por rol — pendiente.** Los controladores y paneles contienen placeholders, y no se encontro una comprobacion integral de registro, login y accesos permitidos/denegados para cada rol.

## Comprobado como base existente

- La base admite los tres roles y establece `PASAJERO` como rol predeterminado; incluye una restriccion de formato para hashes bcrypt/argon2 en `password_hash` ([01_schema.sql](../db/01_schema.sql)).
- El seed contiene cuentas de ejemplo para administrador, empleado de mostrador y pasajero ([03_seed.sql](../db/03_seed.sql)).
- Scala define modelos de solicitud/respuesta de login y registro, roles y listas de permisos ([Models.scala](../backend/src/main/scala/com/transport/system/models/Models.scala)).
- Los controladores expresan comprobaciones de rol o permiso como intencion, pero su middleware de autorizacion no esta presente en los archivos revisados.
