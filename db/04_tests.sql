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
    'resultado CANCELADA; vendidos vuelve al valor previo',
    COALESCE(v_err, CONCAT('resultado ', @r_t22, '; vendidos ',
      (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY'), ' (antes ', v_antes, ')')),
    v_err IS NULL AND @r_t22 = 'CANCELADA'
      AND (SELECT vendidos FROM salida_clase WHERE salida_id = @s2 AND clase = 'ECONOMY') = v_antes);
END//

-- T23. Resultado esperado: pago APROBADO confirma la compra, emite los pasajes y
-- encola la notificación CONFIRMACION por email y push (María tiene app Android).
BEGIN NOT ATOMIC
  DECLARE v_err VARCHAR(512) DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION GET DIAGNOSTICS CONDITION 1 v_err = MESSAGE_TEXT;
  CALL crear_compra(@s3, @maria, NULL, 'MOVIL', 'maria.gonzalez@hotmail.com', @dos_eco, @c_t23);
  CALL registrar_pago(@c_t23, 200000.00, 'TARJETA_CREDITO', 'APROBADO', 'TEST-APR-1', 'VISA', '4242', @p_t23, @r_t23);
  INSERT INTO resultado_test VALUES ('T23', 'Pago aprobado confirma y notifica',
    'crear_compra + registrar_pago APROBADO',
    'CONFIRMADA; 2 pasajes EMITIDO; 1 email + 1 push CONFIRMACION',
    COALESCE(v_err, CONCAT((SELECT estado FROM compra WHERE id = @c_t23), '; ',
      (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t23 AND estado = 'EMITIDO'), ' EMITIDO; ',
      (SELECT COUNT(*) FROM notificacion WHERE compra_id = @c_t23 AND tipo = 'CONFIRMACION'), ' notificaciones')),
    v_err IS NULL AND @r_t23 = 'CONFIRMADA'
      AND (SELECT COUNT(*) FROM pasaje WHERE compra_id = @c_t23 AND estado = 'EMITIDO') = 2
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

DELIMITER ;

-- =============================================================================
-- Resultados (antes del ROLLBACK, que también descarta resultado_test)
-- =============================================================================
SELECT caso, requisito, prueba, esperado, obtenido,
       IF(ok, 'PASA', '** FALLA **') AS resultado
  FROM resultado_test ORDER BY caso;

SELECT COUNT(*) AS casos, SUM(ok) AS pasan, SUM(NOT ok) AS fallan,
       IF(SUM(NOT ok) = 0 AND COUNT(*) = 26, 'TODOS LOS CASOS PASAN', 'HAY CASOS QUE FALLAN') AS resumen
  FROM resultado_test;

SET @casos_ok = (SELECT COUNT(*) FROM resultado_test WHERE ok);

ROLLBACK;

-- Termina con error si algún caso falló o no se ejecutó (útil en CI).
DELIMITER //
BEGIN NOT ATOMIC
  IF @casos_ok <> 26 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '04_tests.sql: hay casos que fallan';
  END IF;
END//
DELIMITER ;
