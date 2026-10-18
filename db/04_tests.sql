-- =============================================================================
-- AeroNet - US 2 - Modelo de datos
-- 04_tests.sql: pruebas de las restricciones de integridad y la lógica.
--
-- Requiere 01, 02 y 03 cargados. Todo corre dentro de una transacción que se
-- deshace al final: el script es repetible y no deja datos.
--
--   docker compose exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" aeronet' < db/04_tests.sql
--
-- Cada caso atrapa el error esperado con un handler y registra el resultado en
-- la tabla temporal resultado_test. Los resultados se muestran antes del
-- ROLLBACK final y, si algún caso falló, el script termina con error (código
-- de salida != 0) para poder usarlo en CI.
-- La tabla de resultados es InnoDB a propósito: una tabla no transaccional
-- dentro de la transacción haría que cada ROLLBACK TO SAVEPOINT emita un
-- warning que taparía el error real en GET DIAGNOSTICS.
-- =============================================================================

USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP TEMPORARY TABLE IF EXISTS resultado_test;
CREATE TEMPORARY TABLE resultado_test (
  caso      VARCHAR(5)   NOT NULL,
  requisito VARCHAR(60)  NOT NULL,
  prueba    VARCHAR(200) NOT NULL,
  esperado  VARCHAR(200) NOT NULL,
  obtenido  VARCHAR(512) NOT NULL,
  ok        BOOLEAN      NOT NULL
) ENGINE=InnoDB;

START TRANSACTION;

-- -----------------------------------------------------------------------------
-- Fixture: vuelo de prueba AEP -> NQN, todos los días, del día +1 al +30.
-- PRIMERA con capacidad 3 para poder agotarla fácilmente.
-- -----------------------------------------------------------------------------
SET @aep   = (SELECT id FROM aeropuerto WHERE codigo_iata = 'AEP');
SET @nqn   = (SELECT id FROM aeropuerto WHERE codigo_iata = 'NQN');
SET @juan  = (SELECT id FROM usuario WHERE email = 'juan.perez@gmail.com');
SET @maria = (SELECT id FROM usuario WHERE email = 'maria.gonzalez@hotmail.com');

INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id, hora_partida, hora_llegada,
                   fecha_desde, fecha_hasta)
VALUES ('ZZ9999', @aep, @nqn, '09:00', '10:55', CURDATE() + INTERVAL 1 DAY, CURDATE() + INTERVAL 30 DAY);
SET @v = LAST_INSERT_ID();
INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana) VALUES (@v,1),(@v,2),(@v,3),(@v,4),(@v,5),(@v,6),(@v,7);
INSERT INTO vuelo_clase (vuelo_id, clase, capacidad, precio) VALUES
  (@v, 'ECONOMY', 20, 100000.00),
  (@v, 'PRIMERA',  3, 250000.00);

CALL generar_salidas(@v);

SET @s  = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = CURDATE() + INTERVAL 5 DAY);
SET @s2 = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = CURDATE() + INTERVAL 6 DAY);
SET @s3 = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = CURDATE() + INTERVAL 7 DAY);

SET @uno_eco = '[{"nombre":"Test","apellido":"Uno","tipo_documento":"DNI","numero_documento":"40000001","clase":"ECONOMY"}]';
SET @dos_eco = '[{"nombre":"Test","apellido":"Uno","tipo_documento":"DNI","numero_documento":"40000001","clase":"ECONOMY"},
                 {"nombre":"Test","apellido":"Dos","tipo_documento":"DNI","numero_documento":"40000002","clase":"ECONOMY"}]';
SET @tres_pri = '[{"nombre":"P","apellido":"Uno","tipo_documento":"DNI","numero_documento":"41000001","clase":"PRIMERA"},
                  {"nombre":"P","apellido":"Dos","tipo_documento":"DNI","numero_documento":"41000002","clase":"PRIMERA"},
                  {"nombre":"P","apellido":"Tres","tipo_documento":"DNI","numero_documento":"41000003","clase":"PRIMERA"}]';
SET @cuatro_pri = JSON_ARRAY_APPEND(@tres_pri, '$',
  JSON_OBJECT('nombre','P','apellido','Cuatro','tipo_documento','DNI','numero_documento','41000004','clase','PRIMERA'));
SET @nueve_eco = '[
  {"nombre":"E","apellido":"Uno","tipo_documento":"DNI","numero_documento":"42000001","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Dos","tipo_documento":"DNI","numero_documento":"42000002","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Tres","tipo_documento":"DNI","numero_documento":"42000003","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Cuatro","tipo_documento":"DNI","numero_documento":"42000004","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Cinco","tipo_documento":"DNI","numero_documento":"42000005","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Seis","tipo_documento":"DNI","numero_documento":"42000006","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Siete","tipo_documento":"DNI","numero_documento":"42000007","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Ocho","tipo_documento":"DNI","numero_documento":"42000008","clase":"ECONOMY"},
  {"nombre":"E","apellido":"Nueve","tipo_documento":"DNI","numero_documento":"42000009","clase":"ECONOMY"}]';
SET @diez_eco = JSON_ARRAY_APPEND(@nueve_eco, '$',
  JSON_OBJECT('nombre','E','apellido','Diez','tipo_documento','DNI','numero_documento','42000010','clase','ECONOMY'));

DELIMITER //

-- =============================================================================
-- generar_salidas
-- =============================================================================

-- T01. Resultado esperado: 30 salidas (una por día del período, opera todos los
-- días) con 2 salida_clase cada una; una segunda llamada no genera duplicados.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_antes INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET v_antes = (SELECT COUNT(*) FROM salida WHERE vuelo_id = @v);
  CALL generar_salidas(@v);
  INSERT INTO resultado_test
  SELECT 'T01', 'Materialización de salidas', 'generar_salidas: 30 días -> 30 salidas; re-ejecutar es idempotente',
         '30 salidas, 60 salida_clase, sin duplicados',
         COALESCE(v_err, CONCAT(COUNT(DISTINCT s.id), ' salidas, ', COUNT(*), ' salida_clase (antes ', v_antes, ')')),
         v_err IS NULL AND v_antes = 30 AND COUNT(DISTINCT s.id) = 30 AND COUNT(*) = 60
    FROM salida s JOIN salida_clase sc ON sc.salida_id = s.id WHERE s.vuelo_id = @v;
END//

-- =============================================================================
-- Capacidad: no se puede vender más que la capacidad por clase
-- =============================================================================

-- T02. Resultado esperado: ERROR 'Sin disponibilidad' al reservar 4 asientos de
-- PRIMERA (capacidad 3); vendidos sigue en 0.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL reservar_asientos(@s, 'PRIMERA', 4);
  INSERT INTO resultado_test VALUES ('T02', 'Vender más que la capacidad falla',
    'reservar_asientos 4 PRIMERA con capacidad 3',
    'ERROR Sin disponibilidad; vendidos = 0', COALESCE(v_err, 'sin error'),
    v_err LIKE 'Sin disponibilidad%'
      AND (SELECT vendidos FROM salida_clase WHERE salida_id = @s AND clase = 'PRIMERA') = 0);
END//

-- T03. Resultado esperado: ERROR en crear_compra con 4 pasajeros PRIMERA y la
-- operación se deshace entera (no queda compra, pasajes ni asientos tomados).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @c_t03 = NULL;
  CALL crear_compra(@s, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @cuatro_pri, @c_t03);
  INSERT INTO resultado_test VALUES ('T03', 'Vender más que la capacidad falla',
    'crear_compra con 4 PRIMERA (capacidad 3) es atómica',
    'ERROR Sin disponibilidad; 0 compras en la salida; vendidos = 0', COALESCE(v_err, 'sin error'),
    v_err LIKE 'Sin disponibilidad%'
      AND (SELECT COUNT(*) FROM compra WHERE salida_id = @s) = 0
      AND (SELECT vendidos FROM salida_clase WHERE salida_id = @s AND clase = 'PRIMERA') = 0);
END//

-- T04. Resultado esperado: OK. Vender exactamente la capacidad (3 PRIMERA) se permite.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @tres_pri, @c_t04);
  INSERT INTO resultado_test VALUES ('T04', 'Vender más que la capacidad falla',
    'Control positivo: crear_compra con 3 PRIMERA (capacidad 3)',
    'OK; vendidos = 3; 3 pasajes RESERVADO',
    COALESCE(v_err, CONCAT('OK; vendidos = ',
      (SELECT vendidos FROM salida_clase WHERE salida_id = @s AND clase = 'PRIMERA'))),
    v_err IS NULL
      AND (SELECT vendidos FROM salida_clase WHERE salida_id = @s AND clase = 'PRIMERA') = 3
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t04 AND estado = 'RESERVADO') = 3);
END//

-- T05. Resultado esperado: ERROR 'Sin disponibilidad' al pedir 1 PRIMERA más (agotada).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s, @maria, NULL, 'MOVIL', 'maria.gonzalez@hotmail.com',
    '[{"nombre":"X","apellido":"Y","tipo_documento":"DNI","numero_documento":"43000001","clase":"PRIMERA"}]', @c_t05);
  INSERT INTO resultado_test VALUES ('T05', 'Vender más que la capacidad falla',
    'crear_compra 1 PRIMERA con la clase agotada',
    'ERROR Sin disponibilidad', COALESCE(v_err, 'sin error'),
    v_err LIKE 'Sin disponibilidad%');
END//

-- T06. Resultado esperado: ERROR del CHECK chk_salida_clase_vendidos al forzar
-- vendidos por encima de la capacidad con un UPDATE directo.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE salida_clase SET vendidos = capacidad + 1 WHERE salida_id = @s AND clase = 'PRIMERA';
  INSERT INTO resultado_test VALUES ('T06', 'Vender más que la capacidad falla',
    'UPDATE directo vendidos = capacidad + 1',
    'ERROR CONSTRAINT chk_salida_clase_vendidos', COALESCE(v_err, 'sin error'),
    v_err LIKE '%chk_salida_clase_vendidos%');
END//

-- T07. Resultado esperado: ERROR 'No hay asiento reservado' al insertar un
-- pasaje directamente sin haber reservado el asiento (evita saltear el control).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t07);
  INSERT INTO pasaje (compra_id, salida_id, clase, nombre, apellido, tipo_documento, numero_documento, precio)
  VALUES (@c_t07, @s, 'ECONOMY', 'Colado', 'Sin Reserva', 'DNI', '44000001', 100000.00);
  INSERT INTO resultado_test VALUES ('T07', 'Vender más que la capacidad falla',
    'INSERT directo de pasaje sin reservar_asientos',
    'ERROR No hay asiento reservado', COALESCE(v_err, 'sin error'),
    v_err LIKE 'No hay asiento reservado%');
END//

-- T08. Resultado esperado: OK. Reservando antes, el INSERT directo funciona y
-- el trigger completa código y precio congelado (vigente del vuelo: 100000.00).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL reservar_asientos(@s, 'ECONOMY', 1);
  INSERT INTO pasaje (compra_id, clase, nombre, apellido, tipo_documento, numero_documento)
  VALUES (@c_t07, 'ECONOMY', 'Con', 'Reserva', 'DNI', '44000002');
  INSERT INTO resultado_test
  SELECT 'T08', 'Precio congelado', 'Control positivo: reservar + INSERT directo sin precio ni código',
         'OK; precio 100000.00; código generado; salida_id tomada de la compra',
         COALESCE(v_err, CONCAT('OK; precio ', p.precio, '; código ', p.codigo)),
         v_err IS NULL AND p.precio = 100000.00 AND p.codigo LIKE 'AN__________' AND p.salida_id = @s
    FROM pasaje p WHERE p.compra_id = @c_t07 AND p.numero_documento = '44000002';
END//

-- =============================================================================
-- Límite de 1 a 9 pasajes por compra
-- =============================================================================

-- T09. Resultado esperado: OK. Una compra con 9 pasajes es válida.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @nueve_eco, @c_t09);
  INSERT INTO resultado_test VALUES ('T09', 'Pasaje número 10 falla',
    'Control positivo: crear_compra con 9 pasajeros', 'OK; 9 pasajes; total 900000.00',
    COALESCE(v_err, CONCAT('OK; ', (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t09),
                           ' pasajes; total ', (SELECT total FROM compra WHERE id = @c_t09))),
    v_err IS NULL
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t09) = 9
      AND (SELECT total FROM compra WHERE id = @c_t09) = 900000.00);
END//

-- T10. Resultado esperado: ERROR 'máximo 9 pasajes' al insertar el décimo pasaje
-- (con el asiento ya reservado, para que el único motivo de rechazo sea el límite).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL reservar_asientos(@s, 'ECONOMY', 1);
  INSERT INTO pasaje (compra_id, salida_id, clase, nombre, apellido, tipo_documento, numero_documento)
  VALUES (@c_t09, @s, 'ECONOMY', 'E', 'Diez', 'DNI', '42000010');
  INSERT INTO resultado_test VALUES ('T10', 'Pasaje número 10 falla',
    'INSERT del pasaje 10 en una compra con 9',
    'ERROR Una compra admite como máximo 9 pasajes; siguen 9', COALESCE(v_err, 'sin error'),
    v_err LIKE '%máximo 9 pasajes%'
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t09) = 9);
END//

-- T11. Resultado esperado: ERROR 'de 1 a 9 pasajes' en crear_compra con 10 pasajeros.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s2, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @diez_eco, @c_t11);
  INSERT INTO resultado_test VALUES ('T11', 'Pasaje número 10 falla',
    'crear_compra con 10 pasajeros', 'ERROR Una compra admite de 1 a 9 pasajes',
    COALESCE(v_err, 'sin error'), v_err LIKE '%de 1 a 9 pasajes%');
END//

-- =============================================================================
-- Capacidad no puede quedar por debajo de lo vendido
-- =============================================================================

-- T12. Resultado esperado: ERROR del trigger al bajar la capacidad PRIMERA de la
-- salida a 2 cuando hay 3 vendidos.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE salida_clase SET capacidad = 2 WHERE salida_id = @s AND clase = 'PRIMERA';
  INSERT INTO resultado_test VALUES ('T12', 'Bajar capacidad bajo lo vendido falla',
    'UPDATE salida_clase capacidad 3 -> 2 con 3 vendidos',
    'ERROR No se puede reducir la capacidad...; capacidad sigue en 3', COALESCE(v_err, 'sin error'),
    v_err LIKE 'No se puede reducir la capacidad%'
      AND (SELECT capacidad FROM salida_clase WHERE salida_id = @s AND clase = 'PRIMERA') = 3);
END//

-- T13. Resultado esperado: ERROR al bajar la capacidad en vuelo_clase: el cambio
-- se propaga a las salidas futuras y la que tiene 3 vendidos lo rechaza; el
-- UPDATE completo se deshace (vuelo_clase sigue en 3).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE vuelo_clase SET capacidad = 2 WHERE vuelo_id = @v AND clase = 'PRIMERA';
  INSERT INTO resultado_test VALUES ('T13', 'Bajar capacidad bajo lo vendido falla',
    'UPDATE vuelo_clase capacidad 3 -> 2 (propaga a salidas)',
    'ERROR No se puede reducir la capacidad...; vuelo_clase y salidas siguen en 3', COALESCE(v_err, 'sin error'),
    v_err LIKE 'No se puede reducir la capacidad%'
      AND (SELECT capacidad FROM vuelo_clase WHERE vuelo_id = @v AND clase = 'PRIMERA') = 3
      AND (SELECT COUNT(*) FROM salida_clase sc JOIN salida s ON s.id = sc.salida_id
            WHERE s.vuelo_id = @v AND sc.clase = 'PRIMERA' AND sc.capacidad <> 3) = 0);
END//

-- T14. Resultado esperado: OK. Subir la capacidad del vuelo se propaga a todas
-- sus salidas futuras.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE vuelo_clase SET capacidad = 5 WHERE vuelo_id = @v AND clase = 'PRIMERA';
  INSERT INTO resultado_test VALUES ('T14', 'Bajar capacidad bajo lo vendido falla',
    'Control positivo: vuelo_clase PRIMERA 3 -> 5', 'OK; 30 salidas con capacidad 5',
    COALESCE(v_err, CONCAT('OK; ', (SELECT COUNT(*) FROM salida_clase sc JOIN salida s ON s.id = sc.salida_id
                                     WHERE s.vuelo_id = @v AND sc.clase = 'PRIMERA' AND sc.capacidad = 5),
                           ' salidas con capacidad 5')),
    v_err IS NULL
      AND (SELECT COUNT(*) FROM salida_clase sc JOIN salida s ON s.id = sc.salida_id
            WHERE s.vuelo_id = @v AND sc.clase = 'PRIMERA' AND sc.capacidad = 5) = 30);
END//

-- =============================================================================
-- Integridad de vuelo y usuario
-- =============================================================================

-- T15. Resultado esperado: ERROR del CHECK chk_vuelo_ruta (origen = destino).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id, hora_partida, hora_llegada,
                     fecha_desde, fecha_hasta)
  VALUES ('ZZ9998', @aep, @aep, '09:00', '10:00', CURDATE(), CURDATE() + INTERVAL 10 DAY);
  INSERT INTO resultado_test VALUES ('T15', 'Origen igual a destino falla',
    'INSERT vuelo AEP -> AEP', 'ERROR CONSTRAINT chk_vuelo_ruta', COALESCE(v_err, 'sin error'),
    v_err LIKE '%chk_vuelo_ruta%');
END//

-- T16. Resultado esperado: ERROR del CHECK chk_vdo_dia (día de semana 8).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana) VALUES (@v, 8);
  INSERT INTO resultado_test VALUES ('T16', 'Días de operación válidos',
    'INSERT dia_semana = 8', 'ERROR CONSTRAINT chk_vdo_dia', COALESCE(v_err, 'sin error'),
    v_err LIKE '%chk_vdo_dia%');
END//

-- T17. Resultado esperado: ERROR de clave duplicada uq_usuario_email.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  INSERT INTO usuario (email, password_hash, nombre, apellido)
  VALUES ('juan.perez@gmail.com', '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012', 'Otro', 'Juan');
  INSERT INTO resultado_test VALUES ('T17', 'Email duplicado falla',
    'INSERT usuario con email existente', 'ERROR Duplicate entry ... uq_usuario_email',
    COALESCE(v_err, 'sin error'), v_err LIKE '%uq_usuario_email%');
END//

-- T18. Resultado esperado: ERROR de clave duplicada también si solo cambian
-- mayúsculas/minúsculas (la colación es case-insensitive).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  INSERT INTO usuario (email, password_hash, nombre, apellido)
  VALUES ('Juan.Perez@Gmail.com', '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012', 'Otro', 'Juan');
  INSERT INTO resultado_test VALUES ('T18', 'Email duplicado falla',
    'INSERT usuario con el mismo email en otra capitalización', 'ERROR Duplicate entry ... uq_usuario_email',
    COALESCE(v_err, 'sin error'), v_err LIKE '%uq_usuario_email%');
END//

-- T19. Resultado esperado: ERROR del CHECK chk_usuario_password_hash al intentar
-- guardar una contraseña en claro.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  INSERT INTO usuario (email, password_hash, nombre, apellido)
  VALUES ('nuevo@test.com', 'MiClave123!', 'Nuevo', 'Usuario');
  INSERT INTO resultado_test VALUES ('T19', 'Nunca contraseña en claro',
    'INSERT usuario con password en texto plano', 'ERROR CONSTRAINT chk_usuario_password_hash',
    COALESCE(v_err, 'sin error'), v_err LIKE '%chk_usuario_password_hash%');
END//

-- =============================================================================
-- Reservas temporales y liberación de asientos
-- =============================================================================

-- T20. Resultado esperado: liberar_reservas_vencidas() expira la compra vencida,
-- cancela sus 2 pasajes y devuelve los 2 asientos (vendidos vuelve al valor previo).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_antes INT;
  DECLARE v_reservado INT;
  DECLARE v_despues INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET v_antes = (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY');
  CALL crear_compra(@s2, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @dos_eco, @c_t20);
  SET v_reservado = (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY');
  UPDATE compra SET expira_en = NOW() - INTERVAL 1 MINUTE WHERE id = @c_t20;
  CALL liberar_reservas_vencidas();
  SET v_despues = (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY');
  INSERT INTO resultado_test VALUES ('T20', 'Liberar reservas vencidas devuelve asientos',
    'Compra de 2 pasajes vencida + liberar_reservas_vencidas()',
    'vendidos 0 -> 2 -> 0; compra EXPIRADA; 2 pasajes CANCELADO',
    COALESCE(v_err, CONCAT('vendidos ', v_antes, ' -> ', v_reservado, ' -> ', v_despues, '; compra ',
                           (SELECT estado FROM compra WHERE id = @c_t20), '; ',
                           (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t20 AND estado = 'CANCELADO'),
                           ' pasajes CANCELADO')),
    v_err IS NULL AND v_reservado = v_antes + 2 AND v_despues = v_antes
      AND (SELECT estado FROM compra WHERE id = @c_t20) = 'EXPIRADA'
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t20 AND estado = 'CANCELADO') = 2);
END//

-- T21. Resultado esperado: ERROR al intentar revivir una compra EXPIRADA
-- (sus asientos ya se liberaron).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE compra SET estado = 'CONFIRMADA' WHERE id = @c_t20;
  INSERT INTO resultado_test VALUES ('T21', 'Estados de compra',
    'UPDATE compra EXPIRADA -> CONFIRMADA', 'ERROR Transición de estado de compra inválida',
    COALESCE(v_err, 'sin error'), v_err LIKE 'Transición de estado de compra inválida%');
END//

-- T22. Resultado esperado: pago RECHAZADO cancela la compra y libera sus asientos.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_antes INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET v_antes = (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY');
  CALL crear_compra(@s2, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @dos_eco, @c_t22);
  CALL registrar_pago(@c_t22, 200000.00, 'TARJETA_CREDITO', 'RECHAZADO', 'TEST-RECH-1', 'VISA', '0002', @p_t22, @r_t22);
  INSERT INTO resultado_test VALUES ('T22', 'Pago rechazado libera asientos',
    'crear_compra 2 ECONOMY + registrar_pago RECHAZADO',
    'resultado CANCELADA; vendidos vuelve al valor previo; sin factura',
    COALESCE(v_err, CONCAT('resultado ', @r_t22, '; vendidos ',
      (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY'), ' (antes ', v_antes, ')')),
    v_err IS NULL AND @r_t22 = 'CANCELADA'
      AND (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY') = v_antes
      AND (SELECT COUNT(*) FROM factura WHERE compra_id = @c_t22) = 0);
END//

-- T23. Resultado esperado: pago APROBADO confirma la compra, emite los pasajes,
-- crea una factura y encola la notificación CONFIRMACION por email y push.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s3, @maria, NULL, 'MOVIL', 'maria.gonzalez@hotmail.com', @dos_eco, @c_t23);
  CALL registrar_pago(@c_t23, 200000.00, 'TARJETA_CREDITO', 'APROBADO', 'TEST-APR-1', 'VISA', '4242', @p_t23, @r_t23);
  CALL emitir_factura_compra(@c_t23);
  INSERT INTO resultado_test VALUES ('T23', 'Pago aprobado confirma y notifica',
    'crear_compra + registrar_pago APROBADO',
    'CONFIRMADA; 2 pasajes EMITIDO; 1 factura; 1 email + 1 push CONFIRMACION',
    COALESCE(v_err, CONCAT((SELECT estado FROM compra WHERE id = @c_t23), '; ',
      (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t23 AND estado = 'EMITIDO'), ' EMITIDO; ',
      (SELECT COUNT(*) FROM factura WHERE compra_id = @c_t23), ' factura; ',
      (SELECT COUNT(*) FROM notificacion WHERE compra_id = @c_t23 AND tipo = 'CONFIRMACION'), ' notificaciones')),
    v_err IS NULL AND @r_t23 = 'CONFIRMADA'
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t23 AND estado = 'EMITIDO') = 2
      AND (SELECT COUNT(*) FROM factura WHERE compra_id = @c_t23) = 1
      AND (SELECT tipo FROM factura WHERE compra_id = @c_t23) = 'C'
      AND (SELECT total FROM factura WHERE compra_id = @c_t23) = 200000.00
      AND (SELECT COUNT(*) FROM notificacion WHERE compra_id = @c_t23 AND tipo = 'CONFIRMACION' AND canal = 'EMAIL') = 1
      AND (SELECT COUNT(*) FROM notificacion WHERE compra_id = @c_t23 AND tipo = 'CONFIRMACION' AND canal = 'PUSH') = 1);
END//

-- T24. Resultado esperado: cancelar la salida encola CANCELACION para la compra
-- confirmada (email + push) y para la pendiente (email + push de Juan), y
-- cancela la compra pendiente devolviendo su asiento.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s3, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t24);
  UPDATE salida SET estado = 'CANCELADA', motivo_cancelacion = 'Prueba' WHERE id = @s3;
  INSERT INTO resultado_test VALUES ('T24', 'Notificación por cancelación',
    'Cancelar salida con 1 compra confirmada y 1 pendiente',
    '4 notificaciones CANCELACION (2 email, 2 push); pendiente -> CANCELADA; vendidos ECONOMY = 2',
    COALESCE(v_err, CONCAT(
      (SELECT COUNT(*) FROM notificacion WHERE salida_id = @s3 AND tipo = 'CANCELACION'), ' notificaciones; pendiente -> ',
      (SELECT estado FROM compra WHERE id = @c_t24), '; vendidos ',
      (SELECT vendidos FROM salida_clase WHERE salida_id = @s3 AND clase = 'ECONOMY'))),
    v_err IS NULL
      AND (SELECT COUNT(*) FROM notificacion WHERE salida_id = @s3 AND tipo = 'CANCELACION' AND canal = 'EMAIL') = 2
      AND (SELECT COUNT(*) FROM notificacion WHERE salida_id = @s3 AND tipo = 'CANCELACION' AND canal = 'PUSH') = 2
      AND (SELECT estado FROM compra WHERE id = @c_t24) = 'CANCELADA'
      AND (SELECT estado FROM compra WHERE id = @c_t23) = 'CONFIRMADA'
      AND (SELECT vendidos FROM salida_clase WHERE salida_id = @s3 AND clase = 'ECONOMY') = 2);
END//

-- T25. Resultado esperado: cambiar el horario del vuelo se propaga a sus salidas
-- futuras y encola CAMBIO_HORARIO para las compras activas de esas salidas.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE vuelo SET hora_partida = '09:30', hora_llegada = '11:25' WHERE id = @v;
  INSERT INTO resultado_test VALUES ('T25', 'Notificación por cambio de horario',
    'UPDATE vuelo hora 09:00 -> 09:30',
    '29 salidas programadas a las 09:30 (1 cancelada no se toca); CAMBIO_HORARIO para compras activas',
    COALESCE(v_err, CONCAT(
      (SELECT COUNT(*) FROM salida WHERE vuelo_id = @v AND hora_partida = '09:30:00'), ' salidas 09:30; ',
      (SELECT COUNT(*) FROM notificacion n JOIN salida s ON s.id = n.salida_id
        WHERE s.vuelo_id = @v AND n.tipo = 'CAMBIO_HORARIO'), ' notificaciones')),
    v_err IS NULL
      AND (SELECT COUNT(*) FROM salida WHERE vuelo_id = @v AND hora_partida = '09:30:00') = 29
      AND (SELECT COUNT(*) FROM notificacion n JOIN salida s ON s.id = n.salida_id
            WHERE s.vuelo_id = @v AND n.tipo = 'CAMBIO_HORARIO' AND n.canal = 'EMAIL')
        = (SELECT COUNT(*) FROM compra c JOIN salida s ON s.id = c.salida_id
            WHERE s.vuelo_id = @v AND s.estado = 'PROGRAMADA'
              AND c.estado IN ('PENDIENTE_PAGO', 'CONFIRMADA')));
END//

-- T26. Resultado esperado: ERROR, el borrado físico de compras está bloqueado.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  DELETE FROM compra WHERE id = @c_t20;
  INSERT INTO resultado_test VALUES ('T26', 'Borrado lógico',
    'DELETE de una compra', 'ERROR Borrado físico no permitido', COALESCE(v_err, 'sin error'),
    v_err LIKE 'Borrado físico no permitido%');
END//

-- =============================================================================
-- Estados de pasaje y de pago
-- =============================================================================

-- T27. Resultado esperado: ERROR al devolver un pasaje EMITIDO a RESERVADO.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE pasaje SET estado = 'RESERVADO' WHERE compra_id = @c_t23;
  INSERT INTO resultado_test VALUES ('T27', 'Estados de pasaje',
    'UPDATE pasaje EMITIDO -> RESERVADO', 'ERROR Transición de estado de pasaje inválida; siguen 2 EMITIDO',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'Transición de estado de pasaje inválida%'
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t23 AND estado = 'EMITIDO') = 2);
END//

-- T28. Resultado esperado: ERROR al volver un pago APROBADO a PENDIENTE.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE pago SET estado = 'PENDIENTE' WHERE id = @p_t23;
  INSERT INTO resultado_test VALUES ('T28', 'Estados de pago',
    'UPDATE pago APROBADO -> PENDIENTE', 'ERROR Transición de estado de pago inválida',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'Transición de estado de pago inválida%'
      AND (SELECT estado FROM pago WHERE id = @p_t23) = 'APROBADO');
END//

-- T29. Resultado esperado: ERROR al aprobar un pago RECHAZADO (estado final).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE pago SET estado = 'APROBADO' WHERE id = @p_t22;
  INSERT INTO resultado_test VALUES ('T29', 'Estados de pago',
    'UPDATE pago RECHAZADO -> APROBADO', 'ERROR Transición de estado de pago inválida',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'Transición de estado de pago inválida%'
      AND (SELECT estado FROM pago WHERE id = @p_t22) = 'RECHAZADO');
END//

-- T30. Resultado esperado: ERROR al cambiar el monto de un pago registrado.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE pago SET monto = monto + 1 WHERE id = @p_t23;
  INSERT INTO resultado_test VALUES ('T30', 'Estados de pago',
    'UPDATE monto de un pago', 'ERROR compra, monto y medio de un pago son inmutables',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'compra, monto y medio de un pago son inmutables%'
      AND (SELECT monto FROM pago WHERE id = @p_t23) = 200000.00);
END//

-- T31. Resultado esperado: ERROR al insertar un pago directamente como REEMBOLSADO.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  INSERT INTO pago (compra_id, monto, medio, estado) VALUES (@c_t23, 1.00, 'EFECTIVO', 'REEMBOLSADO');
  INSERT INTO resultado_test VALUES ('T31', 'Estados de pago',
    'INSERT pago en estado REEMBOLSADO', 'ERROR Un pago no se registra como REEMBOLSADO',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'Un pago no se registra como REEMBOLSADO%'
      AND (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t23) = 1);
END//

-- T32. Resultado esperado: ERROR al cambiar los datos de pasarela de un pago ya resuelto.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE pago SET ultimos_4 = '0000' WHERE id = @p_t23;
  INSERT INTO resultado_test VALUES ('T32', 'Estados de pago',
    'UPDATE ultimos_4 de un pago APROBADO', 'ERROR Los datos de pasarela de un pago resuelto son inmutables',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'Los datos de pasarela de un pago resuelto son inmutables%'
      AND (SELECT ultimos_4 FROM pago WHERE id = @p_t23) = '4242');
END//

-- T33. Resultado esperado: OK. Un pago APROBADO puede pasar a REEMBOLSADO.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE pago SET estado = 'REEMBOLSADO' WHERE id = @p_t23;
  INSERT INTO resultado_test VALUES ('T33', 'Estados de pago',
    'Control positivo: UPDATE pago APROBADO -> REEMBOLSADO', 'OK; estado REEMBOLSADO',
    COALESCE(v_err, CONCAT('OK; estado ', (SELECT estado FROM pago WHERE id = @p_t23))),
      v_err IS NULL AND (SELECT estado FROM pago WHERE id = @p_t23) = 'REEMBOLSADO');
END//

-- T34. Resultado esperado: ERROR si la fecha de la salida no opera ese día.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_compras_antes INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @fecha_no_operativa = CURDATE() + INTERVAL 8 DAY;
  DELETE FROM vuelo_dia_operacion
   WHERE vuelo_id = @v AND dia_semana = WEEKDAY(@fecha_no_operativa) + 1;
  SET @salida_no_operativa = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = @fecha_no_operativa);
  SET v_compras_antes = (SELECT COUNT(*) FROM compra);
  CALL crear_compra(@salida_no_operativa, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t34);
  INSERT INTO resultado_test VALUES ('T34', 'Período y días de operación',
    'Rechaza compra en fecha que no opera el vuelo',
    'ERROR La salida está fuera del período de venta o el vuelo no opera ese día',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'La salida está fuera del período de venta o el vuelo no opera ese día%'
      AND (SELECT COUNT(*) FROM compra) = v_compras_antes);
END//

-- T35. Resultado esperado: ERROR si se intenta vender una salida fuera del período.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_compras_antes INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @fecha_fuera_periodo = CURDATE() + INTERVAL 31 DAY;
  INSERT INTO salida (vuelo_id, aeropuerto_origen_id, aeropuerto_destino_id, fecha, hora_partida, hora_llegada)
  SELECT id, aeropuerto_origen_id, aeropuerto_destino_id, @fecha_fuera_periodo, hora_partida, hora_llegada
    FROM vuelo WHERE id = @v;
  SET @salida_fuera_periodo = LAST_INSERT_ID();
  INSERT INTO salida_clase (salida_id, clase, capacidad, vendidos)
  SELECT @salida_fuera_periodo, clase, capacidad, 0 FROM vuelo_clase WHERE vuelo_id = @v;
  SET v_compras_antes = (SELECT COUNT(*) FROM compra);
  CALL crear_compra(@salida_fuera_periodo, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t35);
  INSERT INTO resultado_test VALUES ('T35', 'Período y días de operación',
    'Rechaza compra después de la fecha final del vuelo',
    'ERROR La salida está fuera del período de venta o el vuelo no opera ese día',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'La salida está fuera del período de venta o el vuelo no opera ese día%'
      AND (SELECT COUNT(*) FROM compra) = v_compras_antes);
END//

-- T36. Resultado esperado: el TTL de reserva temporal es de 10 minutos (600 s) y
-- v_disponibilidad descuenta tanto ventas confirmadas como reservas vigentes.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_ttl_seg INT;
  DECLARE v_disp_inicial INT;
  DECLARE v_disp_tras_reserva INT;
  DECLARE v_disp_tras_confirmar INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @s_t36 = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = CURDATE() + INTERVAL 9 DAY);
  SET v_disp_inicial = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t36 AND clase = 'ECONOMY');
  CALL crear_compra(@s_t36, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @dos_eco, @c_t36a);
  SET v_ttl_seg = (SELECT TIMESTAMPDIFF(SECOND, created_at, expira_en) FROM compra WHERE id = @c_t36a);
  SET v_disp_tras_reserva = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t36 AND clase = 'ECONOMY');
  CALL confirmar_compra(@c_t36a);
  CALL crear_compra(@s_t36, @maria, NULL, 'WEB', 'maria.gonzalez@hotmail.com', @uno_eco, @c_t36b);
  SET v_disp_tras_confirmar = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t36 AND clase = 'ECONOMY');
  INSERT INTO resultado_test VALUES ('T36', 'TTL 10m y descuento en búsqueda',
    'TTL de 10 minutos y v_disponibilidad descuenta confirmadas y reservas vigentes',
    'TTL 600s; disponibles 20 -> 18 (reserva) -> 17 (2 confirmados + 1 reservado)',
    COALESCE(v_err, CONCAT('TTL ', v_ttl_seg, 's; disponibles ', v_disp_inicial, ' -> ', v_disp_tras_reserva, ' -> ', v_disp_tras_confirmar)),
    v_err IS NULL AND v_ttl_seg BETWEEN 599 AND 601
      AND v_disp_inicial = 20 AND v_disp_tras_reserva = 18 AND v_disp_tras_confirmar = 17
      AND (SELECT estado FROM compra WHERE id = @c_t36a) = 'CONFIRMADA');
END//

-- T37. Resultado esperado: confirmar_compra rechaza una reserva con TTL vencido y
-- registrar_pago sobre reserva vencida la expira, libera asientos y pide reembolso.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_disp_final INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE compra SET expira_en = NOW() - INTERVAL 1 SECOND WHERE id = @c_t36b;
  CALL confirmar_compra(@c_t36b);
  CALL registrar_pago(@c_t36b, 100000.00, 'TARJETA_CREDITO', 'APROBADO', 'TEST-EXP-37', 'VISA', '4242', @p_t37, @r_t37);
  SET v_disp_final = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t36 AND clase = 'ECONOMY');
  INSERT INTO resultado_test VALUES ('T37', 'Reserva vencida no se confirma',
    'confirmar_compra falla si expira_en <= NOW() y registrar_pago libera el asiento con REQUIERE_REEMBOLSO',
    'ERROR La reserva de la compra está vencida; resultado REQUIERE_REEMBOLSO; compra EXPIRADA; disponibles = 18',
    CONCAT(COALESCE(v_err, 'sin error'), '; resultado=', COALESCE(@r_t37, 'NULL'), '; disponibles=', COALESCE(v_disp_final, -1)),
    v_err LIKE 'La reserva de la compra está vencida%'
      AND @r_t37 = 'REQUIERE_REEMBOLSO'
      AND (SELECT estado FROM compra WHERE id = @c_t36b) = 'EXPIRADA'
      AND v_disp_final = 18);
END//

-- -----------------------------------------------------------------------------
-- US9 — Pago en línea: transacciones con uuid, idempotencia y efecto sobre la compra.
-- -----------------------------------------------------------------------------

-- T38. Resultado esperado: iniciar_transaccion_pago crea la transacción con el uuid
-- recibido y, mientras está activa, devuelve la misma aunque se pida con otro uuid.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @s_t38 = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = CURDATE() + INTERVAL 10 DAY);
  CALL crear_compra(@s_t38, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t38);
  CALL iniciar_transaccion_pago(@c_t38, @juan, '38000000-0000-4000-8000-000000000001', @tx_t38a);
  CALL iniciar_transaccion_pago(@c_t38, @juan, '38000000-0000-4000-8000-000000000002', @tx_t38b);
  INSERT INTO resultado_test VALUES ('T38', 'US9 UUID por transacción',
    'Una compra tiene una sola transacción activa: el segundo inicio devuelve el mismo uuid',
    'uuid …0001 en ambos inicios; 1 transacción CREADA con monto = total de la compra',
    COALESCE(v_err, CONCAT(COALESCE(@tx_t38a, 'NULL'), ' / ', COALESCE(@tx_t38b, 'NULL'), '; transacciones=',
      (SELECT COUNT(*) FROM transaccion_pago WHERE compra_id = @c_t38))),
    v_err IS NULL
      AND @tx_t38a = '38000000-0000-4000-8000-000000000001' AND @tx_t38b = @tx_t38a
      AND (SELECT COUNT(*) FROM transaccion_pago WHERE compra_id = @c_t38) = 1
      AND (SELECT estado FROM transaccion_pago WHERE uuid = @tx_t38a) = 'CREADA'
      AND (SELECT monto FROM transaccion_pago WHERE uuid = @tx_t38a) = (SELECT total FROM compra WHERE id = @c_t38));
END//

-- T39. Resultado esperado: ERROR al insertar una segunda transacción activa para la misma compra.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @total_t38 = (SELECT total FROM compra WHERE id = @c_t38);
  INSERT INTO transaccion_pago (uuid, compra_id, monto)
  VALUES ('39000000-0000-4000-8000-000000000001', @c_t38, @total_t38);
  INSERT INTO resultado_test VALUES ('T39', 'US9 Bloqueo de doble procesamiento',
    'El índice único impide dos transacciones activas para la misma compra',
    'ERROR Duplicate entry … uq_transaccion_pago_compra_activa',
    COALESCE(v_err, 'sin error'),
    v_err LIKE '%uq_transaccion_pago_compra_activa%'
      AND (SELECT COUNT(*) FROM transaccion_pago WHERE compra_id = @c_t38) = 1);
END//

-- T40. Resultado esperado: el pago aprobado confirma la compra y emite el pasaje;
-- repetir la misma notificación de la pasarela no registra un segundo pago.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL tomar_transaccion_pago(@tx_t38a, @juan, @accion_t40);
  CALL resolver_transaccion_pago(@tx_t38a, 'APROBADA', '9040001', 'approved', 'accredited',
                                 @total_t38, 'TARJETA_CREDITO', 'visa', '3704', @r_t40a);
  CALL resolver_transaccion_pago(@tx_t38a, 'APROBADA', '9040001', 'approved', 'accredited',
                                 @total_t38, 'TARJETA_CREDITO', 'visa', '3704', @r_t40b);
  INSERT INTO resultado_test VALUES ('T40', 'US9 Aprobado confirma e idempotencia',
    'APROBADA confirma la compra; una notificación repetida no duplica el pago',
    'PROCESAR; CONFIRMADA dos veces; 1 pago MP-9040001 APROBADO; pasaje EMITIDO',
    COALESCE(v_err, CONCAT(COALESCE(@accion_t40, 'NULL'), '; ', COALESCE(@r_t40a, 'NULL'), ' / ', COALESCE(@r_t40b, 'NULL'),
      '; pagos=', (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t38))),
    v_err IS NULL AND @accion_t40 = 'PROCESAR'
      AND @r_t40a = 'CONFIRMADA' AND @r_t40b = 'CONFIRMADA'
      AND (SELECT estado FROM compra WHERE id = @c_t38) = 'CONFIRMADA'
      AND (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t38) = 1
      AND (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t38 AND estado = 'APROBADO'
             AND id_transaccion_pasarela = 'MP-9040001' AND ultimos_4 = '3704') = 1
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t38 AND estado = 'EMITIDO') = 1
      AND (SELECT pago_id IS NOT NULL AND estado = 'APROBADA' FROM transaccion_pago WHERE uuid = @tx_t38a));
END//

-- T41. Resultado esperado: el pago rechazado cancela la compra y libera los asientos reservados.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_disp_inicial INT;
  DECLARE v_disp_reserva INT;
  DECLARE v_disp_final INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET @s_t41 = (SELECT id FROM salida WHERE vuelo_id = @v AND fecha = CURDATE() + INTERVAL 11 DAY);
  SET v_disp_inicial = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t41 AND clase = 'ECONOMY');
  CALL crear_compra(@s_t41, @maria, NULL, 'WEB', 'maria.gonzalez@hotmail.com', @dos_eco, @c_t41);
  SET v_disp_reserva = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t41 AND clase = 'ECONOMY');
  SET @total_t41 = (SELECT total FROM compra WHERE id = @c_t41);
  CALL iniciar_transaccion_pago(@c_t41, @maria, '41000000-0000-4000-8000-000000000001', @tx_t41);
  CALL tomar_transaccion_pago(@tx_t41, @maria, @accion_t41);
  CALL resolver_transaccion_pago(@tx_t41, 'RECHAZADA', '9041001', 'rejected', 'cc_rejected_other_reason',
                                 @total_t41, 'TARJETA_CREDITO', 'master', '0604', @r_t41);
  SET v_disp_final = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t41 AND clase = 'ECONOMY');
  INSERT INTO resultado_test VALUES ('T41', 'US9 Rechazado libera reservas',
    'RECHAZADA cancela la compra, cancela sus pasajes y devuelve los asientos',
    'CANCELADA; disponibles 20 -> 18 -> 20; transacción RECHAZADA',
    COALESCE(v_err, CONCAT(COALESCE(@r_t41, 'NULL'), '; disponibles ', v_disp_inicial, ' -> ', v_disp_reserva, ' -> ', v_disp_final)),
    v_err IS NULL AND @r_t41 = 'CANCELADA'
      AND v_disp_inicial = 20 AND v_disp_reserva = 18 AND v_disp_final = 20
      AND (SELECT estado FROM compra WHERE id = @c_t41) = 'CANCELADA'
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t41 AND estado <> 'CANCELADO') = 0
      AND (SELECT estado FROM transaccion_pago WHERE uuid = @tx_t41) = 'RECHAZADA'
      AND (SELECT detalle_estado FROM transaccion_pago WHERE uuid = @tx_t41) = 'cc_rejected_other_reason');
END//

-- T42. Resultado esperado: un pago pendiente mantiene la compra en PENDIENTE_PAGO
-- con los asientos reservados; la aprobación posterior la confirma.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_compra_pendiente VARCHAR(20);
  DECLARE v_disp_pendiente INT;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s_t41, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t42);
  SET @total_t42 = (SELECT total FROM compra WHERE id = @c_t42);
  CALL iniciar_transaccion_pago(@c_t42, @juan, '42000000-0000-4000-8000-000000000001', @tx_t42);
  CALL tomar_transaccion_pago(@tx_t42, @juan, @accion_t42);
  CALL resolver_transaccion_pago(@tx_t42, 'PENDIENTE', '9042001', 'in_process', 'pending_contingency',
                                 @total_t42, 'TARJETA_CREDITO', 'visa', '3704', @r_t42a);
  SET v_compra_pendiente = (SELECT estado FROM compra WHERE id = @c_t42);
  SET v_disp_pendiente = (SELECT asientos_disponibles FROM v_disponibilidad WHERE salida_id = @s_t41 AND clase = 'ECONOMY');
  CALL resolver_transaccion_pago(@tx_t42, 'APROBADA', '9042001', 'approved', 'accredited',
                                 @total_t42, 'TARJETA_CREDITO', 'visa', '3704', @r_t42b);
  INSERT INTO resultado_test VALUES ('T42', 'US9 Pendiente y aprobación asincrónica',
    'PENDIENTE conserva la reserva; la confirmación posterior de la pasarela confirma la compra',
    'PENDIENTE; compra PENDIENTE_PAGO con 19 disponibles; luego CONFIRMADA',
    COALESCE(v_err, CONCAT(COALESCE(@r_t42a, 'NULL'), '; compra ', COALESCE(v_compra_pendiente, 'NULL'),
      ' con ', COALESCE(v_disp_pendiente, -1), ' disponibles; luego ', COALESCE(@r_t42b, 'NULL'))),
    v_err IS NULL AND @r_t42a = 'PENDIENTE' AND v_compra_pendiente = 'PENDIENTE_PAGO'
      AND v_disp_pendiente = 19 AND @r_t42b = 'CONFIRMADA'
      AND (SELECT estado FROM compra WHERE id = @c_t42) = 'CONFIRMADA'
      AND (SELECT estado FROM transaccion_pago WHERE uuid = @tx_t42) = 'APROBADA');
END//

-- T43. Resultado esperado: ERROR si el importe informado por la pasarela no coincide;
-- no se registra pago y la compra sigue pendiente.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s_t41, @maria, NULL, 'WEB', 'maria.gonzalez@hotmail.com', @uno_eco, @c_t43);
  SET @total_t43 = (SELECT total FROM compra WHERE id = @c_t43);
  CALL iniciar_transaccion_pago(@c_t43, @maria, '43000000-0000-4000-8000-000000000001', @tx_t43);
  CALL tomar_transaccion_pago(@tx_t43, @maria, @accion_t43);
  CALL resolver_transaccion_pago(@tx_t43, 'APROBADA', '9043001', 'approved', 'accredited',
                                 1.00, 'TARJETA_CREDITO', 'visa', '3704', @r_t43);
  INSERT INTO resultado_test VALUES ('T43', 'US9 Importe de la pasarela',
    'Un importe distinto al de la transacción no confirma la compra ni registra el pago',
    'ERROR El importe informado por la pasarela no coincide con la transacción',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'El importe informado por la pasarela no coincide con la transacción%'
      AND (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t43) = 0
      AND (SELECT estado FROM compra WHERE id = @c_t43) = 'PENDIENTE_PAGO'
      AND (SELECT estado FROM transaccion_pago WHERE uuid = @tx_t43) = 'PROCESANDO');
END//

-- T44. Resultado esperado: un pago aprobado sobre una reserva vencida expira la compra,
-- pide reembolso y el reembolso queda registrado una sola vez.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE compra SET expira_en = NOW() - INTERVAL 1 SECOND WHERE id = @c_t43;
  CALL resolver_transaccion_pago(@tx_t43, 'APROBADA', '9043001', 'approved', 'accredited',
                                 @total_t43, 'TARJETA_CREDITO', 'visa', '3704', @r_t44);
  CALL registrar_reembolso_transaccion(@tx_t43);
  CALL registrar_reembolso_transaccion(@tx_t43);
  INSERT INTO resultado_test VALUES ('T44', 'US9 Aprobación tardía y reembolso',
    'Aprobación con la reserva vencida: compra EXPIRADA, REQUIERE_REEMBOLSO y reembolso idempotente',
    'REQUIERE_REEMBOLSO; compra EXPIRADA; transacción REEMBOLSADA; pago REEMBOLSADO',
    COALESCE(v_err, CONCAT(COALESCE(@r_t44, 'NULL'), '; compra ', (SELECT estado FROM compra WHERE id = @c_t43),
      '; transacción ', (SELECT estado FROM transaccion_pago WHERE uuid = @tx_t43))),
    v_err IS NULL AND @r_t44 = 'REQUIERE_REEMBOLSO'
      AND (SELECT estado FROM compra WHERE id = @c_t43) = 'EXPIRADA'
      AND (SELECT estado FROM transaccion_pago WHERE uuid = @tx_t43) = 'REEMBOLSADA'
      AND (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t43 AND estado = 'REEMBOLSADO') = 1
      AND (SELECT COUNT(*) FROM pago WHERE compra_id = @c_t43) = 1);
END//

-- T45. Resultado esperado: ERROR si otro usuario intenta iniciar el pago de una compra ajena.
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s_t41, @juan, NULL, 'WEB', 'juan.perez@gmail.com', @uno_eco, @c_t45);
  CALL iniciar_transaccion_pago(@c_t45, @maria, '45000000-0000-4000-8000-000000000001', @tx_t45);
  INSERT INTO resultado_test VALUES ('T45', 'US9 Pago de compra ajena',
    'Solo el comprador puede iniciar el pago; para otro usuario la compra no existe',
    'ERROR La compra no existe; sin transacciones',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'La compra no existe%'
      AND (SELECT COUNT(*) FROM transaccion_pago WHERE compra_id = @c_t45) = 0);
END//

-- T46. Resultado esperado: ERROR al reabrir una transacción RECHAZADA (estado final).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  UPDATE transaccion_pago SET estado = 'APROBADA' WHERE uuid = @tx_t41;
  INSERT INTO resultado_test VALUES ('T46', 'US9 Estados de transacción',
    'Una transacción RECHAZADA no puede pasar a APROBADA',
    'ERROR Transición de estado de transacción de pago inválida: RECHAZADA -> APROBADA',
    COALESCE(v_err, 'sin error'),
    v_err LIKE 'Transición de estado de transacción de pago inválida: RECHAZADA -> APROBADA%');
END//

-- T47. Resultado esperado: cada cambio de estado de la transacción queda en auditoria
-- con su uuid (CREADA -> PROCESANDO -> RECHAZADA).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE v_traza VARCHAR(200);
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  SET v_traza = (SELECT GROUP_CONCAT(JSON_UNQUOTE(JSON_EXTRACT(detalles, '$.estado')) ORDER BY id SEPARATOR ' -> ')
                   FROM auditoria
                  WHERE entidad = 'transaccion_pago' AND accion = 'PAGO_TRANSACCION'
                    AND JSON_UNQUOTE(JSON_EXTRACT(detalles, '$.uuid')) = @tx_t41);
  INSERT INTO resultado_test VALUES ('T47', 'US9 Estado rastreable',
    'La auditoría registra la creación y cada transición de la transacción',
    'CREADA -> PROCESANDO -> RECHAZADA',
    COALESCE(v_err, COALESCE(v_traza, 'sin registros')),
    v_err IS NULL AND v_traza = 'CREADA -> PROCESANDO -> RECHAZADA');
END//

DELIMITER ;

-- =============================================================================
-- Resultados (antes del ROLLBACK, que también descarta resultado_test)
-- =============================================================================
SELECT caso, requisito, prueba, esperado, obtenido,
       IF(ok, 'PASA', '** FALLA **') AS resultado
  FROM resultado_test ORDER BY caso;

SELECT COUNT(*) AS casos, SUM(ok) AS pasan, SUM(NOT ok) AS fallan,
       IF(SUM(NOT ok) = 0 AND COUNT(*) = 47, 'TODOS LOS CASOS PASAN', 'HAY CASOS QUE FALLAN') AS resumen
  FROM resultado_test;

SET @casos_ok = (SELECT COUNT(*) FROM resultado_test WHERE ok);

ROLLBACK;

-- Termina con error si algún caso falló o no se ejecutó (útil en CI).
DELIMITER //
BEGIN NOT ATOMIC
  IF @casos_ok <> 47 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '04_tests.sql: hay casos que fallan';
  END IF;
END//
DELIMITER ;
