# Sistema de Transporte

Backend Scala + Scalatra sobre MariaDB, y frontend React + Vite.

La base de datos es la autoridad de las reglas de negocio: los CHECK, las claves
foráneas y los triggers de `db/` son los que validan. El backend traduce los
errores que vuelven de ahí a respuestas HTTP, y el frontend los muestra. Por eso
no hay validación de negocio duplicada en Scala ni en JavaScript.

## Requisitos

- Java 21 (el backend)
- sbt
- Node 18 o superior (el frontend)
- MariaDB 10.11 o superior

## Levantar la base

```bash
cd backend
./scripts/db-up.sh          # levanta y espera a que responda
./scripts/db-up.sh --status # solo informa si está
```

**Ojo:** en esta máquina la base vive en `/tmp/opencode/mdb`, una instalación
descomprimida a mano, porque no hay Docker. Si se reinicia la máquina o el
sistema limpia `/tmp`, se pierde. Cuando pase:

```bash
cd backend
./scripts/db-up.sh   # dice qué falta
./scripts/db-reset.sh # reconstruye aeronet desde db/*.sql
```

Para crear la base de test, en vez de la de desarrollo: `./scripts/db-reset.sh aeronet_test`.

## Levantar el backend

```bash
cd backend
AERONET_JWT_SECRET=dev_secret_de_prueba_1234567890 \
  sbt -batch "runMain com.transport.system.Main"
```

Queda en `http://localhost:8080`. Conecta a la base de desarrollo
(`localhost:3306/aeronet`, usuario `aeronet_app`) sin que haya que pasar nada
más: esos son los defaults de `application.conf`.

Importante: **`sbt run` no levanta el backend**. Hay que usar
`runMain com.transport.system.Main`.

El backend no arranca sin `AERONET_JWT_SECRET`: en `application.conf` esa clave
no tiene valor por defecto a propósito, para que nadie termine firmando tokens
con una clave conocida.

## Probar la API

No hay endpoint de login todavía, así que hace falta firmar un token a mano:

```bash
cd backend
TOKEN=$(AERONET_JWT_SECRET=dev_secret_de_prueba_1234567890 ./scripts/dev-token.sh)
```

El script firma un admin que vence en 1 hora. Acepta rol, id de usuario, email y
horas de validez: `./scripts/dev-token.sh passenger 7 juan@x.com 8`.

El secreto tiene que coincidir con el del servidor, si no el token se firma bien
pero el backend lo rechaza y el 403 parece un problema de permisos.

```bash
# Aerpuertos
curl -H "Authorization: Bearer $TOKEN" localhost:8080/admin/aeropuertos

# Alta de vuelo
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "codigo": "AN7001",
    "aeropuertoOrigen": "AEP",
    "aeropuertoDestino": "MDZ",
    "horaPartida": "06:00",
    "horaLlegada": "08:10",
    "diasDesfaseLlegada": 0,
    "fechaDesde": "2026-12-01",
    "fechaHasta": "2026-12-31",
    "diasOperacion": [1,2,3,4,5,6,7],
    "clases": [{"clase": "ECONOMY", "capacidad": 120, "precio": "120000.55"}]
  }' localhost:8080/admin/vuelos

# Detalle (el id va en el Location de la respuesta del alta)
curl -H "Authorization: Bearer $TOKEN" localhost:8080/admin/vuelos/1
```

El alta es una transacción: inserta el vuelo, sus días y sus clases, y llama a
`generar_salidas(id)`, que crea una salida por cada día de operación dentro del
rango de vigencia. O se escribe todo o no se escribe nada.

### Endpoints del alta

| Método | Ruta                  | Qué hace                                    |
| ------ | --------------------- | ------------------------------------------- |
| POST   | `/admin/vuelos`       | Da de alta un vuelo. 201 con el id y las salidas generadas |
| GET    | `/admin/aeropuertos`  | Catálogo para los selects del formulario    |
| GET    | `/admin/vuelos/:id`   | Detalle con días y clases                   |

Los tres exigen rol `admin`. Sin token o con uno inválido responden 403.

Los errores de la base se traducen así:

| Situación                        | Status | Campo devuelto          |
| -------------------------------- | ------ | ----------------------- |
| Código de vuelo repetido          | 409    | `codigo`                |
| Check, FK o SIGNAL de la base     | 422    | el campo, si se pudo saber |
| Formato mal del JSON              | 422    | el campo exacto         |

`campo` existe para que el formulario marque el input. Por eso el backend
traduce los errores de formato a mano en vez de usar `extract`: con `extract`, un
campo con el tipo equivocado revienta la request entera con un error genérico y
el formulario no tiene forma de saber qué input marcar.

## Tests

```bash
cd backend
AERONET_JWT_SECRET=dev_secret_de_prueba_1234567890 ./scripts/test.sh
```

31 tests. El script recrea `aeronet_test` antes de correr, y no es opcional: la
base prohíbe el borrado físico con triggers, así que un vuelo que crea un test
quedaría en la base y el test que reuse el código fallaría en la corrida
siguiente.

Para correr un spec puntual:

```bash
./scripts/test.sh "testOnly com.transport.system.services.VueloServiceSpec"
```

## Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run lint
```

**El frontend todavía no se puede ver en el navegador.** El esqueleto está a
medias en el repo: falta `index.html`, el entry point, el router y
`src/contexts/AuthContext.jsx` (que `MainLayout.jsx` y `AdminDashboard.jsx` ya
importan). Por eso `npm run dev` y `npm run build` fallan. Lo que sí anda es el
lint, que es como se verifica `AltaVuelo.jsx` por ahora.

Las variables de entorno usan prefijo `VITE_` porque el build es Vite. Vite solo
expone a `import.meta.env` las que arrancan así; las de `REACT_APP_` de Create
React App se ignoran en silencio.

## Cosas que se saben y no están arregladas

**El seed de compras falla.** `db/02_logic.sql:585` mezcla
`utf8mb4_unicode_ci` y `utf8mb4_general_ci`, y los 7 INSERT de compra se caen con
un error de collation. La base queda con 0 compras y `db/04_tests.sql` falla
11 de 26 casos. No afecta al alta de vuelos, que no usa `JSON_TABLE`, y
`reset-test-db.sh` pasa `--force` solo en el seed por eso. La corrección requiere
unificar la collation, que es un cambio de schema.

**Las rutas del panel que no existen devuelven HTML.** Scalatra responde con el
listado de rutas en lugar de JSON. Registrar un `notFound` no compila con
literales `PartialFunction` en Scala 3 con Scalatra 3.2.1, así que quedó fuera.

**El frontend no tiene punto de entrada.** Ver arriba.
