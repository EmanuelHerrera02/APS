-- Migración US11 para bases existentes: TTL de 10 minutos en reservas temporales,
-- confirmación atómica contra el inventario de disponibilidad y expiración
-- preventiva de reservas vencidas antes de confirmar un pago.
USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DELIMITER //

DROP TRIGGER IF EXISTS trg_compra_bi//
CREATE TRIGGER trg_compra_bi BEFORE INSERT ON compra FOR EACH ROW
BEGIN
  DECLARE v_ok INT DEFAULT 0;

  IF NEW.estado <> 'PENDIENTE_PAGO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una compra se crea en estado PENDIENTE_PAGO';
  END IF;

  SELECT COUNT(*) INTO v_ok
    FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
   WHERE s.id = NEW.salida_id;
  IF v_ok = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La salida no existe';
  END IF;

  SELECT COUNT(*) INTO v_ok
    FROM salida s
    JOIN vuelo v ON v.id = s.vuelo_id
    JOIN vuelo_dia_operacion d ON d.vuelo_id = v.id
   WHERE s.id = NEW.salida_id
     AND s.fecha BETWEEN v.fecha_desde AND v.fecha_hasta
     AND d.dia_semana = WEEKDAY(s.fecha) + 1;
  IF v_ok = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'La salida está fuera del período de venta o el vuelo no opera ese día';
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
    SET NEW.expira_en = NOW() + INTERVAL 10 MINUTE;
  END IF;
  SET NEW.confirmada_en = NULL;
END//

DROP TRIGGER IF EXISTS trg_compra_bu//
CREATE TRIGGER trg_compra_bu BEFORE UPDATE ON compra FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(255);
  DECLARE v_reservados INT DEFAULT 0;
  DECLARE v_desborde INT DEFAULT 0;
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
      IF OLD.expira_en IS NOT NULL AND OLD.expira_en <= NOW() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La reserva de la compra está vencida';
      END IF;
      SELECT COUNT(*) INTO v_reservados
        FROM pasaje WHERE compra_id = NEW.id AND estado = 'RESERVADO';
      IF v_reservados = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se puede confirmar una compra sin pasajes reservados';
      END IF;
      SELECT COUNT(*) INTO v_desborde
        FROM salida_clase sc
       WHERE sc.salida_id = NEW.salida_id
         AND (sc.vendidos > sc.capacidad
              OR (SELECT COUNT(*) FROM pasaje p
                   WHERE p.salida_id = sc.salida_id
                     AND p.clase = sc.clase
                     AND p.estado IN ('RESERVADO', 'EMITIDO')) > sc.vendidos);
      IF v_desborde > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Inconsistencia de inventario: los pasajes activos superan la capacidad disponible';
      END IF;
      SET NEW.confirmada_en = COALESCE(NEW.confirmada_en, NOW());
    END IF;
  END IF;
END//

DROP PROCEDURE IF EXISTS confirmar_compra//
CREATE PROCEDURE confirmar_compra(IN p_compra_id BIGINT UNSIGNED)
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  DECLARE v_salida_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_expira_en DATETIME DEFAULT NULL;
  DECLARE v_clases INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_confirmar_compra; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_confirmar_compra; END IF;

  SELECT estado, salida_id, expira_en
    INTO v_estado, v_salida_id, v_expira_en
    FROM compra WHERE id = p_compra_id FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra no existe';
  END IF;
  IF v_estado <> 'PENDIENTE_PAGO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se pueden confirmar compras en estado PENDIENTE_PAGO';
  END IF;
  IF v_expira_en IS NOT NULL AND v_expira_en <= NOW() THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La reserva de la compra está vencida';
  END IF;

  SELECT COUNT(*) INTO v_clases
    FROM salida_clase
   WHERE salida_id = v_salida_id
     AND clase IN (SELECT clase FROM pasaje WHERE compra_id = p_compra_id AND estado = 'RESERVADO')
   FOR UPDATE;

  UPDATE compra SET estado = 'CONFIRMADA' WHERE id = p_compra_id;

  IF v_tx_propia THEN COMMIT; END IF;
END//

DROP PROCEDURE IF EXISTS registrar_pago//
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
  DECLARE v_expira_en DATETIME DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_pago_id = NULL, p_resultado = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_registrar_pago; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_registrar_pago; END IF;

  SELECT estado, total, expira_en INTO v_estado, v_total, v_expira_en
    FROM compra WHERE id = p_compra_id FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra no existe';
  END IF;
  IF v_estado = 'PENDIENTE_PAGO' AND v_expira_en IS NOT NULL AND v_expira_en <= NOW() THEN
    UPDATE compra SET estado = 'EXPIRADA' WHERE id = p_compra_id;
    SET v_estado = 'EXPIRADA';
  END IF;
  IF p_estado = 'APROBADO' AND v_estado = 'PENDIENTE_PAGO' AND p_monto <> v_total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El monto aprobado no coincide con el total de la compra';
  END IF;

  INSERT INTO pago (compra_id, monto, medio, estado, id_transaccion_pasarela, marca_tarjeta, ultimos_4)
  VALUES (p_compra_id, p_monto, p_medio, p_estado, p_id_transaccion, p_marca_tarjeta, p_ultimos_4);
  SET p_pago_id = LAST_INSERT_ID();

  IF p_estado = 'APROBADO' AND v_estado = 'PENDIENTE_PAGO' THEN
    CALL confirmar_compra(p_compra_id);
    CALL emitir_factura_compra(p_compra_id);

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

DROP PROCEDURE IF EXISTS liberar_reservas_vencidas//
CREATE PROCEDURE liberar_reservas_vencidas()
MODIFIES SQL DATA
BEGIN
  DECLARE v_corte DATETIME DEFAULT NOW();
  DECLARE v_asientos INT;
  DECLARE v_compras INT;

  SELECT COUNT(*) INTO v_asientos
    FROM pasaje p JOIN compra c ON c.id = p.compra_id
   WHERE c.estado = 'PENDIENTE_PAGO' AND c.expira_en <= v_corte AND p.estado = 'RESERVADO';

  UPDATE compra SET estado = 'EXPIRADA'
   WHERE estado = 'PENDIENTE_PAGO' AND expira_en <= v_corte;
  SET v_compras = ROW_COUNT();

  SELECT v_compras AS compras_expiradas, v_asientos AS asientos_liberados;
END//

DELIMITER ;

