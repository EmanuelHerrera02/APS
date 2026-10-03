-- Fixture para docs/pruebas-busqueda-viajes.md.
-- Ejecutar solo en la instancia aislada docker-compose.us7.yml, después del seed.
-- Compra asientos por crear_compra para mantener los invariantes de ocupación.

USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @aep = (SELECT id FROM aeropuerto WHERE codigo_iata = 'AEP');
SET @eze = (SELECT id FROM aeropuerto WHERE codigo_iata = 'EZE');
SET @admin = (SELECT id FROM usuario WHERE rol = 'ADMIN' ORDER BY id LIMIT 1);
SET @inicio = CURDATE() + INTERVAL 10 DAY;
SET @fin = CURDATE() + INTERVAL 11 DAY;

-- La ruta AEP -> EZE no existe en el seed. Opera solo en dos fechas futuras,
-- con tres plazas Economy y dos Primera en cada salida.
INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id,
                   hora_partida, hora_llegada, dias_desfase_llegada,
                   fecha_desde, fecha_hasta, creado_por_id)
VALUES ('US71', @aep, @eze, '12:00', '13:00', 0, @inicio, @fin, @admin);

SET @vuelo = LAST_INSERT_ID();
INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana)
VALUES (@vuelo, WEEKDAY(@inicio) + 1), (@vuelo, WEEKDAY(@fin) + 1);

INSERT INTO vuelo_clase (vuelo_id, clase, capacidad, precio)
VALUES (@vuelo, 'ECONOMY', 3, 25000.00), (@vuelo, 'PRIMERA', 2, 50000.00);

CALL generar_salidas(@vuelo);
SET @salida_parcial = (SELECT id FROM salida WHERE vuelo_id = @vuelo AND fecha = @inicio);
SET @salida_agotada = (SELECT id FROM salida WHERE vuelo_id = @vuelo AND fecha = @fin);

-- S05: Economy agotada, Primera conserva disponibilidad.
CALL crear_compra(@salida_parcial, NULL, NULL, 'WEB', 'us7-economy@example.test',
  '[{"nombre":"Prueba1","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7E001","clase":"ECONOMY"},{"nombre":"Prueba2","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7E002","clase":"ECONOMY"},{"nombre":"Prueba3","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7E003","clase":"ECONOMY"}]',
  @compra);
SET @total = (SELECT total FROM compra WHERE id = @compra);
CALL registrar_pago(@compra, @total, 'TARJETA_CREDITO', 'APROBADO', 'US7-S05', 'VISA', '4242', @pago, @resultado);

-- S06: ambas clases agotadas en una segunda salida de la misma ruta.
CALL crear_compra(@salida_agotada, NULL, NULL, 'WEB', 'us7-economy-2@example.test',
  '[{"nombre":"Prueba1","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7E101","clase":"ECONOMY"},{"nombre":"Prueba2","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7E102","clase":"ECONOMY"},{"nombre":"Prueba3","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7E103","clase":"ECONOMY"}]',
  @compra);
SET @compra_economy = @compra;
CALL crear_compra(@salida_agotada, NULL, NULL, 'WEB', 'us7-first-2@example.test',
  '[{"nombre":"Prueba1","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7P101","clase":"PRIMERA"},{"nombre":"Prueba2","apellido":"US7","tipo_documento":"OTRO","numero_documento":"US7P102","clase":"PRIMERA"}]',
  @compra);
SET @compra_primera = @compra;
SET @total = (SELECT total FROM compra WHERE id = @compra_economy);
CALL registrar_pago(@compra_economy, @total, 'TARJETA_CREDITO', 'APROBADO', 'US7-S06-E', 'VISA', '4242', @pago, @resultado);
SET @total = (SELECT total FROM compra WHERE id = @compra_primera);
CALL registrar_pago(@compra_primera, @total, 'TARJETA_CREDITO', 'APROBADO', 'US7-S06-P', 'VISA', '4242', @pago, @resultado);

SELECT 'US7 fixture preparada' AS resultado,
       @inicio AS fecha_s05,
       @fin AS fecha_s06,
       @salida_parcial AS salida_s05,
       @salida_agotada AS salida_s06;
