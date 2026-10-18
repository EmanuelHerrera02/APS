-- Migración US9 para bases existentes: transacciones de pago en línea con uuid
-- (clave de idempotencia ante la pasarela), bloqueo de doble procesamiento,
-- auditoría de estados y procedimientos que aplican el resultado de la pasarela.
-- Idempotente: puede ejecutarse más de una vez.
USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- transaccion_pago (US9): intento de cobro en línea contra la pasarela.
-- uuid es la clave de idempotencia que se envía a la pasarela (X-Idempotency-Key)
-- y su external_reference. Los datos de tarjeta se tokenizan en el navegador
-- directamente contra la pasarela: acá nunca llegan PAN ni CVV.
-- compra_bloqueada impide dos transacciones activas o aprobadas para una compra.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaccion_pago (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  compra_id         BIGINT UNSIGNED NOT NULL,
  pasarela          ENUM('MERCADOPAGO') NOT NULL DEFAULT 'MERCADOPAGO',
  monto             DECIMAL(12,2)   NOT NULL,
  moneda            CHAR(3)         NOT NULL DEFAULT 'ARS',
  estado            ENUM('CREADA','PROCESANDO','PENDIENTE','APROBADA','RECHAZADA','ERROR','REEMBOLSADA')
                    NOT NULL DEFAULT 'CREADA',
  id_pago_pasarela  VARCHAR(64)     NULL,
  estado_pasarela   VARCHAR(40)     NULL,       -- status informado por la pasarela (approved, in_process…)
  detalle_estado    VARCHAR(100)    NULL,       -- status_detail o motivo del error
  resultado_compra  VARCHAR(20)     NULL,       -- resultado de registrar_pago()
  pago_id           BIGINT UNSIGNED NULL,
  consultas         SMALLINT        NOT NULL DEFAULT 0,
  compra_bloqueada  BIGINT UNSIGNED AS (CASE WHEN estado IN ('CREADA','PROCESANDO','PENDIENTE','APROBADA')
                                             THEN compra_id END) PERSISTENT,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_transaccion_pago_uuid (uuid),
  UNIQUE KEY uq_transaccion_pago_pasarela (pasarela, id_pago_pasarela),
  UNIQUE KEY uq_transaccion_pago_compra_activa (compra_bloqueada),
  UNIQUE KEY uq_transaccion_pago_pago (pago_id),
  KEY ix_transaccion_pago_compra (compra_id, created_at),
  KEY ix_transaccion_pago_conciliacion (estado, updated_at),
  CONSTRAINT fk_transaccion_pago_compra FOREIGN KEY (compra_id)
    REFERENCES compra (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_transaccion_pago_pago FOREIGN KEY (pago_id)
    REFERENCES pago (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_transaccion_pago_uuid
    CHECK (uuid REGEXP BINARY '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT chk_transaccion_pago_monto CHECK (monto > 0),
  CONSTRAINT chk_transaccion_pago_resuelta
    CHECK (estado NOT IN ('APROBADA','RECHAZADA','REEMBOLSADA') OR (id_pago_pasarela IS NOT NULL AND pago_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //

DROP TRIGGER IF EXISTS trg_transaccion_pago_bd//
DROP TRIGGER IF EXISTS trg_transaccion_pago_bi//
DROP TRIGGER IF EXISTS trg_transaccion_pago_bu//
DROP TRIGGER IF EXISTS trg_transaccion_pago_ai//
DROP TRIGGER IF EXISTS trg_transaccion_pago_au//
DROP PROCEDURE IF EXISTS iniciar_transaccion_pago//
DROP PROCEDURE IF EXISTS tomar_transaccion_pago//
DROP PROCEDURE IF EXISTS resolver_transaccion_pago//
DROP PROCEDURE IF EXISTS registrar_reembolso_transaccion//

CREATE TRIGGER trg_transaccion_pago_bd BEFORE DELETE ON transaccion_pago FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Borrado físico no permitido en transaccion_pago'//

CREATE TRIGGER trg_transaccion_pago_bi BEFORE INSERT ON transaccion_pago FOR EACH ROW
BEGIN
  IF NEW.estado <> 'CREADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Una transacción de pago se crea en estado CREADA';
  END IF;
END//

CREATE TRIGGER trg_transaccion_pago_bu BEFORE UPDATE ON transaccion_pago FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(255);
  IF NEW.uuid <> OLD.uuid OR NEW.compra_id <> OLD.compra_id OR NEW.pasarela <> OLD.pasarela
     OR NEW.monto <> OLD.monto OR NEW.moneda <> OLD.moneda THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'uuid, compra, pasarela, monto y moneda de una transacción de pago son inmutables';
  END IF;
  IF (OLD.id_pago_pasarela IS NOT NULL AND NOT (NEW.id_pago_pasarela <=> OLD.id_pago_pasarela))
     OR (OLD.pago_id IS NOT NULL AND NOT (NEW.pago_id <=> OLD.pago_id)) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'El pago asociado a una transacción no se puede reemplazar';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT (
        (OLD.estado = 'CREADA'     AND NEW.estado IN ('PROCESANDO', 'ERROR'))
     OR (OLD.estado = 'PROCESANDO' AND NEW.estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'ERROR'))
     OR (OLD.estado = 'PENDIENTE'  AND NEW.estado IN ('APROBADA', 'RECHAZADA'))
     OR (OLD.estado = 'ERROR'      AND NEW.estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA'))
     OR (OLD.estado = 'APROBADA'   AND NEW.estado = 'REEMBOLSADA')) THEN
    SET v_msg = CONCAT('Transición de estado de transacción de pago inválida: ', OLD.estado, ' -> ', NEW.estado);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
END//

CREATE TRIGGER trg_transaccion_pago_ai AFTER INSERT ON transaccion_pago FOR EACH ROW
  INSERT INTO auditoria (accion, entidad, entidad_id, detalles)
  VALUES ('PAGO_TRANSACCION', 'transaccion_pago', NEW.id,
          JSON_OBJECT('uuid', NEW.uuid, 'compra_id', NEW.compra_id, 'monto', NEW.monto,
                      'moneda', NEW.moneda, 'estado', NEW.estado))//

CREATE TRIGGER trg_transaccion_pago_au AFTER UPDATE ON transaccion_pago FOR EACH ROW
BEGIN
  IF NEW.estado <> OLD.estado THEN
    INSERT INTO auditoria (accion, entidad, entidad_id, detalles)
    VALUES ('PAGO_TRANSACCION', 'transaccion_pago', NEW.id,
            JSON_OBJECT('uuid', NEW.uuid, 'compra_id', NEW.compra_id, 'monto', NEW.monto,
                        'estado_anterior', OLD.estado, 'estado', NEW.estado,
                        'id_pago_pasarela', NEW.id_pago_pasarela, 'estado_pasarela', NEW.estado_pasarela,
                        'detalle', NEW.detalle_estado, 'resultado_compra', NEW.resultado_compra));
  END IF;
END//

-- Crea la transacción de pago de una compra pendiente, o devuelve la que ya
-- está activa o aprobada (dos clics o dos pestañas obtienen el mismo uuid).
-- Si p_usuario_id no es el comprador, la compra se informa como inexistente.
CREATE PROCEDURE iniciar_transaccion_pago(IN  p_compra_id        BIGINT UNSIGNED,
                                          IN  p_usuario_id       BIGINT UNSIGNED,
                                          IN  p_uuid             CHAR(36),
                                          OUT p_uuid_transaccion CHAR(36))
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  DECLARE v_usuario BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_total DECIMAL(12,2);
  DECLARE v_expira_en DATETIME DEFAULT NULL;
  DECLARE v_existente CHAR(36) DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_uuid_transaccion = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_iniciar_transaccion_pago; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_iniciar_transaccion_pago; END IF;

  SELECT estado, usuario_id, total, expira_en INTO v_estado, v_usuario, v_total, v_expira_en
    FROM compra WHERE id = p_compra_id FOR UPDATE;
  IF v_estado IS NULL OR NOT (v_usuario <=> p_usuario_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra no existe';
  END IF;

  SELECT uuid INTO v_existente FROM transaccion_pago WHERE compra_bloqueada = p_compra_id;
  IF v_existente IS NOT NULL THEN
    SET p_uuid_transaccion = v_existente;
  ELSE
    IF v_estado <> 'PENDIENTE_PAGO' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra no está pendiente de pago';
    END IF;
    IF v_expira_en IS NULL OR v_expira_en <= NOW() + INTERVAL 30 SECOND THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La reserva de la compra está vencida o por vencer';
    END IF;
    INSERT INTO transaccion_pago (uuid, compra_id, monto) VALUES (p_uuid, p_compra_id, v_total);
    SET p_uuid_transaccion = p_uuid;
  END IF;

  IF v_tx_propia THEN COMMIT; END IF;
END//

-- Reserva una transacción para enviarla a la pasarela. p_accion = PROCESAR
-- indica que el llamador debe invocar la pasarela con el uuid como clave de
-- idempotencia; cualquier otro valor es el estado actual (reintento del cliente).
-- Un PROCESANDO se reenvía solo si la reserva sigue vigente: la pasarela
-- deduplica por uuid, así que reenviar no genera un segundo cobro.
CREATE PROCEDURE tomar_transaccion_pago(IN  p_uuid       CHAR(36),
                                        IN  p_usuario_id BIGINT UNSIGNED,
                                        OUT p_accion     VARCHAR(20))
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  DECLARE v_compra_estado VARCHAR(20);
  DECLARE v_usuario BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_expira_en DATETIME DEFAULT NULL;
  DECLARE v_vigente BOOLEAN;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_accion = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_tomar_transaccion_pago; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_tomar_transaccion_pago; END IF;

  SELECT t.estado, c.estado, c.usuario_id, c.expira_en
    INTO v_estado, v_compra_estado, v_usuario, v_expira_en
    FROM transaccion_pago t JOIN compra c ON c.id = t.compra_id
   WHERE t.uuid = p_uuid FOR UPDATE;
  IF v_estado IS NULL OR NOT (v_usuario <=> p_usuario_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La transacción de pago no existe';
  END IF;
  SET v_vigente = (v_compra_estado = 'PENDIENTE_PAGO'
                   AND v_expira_en IS NOT NULL AND v_expira_en > NOW() + INTERVAL 30 SECOND);

  IF v_estado = 'CREADA' THEN
    IF v_compra_estado <> 'PENDIENTE_PAGO' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La compra no está pendiente de pago';
    END IF;
    IF NOT v_vigente THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La reserva de la compra está vencida o por vencer';
    END IF;
    UPDATE transaccion_pago SET estado = 'PROCESANDO' WHERE uuid = p_uuid;
    SET p_accion = 'PROCESAR';
  ELSEIF v_estado = 'PROCESANDO' AND v_vigente THEN
    SET p_accion = 'PROCESAR';
  ELSE
    SET p_accion = v_estado;
  END IF;

  IF v_tx_propia THEN COMMIT; END IF;
END//

-- Aplica el resultado que informa la pasarela (respuesta sincrónica, webhook o
-- conciliación). Idempotente: si la transacción ya está resuelta devuelve el
-- resultado guardado sin registrar otro pago. APROBADA confirma la compra y
-- RECHAZADA la cancela, liberando los asientos (vía registrar_pago).
-- p_resultado: PENDIENTE o el resultado de registrar_pago (CONFIRMADA,
-- CANCELADA, REQUIERE_REEMBOLSO, REGISTRADO).
CREATE PROCEDURE resolver_transaccion_pago(IN  p_uuid             CHAR(36),
                                           IN  p_estado           VARCHAR(20),
                                           IN  p_id_pago_pasarela VARCHAR(64),
                                           IN  p_estado_pasarela  VARCHAR(40),
                                           IN  p_detalle          VARCHAR(100),
                                           IN  p_monto            DECIMAL(12,2),
                                           IN  p_medio            VARCHAR(20),
                                           IN  p_marca            VARCHAR(20),
                                           IN  p_ultimos_4        CHAR(4),
                                           OUT p_resultado        VARCHAR(20))
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_compra_id BIGINT UNSIGNED;
  DECLARE v_monto DECIMAL(12,2);
  DECLARE v_estado VARCHAR(20);
  DECLARE v_id_pasarela VARCHAR(64);
  DECLARE v_resultado VARCHAR(20);
  DECLARE v_pago_id BIGINT UNSIGNED;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET p_resultado = NULL;
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_resolver_transaccion_pago; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_resolver_transaccion_pago; END IF;

  SELECT id, compra_id, monto, estado, id_pago_pasarela, resultado_compra
    INTO v_id, v_compra_id, v_monto, v_estado, v_id_pasarela, v_resultado
    FROM transaccion_pago WHERE uuid = p_uuid FOR UPDATE;
  IF v_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La transacción de pago no existe';
  END IF;
  IF NULLIF(TRIM(p_id_pago_pasarela), '') IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta el identificador del pago en la pasarela';
  END IF;
  IF v_id_pasarela IS NOT NULL AND v_id_pasarela <> p_id_pago_pasarela THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La transacción ya está asociada a otro pago de la pasarela';
  END IF;

  IF v_estado IN ('APROBADA', 'RECHAZADA', 'REEMBOLSADA') THEN
    SET p_resultado = v_resultado;
  ELSEIF p_estado = 'PENDIENTE' THEN
    UPDATE transaccion_pago
       SET estado = 'PENDIENTE', id_pago_pasarela = p_id_pago_pasarela,
           estado_pasarela = p_estado_pasarela, detalle_estado = p_detalle
     WHERE id = v_id;
    SET p_resultado = 'PENDIENTE';
  ELSEIF p_estado IN ('APROBADA', 'RECHAZADA') THEN
    IF p_monto IS NULL OR p_monto <> v_monto THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El importe informado por la pasarela no coincide con la transacción';
    END IF;
    CALL registrar_pago(v_compra_id, v_monto, p_medio,
                        IF(p_estado = 'APROBADA', 'APROBADO', 'RECHAZADO'),
                        CONCAT('MP-', p_id_pago_pasarela), p_marca, p_ultimos_4, v_pago_id, v_resultado);
    UPDATE transaccion_pago
       SET estado = p_estado, id_pago_pasarela = p_id_pago_pasarela,
           estado_pasarela = p_estado_pasarela, detalle_estado = p_detalle,
           pago_id = v_pago_id, resultado_compra = v_resultado
     WHERE id = v_id;
    SET p_resultado = v_resultado;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Estado de pasarela inválido: se espera PENDIENTE, APROBADA o RECHAZADA';
  END IF;

  IF v_tx_propia THEN COMMIT; END IF;
END//

-- Registra el reembolso de un pago aprobado que llegó con la compra ya vencida
-- o cancelada (resultado REQUIERE_REEMBOLSO). Repetirlo no tiene efecto.
CREATE PROCEDURE registrar_reembolso_transaccion(IN p_uuid CHAR(36))
MODIFIES SQL DATA
BEGIN
  DECLARE v_tx_propia BOOLEAN DEFAULT (@@in_transaction = 0);
  DECLARE v_estado VARCHAR(20) DEFAULT NULL;
  DECLARE v_resultado VARCHAR(20);
  DECLARE v_pago_id BIGINT UNSIGNED;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF v_tx_propia THEN ROLLBACK; ELSE ROLLBACK TO SAVEPOINT sp_registrar_reembolso; END IF;
    RESIGNAL;
  END;

  IF v_tx_propia THEN START TRANSACTION; ELSE SAVEPOINT sp_registrar_reembolso; END IF;

  SELECT estado, resultado_compra, pago_id INTO v_estado, v_resultado, v_pago_id
    FROM transaccion_pago WHERE uuid = p_uuid FOR UPDATE;
  IF v_estado IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La transacción de pago no existe';
  END IF;
  IF v_estado <> 'REEMBOLSADA' THEN
    IF v_estado <> 'APROBADA' OR NOT (v_resultado <=> 'REQUIERE_REEMBOLSO') THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Solo se reembolsan pagos aprobados sobre compras vencidas o canceladas';
    END IF;
    UPDATE pago SET estado = 'REEMBOLSADO' WHERE id = v_pago_id;
    UPDATE transaccion_pago SET estado = 'REEMBOLSADA' WHERE uuid = p_uuid;
  END IF;

  IF v_tx_propia THEN COMMIT; END IF;
END//

DELIMITER ;
