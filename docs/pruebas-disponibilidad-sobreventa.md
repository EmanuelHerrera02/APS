# Manual de Usuario — Cómo testear la US11 (Control de Disponibilidad y Sobreventa)

Este manual explica **paso a paso y desde cero** cómo probar todos los criterios de aceptación del **Módulo 2 / US 11 (Control de disponibilidad y sobreventa)**, tanto de forma **automatizada** (consola) como **manual** (desde el navegador web, simulando pasajeros reales).

---

## 1. Qué se valida en la US11 (Criterios de Aceptación)

| Código | Criterio de Aceptación | Qué debe ocurrir en el sistema |
|---|---|---|
| **US11-AC1** | Ninguna compra simultánea puede confirmar más pasajes que la capacidad real | Si quedan $N$ asientos y llegan múltiples compras al mismo tiempo, a lo sumo se reservan/confirman $N$ asientos; el resto recibe `HTTP 409 Conflict` y la base jamás supera `vendidos <= capacidad`. |
| **US11-AC2** | Asientos reservados temporalmente durante el pago; liberación automática tras 10 minutos si no hay confirmación | Al crear la compra (`PENDIENTE_PAGO`), los asientos quedan retenidos con `expira_en = NOW() + 10 minutos`. Si no se confirma el pago en 10 minutos, la compra pasa a `EXPIRADA`, los pasajes a `CANCELADO` y los asientos vuelven al inventario automáticamente. |
| **US11-AC3** | Aviso en pantalla si no hay disponibilidad suficiente antes del pago | Si el usuario intenta elegir más pasajes que los disponibles o si otro comprador agota el cupo antes de confirmar la reserva, la interfaz muestra una alerta clara (`role="alert"`) antes de pasar al pago. |
| **US11-AC4** | La búsqueda de vuelos debe descontar tanto ventas confirmadas como reservas vigentes | El buscador de vuelos (`GET /passenger/search`) descuenta de la capacidad tanto los pasajes `EMITIDO` (ventas confirmadas) como los `RESERVADO` (reservas temporales dentro de los 10 minutos). |

---

## 2. Requisitos previos

Antes de empezar, asegurate de tener instalado en tu máquina:

1. **Docker** y **Docker Compose** (en Windows/macOS: *Docker Desktop* abierto y en estado *Engine running*).
2. **Java JDK 17 o superior** (`java -version`).
3. **sbt** (Scala Build Tool, `sbt --version`).
4. **Node.js 18 o superior** y **npm** (`node -v` y `npm -v`).

> [!IMPORTANT]
> Todos los comandos de este manual asumen que abrís la terminal en la carpeta del proyecto (`APS/`):
> ```bash
> cd /ruta/a/proyectoAPS/APS
> ```

---

## 3. Opción Rápida (sin levantar Docker ni servidores): `--self-test`

Si querés validar en **5 segundos** que las reglas de base de datos, el TTL de 10 minutos, el controlador Scala, las alertas de la interfaz React y el motor de concurrencia (25 compras simultáneas sobre los últimos 10 asientos) estén correctamente configurados:

```bash
node tests/http/us11-disponibilidad-concurrencia.mjs --self-test
```

### Resultado esperado en pantalla:
```text
US11 — Control Agregar fode disponibilidad, TTL 10 min y concurrencia
===========================================================
PASA   U11-S01 Restricciones DB (chk_salida_clase_vendidos, trg_salida_clase_bu, trg_pasaje_bi) y v_disponibilidad — db/01_schema.sql + db/02_logic.sql
PASA   U11-S02 Reserva temporal con TTL de 10 minutos y liberación automática en trg_compra_bi y liberar_reservas_vencidas — TTL = 10 MINUTE + evento cada 1 min + migración US11
PASA   U11-S03 Confirmación atómica (confirmar_compra + trg_compra_bu + registrar_pago) y casos T36–T37 en 04_tests.sql — confirmar_compra + validación de inventario y vencimiento
PASA   U11-S04 Backend libera reservas vencidas en búsqueda/conflicto (HTTP 409) y UI muestra alerta antes del pago — PassengerController.scala + PassengerDashboard.jsx
PASA   U11-S05 Búsqueda descuenta confirmadas (2) + reservas vigentes (2) y libera automáticamente tras 10 minutos — durante_reserva=8, tras_10m=10, pago_tardio=REQUIERE_REEMBOLSO
PASA   U11-S06 Estrés concurrente (25 compras simultáneas sobre los últimos 10 asientos): 10 confirmadas, 15 rechazadas, 0 sobreventa — aceptadas=10, rechazadas=15, vendidos=12/12

6/6 comprobaciones aprobadas.
```

---

## 4. Preparación del entorno completo desde cero (Base de Datos + API + Web)

Para probar el sistema completo (tanto con los scripts automatizados contra MariaDB como desde el navegador web), vas a usar **3 terminales**.

### Paso 1 — Levantar la Base de Datos (Terminal 1)

Usaremos una instancia aislada de MariaDB en el puerto `3311` (definida en [docker-compose.us11.yml](../docker-compose.us11.yml)) para empezar con una base limpia desde cero que carga automáticamente `01_schema.sql`, `02_logic.sql` y `03_seed.sql`.

**En Linux / macOS (bash):**
```bash
export AERONET_DB_PORT=3311
docker compose -f docker-compose.yml -f docker-compose.us11.yml -p aeronet-us11 up -d --wait db
```

**En Windows (PowerShell):**
```powershell
$env:AERONET_DB_PORT = '3311'
docker compose -f docker-compose.yml -f docker-compose.us11.yml -p aeronet-us11 up -d --wait db
```

> [!TIP]
> Si preferís usar la base de datos general del puerto `3306` (`docker compose up -d db`) y ya tenías un volumen creado de antes, aplicale por única vez la migración de la US11:
> ```bash
> docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/migrations/20261018_us11_disponibilidad_ttl.sql'
> ```

---

### Paso 2 — Ejecutar las pruebas SQL de la Base de Datos (Terminal 1)

Con el contenedor de MariaDB corriendo, verificá que los **37 casos de prueba SQL** (incluidos `T36` para TTL de 10 min y descuento en `v_disponibilidad`, y `T37` para `confirmar_compra` y bloqueo de reservas vencidas) pasen sin errores:

```bash
docker compose -f docker-compose.yml -f docker-compose.us11.yml -p aeronet-us11 exec -T db \
  sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/04_tests.sql'
```

Al final de la tabla tiene que mostrar:
```text
37	37	0	TODOS LOS CASOS PASAN
```

---

### Paso 3 — Levantar el Backend en Scala (Terminal 2)

Abrí una **segunda terminal** en `APS/` y levantá la API apuntando a la base en el puerto `3311`:

**En Linux / macOS (bash):**
```bash
cd backend
export AERONET_JDBC_URL="jdbc:mariadb://localhost:3311/aeronet"
export AERONET_DB_USER="aeronet_app"
export AERONET_DB_PASSWORD="aeronet_app_dev"
export AERONET_JWT_SECRET="clave-local-de-pruebas-cambiar-123456"
export AERONET_HTTP_PORT="8080"
sbt run
```

**En Windows (PowerShell):**
```powershell
cd backend
$env:AERONET_JDBC_URL = "jdbc:mariadb://localhost:3311/aeronet"
$env:AERONET_DB_USER = "aeronet_app"
$env:AERONET_DB_PASSWORD = "aeronet_app_dev"
$env:AERONET_JWT_SECRET = "clave-local-de-pruebas-cambiar-123456"
$env:AERONET_HTTP_PORT = "8080"
sbt run
```

Esperá hasta ver en la consola que el servidor HTTP inició en `http://localhost:8080`. Dejá esta terminal abierta.

---

## 5. Ejecutar la prueba automatizada HTTP + Estrés de Concurrencia

Con la base de datos (Paso 1) y el backend (Paso 3) corriendo, volvé a la **Terminal 1** (en la raíz `APS/`) y ejecutá:

```bash
node tests/http/us11-disponibilidad-concurrencia.mjs
```

### Qué hace este script automáticamente:
1. **`U11-01`**: Registra 16 cuentas de pasajeros reales vía `POST /auth/register`.
2. **`U11-02`**: Crea un vuelo de prueba con capacidad acotada (`PRIMERA = 3`, `ECONOMY = 5`) y verifica que `GET /passenger/search` informe exactamente `3` y `5` asientos disponibles.
3. **`U11-03`**: Crea una reserva temporal de 1 asiento en `PRIMERA` (`POST /passenger/reservations`) y comprueba que queda en `PENDIENTE_PAGO` con un TTL de **10 minutos (600 segundos)**.
4. **`U11-04`**: Crea y confirma una segunda compra en `PRIMERA`, y verifica que `GET /passenger/search` descuente **ambas** (1 confirmada + 1 reservada = queda `1` asiento disponible).
5. **`U11-05`**: Intenta reservar `2` asientos en `PRIMERA` cuando solo queda `1` y comprueba que el backend rechaza antes del pago con `HTTP 409` y el mensaje `Sin disponibilidad: se pidieron 2 asientos en PRIMERA y quedan 1`.
6. **`U11-06`**: Simula el paso de los 10 minutos sobre la primera reserva impaga, ejecuta una búsqueda y verifica que la reserva pasó a `EXPIRADA`, su pasaje a `CANCELADO` y la disponibilidad subió de `1` a `2`.
7. **`U11-07` (Estrés en `PRIMERA`)**: Lanza **12 peticiones HTTP simultáneas** (`Promise.all`) compitiendo por los últimos **2 asientos** de `PRIMERA`. Verifica que exactamente **2** responden `201 Created`, **10** responden `409 Conflict` y, tras confirmarlas, `vendidos = 3/3` (0 sobreventa).
8. **`U11-08` (Estrés en `ECONOMY`)**: Lanza **15 peticiones HTTP simultáneas** de 1 y 2 pasajes compitiendo por los **5 asientos** de `ECONOMY`. Verifica que la suma confirmada jamás supera `5/5`.

---

## 6. Cómo probar manualmente desde el navegador (Paso a Paso)

Si querés probar la experiencia completa como usuario final desde la interfaz web:

### Paso 1 — Levantar el Frontend (Terminal 3)

Abrí una **tercera terminal** en `APS/frontend`:

```bash
cd frontend
npm install
npm run dev
```

Abrí en el navegador la dirección que indica Vite: **`http://localhost:5173`**.

---

### Paso 2 — Registrarse e iniciar sesión como Pasajero

1. En `http://localhost:5173`, hacé clic en **Crear cuenta** (o registrate desde el formulario inicial).
2. Completá tus datos (por ejemplo, `pasajero1@aeronet.test` y una contraseña de al menos 12 caracteres, como `Pasajero123456!`) e iniciá sesión.
3. Ingresarás al **Panel de Pasajero**.

---

### Prueba Manual 1 — Descuento de disponibilidad y Reserva Temporal de 10 minutos (`US11-AC2` y `US11-AC4`)

1. En el buscador de vuelos del **Panel de Pasajero**, completá:
   - **Origen:** `AEP` (o `Buenos Aires`)
   - **Destino:** `BRC` (o `Bariloche`)
   - **Fecha desde:** elegí mañana o pasado mañana.
   - Hacé clic en **Buscar viajes**.
2. En la tarjeta del vuelo `AN1720` (`AEP → BRC`), mirá el botón de clase **Primera** y **anotá cuántos asientos disponibles dice** (por ejemplo, `12 disponibles`).
3. Hacé clic en **Elegir Primera**.
4. En el panel **Seleccionar clase y cantidad**, subí la **Cantidad de pasajes** a `2` con el botón `+`.
5. Completá nombre, apellido, tipo (`DNI`) y número de documento de los 2 pasajeros y presioná **Continuar al resumen**.
6. Revisá el panel **Resumen previo al pago** y hacé clic en **Confirmar reserva y continuar al pago**.
7. **Verificación 1 (Reserva temporal de 10 min):**
   - Verás el cartel verde de confirmación indicando el código de reserva en estado `PENDIENTE_PAGO` y aclarando que **los asientos quedan reservados temporalmente por 10 minutos**.
8. **Verificación 2 (La búsqueda descuenta reservas vigentes):**
   - Sin pagar todavía, volvé arriba al buscador y hacé clic otra vez en **Buscar viajes** para la misma fecha.
   - Mirá la clase **Primera** de ese mismo vuelo: ahora mostrará **`10 disponibles`** (descontó inmediatamente los 2 asientos reservados temporalmente).

---

### Prueba Manual 2 — Aviso en pantalla si no hay disponibilidad suficiente antes del pago (`US11-AC3`)

Hay dos situaciones en las que un pasajero puede quedarse sin disponibilidad antes de pagar. Podés probar ambas:

#### Caso 2A — Intentar seleccionar más asientos que los disponibles en el vuelo
1. En los resultados de búsqueda, elegí una clase que tenga pocos asientos disponibles (por ejemplo, **Primera** del vuelo `AN1140` `COR → MDZ`, que tiene **6 asientos**, o **Primera** de `AN1890` `AEP → USH`, que tiene **8 asientos**).
2. En **Cantidad de pasajes**, presioná el botón `+` hasta alcanzar el máximo disponible de esa clase (ej. `6`) y presioná `+` **una vez más**.
3. **Resultado esperado:** Aparece inmediatamente un aviso en pantalla (`role="alert"`) indicando:
   > *"No hay disponibilidad suficiente para 7 pasajes en Primera (quedan 6 asientos disponibles)."*

#### Caso 2B — Otro pasajero compra los últimos asientos mientras estás completando tus datos (Carrera antes del pago)
1. Abrí **dos pestañas** del navegador (o una ventana normal y una de incógnito) en `http://localhost:5173`.
2. Buscá el mismo vuelo y fecha en ambas pestañas (por ejemplo, `COR` → `MDZ`, vuelo `AN1140`, clase **Primera** con `6 disponibles`).
3. En la **Pestaña 1**, elegí **Primera**, seleccioná `4` pasajes, cargá los datos de los 4 pasajeros y avanzá hasta **Resumen previo al pago** (todavía no presiones confirmar).
4. En la **Pestaña 2**, elegí **Primera** del mismo vuelo y fecha, seleccioná `4` pasajes, cargá los datos y avanzá hasta **Resumen previo al pago**.
5. En la **Pestaña 1**, hacé clic en **Confirmar reserva y continuar al pago**. Se reservarán 4 de los 6 asientos (quedan solo 2 libres).
6. Ahora andá a la **Pestaña 2** y hacé clic en **Confirmar reserva y continuar al pago** (está pidiendo 4 asientos pero ya solo quedan 2).
7. **Resultado esperado:** Antes de pasar al pago, la **Pestaña 2** muestra en pantalla el cartel de alerta roja (`role="alert"`):
   > *"Sin disponibilidad: se pidieron 4 asientos en PRIMERA y quedan 2"*

---

### Prueba Manual 3 — Liberación automática tras 10 minutos sin confirmación (`US11-AC2`)

Cuando hiciste la **Prueba Manual 1**, reservaste asientos que quedaron en estado `PENDIENTE_PAGO` con vencimiento a los 10 minutos:

- **Opción 1 (Tiempo real):** Esperá 10 minutos sin confirmar el pago y volvé a presionar **Buscar viajes** en el navegador. Verás que los asientos disponibles volvieron a su número original automáticamente.
- **Opción 2 (Simular el paso de los 10 minutos al instante por consola):** Si no querés esperar 10 minutos de reloj, ejecutá este comando en la **Terminal 1** para adelantar el reloj de vencimiento de las reservas pendientes:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.us11.yml -p aeronet-us11 exec -T db \
    sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet -e "UPDATE compra SET expira_en = NOW() - INTERVAL 1 SECOND WHERE estado = '\''PENDIENTE_PAGO'\'';"'
  ```
  Luego hacé clic en **Buscar viajes** en el navegador: el backend invocará automáticamente `liberar_reservas_vencidas()`, pasará la compra a `EXPIRADA` y verás que los asientos volvieron a estar disponibles.

---

## 7. Limpieza al terminar las pruebas

Cuando termines de probar:

1. Detené el Frontend (**Terminal 3**) y el Backend (**Terminal 2**) con `Ctrl + C`.
2. Eliminá el contenedor y el volumen aislado de la base de datos de prueba en la **Terminal 1**:

```bash
export AERONET_DB_PORT=3311
docker compose -f docker-compose.yml -f docker-compose.us11.yml -p aeronet-us11 down -v
```
