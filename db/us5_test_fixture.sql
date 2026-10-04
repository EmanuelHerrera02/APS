-- Fixture para tests/http/us5-alta-vuelos.mjs.
-- Ejecutar solo en la instancia aislada docker-compose.us5.yml, después del seed.
-- Idempotente: puede volver a cargarse sobre la misma instancia.

USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Aeropuerto deshabilitado: el alta de vuelos debe rechazarlo aunque exista.
INSERT INTO aeropuerto (codigo_iata, nombre, ciudad, provincia, activo)
VALUES ('XIN', 'Aeropuerto de Prueba Inactivo', 'Ciudad de Prueba', 'Prueba', FALSE)
ON DUPLICATE KEY UPDATE activo = FALSE;

-- Inyección de fallo para la prueba de atomicidad: el vuelo ZF9001 falla al
-- generar sus salidas, después de insertar vuelo, días, clases y salidas. El
-- alta completa debe deshacerse y no dejar filas parciales ni auditoría.
DROP TRIGGER IF EXISTS trg_us5_test_fallo;

DELIMITER //
CREATE TRIGGER trg_us5_test_fallo BEFORE INSERT ON salida_clase FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM salida s JOIN vuelo v ON v.id = s.vuelo_id
              WHERE s.id = NEW.salida_id AND v.codigo = 'ZF9001') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Fallo inyectado por la prueba de atomicidad de US5';
  END IF;
END//
DELIMITER ;

SELECT 'US5 fixture preparada' AS resultado;
