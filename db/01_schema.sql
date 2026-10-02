-- =============================================================================
-- AeroNet - US 2 - Modelo de datos
-- 01_schema.sql: base de datos, tablas, claves, restricciones, índices y vistas.
--
-- Motor: MariaDB >= 10.6 (probado en 11.4 LTS). InnoDB, utf8mb4_unicode_ci.
-- Este script solo crea objetos; no borra nada. Para regenerar la base en
-- desarrollo: `docker compose down -v && docker compose up -d`.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS aeronet
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER DATABASE aeronet CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aeronet;

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- aeropuerto
-- -----------------------------------------------------------------------------
CREATE TABLE aeropuerto (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo_iata CHAR(3)         NOT NULL,
  nombre      VARCHAR(150)    NOT NULL,
  ciudad      VARCHAR(100)    NOT NULL,
  provincia   VARCHAR(100)    NOT NULL,
  activo      BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_aeropuerto_iata (codigo_iata),
  KEY ix_aeropuerto_ciudad (ciudad),
  CONSTRAINT chk_aeropuerto_iata CHECK (codigo_iata REGEXP BINARY '^[A-Z]{3}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- usuario: pasajeros registrados y cuentas internas (mostrador, admin).
-- Los acompañantes de una compra NO son usuarios (viven en pasaje).
-- -----------------------------------------------------------------------------
CREATE TABLE usuario (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email            VARCHAR(255)    NOT NULL,
  password_hash    VARCHAR(255)    NOT NULL,
  rol              ENUM('PASAJERO','MOSTRADOR','ADMIN') NOT NULL DEFAULT 'PASAJERO',
  activo           BOOLEAN         NOT NULL DEFAULT TRUE,
  nombre           VARCHAR(100)    NOT NULL,
  apellido         VARCHAR(100)    NOT NULL,
  tipo_documento   ENUM('DNI','PASAPORTE','OTRO') NULL,
  numero_documento VARCHAR(20)     NULL,
  telefono         VARCHAR(30)     NULL,
  fecha_nacimiento DATE            NULL,
  ultimo_acceso    DATETIME        NULL,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- utf8mb4_unicode_ci es case-insensitive: 'Ana@x.com' y 'ana@x.com' colisionan.
  UNIQUE KEY uq_usuario_email (email),
  UNIQUE KEY uq_usuario_documento (tipo_documento, numero_documento),
  KEY ix_usuario_rol_activo (rol, activo),
  CONSTRAINT chk_usuario_email CHECK (email LIKE '_%@_%._%'),
  -- Solo se aceptan hashes bcrypt ($2a/$2b/$2y) o argon2: nunca contraseñas en claro.
  CONSTRAINT chk_usuario_password_hash
    CHECK (password_hash REGEXP BINARY '^\\$(2[aby]\\$[0-9]{2}\\$|argon2(id|i|d)\\$).{20,}$'),
  CONSTRAINT chk_usuario_documento
    CHECK ((tipo_documento IS NULL) = (numero_documento IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sesiones de autenticación: el refresh token se conserva únicamente como SHA-256.
CREATE TABLE sesion_usuario (
  id             CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id     BIGINT UNSIGNED NOT NULL,
  refresh_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  creada_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en      DATETIME NOT NULL,
  revocada_en    DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesion_refresh_hash (refresh_hash),
  KEY ix_sesion_usuario_activa (usuario_id, revocada_en, expira_en),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_sesion_expiracion CHECK (expira_en > creada_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auditoria (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_usuario_id  BIGINT UNSIGNED NULL,
  accion            VARCHAR(80) NOT NULL,
  entidad           VARCHAR(80) NOT NULL,
  entidad_id        BIGINT UNSIGNED NULL,
  detalles          JSON NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_auditoria_fecha (created_at),
  KEY ix_auditoria_actor (actor_usuario_id, created_at),
  KEY ix_auditoria_entidad (entidad, entidad_id, created_at),
  CONSTRAINT fk_auditoria_actor FOREIGN KEY (actor_usuario_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- permiso y rol_permiso: catálogo común para backend, frontend y base.
-- Los códigos de rol deben coincidir con usuario.rol.
-- -----------------------------------------------------------------------------
CREATE TABLE permiso (
  codigo      VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  descripcion VARCHAR(160) NOT NULL,
  PRIMARY KEY (codigo),
  CONSTRAINT chk_permiso_codigo CHECK (codigo REGEXP BINARY '^[a-z]+:[a-z_]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rol_permiso (
  rol           ENUM('PASAJERO','MOSTRADOR','ADMIN') NOT NULL,
  permiso_codigo VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rol, permiso_codigo),
  KEY ix_rol_permiso_codigo (permiso_codigo),
  CONSTRAINT fk_rol_permiso_permiso FOREIGN KEY (permiso_codigo)
    REFERENCES permiso (codigo) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- dispositivo_usuario: tokens push de la app móvil.
-- -----------------------------------------------------------------------------
CREATE TABLE dispositivo_usuario (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id  BIGINT UNSIGNED NOT NULL,
  token_push  VARCHAR(255)    NOT NULL,
  plataforma  ENUM('ANDROID','IOS') NOT NULL,
  activo      BOOLEAN         NOT NULL DEFAULT TRUE,
  ultimo_uso  DATETIME        NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dispositivo_token (token_push),
  KEY ix_dispositivo_usuario (usuario_id, activo),
  CONSTRAINT fk_dispositivo_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- vuelo: definición recurrente (ruta, horario, período, días, clases).
-- fecha_desde/fecha_hasta = período en que el vuelo opera y está a la venta.
-- -----------------------------------------------------------------------------
CREATE TABLE vuelo (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo                VARCHAR(10)     NOT NULL,
  aeropuerto_origen_id  BIGINT UNSIGNED NOT NULL,
  aeropuerto_destino_id BIGINT UNSIGNED NOT NULL,
  hora_partida          TIME            NOT NULL,
  hora_llegada          TIME            NOT NULL,
  dias_desfase_llegada  TINYINT         NOT NULL DEFAULT 0,
  fecha_desde           DATE            NOT NULL,
  fecha_hasta           DATE            NOT NULL,
  estado                ENUM('ACTIVO','CANCELADO') NOT NULL DEFAULT 'ACTIVO',
  creado_por_id         BIGINT UNSIGNED NULL,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vuelo_codigo (codigo),
  -- Clave candidata para la FK compuesta desde salida (garantiza que la ruta
  -- copiada en salida coincide con la del vuelo).
  UNIQUE KEY uq_vuelo_ruta (id, aeropuerto_origen_id, aeropuerto_destino_id),
  KEY ix_vuelo_origen_destino (aeropuerto_origen_id, aeropuerto_destino_id),
  KEY ix_vuelo_destino (aeropuerto_destino_id),
  KEY ix_vuelo_creado_por (creado_por_id),
  CONSTRAINT fk_vuelo_origen FOREIGN KEY (aeropuerto_origen_id)
    REFERENCES aeropuerto (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_vuelo_destino FOREIGN KEY (aeropuerto_destino_id)
    REFERENCES aeropuerto (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_vuelo_creado_por FOREIGN KEY (creado_por_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_vuelo_ruta CHECK (aeropuerto_origen_id <> aeropuerto_destino_id),
  CONSTRAINT chk_vuelo_periodo CHECK (fecha_desde <= fecha_hasta),
  CONSTRAINT chk_vuelo_desfase CHECK (dias_desfase_llegada IN (0, 1)),
  CONSTRAINT chk_vuelo_horario CHECK (dias_desfase_llegada = 1 OR hora_llegada > hora_partida),
  CONSTRAINT chk_vuelo_codigo CHECK (codigo REGEXP BINARY '^[A-Z0-9]{2}[0-9]{1,4}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- vuelo_dia_operacion: días de la semana en que opera el vuelo (1=lunes..7=domingo).
-- Es configuración, no historia: se permite borrado físico.
-- -----------------------------------------------------------------------------
CREATE TABLE vuelo_dia_operacion (
  vuelo_id   BIGINT UNSIGNED NOT NULL,
  dia_semana TINYINT         NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (vuelo_id, dia_semana),
  CONSTRAINT fk_vdo_vuelo FOREIGN KEY (vuelo_id)
    REFERENCES vuelo (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_vdo_dia CHECK (dia_semana BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- vuelo_clase: capacidad y precio vigente por clase.
-- El precio de venta se congela en pasaje.precio al momento de la compra.
-- -----------------------------------------------------------------------------
CREATE TABLE vuelo_clase (
  vuelo_id   BIGINT UNSIGNED NOT NULL,
  clase      ENUM('ECONOMY','PRIMERA') NOT NULL,
  capacidad  INT             NOT NULL,
  precio     DECIMAL(12,2)   NOT NULL,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (vuelo_id, clase),
  CONSTRAINT fk_vuelo_clase_vuelo FOREIGN KEY (vuelo_id)
    REFERENCES vuelo (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_vuelo_clase_capacidad CHECK (capacidad > 0),
  CONSTRAINT chk_vuelo_clase_precio CHECK (precio > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salida: ocurrencia concreta de un vuelo en una fecha. Materializada por
-- generar_salidas(). Copia ruta y horario del vuelo: la ruta para poder
-- indexar la búsqueda (origen, destino, fecha) sin JOIN; el horario porque
-- puede modificarse por salida (demoras, reprogramaciones puntuales).
-- -----------------------------------------------------------------------------
CREATE TABLE salida (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vuelo_id              BIGINT UNSIGNED NOT NULL,
  aeropuerto_origen_id  BIGINT UNSIGNED NOT NULL,
  aeropuerto_destino_id BIGINT UNSIGNED NOT NULL,
  fecha                 DATE            NOT NULL,
  hora_partida          TIME            NOT NULL,
  hora_llegada          TIME            NOT NULL,
  dias_desfase_llegada  TINYINT         NOT NULL DEFAULT 0,
  estado                ENUM('PROGRAMADA','CANCELADA') NOT NULL DEFAULT 'PROGRAMADA',
  motivo_cancelacion    VARCHAR(255)    NULL,
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Una salida por vuelo y fecha; también sirve a reportes por (vuelo, fecha).
  UNIQUE KEY uq_salida_vuelo_fecha (vuelo_id, fecha),
  -- Búsqueda de pasajeros: origen + destino + rango de fechas.
  KEY ix_salida_busqueda (aeropuerto_origen_id, aeropuerto_destino_id, fecha, estado),
  KEY ix_salida_ruta_vuelo (vuelo_id, aeropuerto_origen_id, aeropuerto_destino_id),
  KEY ix_salida_destino (aeropuerto_destino_id),
  KEY ix_salida_fecha (fecha),
  CONSTRAINT fk_salida_vuelo_ruta FOREIGN KEY (vuelo_id, aeropuerto_origen_id, aeropuerto_destino_id)
    REFERENCES vuelo (id, aeropuerto_origen_id, aeropuerto_destino_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_salida_origen FOREIGN KEY (aeropuerto_origen_id)
    REFERENCES aeropuerto (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_salida_destino FOREIGN KEY (aeropuerto_destino_id)
    REFERENCES aeropuerto (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_salida_desfase CHECK (dias_desfase_llegada IN (0, 1)),
  CONSTRAINT chk_salida_horario CHECK (dias_desfase_llegada = 1 OR hora_llegada > hora_partida),
  CONSTRAINT chk_salida_motivo CHECK (estado = 'CANCELADA' OR motivo_cancelacion IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- salida_clase: capacidad y asientos vendidos por salida y clase.
-- vendidos incluye las reservas de compras en PENDIENTE_PAGO.
-- Invariante: pasajes activos <= vendidos <= capacidad.
-- -----------------------------------------------------------------------------
CREATE TABLE salida_clase (
  salida_id  BIGINT UNSIGNED NOT NULL,
  clase      ENUM('ECONOMY','PRIMERA') NOT NULL,
  capacidad  INT             NOT NULL,
  vendidos   INT             NOT NULL DEFAULT 0,
  created_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (salida_id, clase),
  CONSTRAINT fk_salida_clase_salida FOREIGN KEY (salida_id)
    REFERENCES salida (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_salida_clase_capacidad CHECK (capacidad >= 0),
  CONSTRAINT chk_salida_clase_vendidos CHECK (vendidos >= 0 AND vendidos <= capacidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- compra: una transacción de venta sobre UNA salida (1 a 9 pasajes).
-- -----------------------------------------------------------------------------
CREATE TABLE compra (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo            CHAR(6)         NOT NULL DEFAULT '',  -- lo genera trg_compra_bi si llega vacío
  salida_id         BIGINT UNSIGNED NOT NULL,
  usuario_id        BIGINT UNSIGNED NULL,     -- comprador con cuenta (NULL: mostrador sin cuenta)
  empleado_id       BIGINT UNSIGNED NULL,     -- empleado que vendió (solo canal MOSTRADOR)
  canal             ENUM('WEB','MOVIL','MOSTRADOR') NOT NULL,
  email_contacto    VARCHAR(255)    NOT NULL,
  telefono_contacto VARCHAR(30)     NULL,
  total             DECIMAL(12,2)   NOT NULL DEFAULT 0.00,
  estado            ENUM('PENDIENTE_PAGO','CONFIRMADA','CANCELADA','EXPIRADA') NOT NULL DEFAULT 'PENDIENTE_PAGO',
  expira_en         DATETIME        NULL,
  confirmada_en     DATETIME        NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_compra_codigo (codigo),
  UNIQUE KEY uq_compra_salida (id, salida_id),   -- destino de la FK compuesta de pasaje
  KEY ix_compra_salida_estado (salida_id, estado),
  KEY ix_compra_usuario (usuario_id, created_at),
  KEY ix_compra_email (email_contacto),
  KEY ix_compra_empleado (empleado_id, created_at),
  KEY ix_compra_vencimiento (estado, expira_en),
  CONSTRAINT fk_compra_salida FOREIGN KEY (salida_id)
    REFERENCES salida (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_compra_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_compra_empleado FOREIGN KEY (empleado_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_compra_codigo CHECK (codigo REGEXP BINARY '^[A-Z0-9]{6}$'),
  CONSTRAINT chk_compra_email CHECK (email_contacto LIKE '_%@_%._%'),
  CONSTRAINT chk_compra_total CHECK (total >= 0),
  CONSTRAINT chk_compra_canal_empleado CHECK ((canal = 'MOSTRADOR') = (empleado_id IS NOT NULL)),
  CONSTRAINT chk_compra_expira CHECK (estado <> 'PENDIENTE_PAGO' OR expira_en IS NOT NULL),
  CONSTRAINT chk_compra_confirmada CHECK (estado <> 'CONFIRMADA' OR confirmada_en IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- pasaje: un asiento para una persona en una clase. Guarda el precio congelado.
-- salida_id se replica desde compra (FK compuesta) para poder referenciar
-- salida_clase y contar ocupación por (salida, clase) con un índice.
-- -----------------------------------------------------------------------------
CREATE TABLE pasaje (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo           VARCHAR(16)     NOT NULL DEFAULT '',  -- lo genera trg_pasaje_bi si llega vacío
  compra_id        BIGINT UNSIGNED NOT NULL,
  salida_id        BIGINT UNSIGNED NOT NULL,
  clase            ENUM('ECONOMY','PRIMERA') NOT NULL,
  nombre           VARCHAR(100)    NOT NULL,
  apellido         VARCHAR(100)    NOT NULL,
  tipo_documento   ENUM('DNI','PASAPORTE','OTRO') NOT NULL,
  numero_documento VARCHAR(20)     NOT NULL,
  precio           DECIMAL(12,2)   NOT NULL,
  estado           ENUM('RESERVADO','EMITIDO','CANCELADO') NOT NULL DEFAULT 'RESERVADO',
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pasaje_codigo (codigo),
  KEY ix_pasaje_compra (compra_id, salida_id),
  KEY ix_pasaje_ocupacion (salida_id, clase, estado),
  KEY ix_pasaje_documento (numero_documento, tipo_documento),
  KEY ix_pasaje_apellido (apellido, nombre),
  CONSTRAINT fk_pasaje_compra FOREIGN KEY (compra_id, salida_id)
    REFERENCES compra (id, salida_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pasaje_salida_clase FOREIGN KEY (salida_id, clase)
    REFERENCES salida_clase (salida_id, clase) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_pasaje_codigo CHECK (codigo <> ''),
  CONSTRAINT chk_pasaje_precio CHECK (precio > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- pago: resultado de la pasarela (o cobro en mostrador).
-- NUNCA se almacenan número de tarjeta, CVV ni vencimiento: solo últimos 4.
-- -----------------------------------------------------------------------------
CREATE TABLE pago (
  id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  compra_id               BIGINT UNSIGNED NOT NULL,
  monto                   DECIMAL(12,2)   NOT NULL,
  medio                   ENUM('TARJETA_CREDITO','TARJETA_DEBITO','EFECTIVO','TRANSFERENCIA') NOT NULL,
  estado                  ENUM('PENDIENTE','APROBADO','RECHAZADO','REEMBOLSADO') NOT NULL DEFAULT 'PENDIENTE',
  id_transaccion_pasarela VARCHAR(100)    NULL,
  marca_tarjeta           VARCHAR(20)     NULL,
  ultimos_4               CHAR(4)         NULL,
  fecha_pago              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pago_transaccion (id_transaccion_pasarela),
  KEY ix_pago_compra (compra_id, estado),
  KEY ix_pago_fecha (fecha_pago),
  CONSTRAINT fk_pago_compra FOREIGN KEY (compra_id)
    REFERENCES compra (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_pago_monto CHECK (monto > 0),
  CONSTRAINT chk_pago_ultimos_4 CHECK (ultimos_4 IS NULL OR ultimos_4 REGEXP '^[0-9]{4}$'),
  CONSTRAINT chk_pago_tarjeta CHECK (
    medio NOT IN ('TARJETA_CREDITO','TARJETA_DEBITO')
    OR (ultimos_4 IS NOT NULL AND id_transaccion_pasarela IS NOT NULL)),
  CONSTRAINT chk_pago_sin_tarjeta CHECK (
    medio IN ('TARJETA_CREDITO','TARJETA_DEBITO') OR (ultimos_4 IS NULL AND marca_tarjeta IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- factura: comprobante de una compra confirmada.
-- -----------------------------------------------------------------------------
CREATE TABLE factura (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  compra_id              BIGINT UNSIGNED NOT NULL,
  numero                 VARCHAR(20)     NOT NULL,   -- p. ej. 'B-0001-00000042'
  tipo                   ENUM('A','B','C') NOT NULL,
  fecha                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total                  DECIMAL(12,2)   NOT NULL,
  receptor_nombre        VARCHAR(200)    NOT NULL,
  receptor_cuit          CHAR(11)        NULL,
  ruta_pdf               VARCHAR(500)    NULL,       -- NULL hasta que se genera el PDF
  created_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_factura_numero (numero),
  UNIQUE KEY uq_factura_compra (compra_id),
  KEY ix_factura_fecha (fecha),
  CONSTRAINT fk_factura_compra FOREIGN KEY (compra_id)
    REFERENCES compra (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_factura_total CHECK (total >= 0),
  CONSTRAINT chk_factura_cuit CHECK (receptor_cuit IS NULL OR receptor_cuit REGEXP '^[0-9]{11}$'),
  CONSTRAINT chk_factura_tipo_a CHECK (tipo <> 'A' OR receptor_cuit IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- notificacion: outbox de emails y push. Se escribe en la misma transacción
-- que el cambio de negocio; un worker externo envía y actualiza el estado.
-- -----------------------------------------------------------------------------
CREATE TABLE notificacion (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo              ENUM('CONFIRMACION','CAMBIO_HORARIO','CANCELACION','REENVIO') NOT NULL,
  canal             ENUM('EMAIL','PUSH') NOT NULL,
  destinatario      VARCHAR(255)    NOT NULL,   -- email o token push
  usuario_id        BIGINT UNSIGNED NULL,
  compra_id         BIGINT UNSIGNED NULL,
  salida_id         BIGINT UNSIGNED NULL,
  solicitado_por_id BIGINT UNSIGNED NULL,       -- empleado que pidió un REENVIO
  payload           JSON            NULL,       -- datos para la plantilla (horarios, etc.)
  estado            ENUM('PENDIENTE','ENVIADA','FALLIDA') NOT NULL DEFAULT 'PENDIENTE',
  intentos          SMALLINT        NOT NULL DEFAULT 0,
  ultimo_error      VARCHAR(500)    NULL,
  programada_para   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviada_en        DATETIME        NULL,
  created_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notificacion_cola (estado, programada_para),
  KEY ix_notificacion_compra (compra_id),
  KEY ix_notificacion_salida (salida_id),
  KEY ix_notificacion_usuario (usuario_id),
  KEY ix_notificacion_solicitante (solicitado_por_id),
  CONSTRAINT fk_notificacion_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_notificacion_compra FOREIGN KEY (compra_id)
    REFERENCES compra (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_notificacion_salida FOREIGN KEY (salida_id)
    REFERENCES salida (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_notificacion_solicitante FOREIGN KEY (solicitado_por_id)
    REFERENCES usuario (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT chk_notificacion_referencia CHECK (compra_id IS NOT NULL OR salida_id IS NOT NULL),
  CONSTRAINT chk_notificacion_intentos CHECK (intentos >= 0),
  CONSTRAINT chk_notificacion_enviada CHECK (estado <> 'ENVIADA' OR enviada_en IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Vistas
-- =============================================================================

-- Disponibilidad para la búsqueda de pasajeros (solo salidas vendibles).
CREATE VIEW v_disponibilidad AS
SELECT s.id                         AS salida_id,
       v.id                         AS vuelo_id,
       v.codigo                     AS codigo_vuelo,
       ao.codigo_iata               AS origen,
       ao.ciudad                    AS ciudad_origen,
       ad.codigo_iata               AS destino,
       ad.ciudad                    AS ciudad_destino,
       s.fecha,
       s.hora_partida,
       s.hora_llegada,
       s.dias_desfase_llegada,
       sc.clase,
       vc.precio,
       sc.capacidad - sc.vendidos   AS asientos_disponibles
FROM salida s
JOIN vuelo v         ON v.id = s.vuelo_id
JOIN aeropuerto ao   ON ao.id = s.aeropuerto_origen_id
JOIN aeropuerto ad   ON ad.id = s.aeropuerto_destino_id
JOIN salida_clase sc ON sc.salida_id = s.id
JOIN vuelo_clase vc  ON vc.vuelo_id = v.id AND vc.clase = sc.clase
WHERE s.estado = 'PROGRAMADA'
  AND v.estado = 'ACTIVO'
  AND TIMESTAMP(s.fecha, s.hora_partida) > NOW();

-- Ocupación por vuelo, fecha y clase (reportes del admin).
-- 'vendidos' incluye reservas pendientes de pago; 'emitidos' solo pagados.
CREATE VIEW v_ocupacion AS
SELECT v.id                                     AS vuelo_id,
       v.codigo                                 AS codigo_vuelo,
       ao.codigo_iata                           AS origen,
       ad.codigo_iata                           AS destino,
       s.id                                     AS salida_id,
       s.fecha,
       s.estado                                 AS estado_salida,
       sc.clase,
       sc.capacidad,
       sc.vendidos,
       COALESCE(p.emitidos, 0)                  AS emitidos,
       COALESCE(p.reservados, 0)                AS reservados,
       sc.capacidad - sc.vendidos               AS disponibles,
       ROUND(100 * COALESCE(p.emitidos, 0) / NULLIF(sc.capacidad, 0), 2) AS porcentaje_ocupacion,
       COALESCE(p.recaudado, 0)                 AS recaudado
FROM salida_clase sc
JOIN salida s       ON s.id = sc.salida_id
JOIN vuelo v        ON v.id = s.vuelo_id
JOIN aeropuerto ao  ON ao.id = s.aeropuerto_origen_id
JOIN aeropuerto ad  ON ad.id = s.aeropuerto_destino_id
LEFT JOIN (
  SELECT salida_id, clase,
         SUM(estado = 'EMITIDO')                        AS emitidos,
         SUM(estado = 'RESERVADO')                      AS reservados,
         SUM(CASE WHEN estado = 'EMITIDO' THEN precio ELSE 0 END) AS recaudado
  FROM pasaje
  GROUP BY salida_id, clase
) p ON p.salida_id = sc.salida_id AND p.clase = sc.clase;
