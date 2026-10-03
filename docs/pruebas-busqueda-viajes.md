# US7 — Matriz de casos de búsqueda

**Estado:** casos y resultados esperados definidos; ejecución HTTP pendiente.

La búsqueda usa `GET /passenger/search` sin credenciales. Los casos con resultados usan fechas calculadas desde salidas futuras del seed, para no depender de una fecha fija.

| Caso | Criterio | Resultado esperado |
|---|---|---|
| S01 | Origen y destino por código IATA (`AEP` → `COR`) en una fecha con salida futura | HTTP 200; cada fila corresponde a esa ruta y fecha, tiene `seatsAvailable > 0` e incluye horario, clase y precio. |
| S02 | La misma ruta por ciudad (`Ciudad Autónoma de Buenos Aires` → `Córdoba`) | HTTP 200; devuelve las mismas opciones que la búsqueda equivalente por IATA. |
| S03 | Rango inclusivo con salidas conocidas al inicio, dentro y al final del período | HTTP 200; solo aparecen fechas dentro del rango y se incluyen los límites cuando tienen salida programada. |
| S04 | Ruta válida sin vuelos sembrados (`EZE` → `AEP`) en fechas futuras | HTTP 200 con `results: []`. |
| S05 | En `AEP` → `EZE`, salida de `CURDATE() + 10 DAY`: Economy agotada y Primera disponible | HTTP 200; se omite Economy y se muestra Primera. |
| S06 | En `AEP` → `EZE`, salida de `CURDATE() + 11 DAY`: todas las clases agotadas | HTTP 200 con `results: []`. |
| S07 | Falta origen, destino o fecha inicial | HTTP 400 con un mensaje de validación. |
| S08 | Origen y destino son iguales | HTTP 400. |
| S09 | Fecha mal formada | HTTP 400. |
| S10 | Fecha final anterior a la fecha inicial | HTTP 400. |
| S11 | Fecha inicial anterior a hoy en Argentina | HTTP 400. |
| S12 | Llamada sin `Authorization` | La búsqueda sigue disponible y responde según sus criterios; el endpoint es público. |

## Desajuste de alcance por resolver

El campo de la interfaz dice “Ciudad o aeropuerto”. El backend compara el código IATA y la ciudad, pero no `aeropuerto.nombre`. Si “aeropuerto” incluye buscar por nombre completo, agregar un caso que espere coincidencia por ese nombre y ampliar la consulta antes de ejecutar la matriz. Si solo se esperan códigos IATA, S01 cubre la búsqueda por aeropuerto y no hace falta esa ampliación.

## Preparación reproducible

La fixture se ejecuta en una instancia MariaDB aislada, con su propio volumen y puerto `3307`; no altera la base de desarrollo del puerto `3306`. Las reservas de agotamiento quedan confirmadas para que el evento de expiración no libere asientos durante la matriz. Las solicitudes HTTP deben incluir `Accept: application/json` (igual que la interfaz); S12 solo exige omitir `Authorization`. Desde la raíz del repositorio, en PowerShell:

```powershell
$env:AERONET_DB_PORT = '3307'
docker compose -f docker-compose.yml -f docker-compose.us7.yml -p aeronet-us7 up -d db
docker compose -f docker-compose.yml -f docker-compose.us7.yml -p aeronet-us7 exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet < /aeronet/db/us7_search_fixture.sql'
```

La segunda orden carga `db/us7_search_fixture.sql` después del esquema, lógica y seed iniciales. Crea el vuelo US71 en dos fechas futuras y agota plazas usando `crear_compra` y `registrar_pago`, por lo que no modifica directamente los contadores de vendidos. Para dirigir la API a esta instancia, usar `AERONET_JDBC_URL=jdbc:mariadb://localhost:3307/aeronet`, `AERONET_DB_USER=aeronet_app` y `AERONET_DB_PASSWORD=aeronet_app_dev`.

Para elegir las fechas de S01–S03 desde las salidas sembradas:

```sql
SELECT DISTINCT s.fecha
FROM salida s
JOIN vuelo v ON v.id = s.vuelo_id
JOIN aeropuerto o ON o.id = s.aeropuerto_origen_id
JOIN aeropuerto d ON d.id = s.aeropuerto_destino_id
JOIN salida_clase sc ON sc.salida_id = s.id
WHERE o.codigo_iata = 'AEP' AND d.codigo_iata = 'COR'
  AND s.fecha >= CURDATE() AND s.estado = 'PROGRAMADA'
  AND v.estado = 'ACTIVO' AND sc.capacidad > sc.vendidos
ORDER BY s.fecha
LIMIT 3;
```

Usar una fecha devuelta para S01–S02 y la primera y tercera para los extremos de S03. Al terminar las pruebas se elimina solo la instancia aislada y su volumen con `docker compose -f docker-compose.yml -f docker-compose.us7.yml -p aeronet-us7 down -v`.

## Resultado de ejecución HTTP — 2026-10-03

Matriz ejecutada contra `http://localhost:8080/passenger/search` con `Accept: application/json` y sin `Authorization`:

| Caso | Resultado |
|---|---|
| S01–S06 | 6/6 aprobados: coincidencia IATA y ciudad, rango inclusivo, ruta sin resultados, clase parcialmente agotada y salida totalmente agotada. |
| S07a–S07c | 3/3 aprobados: falta origen, destino o fecha inicial devuelve HTTP 400. |
| S08–S11 | 4/4 aprobados: origen igual a destino, fecha inválida, rango invertido y fecha pasada devuelven HTTP 400. |
| S12 | Aprobado: llamada válida sin `Authorization` devuelve HTTP 200 y resultados. |
| **Total** | **14/14 comprobaciones aprobadas.** |

En la ejecución, las salidas de la fixture fueron el 13 y 14 de octubre de 2026. Las compras de los casos S05–S06 se confirmaron para que el evento de expiración no liberara sus asientos durante la prueba.
