-- Agrega el permiso de alta de vuelos a bases creadas antes de US5.
-- Idempotente: puede ejecutarse más de una vez sobre el esquema actual.
USE aeronet;

INSERT INTO permiso (codigo, descripcion)
VALUES ('flight:create', 'Crear vuelos')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

INSERT IGNORE INTO rol_permiso (rol, permiso_codigo)
VALUES ('ADMIN', 'flight:create');
