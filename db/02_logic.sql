-- =============================================================================
-- AeroNet - US 2 - Modelo de datos
-- 02_logic.sql: funciones, triggers, procedimientos almacenados y eventos.
--
-- Invariante central de capacidad (por salida y clase):
--     pasajes activos (RESERVADO/EMITIDO)  <=  vendidos  <=  capacidad
--   * vendidos <= capacidad ............ CHECK chk_salida_clase_vendidos
--   * vendidos solo sube por ........... reservar_asientos() (UPDATE atómico condicional)
--   * pasajes activos <= vendidos ...... trigger trg_pasaje_bi
--   * vendidos baja al cancelar pasaje . trigger trg_pasaje_au
-- =============================================================================

USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DELIMITER //

-- =============================================================================
-- Funciones auxiliares
-- =============================================================================

-- Cadena aleatoria de p_largo caracteres tomados de p_alfabeto.
CREATE FUNCTION generar_codigo(p_largo INT, p_alfabeto VARCHAR(64))
RETURNS VARCHAR(64)
NOT DETERMINISTIC NO SQL
BEGIN
  DECLARE v_codigo VARCHAR(64) DEFAULT '';
  WHILE CHAR_LENGTH(v_codigo) < p_largo DO
    SET v_codigo = CONCAT(v_codigo,
      SUBSTRING(p_alfabeto, 1 + FLOOR(RAND() * CHAR_LENGTH(p_alfabeto)), 1));
  END WHILE;
  RETURN v_codigo;
END//

-- =============================================================================
-- Triggers: borrado lógico
-- Las entidades de negocio no se borran físicamente: se desactivan o cambian
-- de estado. vuelo_dia_operacion, dispositivo_usuario y notificacion quedan
-- fuera (son configuración / datos operativos que se pueden depurar).
-- =============================================================================

CREATE TRIGGER trg_aeropuerto_bd BEFORE DELETE ON aeropuerto FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en aeropuerto: use activo = FALSE'//
CREATE TRIGGER trg_usuario_bd BEFORE DELETE ON usuario FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en usuario: use activo = FALSE'//
CREATE TRIGGER trg_vuelo_bd BEFORE DELETE ON vuelo FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en vuelo: use estado = CANCELADO'//
CREATE TRIGGER trg_vuelo_clase_bd BEFORE DELETE ON vuelo_clase FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en vuelo_clase'//
CREATE TRIGGER trg_salida_bd BEFORE DELETE ON salida FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en salida: use estado = CANCELADA'//
CREATE TRIGGER trg_salida_clase_bd BEFORE DELETE ON salida_clase FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en salida_clase'//
CREATE TRIGGER trg_compra_bd BEFORE DELETE ON compra FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en compra: use estado = CANCELADA'//
CREATE TRIGGER trg_pasaje_bd BEFORE DELETE ON pasaje FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en pasaje: use estado = CANCELADO'//
CREATE TRIGGER trg_pago_bd BEFORE DELETE ON pago FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en pago'//
CREATE TRIGGER trg_factura_bd BEFORE DELETE ON factura FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en factura'//

-- =============================================================================
-- Triggers: vuelo
-- =============================================================================

CREATE TRIGGER trg_vuelo_bu BEFORE UPDATE ON vuelo FOR EACH ROW
BEGIN
  IF OLD.estado = 'CANCELADO' AND NEW.estado <> 'CANCELADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un vuelo cancelado no puede reactivarse';
  END IF;
  IF NEW.aeropuerto_origen_id <> OLD.aeropuerto_origen_id
     OR NEW.aeropuerto_destino_id <> OLD.aeropuerto_destino_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La ruta de un vuelo no se modifica: cancele el vuelo y cree uno nuevo';
  END IF;
END//

-- Propaga a las salidas futuras la cancelación del vuelo o el cambio de horario.
-- El cambio de horario solo pisa salidas que conservan el horario anterior del
-- vuelo: las salidas reprogramadas individualmente no se tocan.
CREATE TRIGGER trg_vuelo_au AFTER UPDATE ON vuelo FOR EACH ROW
BEGIN
  IF OLD.estado = 'ACTIVO' AND NEW.estado = 'CANCELADO' THEN
    UPDATE salida
       SET estado = 'CANCELADA', motivo_cancelacion = 'Vuelo cancelado'
     WHERE vuelo_id = NEW.id
       AND estado = 'PROGRAMADA'
       AND TIMESTAMP(fecha, hora_partida) > NOW();
  ELSEIF NEW.hora_partida <> OLD.hora_partida
      OR NEW.hora_llegada <> OLD.hora_llegada
      OR NEW.dias_desfase_llegada <> OLD.dias_desfase_llegada THEN
    UPDATE salida
       SET hora_partida = NEW.hora_partida,
           hora_llegada = NEW.hora_llegada,
           dias_desfase_llegada = NEW.dias_desfase_llegada
     WHERE vuelo_id = NEW.id
       AND estado = 'PROGRAMADA'
       AND TIMESTAMP(fecha, hora_partida) > NOW()
       AND hora_partida = OLD.hora_partida
       AND hora_llegada = OLD.hora_llegada
       AND dias_desfase_llegada = OLD.dias_desfase_llegada;
  END IF;
END//

-- Un cambio de capacidad del vuelo se aplica a sus salidas futuras. Si alguna
-- ya vendió más que la nueva capacidad, trg_salida_clase_bu aborta todo.
CREATE TRIGGER trg_vuelo_clase_au AFTER UPDATE ON vuelo_clase FOR EACH ROW
BEGIN
  IF NEW.vuelo_id <> OLD.vuelo_id OR NEW.clase <> OLD.clase THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vuelo_id y clase de vuelo_clase son inmutables';
  END IF;
  IF NEW.capacidad <> OLD.capacidad THEN
    UPDATE salida_clase sc
      JOIN salida s ON s.id = sc.salida_id
       SET sc.capacidad = NEW.capacidad
     WHERE s.vuelo_id = NEW.vuelo_id
       AND sc.clase = NEW.clase
       AND s.estado = 'PROGRAMADA'
       AND TIMESTAMP(s.fecha, s.hora_partida) > NOW();
  END IF;
END//

-- =============================================================================
-- Triggers: salida y salida_clase
-- =============================================================================

CREATE TRIGGER trg_salida_bu BEFORE UPDATE ON salida FOR EACH ROW
BEGIN
  IF OLD.estado = 'CANCELADA' AND NEW.estado <> 'CANCELADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una salida cancelada no puede reprogramarse';
  END IF;
  IF NEW.vuelo_id <> OLD.vuelo_id OR NEW.fecha <> OLD.fecha THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vuelo_id y fecha de una salida son inmutables';
  END IF;
END//

-- Outbox: ante cancelación o cambio de horario de una salida se encolan
-- notificaciones (email a cada compra activa + push a los dispositivos del
-- comprador) en la misma transacción. Las compras aún impagas de una salida
-- cancelada se cancelan (libera sus pasajes).
CREATE TRIGGER trg_salida_au AFTER UPDATE ON salida FOR EACH ROW
BEGIN
  DECLARE v_tipo VARCHAR(20) DEFAULT NULL;
  DECLARE v_payload LONGTEXT;

  IF OLD.estado = 'PROGRAMADA' AND NEW.estado = 'CANCELADA' THEN
    SET v_tipo = 'CANCELACION';
  ELSEIF NEW.estado = 'PROGRAMADA' AND (
         NEW.hora_partida <> OLD.hora_partida
      OR NEW.hora_llegada <> OLD.hora_llegada
      OR NEW.dias_desfase_llegada <> OLD.dias_desfase_llegada) THEN
    SET v_tipo = 'CAMBIO_HORARIO';
  END IF;

  IF v_tipo IS NOT NULL THEN
    SET v_payload = JSON_OBJECT(
      'fecha', NEW.fecha,
      'hora_partida_anterior', OLD.hora_partida,
      'hora_llegada_anterior', OLD.hora_llegada,
      'hora_partida', NEW.hora_partida,
      'hora_llegada', NEW.hora_llegada,
      'dias_desfase_llegada', NEW.dias_desfase_llegada,
      'motivo', NEW.motivo_cancelacion);

    INSERT INTO notificacion (tipo, canal, destinatario, usuario_id, compra_id, salida_id, payload)
    SELECT v_tipo, 'EMAIL', c.email_contacto, c.usuario_id, c.id, NEW.id, v_payload
      FROM compra c
     WHERE c.salida_id = NEW.id
       AND c.estado IN ('PENDIENTE_PAGO', 'CONFIRMADA');

    INSERT INTO notificacion (tipo, canal, destinatario, usuario_id, compra_id, salida_id, payload)
    SELECT v_tipo, 'PUSH', d.token_push, c.usuario_id, c.id, NEW.id, v_payload
      FROM compra c
      JOIN usuario u             ON u.id = c.usuario_id AND u.activo
      JOIN dispositivo_usuario d ON d.usuario_id = u.id AND d.activo
     WHERE c.salida_id = NEW.id
       AND c.estado IN ('PENDIENTE_PAGO', 'CONFIRMADA');
  END IF;

  IF v_tipo = 'CANCELACION' THEN
    UPDATE compra SET estado = 'CANCELADA'
     WHERE salida_id = NEW.id AND estado = 'PENDIENTE_PAGO';
  END IF;
END//

CREATE TRIGGER trg_salida_clase_bu BEFORE UPDATE ON salida_clase FOR EACH ROW
BEGIN
  IF NEW.salida_id <> OLD.salida_id OR NEW.clase <> OLD.clase THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'salida_id y clase de salida_clase son inmutables';
  END IF;
  IF NEW.capacidad <> OLD.capacidad AND NEW.capacidad < NEW.vendidos THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No se puede reducir la capacidad por debajo de los asientos vendidos';
  END IF;
END//

-- =============================================================================
-- Triggers: compra
-- Máquina de estados:
--   PENDIENTE_PAGO -> CONFIRMADA | CANCELADA | EXPIRADA
--   CONFIRMADA     -> CANCELADA
--   CANCELADA, EXPIRADA: finales (sus asientos ya se liberaron)
-- =============================================================================

CREATE TRIGGER trg_compra_bi BEFORE INSERT ON compra FOR EACH ROW
BEGIN
  DECLARE v_ok INT DEFAULT 0;

  IF NEW.estado <> 'PENDIENTE_PAGO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una compra se crea en estado PENDIENTE_PAGO';
  END IF;

  SELECT COUNT(*) INTO v_ok
    FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
   WHERE s.id = NEW.salida_id
     AND s.estado = 'PROGRAMADA'
     AND v.estado = 'ACTIVO'
     AND TIMESTAMP(s.fecha, s.hora_partida) > NOW();
  IF v_ok = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La salida no está disponible para la venta';
  END IF;

  IF NEW.usuario_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_ok FROM usuario WHERE id = NEW.usuario_id AND activo;
    IF v_ok = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El usuario comprador no existe o está deshabilitado';
    END IF;
  END IF;

  IF NEW.empleado_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_ok FROM usuario
     WHERE id = NEW.empleado_id AND activo AND rol IN ('MOSTRADOR', 'ADMIN');
    IF v_ok = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El empleado vendedor no existe, está deshabilitado o no tiene rol interno';
    END IF;
  END IF;

  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    REPEAT
      SET NEW.codigo = generar_codigo(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    UNTIL NOT EXISTS (SELECT 1 FROM compra WHERE codigo = NEW.codigo) END REPEAT;
  END IF;

  IF NEW.expira_en IS NULL THEN
    SET NEW.expira_en = NOW() + INTERVAL 15 MINUTE;
  END IF;
  SET NEW.confirmada_en = NULL;
END//

CREATE TRIGGER trg_compra_bu BEFORE UPDATE ON compra FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(255);
  IF NEW.salida_id <> OLD.salida_id OR NEW.codigo <> OLD.codigo THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'salida_id y codigo de una compra son inmutables';
  END IF;

  IF NEW.estado <> OLD.estado THEN
    IF NOT (   (OLD.estado = 'PENDIENTE_PAGO' AND NEW.estado IN ('CONFIRMADA', 'CANCELADA', 'EXPIRADA'))
            OR (OLD.estado = 'CONFIRMADA'     AND NEW.estado = 'CANCELADA')) THEN
      SET v_msg = CONCAT('Transición de estado de compra inválida: ', OLD.estado, ' -> ', NEW.estado);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
    IF NEW.estado = 'CONFIRMADA' THEN
      SET NEW.confirmada_en = COALESCE(NEW.confirmada_en, NOW());
    END IF;
  END IF;
END//

-- Confirmar emite los pasajes; cancelar/expirar los cancela, y trg_pasaje_au
-- devuelve cada asiento a salida_clase.
CREATE TRIGGER trg_compra_au AFTER UPDATE ON compra FOR EACH ROW
BEGIN
  IF NEW.estado <> OLD.estado THEN
    IF NEW.estado = 'CONFIRMADA' THEN
      UPDATE pasaje SET estado = 'EMITIDO'
       WHERE compra_id = NEW.id AND estado = 'RESERVADO';
    ELSEIF NEW.estado IN ('CANCELADA', 'EXPIRADA') THEN
      UPDATE pasaje SET estado = 'CANCELADO'
       WHERE compra_id = NEW.id AND estado <> 'CANCELADO';
    END IF;
  END IF;
END//

-- =============================================================================
-- Triggers: pasaje
-- =============================================================================

CREATE TRIGGER trg_pasaje_bi BEFORE INSERT ON pasaje FOR EACH ROW
BEGIN
  DECLARE v_compra_estado VARCHAR(20);
  DECLARE v_compra_salida BIGINT UNSIGNED;
  DECLARE v_cantidad INT;
  DECLARE v_vendidos INT DEFAULT NULL;
  DECLARE v_activos INT;

  -- Bloquea la compra: serializa inserciones concurrentes en la misma compra.
  SELECT estado, salida_id INTO v_compra_estado, v_compra_salida
    FROM compra WHERE id = NEW.compra_id FOR UPDATE;
  IF v_compra_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra del pasaje no existe';
  END IF;
  IF v_compra_estado <> 'PENDIENTE_PAGO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se agregan pasajes a compras en PENDIENTE_PAGO';
  END IF;
  SET NEW.salida_id = COALESCE(NEW.salida_id, v_compra_salida);

  -- Regla de negocio: 1 a 9 pasajes por compra.
  SELECT COUNT(*) INTO v_cantidad FROM pasaje WHERE compra_id = NEW.compra_id;
  IF v_cantidad >= 9 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una compra admite como máximo 9 pasajes';
  END IF;

  IF NEW.estado <> 'RESERVADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Un pasaje se crea en estado RESERVADO';
  END IF;

  -- Todo pasaje activo debe tener un asiento reservado en salida_clase.vendidos.
  SELECT vendidos INTO v_vendidos
    FROM salida_clase WHERE salida_id = NEW.salida_id AND clase = NEW.clase FOR UPDATE;
  IF v_vendidos IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La salida no ofrece la clase solicitada';
  END IF;
  SELECT COUNT(*) INTO v_activos FROM pasaje
   WHERE salida_id = NEW.salida_id AND clase = NEW.clase AND estado IN ('RESERVADO', 'EMITIDO');
  IF v_activos + 1 > v_vendidos THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'No hay asiento reservado para el pasaje: llame antes a reservar_asientos()';
  END IF;

  -- Precio congelado: si no se informa, se toma el vigente del vuelo.
  IF NEW.precio IS NULL THEN
    SET NEW.precio = (SELECT vc.precio
                        FROM salida s JOIN vuelo_clase vc ON vc.vuelo_id = s.vuelo_id AND vc.clase = NEW.clase
                       WHERE s.id = NEW.salida_id);
  END IF;

  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    REPEAT
      SET NEW.codigo = CONCAT('AN', generar_codigo(10, '0123456789'));
    UNTIL NOT EXISTS (SELECT 1 FROM pasaje WHERE codigo = NEW.codigo) END REPEAT;
  END IF;
END//

-- Máquina de estados: RESERVADO -> EMITIDO | CANCELADO; EMITIDO -> CANCELADO.
CREATE TRIGGER trg_pasaje_bu BEFORE UPDATE ON pasaje FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(255);
  IF NEW.compra_id <> OLD.compra_id OR NEW.salida_id <> OLD.salida_id
     OR NEW.clase <> OLD.clase OR NEW.precio <> OLD.precio OR NEW.codigo <> OLD.codigo THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'compra, salida, clase, precio y código de un pasaje son inmutables';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT (
        (OLD.estado = 'RESERVADO' AND NEW.estado IN ('EMITIDO', 'CANCELADO'))
     OR (OLD.estado = 'EMITIDO'   AND NEW.estado = 'CANCELADO')) THEN
    SET v_msg = CONCAT('Transición de estado de pasaje inválida: ', OLD.estado, ' -> ', NEW.estado);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
END//

-- Único punto donde se liberan asientos.
CREATE TRIGGER trg_pasaje_au AFTER UPDATE ON pasaje FOR EACH ROW
BEGIN
  IF OLD.estado IN ('RESERVADO', 'EMITIDO') AND NEW.estado = 'CANCELADO' THEN
    UPDATE salida_clase SET vendidos = vendidos - 1
     WHERE salida_id = NEW.salida_id AND clase = NEW.clase;
  END IF;
END//

-- =============================================================================
-- Triggers: factura
-- =============================================================================

CREATE TRIGGER trg_factura_bi BEFORE INSERT ON factura FOR EACH ROW
BEGIN
  DECLARE v_estado VARCHAR(20);
  DECLARE v_total DECIMAL(12,2);
  SELECT estado, total INTO v_estado, v_total FROM compra WHERE id = NEW.compra_id;
  IF v_estado IS NULL OR v_estado <> 'CONFIRMADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se factura una compra CONFIRMADA';
  END IF;
  IF NEW.total <> v_total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El total de la factura no coincide con el de la compra';
  END IF;
END//

CREATE TRIGGER trg_factura_bu BEFORE UPDATE ON factura FOR EACH ROW
BEGIN
  IF NEW.compra_id <> OLD.compra_id OR NEW.numero <> OLD.numero OR NEW.tipo <> OLD.tipo
     OR NEW.total <> OLD.total OR NEW.fecha <> OLD.fecha THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una factura emitida no se modifica (solo ruta_pdf)';
  END IF;
END//

-- =============================================================================
-- Procedimientos
-- Los que ejecutan varios pasos usan su propia transacción si se los llama en
-- modo autocommit, o un SAVEPOINT si ya hay una transacción abierta; ante
-- cualquier error deshacen lo propio y re-lanzan el error original.
-- =============================================================================

-- Materializa una salida por cada día de operación dentro del período del
-- vuelo, con su salida_clase por cada clase. Idempotente: se puede volver a
-- llamar tras extender el período, agregar días o agregar una clase.
CREATE PROCEDURE generar_salidas(IN p_vuelo_id BIGINT UNSIGNED)
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_desde DATE;
  DECLARE v_hasta DATE;
  DECLARE v_dia DATE;
  DECLARE v_estado VARCHAR(20);
  DECLARE v_salidas INT DEFAULT 0;
  DECLARE v_clases INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_generar_salidas; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_generar_salidas; END IF;

  SELECT fecha_desde, fecha_hasta, estado INTO v_desde, v_hasta, v_estado
    FROM vuelo WHERE id = p_vuelo_id FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El vuelo no existe';
  END IF;
  IF v_estado <> 'ACTIVO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se generan salidas para un vuelo cancelado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vuelo_dia_operacion WHERE vuelo_id = p_vuelo_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El vuelo no tiene días de operación';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vuelo_clase WHERE vuelo_id = p_vuelo_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El vuelo no tiene clases (capacidad y precio)';
  END IF;

  SET v_dia = v_desde;
  WHILE v_dia <= v_hasta DO
    -- WEEKDAY(): 0 = lunes ... 6 = domingo  ->  dia_semana 1..7
    INSERT INTO salida (vuelo_id, aeropuerto_origen_id, aeropuerto_destino_id, fecha,
                        hora_partida, hora_llegada, dias_desfase_llegada)
    SELECT v.id, v.aeropuerto_origen_id, v.aeropuerto_destino_id, v_dia,
           v.hora_partida, v.hora_llegada, v.dias_desfase_llegada
      FROM vuelo v
     WHERE v.id = p_vuelo_id
       AND EXISTS (SELECT 1 FROM vuelo_dia_operacion d
                    WHERE d.vuelo_id = p_vuelo_id AND d.dia_semana = WEEKDAY(v_dia) + 1)
       AND NOT EXISTS (SELECT 1 FROM salida s WHERE s.vuelo_id = p_vuelo_id AND s.fecha = v_dia);
    SET v_salidas = v_salidas + ROW_COUNT();
    SET v_dia = v_dia + INTERVAL 1 DAY;
  END WHILE;

  INSERT INTO salida_clase (salida_id, clase, capacidad, vendidos)
  SELECT s.id, vc.clase, vc.capacidad, 0
    FROM salida s
    JOIN vuelo_clase vc ON vc.vuelo_id = s.vuelo_id
   WHERE s.vuelo_id = p_vuelo_id
     AND s.estado = 'PROGRAMADA'
     AND NOT EXISTS (SELECT 1 FROM salida_clase sc WHERE sc.salida_id = s.id AND sc.clase = vc.clase);
  SET v_clases = ROW_COUNT();

  IF v_tx_propia THEN COMMIT; END IF;

  SELECT p_vuelo_id AS vuelo_id, v_salidas AS salidas_generadas, v_clases AS salida_clases_generadas;
END//

-- Reserva atómica de p_cantidad asientos: un único UPDATE condicional. Si no
-- afecta filas, no hay disponibilidad (o la salida no es vendible) y se aborta.
CREATE PROCEDURE reservar_asientos(IN p_salida_id BIGINT UNSIGNED,
                                   IN p_clase     VARCHAR(10),
                                   IN p_cantidad  INT)
MODIFIES SQL DATA
BEGIN
  DECLARE v_disponibles INT DEFAULT NULL;
  DECLARE v_msg VARCHAR(255);

  IF p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 9 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cantidad de asientos a reservar debe estar entre 1 y 9';
  END IF;

  UPDATE salida_clase sc
     SET sc.vendidos = sc.vendidos + p_cantidad
   WHERE sc.salida_id = p_salida_id
     AND sc.clase = p_clase
     AND sc.vendidos + p_cantidad <= sc.capacidad
     AND EXISTS (SELECT 1 FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
                  WHERE s.id = sc.salida_id
                    AND s.estado = 'PROGRAMADA'
                    AND v.estado = 'ACTIVO'
                    AND TIMESTAMP(s.fecha, s.hora_partida) > NOW());

  IF ROW_COUNT() = 0 THEN
    SELECT sc.capacidad - sc.vendidos INTO v_disponibles
      FROM salida_clase sc WHERE sc.salida_id = p_salida_id AND sc.clase = p_clase;
    IF v_disponibles IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La salida no existe o no ofrece la clase solicitada';
    ELSEIF v_disponibles >= p_cantidad THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La salida no está disponible para la venta';
    ELSE
      SET v_msg = CONCAT('Sin disponibilidad: se pidieron ', p_cantidad, ' asientos en ',
                                p_clase, ' y quedan ', v_disponibles);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
  END IF;
END//

-- Flujo completo de venta: crea la compra en PENDIENTE_PAGO, reserva asientos
-- por clase, crea los pasajes con el precio vigente congelado y calcula el total.
-- p_pasajeros: JSON array de 1 a 9 objetos
--   {"nombre","apellido","tipo_documento":"DNI|PASAPORTE|OTRO","numero_documento","clase":"ECONOMY|PRIMERA"}
CREATE PROCEDURE crear_compra(IN  p_salida_id   BIGINT UNSIGNED,
                              IN  p_usuario_id  BIGINT UNSIGNED,
                              IN  p_empleado_id BIGINT UNSIGNED,
                              IN  p_canal       VARCHAR(10),
                              IN  p_email       VARCHAR(255),
                              IN  p_pasajeros   LONGTEXT,
                              OUT p_compra_id   BIGINT UNSIGNED)
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_cantidad INT;
  DECLARE v_validos INT;
  DECLARE v_economy INT;
  DECLARE v_primera INT;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_compra_id = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_crear_compra; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_crear_compra; END IF;

  IF p_pasajeros IS NULL OR NOT JSON_VALID(p_pasajeros) OR JSON_TYPE(p_pasajeros) <> 'ARRAY' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'p_pasajeros debe ser un array JSON';
  END IF;
  SET v_cantidad = JSON_LENGTH(p_pasajeros);
  IF v_cantidad < 1 OR v_cantidad > 9 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una compra admite de 1 a 9 pasajes';
  END IF;

  SELECT COUNT(*),
         COALESCE(SUM(jt.clase = 'ECONOMY'), 0),
         COALESCE(SUM(jt.clase = 'PRIMERA'), 0)
    INTO v_validos, v_economy, v_primera
    FROM JSON_TABLE(p_pasajeros, '$[*]' COLUMNS (
           nombre           VARCHAR(100) PATH '$.nombre',
           apellido         VARCHAR(100) PATH '$.apellido',
           tipo_documento   VARCHAR(20)  PATH '$.tipo_documento',
           numero_documento VARCHAR(20)  PATH '$.numero_documento',
           clase            VARCHAR(10)  PATH '$.clase')) AS jt
   WHERE NULLIF(TRIM(jt.nombre), '') IS NOT NULL
     AND NULLIF(TRIM(jt.apellido), '') IS NOT NULL
     AND jt.tipo_documento IN ('DNI', 'PASAPORTE', 'OTRO')
     AND NULLIF(TRIM(jt.numero_documento), '') IS NOT NULL
     AND jt.clase IN ('ECONOMY', 'PRIMERA');
  IF v_validos <> v_cantidad THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Datos de pasajero incompletos o inválidos (nombre, apellido, tipo_documento, numero_documento, clase)';
  END IF;

  INSERT INTO compra (salida_id, usuario_id, empleado_id, canal, email_contacto, estado)
  VALUES (p_salida_id, p_usuario_id, p_empleado_id, p_canal, p_email, 'PENDIENTE_PAGO');
  SET p_compra_id = LAST_INSERT_ID();

  IF v_economy > 0 THEN CALL reservar_asientos(p_salida_id, 'ECONOMY', v_economy); END IF;
  IF v_primera > 0 THEN CALL reservar_asientos(p_salida_id, 'PRIMERA', v_primera); END IF;

  INSERT INTO pasaje (compra_id, salida_id, clase, nombre, apellido,
                      tipo_documento, numero_documento, precio, estado)
  SELECT p_compra_id, p_salida_id, jt.clase, TRIM(jt.nombre), TRIM(jt.apellido),
         jt.tipo_documento, TRIM(jt.numero_documento), vc.precio, 'RESERVADO'
    FROM JSON_TABLE(p_pasajeros, '$[*]' COLUMNS (
           orden            FOR ORDINALITY,
           nombre           VARCHAR(100) PATH '$.nombre',
           apellido         VARCHAR(100) PATH '$.apellido',
           tipo_documento   VARCHAR(20)  PATH '$.tipo_documento',
           numero_documento VARCHAR(20)  PATH '$.numero_documento',
           clase            VARCHAR(10)  PATH '$.clase')) AS jt
    JOIN salida s       ON s.id = p_salida_id
    JOIN vuelo_clase vc ON vc.vuelo_id = s.vuelo_id AND vc.clase = jt.clase
   ORDER BY jt.orden;

  UPDATE compra
     SET total = (SELECT SUM(precio) FROM pasaje WHERE compra_id = p_compra_id)
   WHERE id = p_compra_id;

  IF v_tx_propia THEN COMMIT; END IF;
END//

-- Registra el resultado de un pago y aplica su efecto sobre la compra:
--   APROBADO  + compra PENDIENTE_PAGO -> CONFIRMADA (emite pasajes, encola email/push)
--   APROBADO  + compra ya no pendiente -> se registra; p_resultado = REQUIERE_REEMBOLSO
--   RECHAZADO + compra PENDIENTE_PAGO -> CANCELADA (libera asientos)
--   otros casos -> solo se registra el pago
CREATE PROCEDURE registrar_pago(IN  p_compra_id      BIGINT UNSIGNED,
                                IN  p_monto          DECIMAL(12,2),
                                IN  p_medio          VARCHAR(20),
                                IN  p_estado         VARCHAR(20),
                                IN  p_id_transaccion VARCHAR(100),
                                IN  p_marca_tarjeta  VARCHAR(20),
                                IN  p_ultimos_4      CHAR(4),
                                OUT p_pago_id        BIGINT UNSIGNED,
                                OUT p_resultado      VARCHAR(20))
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  DECLARE v_total DECIMAL(12,2);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_pago_id = NULL, p_resultado = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_registrar_pago; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_registrar_pago; END IF;

  -- Bloquea la compra: evita carreras con liberar_reservas_vencidas().
  SELECT estado, total INTO v_estado, v_total FROM compra WHERE id = p_compra_id FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra no existe';
  END IF;
  IF p_estado = 'APROBADO' AND v_estado = 'PENDIENTE_PAGO' AND p_monto <> v_total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El monto aprobado no coincide con el total de la compra';
  END IF;

  INSERT INTO pago (compra_id, monto, medio, estado, id_transaccion_pasarela, marca_tarjeta, ultimos_4)
  VALUES (p_compra_id, p_monto, p_medio, p_estado, p_id_transaccion, p_marca_tarjeta, p_ultimos_4);
  SET p_pago_id = LAST_INSERT_ID();

  IF p_estado = 'APROBADO' AND v_estado = 'PENDIENTE_PAGO' THEN
    UPDATE compra SET estado = 'CONFIRMADA' WHERE id = p_compra_id;

    INSERT INTO notificacion (tipo, canal, destinatario, usuario_id, compra_id, salida_id)
    SELECT 'CONFIRMACION', 'EMAIL', c.email_contacto, c.usuario_id, c.id, c.salida_id
      FROM compra c WHERE c.id = p_compra_id;

    INSERT INTO notificacion (tipo, canal, destinatario, usuario_id, compra_id, salida_id)
    SELECT 'CONFIRMACION', 'PUSH', d.token_push, c.usuario_id, c.id, c.salida_id
      FROM compra c
      JOIN usuario u             ON u.id = c.usuario_id AND u.activo
      JOIN dispositivo_usuario d ON d.usuario_id = u.id AND d.activo
     WHERE c.id = p_compra_id;

    SET p_resultado = 'CONFIRMADA';
  ELSEIF p_estado = 'APROBADO' THEN
    SET p_resultado = 'REQUIERE_REEMBOLSO';
  ELSEIF p_estado = 'RECHAZADO' AND v_estado = 'PENDIENTE_PAGO' THEN
    UPDATE compra SET estado = 'CANCELADA' WHERE id = p_compra_id;
    SET p_resultado = 'CANCELADA';
  ELSE
    SET p_resultado = 'REGISTRADO';
  END IF;

  IF v_tx_propia THEN COMMIT; END IF;
END//

-- Expira las compras impagas vencidas. Los triggers cancelan sus pasajes y
-- devuelven los asientos. Lo ejecuta el evento ev_liberar_reservas_vencidas.
CREATE PROCEDURE liberar_reservas_vencidas()
MODIFIES SQL DATA
BEGIN
  DECLARE v_corte DATETIME DEFAULT NOW();
  DECLARE v_asientos INT;
  DECLARE v_compras INT;

  SELECT COUNT(*) INTO v_asientos
    FROM pasaje p JOIN compra c ON c.id = p.compra_id
   WHERE c.estado = 'PENDIENTE_PAGO' AND c.expira_en < v_corte AND p.estado = 'RESERVADO';

  UPDATE compra SET estado = 'EXPIRADA'
   WHERE estado = 'PENDIENTE_PAGO' AND expira_en < v_corte;
  SET v_compras = ROW_COUNT();

  SELECT v_compras AS compras_expiradas, v_asientos AS asientos_liberados;
END//

-- Encola el reenvío de pasajes y factura (empleado de mostrador o el pasajero).
CREATE PROCEDURE reenviar_documentacion(IN p_compra_id    BIGINT UNSIGNED,
                                        IN p_solicitante  BIGINT UNSIGNED,
                                        IN p_email        VARCHAR(255))
MODIFIES SQL DATA
BEGIN
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  SELECT estado INTO v_estado FROM compra WHERE id = p_compra_id;
  IF v_estado IS NULL OR v_estado <> 'CONFIRMADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se reenvía documentación de compras CONFIRMADAS';
  END IF;

  INSERT INTO notificacion (tipo, canal, destinatario, usuario_id, compra_id, salida_id, solicitado_por_id)
  SELECT 'REENVIO', 'EMAIL', COALESCE(NULLIF(TRIM(p_email), ''), c.email_contacto),
         c.usuario_id, c.id, c.salida_id, p_solicitante
    FROM compra c WHERE c.id = p_compra_id;
END//

DELIMITER ;

-- =============================================================================
-- Evento: barrido periódico de reservas vencidas.
-- Requiere event_scheduler=ON (el docker-compose lo habilita).
-- =============================================================================
CREATE EVENT ev_liberar_reservas_vencidas
  ON SCHEDULE EVERY 1 MINUTE
  DO CALL liberar_reservas_vencidas();
