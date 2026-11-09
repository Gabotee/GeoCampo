-- ============================================================================
-- GeoCampo - Esquema de Base de Datos MySQL
-- Plataforma de Gestión de Potreros y Pastoreo (Tambo 117 ha - El Arañado, CBA)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS geocampo_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE geocampo_db;

-- Desactivar temporalmente chequeo de claves foráneas para recreación limpia
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS Notificacion;
DROP TABLE IF EXISTS Uso_Potrero;
DROP TABLE IF EXISTS Historial_Rodeo;
DROP TABLE IF EXISTS Rodeo;
DROP TABLE IF EXISTS Potrero;
DROP TABLE IF EXISTS Establecimiento;
DROP TABLE IF EXISTS Historial_Contrasena;
DROP TABLE IF EXISTS Productor;

SET FOREIGN_KEY_CHECKS = 1;

-- 1. Tabla Productor (Unifica Productor del SQL + Usuario del DER + Seguridad)
CREATE TABLE Productor (
  id_productor INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  contrasena_hash VARCHAR(255) NOT NULL,
  intentos_fallidos INT DEFAULT 0,
  bloqueado BOOLEAN DEFAULT FALSE,
  token_recuperacion VARCHAR(255) NULL,
  token_expiracion DATETIME NULL,
  fecha_ultimo_cambio_clave DATETIME DEFAULT CURRENT_TIMESTAMP,
  rol VARCHAR(50) DEFAULT 'productor',
  activo BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabla Historial_Contrasena (Evita repetir las últimas 3 contraseñas)
CREATE TABLE Historial_Contrasena (
  id_historial_clave INT AUTO_INCREMENT PRIMARY KEY,
  id_productor INT NOT NULL,
  contrasena_hash VARCHAR(255) NOT NULL,
  fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_productor) REFERENCES Productor(id_productor) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabla Establecimiento (Incluye ubicacion_lat y ubicacion_lng del DER)
CREATE TABLE Establecimiento (
  id_establecimiento INT AUTO_INCREMENT PRIMARY KEY,
  id_productor INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  ubicacion_lat DECIMAL(10,6) DEFAULT -31.738000,
  ubicacion_lng DECIMAL(10,6) DEFAULT -62.723000,
  poligono JSON,
  superficie_total_ha DECIMAL(10,2),
  FOREIGN KEY (id_productor) REFERENCES Productor(id_productor) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tabla Potrero (HU-002, HU-003, HU-007)
CREATE TABLE Potrero (
  id_potrero INT AUTO_INCREMENT PRIMARY KEY,
  id_establecimiento INT NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  poligono JSON,
  superficie_ha DECIMAL(10,2),
  tipo_pastura VARCHAR(100) DEFAULT 'Sin especificar',
  disponibilidad_kg_ms_ha DECIMAL(10,2) DEFAULT 0.00,
  porcentaje_aprovechable DECIMAL(5,2) DEFAULT 70.00,
  observaciones VARCHAR(255),
  estado_actual ENUM('disponible','advertencia','descanso') DEFAULT 'disponible',
  FOREIGN KEY (id_establecimiento) REFERENCES Establecimiento(id_establecimiento) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tabla Rodeo (HU-004)
CREATE TABLE Rodeo (
  id_rodeo INT AUTO_INCREMENT PRIMARY KEY,
  id_establecimiento INT NOT NULL,
  cant_vacas_ordene INT DEFAULT 0,
  cant_vacas_secas INT DEFAULT 0,
  cant_vaquillonas INT DEFAULT 0,
  cant_terneras INT DEFAULT 0,
  consumo_diario_prom_kg_ms DECIMAL(6,2) DEFAULT 15.00,
  fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_establecimiento) REFERENCES Establecimiento(id_establecimiento) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Tabla Historial_Rodeo (HU-004 / HU-005 / HU-010 - Snapshots de evolución)
CREATE TABLE Historial_Rodeo (
  id_historial_rodeo INT AUTO_INCREMENT PRIMARY KEY,
  id_rodeo INT NOT NULL,
  fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
  cant_vacas_ordene INT DEFAULT 0,
  cant_vacas_secas INT DEFAULT 0,
  cant_vaquillonas INT DEFAULT 0,
  cant_terneras INT DEFAULT 0,
  consumo_diario_prom_kg_ms DECIMAL(6,2) DEFAULT 15.00,
  FOREIGN KEY (id_rodeo) REFERENCES Rodeo(id_rodeo) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Tabla Uso_Potrero (HU-005, HU-006, HU-009, HU-010)
CREATE TABLE Uso_Potrero (
  id_uso_potrero INT AUTO_INCREMENT PRIMARY KEY,
  id_potrero INT NOT NULL,
  id_rodeo INT NOT NULL,
  id_historial_rodeo INT NOT NULL,
  fecha_ingreso DATE NOT NULL,
  fecha_fin_estimada DATE NOT NULL,
  fecha_fin_real DATE NULL,
  dias_pastoreo_estimados INT NOT NULL,
  estado ENUM('activo','finalizado') DEFAULT 'activo',
  FOREIGN KEY (id_potrero) REFERENCES Potrero(id_potrero) ON DELETE CASCADE,
  FOREIGN KEY (id_rodeo) REFERENCES Rodeo(id_rodeo) ON DELETE CASCADE,
  FOREIGN KEY (id_historial_rodeo) REFERENCES Historial_Rodeo(id_historial_rodeo) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Tabla Notificacion (HU-008)
CREATE TABLE Notificacion (
  id_notificacion INT AUTO_INCREMENT PRIMARY KEY,
  id_uso_potrero INT NOT NULL,
  fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
  mensaje VARCHAR(255) NOT NULL,
  leida BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (id_uso_potrero) REFERENCES Uso_Potrero(id_uso_potrero) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
