# Tareas a realizar — etapa 1

Esta lista recoge el alcance de primera etapa descrito por el responsable del proyecto. Conviene contrastarla con el backlog oficial cuando este disponible.

## US4 — Acceso por roles y permisos

- [ ] Diseñar el esquema de roles y permisos de los tres perfiles (4 horas).
- [ ] Implementar los tres roles: administrador (`ADMIN`), pasajero (`PASAJERO`) y empleado de mostrador (`MOSTRADOR`).
- [ ] Definir y mantener una asignacion coherente de permisos para cada rol en las capas que los consumen.

### Alta e inicio de sesion

- [x] Implementar el alta de usuarios y la autenticación (8 horas).
- [x] Dar de alta los usuarios en la base de datos al registrarlos, con validacion de datos y contrasena almacenada como hash.
- [x] Autenticar las credenciales cada vez que un usuario inicia sesion y rechazar cuentas deshabilitadas.
- [x] Al autenticar, actualizar el ultimo acceso y entregar una credencial de sesion verificable para las solicitudes autenticadas.
- [x] Restringir la asignacion de roles internos: el registro publico de pasajeros no debe permitir que el cliente se asigne rol de administrador o empleado.

### Acceso por permisos

- [x] Implementar el control de acceso por perfil en la navegación (5 horas).
- [x] Al entrar y navegar por la plataforma, mostrar y proteger las pantallas segun rol y permisos.
- [x] Validar los permisos tambien en el backend en cada endpoint protegido; ocultar opciones en la interfaz no basta como control de acceso.
- [ ] Unificar los identificadores de roles y permisos usados por base de datos, backend y frontend.

### Integracion y estado funcional

- [ ] Probar los accesos con usuarios de los tres perfiles (3 horas).
- [x] Conectar alta, login y autorizacion con persistencia real; reemplazar respuestas y datos de demostracion en estos flujos.
- [ ] Poder comprobar los flujos para los tres roles, incluyendo accesos permitidos y denegados.

## US7 — Búsqueda de viajes

- [ ] Diseñar la interfaz de búsqueda y de resultados (4 horas).
- [ ] Implementar la consulta por origen, destino y fechas (6 horas).
- [ ] Mostrar horarios, clases, precios y disponibilidad de cada opción (4 horas).
- [ ] Probar la búsqueda con distintos criterios y casos sin resultados (3 horas).

## US5 — Alta de vuelos

- [ ] Diseñar el formulario de alta de vuelo (4 horas).
  - Definir campos: código, aeropuertos, horarios, desfase de llegada, período, días de operación y clases.
  - Organizar el formulario por ruta y horario, período, días y capacidad/precio por clase.
  - Incluir estados accesibles de carga, error y confirmación.
- [ ] Implementar las validaciones de los datos (días, horarios, período de venta, capacidades y precios) (6 horas).
  - Validar campos obligatorios, formato del código y selección de aeropuertos distintos.
  - Validar días, fechas, horarios y llegada el mismo día o al siguiente.
  - Validar al menos una clase y capacidades/precios positivos dentro de los límites de base de datos.
  - Repetir las validaciones de negocio en el backend y mapear conflictos de persistencia a errores entendibles.
- [ ] Implementar la persistencia del vuelo en la base de datos (5 horas).
  - Proteger el endpoint con autenticación y permiso específico de alta de vuelos.
  - Insertar vuelo, días y clases en una única transacción.
  - Generar las salidas y sus capacidades por clase antes de confirmar la transacción.
  - Registrar la acción en auditoría y revertir la operación completa ante fallos.
- [ ] Probar el alta con casos válidos e inválidos (3 horas).
  - Verificar alta válida, incluyendo salidas y clases generadas.
  - Rechazar campos inválidos, duplicación de código y acceso sin permiso.
  - Comprobar atomicidad: un fallo no debe dejar vuelo, días, clases ni salidas parciales.

## US2 — Modelo y base de datos

- [ ] Definir las restricciones de integridad (capacidad por clase, estados de pasaje y de pago) (3 horas).
- [ ] Crear la base de datos con sus scripts iniciales (4 horas).
- [ ] Validar el modelo contra las historias del backlog (3 horas).
