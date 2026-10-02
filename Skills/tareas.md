# Tareas a realizar — etapa 1

Esta lista recoge el alcance de primera etapa descrito por el responsable del proyecto. Conviene contrastarla con el backlog oficial cuando este disponible.

## US4 — Acceso por roles y permisos

- [ ] Diseñar el esquema de roles y permisos de los tres perfiles (4 horas).
- [ ] Implementar los tres roles: administrador (`ADMIN`), pasajero (`PASAJERO`) y empleado de mostrador (`MOSTRADOR`).
- [ ] Definir y mantener una asignacion coherente de permisos para cada rol en las capas que los consumen.

### Alta e inicio de sesion

- [ ] Implementar el alta de usuarios y la autenticación (8 horas).
- [ ] Dar de alta los usuarios en la base de datos al registrarlos, con validacion de datos y contrasena almacenada como hash.
- [ ] Autenticar las credenciales cada vez que un usuario inicia sesion y rechazar cuentas deshabilitadas.
- [ ] Al autenticar, actualizar el ultimo acceso y entregar una credencial de sesion verificable para las solicitudes autenticadas.
- [ ] Restringir la asignacion de roles internos: el registro publico de pasajeros no debe permitir que el cliente se asigne rol de administrador o empleado.

### Acceso por permisos

- [ ] Implementar el control de acceso por perfil en la navegación (5 horas).
- [ ] Al entrar y navegar por la plataforma, mostrar y proteger las pantallas segun rol y permisos.
- [ ] Validar los permisos tambien en el backend en cada endpoint protegido; ocultar opciones en la interfaz no basta como control de acceso.
- [ ] Unificar los identificadores de roles y permisos usados por base de datos, backend y frontend.

### Integracion y estado funcional

- [ ] Probar los accesos con usuarios de los tres perfiles (3 horas).
- [ ] Conectar alta, login y autorizacion con persistencia real; reemplazar respuestas y datos de demostracion en estos flujos.
- [ ] Poder comprobar los flujos para los tres roles, incluyendo accesos permitidos y denegados.

## US7 — Búsqueda de viajes

- [ ] Diseñar la interfaz de búsqueda y de resultados (4 horas).
- [ ] Implementar la consulta por origen, destino y fechas (6 horas).
- [ ] Mostrar horarios, clases, precios y disponibilidad de cada opción (4 horas).
- [ ] Probar la búsqueda con distintos criterios y casos sin resultados (3 horas).
