-- Agrega la máquina de estados de pago a bases creadas antes de su incorporación
-- en 02_logic.sql. Idempotente: puede ejecutarse más de una vez.
USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP TRIGGER IF EXISTS trg_pago_bi;
DROP TRIGGER IF EXISTS trg_pago_bu;

DELIMITER //

CREATE TRIGGER trg_pago_bi BEFORE INSERT ON pago FOR EACH ROW
BEGIN
  IF NEW.estado = 'REEMBOLSADO' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Un pago no se registra como REEMBOLSADO: se reembolsa un pago APROBADO existente';
  END IF;
END//

CREATE TRIGGER trg_pago_bu BEFORE UPDATE ON pago FOR EACH ROW
BEGIN
  DECLARE v_msg VARCHAR(255);
  IF NEW.compra_id <> OLD.compra_id OR NEW.monto <> OLD.monto OR NEW.medio <> OLD.medio THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'compra, monto y medio de un pago son inmutables';
  END IF;
  IF OLD.estado <> 'PENDIENTE' AND (
        NOT (NEW.id_transaccion_pasarela <=> OLD.id_transaccion_pasarela)
     OR NOT (NEW.marca_tarjeta <=> OLD.marca_tarjeta)
     OR NOT (NEW.ultimos_4 <=> OLD.ultimos_4)) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Los datos de pasarela de un pago resuelto son inmutables';
  END IF;
  IF NEW.estado <> OLD.estado AND NOT (
        (OLD.estado = 'PENDIENTE' AND NEW.estado IN ('APROBADO', 'RECHAZADO'))
     OR (OLD.estado = 'APROBADO'  AND NEW.estado = 'REEMBOLSADO')) THEN
    SET v_msg = CONCAT('Transición de estado de pago inválida: ', OLD.estado, ' -> ', NEW.estado);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;
END//

DELIMITER ;
