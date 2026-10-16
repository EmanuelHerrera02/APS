-- Eventos de entrega del proveedor de correo (US10). Ejecutar una vez en bases existentes.
USE aeronet;

CREATE TABLE IF NOT EXISTS email_delivery_event (
  provider_event_id VARCHAR(190) NOT NULL,
  notification_id   BIGINT UNSIGNED NOT NULL,
  provider_status   VARCHAR(24) NOT NULL,
  received_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_event_id),
  KEY ix_email_delivery_notification (notification_id),
  CONSTRAINT fk_email_delivery_notification FOREIGN KEY (notification_id)
    REFERENCES notificacion (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
