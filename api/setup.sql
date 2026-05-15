-- ImageFlow — esquema de base de datos
-- Ejecutar una sola vez: desde phpMyAdmin o con:
--   mysql -u root < /Applications/XAMPP/xamppfiles/htdocs/imageflow/api/setup.sql

CREATE DATABASE IF NOT EXISTS imageflow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE imageflow;

CREATE TABLE IF NOT EXISTS workflows (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL DEFAULT 'Sin nombre',
  description TEXT         NOT NULL DEFAULT '',
  data        LONGTEXT     NOT NULL DEFAULT '{}',
  created_at  BIGINT       NOT NULL,
  updated_at  BIGINT       NOT NULL,
  INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada fila guarda metadatos de una ejecución.
-- node_results_json: [{nodeId, type, resultsMeta, filePaths:[]}]
-- Los ficheros de imagen/vídeo se guardan en storage/runs/{run_id}/
CREATE TABLE IF NOT EXISTS runs (
  id                VARCHAR(80)  NOT NULL PRIMARY KEY,
  workflow_id       VARCHAR(64)  NOT NULL,
  workflow_name     VARCHAR(255) NOT NULL DEFAULT '',
  created_at        BIGINT       NOT NULL,
  duration_ms       INT          NOT NULL DEFAULT 0,
  result_count      INT          NOT NULL DEFAULT 0,
  thumbnail_path    VARCHAR(512) DEFAULT NULL,
  node_results_json LONGTEXT     NOT NULL DEFAULT '[]',
  INDEX idx_wf_created (workflow_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
