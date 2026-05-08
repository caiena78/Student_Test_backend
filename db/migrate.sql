-- Safe migration for existing databases
-- Run this against an existing edutest_db to add new columns and tables

USE edutest_db;

-- Add true_false to the questions.type ENUM (safe: existing rows are unaffected)
ALTER TABLE questions
  MODIFY COLUMN type ENUM('multiple_choice','free_text','drag_drop','true_false') NOT NULL;

-- Image columns: store file paths instead of base64. TEXT is sufficient for any URL/path.
ALTER TABLE tests            MODIFY COLUMN title_image   TEXT;
ALTER TABLE questions        MODIFY COLUMN prompt_image  TEXT;
ALTER TABLE question_options MODIFY COLUMN image         TEXT;
ALTER TABLE drag_drop_items  MODIFY COLUMN item_image    TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by INT DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change TINYINT(1) DEFAULT 0;

-- Add the FK for created_by only if it doesn't already exist
-- (MySQL does not support IF NOT EXISTS for FOREIGN KEY; run manually if needed)
-- ALTER TABLE users ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS student_attempt_overrides (
  id INT PRIMARY KEY AUTO_INCREMENT,
  test_id INT NOT NULL,
  student_id INT NOT NULL,
  extra_attempts INT NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_override (test_id, student_id),
  FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── PRINT JOBS ───────────────────────────────────────────────────────────────
-- Teacher generates N printable versions of a test. Each version stores a
-- frozen snapshot of the test so printed copies remain stable after edits.

CREATE TABLE IF NOT EXISTS print_jobs (
  id                 INT      PRIMARY KEY AUTO_INCREMENT,
  test_id            INT      NOT NULL,
  teacher_id         INT      NOT NULL,
  status             ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  number_of_versions INT      NOT NULL,
  error_message      TEXT     DEFAULT NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pj_test    FOREIGN KEY (test_id)    REFERENCES tests(id) ON DELETE CASCADE,
  CONSTRAINT fk_pj_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS print_job_versions (
  id             INT          PRIMARY KEY AUTO_INCREMENT,
  print_job_id   INT          NOT NULL,
  version_number INT          NOT NULL,
  version_name   VARCHAR(255) NOT NULL,
  payload        JSON         NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pjv_name (print_job_id, version_name),
  CONSTRAINT fk_pjv_job FOREIGN KEY (print_job_id)
    REFERENCES print_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback (run in reverse order if needed):
-- DROP TABLE IF EXISTS print_job_versions;
-- DROP TABLE IF EXISTS print_jobs;
