-- Safe migration for existing databases
-- Run this against an existing edutest_db to add new columns and tables

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
