-- ============================================================================
-- GeoCampo - Datos Semilla Iniciales (Solo Cuenta de Productor)
-- El establecimiento, los potreros, las pasturas y el rodeo se crean y guardan
-- directamente desde el mapa interactivo de la aplicación.
--
-- Credenciales de acceso:
--   Email:      productor@elaranado.com
--   Contraseña: Campo2026!
-- ============================================================================

USE geocampo_db;

-- 1. Productor / Dueño único del establecimiento
-- Hash bcrypt real correspondiente a: Campo2026!
INSERT INTO Productor (
  id_productor, nombre, email, contrasena_hash, intentos_fallidos, bloqueado, fecha_ultimo_cambio_clave, rol, activo
) VALUES (
  1,
  'Juan Carlos Giordano (Productor)',
  'productor@elaranado.com',
  '$2a$10$o1Pk7DI4saEnJEiHDrdVjuM.sWMfgFSR1oN6VqF8pZMaHTj7EYRa2',
  0,
  FALSE,
  NOW(),
  'productor',
  TRUE
);

INSERT INTO Historial_Contrasena (id_productor, contrasena_hash, fecha_creacion)
VALUES (1, '$2a$10$o1Pk7DI4saEnJEiHDrdVjuM.sWMfgFSR1oN6VqF8pZMaHTj7EYRa2', NOW());
