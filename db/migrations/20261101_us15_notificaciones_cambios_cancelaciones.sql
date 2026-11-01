-- US15 — Outbox transaccional para notificar cambios de horario y cancelaciones.
-- Reaplicable en instalaciones existentes: reemplaza únicamente el trigger de salida.
USE aeronet;
DELIMITER //

DROP TRIGGER IF EXISTS trg_salida_au//
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

DELIMITER ;
