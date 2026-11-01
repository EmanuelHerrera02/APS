-- Permiso independiente para modificar/cancelar vuelos (US6).
-- Idempotente para instalaciones previas.
USE aeronet;

INSERT INTO permiso (codigo, descripcion)
VALUES ('flight:edit', 'Modificar y cancelar vuelos')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

INSERT IGNORE INTO rol_permiso (rol, permiso_codigo)
VALUES ('ADMIN', 'flight:edit');
