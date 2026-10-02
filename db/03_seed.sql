-- =============================================================================
-- AeroNet - US 2 - Modelo de datos
-- 03_seed.sql: datos de prueba.
--
-- Las fechas son relativas a CURDATE() para que el seed siga siendo válido sin
-- importar cuándo se levante la base (no se puede vender una salida pasada).
-- Las compras se crean con los mismos procedimientos que usará el backend, así
-- el seed también ejercita la lógica de 02_logic.sql.
--
-- Los password_hash son hashes bcrypt DE EJEMPLO (formato válido, no
-- corresponden a ninguna contraseña conocida): el backend debe regenerarlos.
-- =============================================================================

USE aeronet;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Catálogo de permisos compartido con backend y frontend.
INSERT INTO permiso (codigo, descripcion) VALUES
  ('auth:login', 'Iniciar sesión'),
  ('profile:view_own', 'Ver perfil propio'),
  ('reservation:view_own', 'Ver reservas propias'),
  ('reservation:create', 'Crear reservas'),
  ('reservation:view_all', 'Ver todas las reservas'),
  ('reservation:confirm', 'Confirmar reservas'),
  ('payment:process', 'Procesar pagos'),
  ('payment:register_method', 'Registrar métodos de pago'),
  ('report:view_operational', 'Ver reportes operacionales'),
  ('admin:panel_access', 'Acceder al panel administrativo'),
  ('user:list', 'Listar usuarios'),
  ('user:create', 'Crear usuarios'),
  ('user:edit', 'Editar usuarios'),
  ('user:change_role', 'Cambiar roles de usuarios'),
  ('report:view_financial', 'Ver reportes financieros'),
  ('admin:view_audit', 'Ver auditoría'),
  ('admin:config', 'Configurar el sistema');

INSERT INTO rol_permiso (rol, permiso_codigo) VALUES
  ('ADMIN', 'auth:login'),
  ('ADMIN', 'profile:view_own'),
  ('ADMIN', 'admin:panel_access'),
  ('ADMIN', 'user:list'),
  ('ADMIN', 'user:create'),
  ('ADMIN', 'user:edit'),
  ('ADMIN', 'user:change_role'),
  ('ADMIN', 'report:view_financial'),
  ('ADMIN', 'admin:view_audit'),
  ('ADMIN', 'admin:config'),
  ('MOSTRADOR', 'auth:login'),
  ('MOSTRADOR', 'profile:view_own'),
  ('MOSTRADOR', 'reservation:view_all'),
  ('MOSTRADOR', 'reservation:confirm'),
  ('MOSTRADOR', 'payment:process'),
  ('MOSTRADOR', 'report:view_operational'),
  ('PASAJERO', 'auth:login'),
  ('PASAJERO', 'profile:view_own'),
  ('PASAJERO', 'reservation:view_own'),
  ('PASAJERO', 'reservation:create'),
  ('PASAJERO', 'payment:register_method');

-- -----------------------------------------------------------------------------
-- Aeropuertos
-- -----------------------------------------------------------------------------
INSERT INTO aeropuerto (codigo_iata, nombre, ciudad, provincia) VALUES
  ('AEP', 'Aeroparque Internacional Jorge Newbery',                'Ciudad Autónoma de Buenos Aires', 'Ciudad Autónoma de Buenos Aires'),
  ('EZE', 'Aeropuerto Internacional Ministro Pistarini',           'Ezeiza',                          'Buenos Aires'),
  ('COR', 'Aeropuerto Internacional Ingeniero Ambrosio Taravella', 'Córdoba',                         'Córdoba'),
  ('MDZ', 'Aeropuerto Internacional Gobernador Francisco Gabrielli','Mendoza',                        'Mendoza'),
  ('BRC', 'Aeropuerto Internacional Teniente Luis Candelaria',     'San Carlos de Bariloche',         'Río Negro'),
  ('USH', 'Aeropuerto Internacional Malvinas Argentinas',          'Ushuaia',                         'Tierra del Fuego'),
  ('IGR', 'Aeropuerto Internacional Cataratas del Iguazú',         'Puerto Iguazú',                   'Misiones'),
  ('SLA', 'Aeropuerto Internacional Martín Miguel de Güemes',      'Salta',                           'Salta'),
  ('FTE', 'Aeropuerto Internacional Comandante Armando Tola',      'El Calafate',                     'Santa Cruz'),
  ('NQN', 'Aeropuerto Internacional Presidente Perón',             'Neuquén',                         'Neuquén');

SET @aep = (SELECT id FROM aeropuerto WHERE codigo_iata = 'AEP');
SET @cor = (SELECT id FROM aeropuerto WHERE codigo_iata = 'COR');
SET @mdz = (SELECT id FROM aeropuerto WHERE codigo_iata = 'MDZ');
SET @brc = (SELECT id FROM aeropuerto WHERE codigo_iata = 'BRC');
SET @ush = (SELECT id FROM aeropuerto WHERE codigo_iata = 'USH');

-- -----------------------------------------------------------------------------
-- Usuarios: los tres roles. Carla Ruiz es una empleada deshabilitada.
-- -----------------------------------------------------------------------------
INSERT INTO usuario (email, password_hash, rol, activo, nombre, apellido,
                     tipo_documento, numero_documento, telefono, fecha_nacimiento) VALUES
  ('laura.mendez@aeronet.com.ar',
   '$2b$12$Qm9sYXJpc0FkbWluU2VlZC4uLi5mQ2hhbmdlTWVQbGVhc2UxMjM0NTY',
   'ADMIN', TRUE, 'Laura', 'Méndez', 'DNI', '27456123', '+54 11 4576-1100', '1982-03-14'),
  ('diego.fernandez@aeronet.com.ar',
   '$2b$12$TW9zdHJhZG9yU2VlZERpZWdvLi4uQ2hhbmdlTWVQbGVhc2U5ODc2NTQ',
   'MOSTRADOR', TRUE, 'Diego', 'Fernández', 'DNI', '31987654', '+54 11 4576-1200', '1988-07-02'),
  ('carla.ruiz@aeronet.com.ar',
   '$2b$12$TW9zdHJhZG9yU2VlZENhcmxhLi4uQ2hhbmdlTWVQbGVhc2UxMTIyMzM',
   'MOSTRADOR', FALSE, 'Carla', 'Ruiz', 'DNI', '33444555', '+54 11 4576-1201', '1990-11-23'),
  ('juan.perez@gmail.com',
   '$2b$12$UGFzYWplcm9TZWVkSnVhbi4uLi4uQ2hhbmdlTWVQbGVhc2U0NDU1NjY',
   'PASAJERO', TRUE, 'Juan', 'Pérez', 'DNI', '30123456', '+54 9 351 555-0101', '1983-05-30'),
  ('maria.gonzalez@hotmail.com',
   '$argon2id$v=19$m=65536,t=3,p=4$c2VlZFNhbHRNYXJpYQ$UGFzYWplcm9TZWVkTWFyaWFDaGFuZ2VNZQ',
   'PASAJERO', TRUE, 'María', 'González', 'DNI', '35222333', '+54 9 11 5555-0202', '1991-09-12'),
  ('lucia.romero@yahoo.com.ar',
   '$2b$12$UGFzYWplcm9TZWVkTHVjaWEuLi4uQ2hhbmdlTWVQbGVhc2U3Nzg4OTk',
   'PASAJERO', TRUE, 'Lucía', 'Romero', 'PASAPORTE', 'AAB123456', NULL, NULL);

SET @admin   = (SELECT id FROM usuario WHERE email = 'laura.mendez@aeronet.com.ar');
SET @diego   = (SELECT id FROM usuario WHERE email = 'diego.fernandez@aeronet.com.ar');
SET @juan    = (SELECT id FROM usuario WHERE email = 'juan.perez@gmail.com');
SET @maria   = (SELECT id FROM usuario WHERE email = 'maria.gonzalez@hotmail.com');
SET @lucia   = (SELECT id FROM usuario WHERE email = 'lucia.romero@yahoo.com.ar');

INSERT INTO dispositivo_usuario (usuario_id, token_push, plataforma, ultimo_uso) VALUES
  (@maria, 'fcm:dQw4w9WgXcQ:APA91bHseedMariaAndroidToken0000000000000001', 'ANDROID', NOW()),
  (@juan,  'apns:3f1a9c2e7b5d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a', 'IOS', NOW());

-- -----------------------------------------------------------------------------
-- Vuelos
-- -----------------------------------------------------------------------------
INSERT INTO vuelo (codigo, aeropuerto_origen_id, aeropuerto_destino_id, hora_partida, hora_llegada,
                   dias_desfase_llegada, fecha_desde, fecha_hasta, creado_por_id) VALUES
  -- Aeroparque -> Córdoba, lunes a viernes, temporada semestral.
  ('AN1402', @aep, @cor, '07:30', '08:50', 0, CURDATE() - INTERVAL 7 DAY, CURDATE() + INTERVAL 180 DAY, @admin),
  -- Aeroparque -> Bariloche, diario.
  ('AN1720', @aep, @brc, '10:15', '12:35', 0, CURDATE() - INTERVAL 7 DAY, CURDATE() + INTERVAL 180 DAY, @admin),
  -- Aeroparque -> Ushuaia, nocturno con llegada al día siguiente, temporada corta.
  ('AN1890', @aep, @ush, '22:40', '02:15', 1, CURDATE(),                  CURDATE() + INTERVAL 90 DAY,  @admin),
  -- Córdoba -> Mendoza, lunes, miércoles y viernes.
  ('AN1140', @cor, @mdz, '13:00', '14:20', 0, CURDATE() - INTERVAL 7 DAY, CURDATE() + INTERVAL 180 DAY, @admin);

SET @v_cor = (SELECT id FROM vuelo WHERE codigo = 'AN1402');
SET @v_brc = (SELECT id FROM vuelo WHERE codigo = 'AN1720');
SET @v_ush = (SELECT id FROM vuelo WHERE codigo = 'AN1890');
SET @v_mdz = (SELECT id FROM vuelo WHERE codigo = 'AN1140');

INSERT INTO vuelo_dia_operacion (vuelo_id, dia_semana) VALUES
  (@v_cor, 1), (@v_cor, 2), (@v_cor, 3), (@v_cor, 4), (@v_cor, 5),
  (@v_brc, 1), (@v_brc, 2), (@v_brc, 3), (@v_brc, 4), (@v_brc, 5), (@v_brc, 6), (@v_brc, 7),
  (@v_ush, 2), (@v_ush, 4), (@v_ush, 6),
  (@v_mdz, 1), (@v_mdz, 3), (@v_mdz, 5);

INSERT INTO vuelo_clase (vuelo_id, clase, capacidad, precio) VALUES
  (@v_cor, 'ECONOMY', 150,  85000.00), (@v_cor, 'PRIMERA', 12, 210000.00),
  (@v_brc, 'ECONOMY', 162, 145000.00), (@v_brc, 'PRIMERA', 12, 350000.00),
  (@v_ush, 'ECONOMY', 150, 190000.00), (@v_ush, 'PRIMERA',  8, 420000.00),
  (@v_mdz, 'ECONOMY',  70,  72000.00), (@v_mdz, 'PRIMERA',  6, 165000.00);

CALL generar_salidas(@v_cor);
CALL generar_salidas(@v_brc);
CALL generar_salidas(@v_ush);
CALL generar_salidas(@v_mdz);

-- Salidas usadas por las compras de ejemplo.
SET @s_cor_5  = (SELECT id FROM salida WHERE vuelo_id = @v_cor AND fecha >= CURDATE() + INTERVAL 5  DAY ORDER BY fecha LIMIT 1);
SET @s_cor_12 = (SELECT id FROM salida WHERE vuelo_id = @v_cor AND fecha >= CURDATE() + INTERVAL 12 DAY ORDER BY fecha LIMIT 1);
SET @s_brc_10 = (SELECT id FROM salida WHERE vuelo_id = @v_brc AND fecha >= CURDATE() + INTERVAL 10 DAY ORDER BY fecha LIMIT 1);
SET @s_ush_20 = (SELECT id FROM salida WHERE vuelo_id = @v_ush AND fecha >= CURDATE() + INTERVAL 20 DAY ORDER BY fecha LIMIT 1);
SET @s_mdz_3  = (SELECT id FROM salida WHERE vuelo_id = @v_mdz AND fecha >= CURDATE() + INTERVAL 3  DAY ORDER BY fecha LIMIT 1);
SET @s_mdz_15 = (SELECT id FROM salida WHERE vuelo_id = @v_mdz AND fecha >= CURDATE() + INTERVAL 15 DAY ORDER BY fecha LIMIT 1);

-- -----------------------------------------------------------------------------
-- C1: Juan compra por web 3 Economy a Bariloche (él + 2 acompañantes). CONFIRMADA + factura B.
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_brc_10, @juan, NULL, 'WEB', 'juan.perez@gmail.com',
  '[{"nombre":"Juan","apellido":"Pérez","tipo_documento":"DNI","numero_documento":"30123456","clase":"ECONOMY"},
    {"nombre":"Sofía","apellido":"Pérez","tipo_documento":"DNI","numero_documento":"31555777","clase":"ECONOMY"},
    {"nombre":"Tomás","apellido":"Pérez","tipo_documento":"DNI","numero_documento":"52111222","clase":"ECONOMY"}]',
  @c1);
SET @c1_total = (SELECT total FROM compra WHERE id = @c1);
CALL registrar_pago(@c1, @c1_total, 'TARJETA_CREDITO', 'APROBADO', 'MP-7790012345', 'VISA', '4242', @p1, @r1);
INSERT INTO factura (compra_id, numero, tipo, total, receptor_nombre, ruta_pdf)
VALUES (@c1, 'B-0001-00000001', 'B', @c1_total, 'Juan Pérez',
        CONCAT('facturas/', YEAR(CURDATE()), '/B-0001-00000001.pdf'));

-- -----------------------------------------------------------------------------
-- C2: venta de mostrador (sin cuenta) de 2 Primera a Córdoba, pago en efectivo. Factura A a empresa.
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_cor_5, NULL, @diego, 'MOSTRADOR', 'viajes@agroandina.com.ar',
  '[{"nombre":"Roberto","apellido":"Salas","tipo_documento":"DNI","numero_documento":"22333444","clase":"PRIMERA"},
    {"nombre":"Mónica","apellido":"Ibáñez","tipo_documento":"DNI","numero_documento":"25666777","clase":"PRIMERA"}]',
  @c2);
SET @c2_total = (SELECT total FROM compra WHERE id = @c2);
CALL registrar_pago(@c2, @c2_total, 'EFECTIVO', 'APROBADO', NULL, NULL, NULL, @p2, @r2);
INSERT INTO factura (compra_id, numero, tipo, total, receptor_nombre, receptor_cuit, ruta_pdf)
VALUES (@c2, 'A-0001-00000001', 'A', @c2_total, 'Agro Andina S.A.', '30712345679',
        CONCAT('facturas/', YEAR(CURDATE()), '/A-0001-00000001.pdf'));

-- -----------------------------------------------------------------------------
-- C3: María desde la app, 1 Economy + 1 Primera a Ushuaia. Queda PENDIENTE_PAGO
-- (se extiende el vencimiento para que la reserva se vea en la demo).
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_ush_20, @maria, NULL, 'MOVIL', 'maria.gonzalez@hotmail.com',
  '[{"nombre":"María","apellido":"González","tipo_documento":"DNI","numero_documento":"35222333","clase":"PRIMERA"},
    {"nombre":"Martín","apellido":"Acosta","tipo_documento":"DNI","numero_documento":"34888999","clase":"ECONOMY"}]',
  @c3);
UPDATE compra SET expira_en = NOW() + INTERVAL 2 HOUR WHERE id = @c3;

-- -----------------------------------------------------------------------------
-- C4: Lucía, 2 Economy a Bariloche, pago rechazado -> CANCELADA (asientos liberados).
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_brc_10, @lucia, NULL, 'WEB', 'lucia.romero@yahoo.com.ar',
  '[{"nombre":"Lucía","apellido":"Romero","tipo_documento":"PASAPORTE","numero_documento":"AAB123456","clase":"ECONOMY"},
    {"nombre":"Pablo","apellido":"Romero","tipo_documento":"PASAPORTE","numero_documento":"AAB654321","clase":"ECONOMY"}]',
  @c4);
SET @c4_total = (SELECT total FROM compra WHERE id = @c4);
CALL registrar_pago(@c4, @c4_total, 'TARJETA_DEBITO', 'RECHAZADO', 'MP-7790019876', 'MASTERCARD', '5100', @p4, @r4);

-- -----------------------------------------------------------------------------
-- C5: Juan, 1 Economy a Mendoza, nunca paga -> vence -> EXPIRADA.
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_mdz_3, @juan, NULL, 'WEB', 'juan.perez@gmail.com',
  '[{"nombre":"Juan","apellido":"Pérez","tipo_documento":"DNI","numero_documento":"30123456","clase":"ECONOMY"}]',
  @c5);
UPDATE compra SET expira_en = NOW() - INTERVAL 1 MINUTE WHERE id = @c5;
CALL liberar_reservas_vencidas();

-- -----------------------------------------------------------------------------
-- C6: María, 2 Economy a Córdoba, CONFIRMADA. Luego la salida se demora 45
-- minutos -> se encolan notificaciones CAMBIO_HORARIO (email + push).
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_cor_12, @maria, NULL, 'MOVIL', 'maria.gonzalez@hotmail.com',
  '[{"nombre":"María","apellido":"González","tipo_documento":"DNI","numero_documento":"35222333","clase":"ECONOMY"},
    {"nombre":"Martín","apellido":"Acosta","tipo_documento":"DNI","numero_documento":"34888999","clase":"ECONOMY"}]',
  @c6);
SET @c6_total = (SELECT total FROM compra WHERE id = @c6);
CALL registrar_pago(@c6, @c6_total, 'TARJETA_CREDITO', 'APROBADO', 'MP-7790023456', 'MASTERCARD', '5454', @p6, @r6);
INSERT INTO factura (compra_id, numero, tipo, total, receptor_nombre, ruta_pdf)
VALUES (@c6, 'B-0001-00000002', 'B', @c6_total, 'María González',
        CONCAT('facturas/', YEAR(CURDATE()), '/B-0001-00000002.pdf'));
UPDATE salida SET hora_partida = '08:15', hora_llegada = '09:35' WHERE id = @s_cor_12;

-- -----------------------------------------------------------------------------
-- C7: Lucía, 1 Primera a Mendoza, CONFIRMADA. Luego se cancela esa salida ->
-- notificación CANCELACION.
-- -----------------------------------------------------------------------------
CALL crear_compra(@s_mdz_15, @lucia, NULL, 'WEB', 'lucia.romero@yahoo.com.ar',
  '[{"nombre":"Lucía","apellido":"Romero","tipo_documento":"PASAPORTE","numero_documento":"AAB123456","clase":"PRIMERA"}]',
  @c7);
SET @c7_total = (SELECT total FROM compra WHERE id = @c7);
CALL registrar_pago(@c7, @c7_total, 'TARJETA_CREDITO', 'APROBADO', 'MP-7790034567', 'AMEX', '1005', @p7, @r7);
INSERT INTO factura (compra_id, numero, tipo, total, receptor_nombre, ruta_pdf)
VALUES (@c7, 'B-0001-00000003', 'B', @c7_total, 'Lucía Romero',
        CONCAT('facturas/', YEAR(CURDATE()), '/B-0001-00000003.pdf'));
UPDATE salida SET estado = 'CANCELADA', motivo_cancelacion = 'Condiciones meteorológicas adversas'
 WHERE id = @s_mdz_15;

-- -----------------------------------------------------------------------------
-- Reenvío de documentación pedido en mostrador para C1.
-- -----------------------------------------------------------------------------
CALL reenviar_documentacion(@c1, @diego, NULL);

-- Simula el trabajo del worker de notificaciones: confirmaciones ya enviadas,
-- un push fallido pendiente de reintento.
UPDATE notificacion SET estado = 'ENVIADA', intentos = 1, enviada_en = NOW()
 WHERE tipo = 'CONFIRMACION' AND canal = 'EMAIL';
UPDATE notificacion SET estado = 'FALLIDA', intentos = 3,
       ultimo_error = 'APNs: BadDeviceToken', programada_para = NOW() + INTERVAL 10 MINUTE
 WHERE tipo = 'CONFIRMACION' AND canal = 'PUSH' AND destinatario LIKE 'apns:%';
