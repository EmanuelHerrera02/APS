# Manual de uso — Base de datos AeroNet

Guía práctica para trabajar con la base de AeroNet: cómo levantarla, conectarse, qué datos de
prueba trae y cómo hacer cada operación del sistema (crear vuelos, vender, cobrar, notificar,
reportar).

Para el *porqué* del diseño (diagrama, decisiones, trazabilidad) ver
[modelo-datos.md](modelo-datos.md). Este manual es el *cómo*.

**Índice**

1. [Puesta en marcha](#1-puesta-en-marcha)
2. [Conectarse](#2-conectarse)
3. [Datos de prueba](#3-datos-de-prueba)
4. [Conceptos en 2 minutos](#4-conceptos-en-2-minutos)
5. [Recetas por funcionalidad](#5-recetas-por-funcionalidad)
6. [Usarla desde el backend (JDBC / Scala)](#6-usarla-desde-el-backend-jdbc--scala)
7. [Errores que devuelve la base](#7-errores-que-devuelve-la-base)
8. [Modificar el esquema](#8-modificar-el-esquema)
9. [Problemas frecuentes](#9-problemas-frecuentes)

---

## 1. Puesta en marcha

**Requisito:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado y
**corriendo** (el ícono de la ballena tiene que decir *Engine running*). No hace falta instalar
MariaDB.

Todos los comandos se corren desde la raíz del repo y funcionan igual en PowerShell, cmd y bash.

| Qué quiero hacer | Comando |
|---|---|
| Levantar la base (la primera vez crea todo y carga los datos de prueba) | `docker compose up -d` |
| Ver si ya está lista | `docker compose ps` → tiene que decir `healthy` |
| Correr los tests | `docker compose exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/04_tests.sql'` |
| Abrir una consola SQL | `docker compose exec db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" aeronet'` |
| Ver los logs | `docker compose logs db` |
| Apagarla (los datos se conservan) | `docker compose stop` |
| **Borrar todo y empezar de cero** | `docker compose down -v` y después `docker compose up -d` |

> Los scripts `db/01..03` **solo se ejecutan cuando la base está vacía** (primer `up`, o después
> de `down -v`). Si alguien cambió los scripts y hacés `git pull`, tenés que hacer
> `docker compose down -v` para que se apliquen. Esto borra tus datos locales.

La corrida de tests termina con `26  26  0  TODOS LOS CASOS PASAN`. Los tests se ejecutan dentro
de una transacción que se deshace, así que no ensucian la base y se pueden correr las veces que
quieras.

---

## 2. Conectarse

| Dato | Valor |
|---|---|
| Host | `localhost` |
| Puerto | `3306` |
| Base | `aeronet` |
| Usuario de la aplicación | `aeronet_app` / `aeronet_app_dev` |
| Usuario root (solo administración) | `root` / `aeronet_root_dev` |
| URL JDBC | `jdbc:mariadb://localhost:3306/aeronet` |

Son credenciales **de desarrollo**. Para cambiarlas (o el puerto) creá un archivo `.env` en la
raíz del repo, que no se sube a git:

```dotenv
AERONET_DB_PORT=3307
AERONET_DB_PASSWORD=otra_clave
AERONET_DB_ROOT_PASSWORD=otra_clave_root
```

**Clientes gráficos:** IntelliJ (*Database → + → Data Source → MariaDB*), DBeaver o HeidiSQL,
con los datos de la tabla. El backend siempre usa `aeronet_app`, nunca `root`.

---

## 3. Datos de prueba

El seed usa **fechas relativas al día en que se levanta la base**: los vuelos siempre tienen
salidas futuras para vender.

### Usuarios

| Email | Rol | Estado |
|---|---|---|
| `laura.mendez@aeronet.com.ar` | ADMIN | activo |
| `diego.fernandez@aeronet.com.ar` | MOSTRADOR | activo |
| `carla.ruiz@aeronet.com.ar` | MOSTRADOR | **deshabilitada** |
| `juan.perez@gmail.com` | PASAJERO | activo, con app iOS |
| `maria.gonzalez@hotmail.com` | PASAJERO | activo, con app Android |
| `lucia.romero@yahoo.com.ar` | PASAJERO | activo, sin app |

> Los `password_hash` del seed son **de ejemplo**: tienen formato válido pero no corresponden a
> ninguna contraseña, así que no se puede iniciar sesión con ellos. Para probar el login,
> generá un hash bcrypt desde el backend y actualizalo:
> `UPDATE usuario SET password_hash = '$2b$12$...' WHERE email = 'juan.perez@gmail.com';`

### Vuelos

| Código | Ruta | Días | Horario | Economy | Primera |
|---|---|---|---|---|---|
| AN1402 | AEP → COR | lun a vie | 07:30 – 08:50 | 150 × $85.000 | 12 × $210.000 |
| AN1720 | AEP → BRC | todos los días | 10:15 – 12:35 | 162 × $145.000 | 12 × $350.000 |
| AN1890 | AEP → USH | mar, jue, sáb | 22:40 – 02:15 **(+1 día)** | 150 × $190.000 | 8 × $420.000 |
| AN1140 | COR → MDZ | lun, mié, vie | 13:00 – 14:20 | 70 × $72.000 | 6 × $165.000 |

Aeropuertos cargados: AEP, EZE, COR, MDZ, BRC, USH, IGR, SLA, FTE, NQN.

### Compras

Hay 7 compras, una o más en cada estado posible:

| # | Quién | Situación |
|---|---|---|
| 1 | Juan, web | 3 Economy a Bariloche. **CONFIRMADA**, factura B, reenvío pedido en mostrador |
| 2 | Diego (mostrador) para una empresa, sin cuenta | 2 Primera a Córdoba, efectivo. **CONFIRMADA**, factura A |
| 3 | María, app | 1 Economy + 1 Primera a Ushuaia. **PENDIENTE_PAGO** (vence 2 h después del `up`) |
| 4 | Lucía, web | Pago rechazado. **CANCELADA** |
| 5 | Juan, web | Nunca pagó. **EXPIRADA** |
| 6 | María, app | **CONFIRMADA**; su salida se demoró 45 min, lo que generó avisos de cambio de horario |
| 7 | Lucía, web | **CONFIRMADA**; su salida se canceló, lo que generó un aviso de cancelación |

Los códigos de compra y de pasaje son aleatorios. Para verlos:

```sql
SELECT id, codigo, canal, estado, total, email_contacto FROM compra;
```

---

## 4. Conceptos en 2 minutos

- **`vuelo`** es la definición ("AN1720 AEP→BRC, todos los días a las 10:15, de marzo a
  septiembre"). **`salida`** es cada ocurrencia concreta ("AN1720 del 14 de octubre"). **Se vende
  sobre salidas, no sobre vuelos.**
- Las salidas **no se cargan a mano**: después de crear un vuelo se llama a
  `generar_salidas(vuelo_id)`.
- **`salida_clase`** tiene la `capacidad` y los `vendidos` de cada salida y clase.
- Una **`compra`** es sobre una sola salida y tiene de 1 a 9 **`pasaje`s**. Cada pasaje tiene su
  clase y los datos de la persona que viaja (los acompañantes no necesitan cuenta).
- Una compra nace en `PENDIENTE_PAGO` y **ya reserva los asientos**. Tiene 15 minutos para
  pagarse; si no, pasa sola a `EXPIRADA` y los asientos se liberan (la base lo hace cada minuto).
- Las **notificaciones** no se envían desde la base: la base las deja en la tabla `notificacion`
  y un proceso del backend las envía (ver [5.6](#56-enviar-notificaciones-worker)).
- **No se borra nada:** se deshabilita (`activo = FALSE`) o se cambia el estado (`CANCELADO`). Un
  `DELETE` sobre tablas de negocio da error a propósito.

### Estados

```
compra:   PENDIENTE_PAGO ──pago aprobado──▶ CONFIRMADA ──▶ CANCELADA
                │
                ├──pago rechazado / cancelación──▶ CANCELADA
                └──pasan 15 min──▶ EXPIRADA

pasaje:   RESERVADO ──▶ EMITIDO ──▶ CANCELADO   (cambian solos con la compra)
salida:   PROGRAMADA ──▶ CANCELADA
vuelo:    ACTIVO ──▶ CANCELADO
```

`CANCELADA`, `EXPIRADA` y `CANCELADO` son **finales**: no se pueden revertir.

---

## 5. Recetas por funcionalidad

Todas las recetas se pueden pegar tal cual en una consola SQL. Los `?` son los parámetros que
pasa el backend.

### 5.1 Vuelos (admin)

**Crear un vuelo.** Son 4 pasos; hacelos en una transacción:

```sql
START TRANSACTION;

INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id,
                   hora_partida, hora_llegada, dias_desfase_llegada,
                   fecha_desde, fecha_hasta, creado_por_id)
VALUES ('AN2010',
        (SELECT id FROM aeropuerto WHERE codigo_iata = 'AEP'),
        (SELECT id FROM aeropuerto WHERE codigo_iata = 'IGR'),
        '06:40', '08:35', 0,                    -- 0 = llega el mismo día, 1 = al día siguiente
        '2026-11-01', '2027-02-28',             -- período en que opera y se vende
        (SELECT id FROM usuario WHERE email = 'laura.mendez@aeronet.com.ar'));
SET @vuelo = LAST_INSERT_ID();

-- Días de operación: 1 = lunes ... 7 = domingo
INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana) VALUES (@vuelo, 5), (@vuelo, 7);

-- Capacidad y precio por clase (si no tiene Primera, no insertes esa fila)
INSERT INTO vuelo_clase (vuelo_id, clase, capacidad, precio) VALUES
  (@vuelo, 'ECONOMY', 150, 120000.00),
  (@vuelo, 'PRIMERA',  12, 280000.00);

CALL generar_salidas(@vuelo);   -- devuelve cuántas salidas creó

COMMIT;
```

**Modificar un vuelo:**

| Cambio | Cómo | Qué hace la base sola |
|---|---|---|
| Horario | `UPDATE vuelo SET hora_partida = ?, hora_llegada = ?, dias_desfase_llegada = ? WHERE id = ?` | Lo aplica a las salidas futuras y encola avisos de `CAMBIO_HORARIO` para quienes ya compraron |
| Precio | `UPDATE vuelo_clase SET precio = ? WHERE vuelo_id = ? AND clase = ?` | Rige para las ventas nuevas; lo ya vendido conserva su precio |
| Capacidad | `UPDATE vuelo_clase SET capacidad = ? WHERE vuelo_id = ? AND clase = ?` | Lo aplica a las salidas futuras. **Falla** si alguna ya vendió más que la nueva capacidad |
| Extender el período | `UPDATE vuelo SET fecha_hasta = ? WHERE id = ?` y luego `CALL generar_salidas(?)` | `generar_salidas` solo agrega las que faltan |
| Agregar un día o una clase | `INSERT` en `vuelo_dia_operacion` / `vuelo_clase` y luego `CALL generar_salidas(?)` | Ídem |
| Quitar un día o acortar el período | `DELETE FROM vuelo_dia_operacion ...` / `UPDATE vuelo SET fecha_hasta = ?` **y además** cancelar las salidas sobrantes (ver abajo) | Nada: las salidas ya creadas **no** se borran solas |
| Cambiar origen o destino | No se puede. Hay que cancelar el vuelo y crear otro | Da error |

Para cancelar las salidas que quedaron afuera al quitar un día, por ejemplo los sábados (`6`):

```sql
UPDATE salida SET estado = 'CANCELADA', motivo_cancelacion = 'El vuelo deja de operar los sábados'
 WHERE vuelo_id = ? AND WEEKDAY(fecha) + 1 = 6 AND fecha >= CURDATE() AND estado = 'PROGRAMADA';
```

**Demorar o reprogramar una sola salida** (no toca el resto del vuelo):

```sql
UPDATE salida SET hora_partida = '08:15', hora_llegada = '09:35' WHERE id = ?;
```

**Cancelar:**

```sql
-- Una salida puntual
UPDATE salida SET estado = 'CANCELADA', motivo_cancelacion = 'Condiciones meteorológicas' WHERE id = ?;

-- El vuelo completo (cancela todas sus salidas futuras)
UPDATE vuelo SET estado = 'CANCELADO' WHERE id = ?;
```

Al cancelar, la base encola los avisos de `CANCELACION` y cancela las compras que todavía no se
pagaron. Las compras **ya pagadas quedan `CONFIRMADA`**: el reembolso lo resuelve el negocio.

### 5.2 Buscar vuelos (pasajero)

```sql
SELECT salida_id, codigo_vuelo, origen, destino, fecha, hora_partida, hora_llegada,
       dias_desfase_llegada, clase, precio, asientos_disponibles
  FROM v_disponibilidad
 WHERE origen = 'AEP' AND destino = 'BRC'
   AND fecha BETWEEN '2026-10-01' AND '2026-10-07'
   AND asientos_disponibles >= 2          -- cantidad de pasajeros
 ORDER BY fecha, hora_partida, clase;
```

- La vista solo muestra lo que **se puede vender**: salidas programadas, de vuelos activos y que
  todavía no partieron.
- Devuelve una fila por salida y clase.
- Para buscar por ciudad usá `ciudad_origen` y `ciudad_destino`.
- Si `dias_desfase_llegada = 1`, el vuelo llega al día siguiente.

### 5.3 Comprar pasajes (web, app o mostrador)

**Paso 1: crear la compra.** Reserva los asientos y congela los precios:

```sql
CALL crear_compra(
  ?,                       -- salida_id (de la búsqueda)
  ?,                       -- usuario_id del comprador, o NULL si es mostrador sin cuenta
  NULL,                    -- empleado_id: solo en canal MOSTRADOR, si no NULL
  'WEB',                   -- 'WEB' | 'MOVIL' | 'MOSTRADOR'
  'juan.perez@gmail.com',  -- email de contacto (obligatorio, adonde van pasajes y factura)
  '[{"nombre":"Juan","apellido":"Pérez","tipo_documento":"DNI","numero_documento":"30123456","clase":"ECONOMY"},
    {"nombre":"Sofía","apellido":"Pérez","tipo_documento":"DNI","numero_documento":"31555777","clase":"PRIMERA"}]',
  @compra                  -- OUT: id de la compra creada
);

SELECT codigo, total, expira_en FROM compra WHERE id = @compra;
SELECT codigo, nombre, apellido, clase, precio FROM pasaje WHERE compra_id = @compra;
```

Sobre el JSON de pasajeros:
- Es un array de **1 a 9** objetos con los 5 campos obligatorios.
- `tipo_documento` puede ser `DNI`, `PASAPORTE` u `OTRO`.
- `clase` puede ser `ECONOMY` o `PRIMERA`, y se puede mezclar en la misma compra.

Si algo falla (no hay lugar, datos inválidos, más de 9), la base **no crea nada** y devuelve un
error (ver [sección 7](#7-errores-que-devuelve-la-base)).

**Paso 2: registrar el pago** cuando responde la pasarela o se cobra en mostrador:

```sql
-- Tarjeta (pasarela)
CALL registrar_pago(@compra, 435000.00, 'TARJETA_CREDITO', 'APROBADO',
                    'MP-7790012345',   -- id de transacción de la pasarela
                    'VISA', '4242',    -- marca y ÚLTIMOS 4 dígitos
                    @pago, @resultado);

-- Efectivo en mostrador
CALL registrar_pago(@compra, 420000.00, 'EFECTIVO', 'APROBADO', NULL, NULL, NULL, @pago, @resultado);

SELECT @resultado;
```

> ⚠️ **Nunca** mandes a la base el número completo de tarjeta, el CVV ni el vencimiento. Solo los
> últimos 4 dígitos. No hay columnas para lo demás, a propósito.

| `@resultado` | Significado | Qué hacer |
|---|---|---|
| `CONFIRMADA` | Compra pagada; pasajes emitidos; email y push de confirmación encolados | Generar la factura (paso 3) |
| `CANCELADA` | Pago rechazado; la compra se canceló y los asientos se liberaron | Avisar al usuario y ofrecer comprar de nuevo |
| `REQUIERE_REEMBOLSO` | Se aprobó un pago de una compra que ya había vencido o se había cancelado | **Reembolsar** por la pasarela |
| `REGISTRADO` | Pago `PENDIENTE` u otro caso; solo se guardó | Esperar la confirmación de la pasarela |

`medio` puede ser `TARJETA_CREDITO`, `TARJETA_DEBITO`, `EFECTIVO` o `TRANSFERENCIA`. El monto
aprobado tiene que coincidir con `compra.total`.

**Paso 3: emitir la factura.** Solo para compras `CONFIRMADA`, con el mismo total:

```sql
INSERT INTO factura (compra_id, numero, tipo, total, receptor_nombre, receptor_cuit)
VALUES (@compra, 'B-0001-00000004', 'B',
        (SELECT total FROM compra WHERE id = @compra), 'Juan Pérez', NULL);   -- tipo A exige CUIT

-- Cuando el backend genera el PDF:
UPDATE factura SET ruta_pdf = 'facturas/2026/B-0001-00000004.pdf' WHERE compra_id = @compra;
```

**Cancelaciones a pedido del cliente:**

```sql
UPDATE compra SET estado = 'CANCELADA' WHERE id = ?;   -- toda la compra: libera todos sus asientos
UPDATE pasaje SET estado = 'CANCELADO' WHERE id = ?;   -- un solo pasajero: libera su asiento
```

### 5.4 Consultas de mostrador y "mis compras"

```sql
-- Por localizador (el código de 6 caracteres que ve el cliente)
SELECT * FROM compra WHERE codigo = 'J4MJLZ';

-- Por documento del pasajero
SELECT p.codigo AS pasaje, p.nombre, p.apellido, p.clase, p.estado,
       c.codigo AS compra, c.estado AS estado_compra, v.codigo AS vuelo, s.fecha, s.hora_partida
  FROM pasaje p
  JOIN compra c ON c.id = p.compra_id
  JOIN salida s ON s.id = p.salida_id
  JOIN vuelo  v ON v.id = s.vuelo_id
 WHERE p.numero_documento = '30123456'
 ORDER BY s.fecha DESC;

-- Por email de contacto (sirve también para compras de mostrador sin cuenta)
SELECT id, codigo, estado, total, created_at FROM compra
 WHERE email_contacto = 'viajes@agroandina.com.ar' ORDER BY created_at DESC;

-- "Mis compras" de un pasajero con cuenta
SELECT c.codigo, c.estado, c.total, v.codigo AS vuelo, s.fecha, s.hora_partida, s.estado AS estado_salida
  FROM compra c JOIN salida s ON s.id = c.salida_id JOIN vuelo v ON v.id = s.vuelo_id
 WHERE c.usuario_id = ? ORDER BY c.created_at DESC;
```

**Reenviar pasajes y factura:**

```sql
CALL reenviar_documentacion(?,      -- compra_id (tiene que estar CONFIRMADA)
                            ?,      -- id del empleado que lo pide (o NULL)
                            NULL);  -- email alternativo, o NULL para el de contacto
```

### 5.5 Reportes de ocupación (admin)

```sql
-- Detalle por vuelo, fecha y clase
SELECT codigo_vuelo, fecha, clase, capacidad, emitidos, reservados, disponibles,
       porcentaje_ocupacion, recaudado
  FROM v_ocupacion
 WHERE codigo_vuelo = 'AN1720' AND fecha BETWEEN '2026-10-01' AND '2026-10-31'
 ORDER BY fecha, clase;

-- Resumen por vuelo y clase en un rango de fechas
SELECT codigo_vuelo, clase, SUM(capacidad) AS capacidad, SUM(emitidos) AS emitidos,
       ROUND(100 * SUM(emitidos) / SUM(capacidad), 2) AS ocupacion_pct, SUM(recaudado) AS recaudado
  FROM v_ocupacion
 WHERE fecha BETWEEN '2026-10-01' AND '2026-10-31' AND estado_salida = 'PROGRAMADA'
 GROUP BY codigo_vuelo, clase
 ORDER BY codigo_vuelo, clase;
```

| Columna | Qué cuenta |
|---|---|
| `emitidos` | Pasajes pagados. **Es la ocupación real.** |
| `reservados` | Pasajes de compras aún sin pagar |
| `vendidos` | `emitidos + reservados`: los asientos que ya no se pueden vender |
| `disponibles` | `capacidad - vendidos` |

### 5.6 Enviar notificaciones (worker)

La base **encola** las notificaciones en la tabla `notificacion`:
- confirmación de compra,
- cambio de horario,
- cancelación,
- reenvío de documentación.

Un proceso del backend las tiene que **enviar**. Patrón recomendado: cada pocos segundos, tomar un lote.

```sql
START TRANSACTION;

SELECT id, tipo, canal, destinatario, compra_id, salida_id, payload, intentos
  FROM notificacion
 WHERE estado IN ('PENDIENTE', 'FALLIDA')
   AND programada_para <= NOW()
   AND intentos < 5
 ORDER BY programada_para
 LIMIT 50
 FOR UPDATE SKIP LOCKED;          -- permite varios workers sin mandar dos veces lo mismo

-- Por cada una, enviar el email/push y según el resultado:
UPDATE notificacion SET estado = 'ENVIADA', intentos = intentos + 1, enviada_en = NOW()
 WHERE id = ?;

UPDATE notificacion SET estado = 'FALLIDA', intentos = intentos + 1, ultimo_error = ?,
       programada_para = NOW() + INTERVAL POW(2, intentos) MINUTE   -- reintento con espera creciente
 WHERE id = ?;

COMMIT;
```

- `canal = 'EMAIL'`: `destinatario` es una dirección de email.
- `canal = 'PUSH'`: `destinatario` es el token del dispositivo.
- `payload` (JSON) trae los datos para armar el mensaje de cambio de horario o cancelación:
  horario anterior, horario nuevo y motivo.
- Si el proveedor de push responde que el token ya no es válido, desactivalo:
  `UPDATE dispositivo_usuario SET activo = FALSE WHERE token_push = ?;`

**Registrar el dispositivo** cuando la app móvil inicia sesión:

```sql
INSERT INTO dispositivo_usuario (usuario_id, token_push, plataforma, ultimo_uso)
VALUES (?, ?, 'ANDROID', NOW())                      -- 'ANDROID' | 'IOS'
ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), activo = TRUE, ultimo_uso = NOW();
```

### 5.7 Usuarios y cuentas internas

```sql
-- Registro de pasajero / alta de empleado (el hash lo genera el backend con bcrypt o argon2)
INSERT INTO usuario (email, password_hash, rol, nombre, apellido, tipo_documento, numero_documento, telefono)
VALUES (?, ?, 'PASAJERO', ?, ?, 'DNI', ?, ?);          -- rol: 'PASAJERO' | 'MOSTRADOR' | 'ADMIN'

-- Login: traer el hash y verificarlo EN EL BACKEND
SELECT id, password_hash, rol, activo FROM usuario WHERE email = ?;
UPDATE usuario SET ultimo_acceso = NOW() WHERE id = ?;

-- Modificar / deshabilitar / rehabilitar
UPDATE usuario SET nombre = ?, apellido = ?, telefono = ?, rol = ? WHERE id = ?;
UPDATE usuario SET activo = FALSE WHERE id = ?;
UPDATE usuario SET activo = TRUE  WHERE id = ?;
```

- El email no se puede repetir, ni siquiera cambiando mayúsculas y minúsculas.
- La base **rechaza contraseñas en claro**: solo acepta hashes bcrypt (`$2a$`, `$2b$`, `$2y$`) o argon2.
- Un usuario deshabilitado no puede comprar y un empleado deshabilitado no puede vender (la base
  lo valida). El login lo tiene que chequear el backend con la columna `activo`.

---

## 6. Usarla desde el backend (JDBC / Scala)

Dependencia del driver oficial, en `build.sbt` (usar la última 3.x de Maven Central):

```scala
libraryDependencies += "org.mariadb.jdbc" % "mariadb-java-client" % "3.5.1"
```

Ejemplo de llamada a un procedimiento con parámetro de salida:

```scala
import java.sql.{DriverManager, SQLException, Types}

val conn = DriverManager.getConnection(
  "jdbc:mariadb://localhost:3306/aeronet", "aeronet_app", "aeronet_app_dev")

try {
  val cs = conn.prepareCall("{call crear_compra(?, ?, ?, ?, ?, ?, ?)}")
  cs.setLong(1, salidaId)
  usuarioId match {
    case Some(id) => cs.setLong(2, id)
    case None     => cs.setNull(2, Types.BIGINT)
  }
  cs.setNull(3, Types.BIGINT)             // empleado_id (solo mostrador)
  cs.setString(4, "WEB")
  cs.setString(5, emailContacto)
  cs.setString(6, pasajerosJson)          // el array JSON de la sección 5.3
  cs.registerOutParameter(7, Types.BIGINT)
  cs.execute()
  val compraId = cs.getLong(7)
} catch {
  case e: SQLException if e.getSQLState == "45000" =>
    // Error de regla de negocio: e.getMessage trae el texto de la sección 7
    // (puede venir con un prefijo tipo "(conn=12) "; conviene buscar con contains)
  case e: SQLException if e.getErrorCode == 1062 =>
    // clave duplicada (por ejemplo, email ya registrado)
}
```

- Con *autocommit* activado (el default), los procedimientos manejan su propia transacción. Si
  el backend ya abrió una, se integran en ella y ante un error solo deshacen lo suyo.
- **Siempre** usar parámetros (`?`), nunca concatenar texto en el SQL.
- La base y el servidor trabajan en hora argentina (`-03:00`). Las fechas y horas de vuelo son
  locales y no tienen zona horaria.

---

## 7. Errores que devuelve la base

Los errores de negocio vienen con **SQLSTATE `45000`** y un mensaje en español. La columna
"HTTP sugerido" es una propuesta para que el backend responda de forma uniforme.

| Mensaje (empieza con…) | Cuándo | HTTP sugerido |
|---|---|---|
| `Sin disponibilidad: se pidieron N asientos en CLASE y quedan M` | No hay lugar suficiente | 409 |
| `La salida no está disponible para la venta` | Salida cancelada, de un vuelo cancelado o que ya partió | 409 |
| `La salida no existe o no ofrece la clase solicitada` | `salida_id` o clase inválidos | 404 |
| `Una compra admite de 1 a 9 pasajes` / `...como máximo 9 pasajes` | Cantidad de pasajeros fuera de rango | 422 |
| `Datos de pasajero incompletos o inválidos...` | Falta un campo o hay un valor inválido en el JSON | 422 |
| `p_pasajeros debe ser un array JSON` | El JSON está mal formado | 400 |
| `El usuario comprador no existe o está deshabilitado` | Comprador inválido | 403 |
| `El empleado vendedor no existe, está deshabilitado o no tiene rol interno` | Venta de mostrador con un empleado inválido | 403 |
| `El monto aprobado no coincide con el total de la compra` | Pago por un monto distinto | 422 |
| `La compra no existe` | `compra_id` inválido | 404 |
| `Solo se factura una compra CONFIRMADA` / `Solo se reenvía documentación...` | Operación sobre una compra no pagada | 409 |
| `Transición de estado de compra inválida: X -> Y` (ídem pasaje) | Por ejemplo, reabrir una compra expirada | 409 |
| `No se puede reducir la capacidad por debajo de los asientos vendidos` | Bajar la capacidad con ventas hechas | 409 |
| `La ruta de un vuelo no se modifica...` | `UPDATE` de origen o destino | 422 |
| `Un vuelo cancelado no puede reactivarse` / `Una salida cancelada no puede reprogramarse` | Revertir una cancelación | 409 |
| `Borrado físico no permitido en ...` | Un `DELETE` sobre una tabla de negocio | 405 |
| `No hay asiento reservado para el pasaje...` | `INSERT` directo en `pasaje` sin reservar: usar `crear_compra` | 500 (bug del backend) |

Otros errores de MariaDB que pueden aparecer:

| Código | Mensaje | Cuándo | HTTP sugerido |
|---|---|---|---|
| 1062 | `Duplicate entry '...' for key 'uq_usuario_email'` | Email ya registrado (ídem `uq_vuelo_codigo`, `uq_factura_numero`, etc.) | 409 |
| 4025 | `CONSTRAINT 'chk_...' failed` | Violación de un CHECK: el nombre dice cuál (ej. `chk_vuelo_ruta` = origen igual a destino) | 422 |
| 1452 | `Cannot add or update a child row: a foreign key constraint fails` | Referencia a un id inexistente | 422 |

---

## 8. Modificar el esquema

1. Editar el script que corresponda: `01_schema.sql` (tablas), `02_logic.sql` (triggers y
   procedimientos) o `03_seed.sql` (datos).
2. Si cambia una regla, agregar o ajustar un caso en `04_tests.sql`, y actualizar el total
   esperado (`26`) al final del archivo.
3. Recrear la base y correr los tests:
   ```
   docker compose down -v
   docker compose up -d
   docker compose exec db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/04_tests.sql'
   ```
4. Actualizar [modelo-datos.md](modelo-datos.md) (diagrama y descripción) y avisar al equipo que
   hay que hacer `down -v`.

Convenciones:
- Nombres en español y `snake_case`.
- `DECIMAL(12,2)` para montos.
- `created_at` y `updated_at` en toda tabla nueva.
- Prefijos: `uq_`, `ix_`, `fk_`, `chk_` y `trg_`.
- Borrado lógico, no físico.

> **Ojo con `INSERT … SELECT`:** si omite una columna `NOT NULL` sin valor por defecto, MariaDB
> falla **antes** de ejecutar el trigger que la completaría. Por eso los `codigo` tienen
> `DEFAULT ''`.

---

## 9. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `Docker Desktop is unable to start`, o `500 Internal Server Error ... dockerDesktopLinuxEngine` | Docker Desktop no terminó de arrancar. Abrirlo, esperar a *Engine running* y reintentar. Si persiste, reiniciar Docker Desktop. |
| `port is already allocated` / `Bind for 0.0.0.0:3306 failed` | Ya hay un MySQL o MariaDB local (XAMPP, WAMP…) en el 3306. Poner `AERONET_DB_PORT=3307` en `.env` y conectarse a ese puerto. |
| Cambié los scripts y no veo los cambios | Los scripts solo corren con la base vacía: `docker compose down -v` y `docker compose up -d`. |
| `docker compose ps` no llega a `healthy` | Falló un script de inicio: `docker compose logs db` y buscar `ERROR`. |
| `Sin disponibilidad` / `La salida no está disponible para la venta` al probar | Estás usando una salida pasada, cancelada o agotada. Buscá una en `v_disponibilidad`. |
| La compra de prueba se me vence sola | Es lo esperado: las reservas vencen a los 15 minutos. Para pruebas manuales: `UPDATE compra SET expira_en = NOW() + INTERVAL 1 DAY WHERE id = ?;` |
| Las reservas vencidas **no** se liberan | Verificar `SELECT @@event_scheduler;` (tiene que dar `ON`). Se puede forzar con `CALL liberar_reservas_vencidas();` |
| Fechas u horas corridas 3 horas | Revisar que el contenedor tenga `TZ: America/Argentina/Buenos_Aires` (ya está en el `docker-compose.yml`) y que la base se haya creado con esa versión: si no, `docker compose down -v` y `up -d`. |
| Tildes rotas (`GonzÃ¡lez`) en la consola | Conectarse con `--default-character-set=utf8mb4`. En los clientes gráficos, usar codificación UTF-8. |
| `Access denied for user 'aeronet_app'` | Se cambió la contraseña en `.env` después de crear la base; el usuario se crea una sola vez. `docker compose down -v` y `up -d`. |
