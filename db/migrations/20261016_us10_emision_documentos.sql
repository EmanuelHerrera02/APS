-- Migración US10 para bases existentes. No elimina ni recrea tablas ni datos.
-- Ejecutar una vez antes de desplegar el backend con generación de documentos.
USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE pasaje
  ADD COLUMN IF NOT EXISTS ruta_pdf VARCHAR(500) NULL COMMENT 'Ubicación privada; NULL hasta generar el PDF',
  ADD UNIQUE INDEX IF NOT EXISTS uq_pasaje_ruta_pdf (ruta_pdf);

ALTER TABLE notificacion
  MODIFY COLUMN estado ENUM('PENDIENTE','PROCESANDO','ENVIADA','ENTREGADA','REBOTADA','FALLIDA') NOT NULL DEFAULT 'PENDIENTE';
ALTER TABLE notificacion
  DROP CONSTRAINT chk_notificacion_enviada,
  ADD CONSTRAINT chk_notificacion_enviada CHECK (estado <> 'ENVIADA' OR enviada_en IS NOT NULL),
  ADD CONSTRAINT chk_notificacion_entregada CHECK (estado <> 'ENTREGADA' OR enviada_en IS NOT NULL);

DELIMITER //

DROP PROCEDURE IF EXISTS emitir_factura_compra//
CREATE PROCEDURE emitir_factura_compra(IN p_compra_id BIGINT UNSIGNED)
MODIFIES SQL DATA
BEGIN
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  SELECT estado INTO v_estado FROM compra WHERE id = p_compra_id FOR UPDATE;
  IF v_estado IS NULL OR v_estado <> 'CONFIRMADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solo se emite factura para compras CONFIRMADAS';
  END IF;

  INSERT INTO factura (compra_id, numero, tipo, total, receptor_nombre)
  SELECT c.id, CONCAT('INT-', c.codigo), 'C', c.total,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), ''),
                  (SELECT NULLIF(TRIM(CONCAT_WS(' ', p.nombre, p.apellido)), '')
                     FROM pasaje p WHERE p.compra_id = c.id ORDER BY p.id LIMIT 1),
                  c.email_contacto)
    FROM compra c
    LEFT JOIN usuario u ON u.id = c.usuario_id
   WHERE c.id = p_compra_id
     AND NOT EXISTS (SELECT 1 FROM factura f WHERE f.compra_id = c.id);
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

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_pago_id = NULL, p_resultado = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_registrar_pago; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_registrar_pago; END IF;

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

DELIMITER ;
