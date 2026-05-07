-- =============================================================================
-- Caroline's Test System — Full Database Schema
-- =============================================================================
-- Run against a fresh MySQL 8+ server:
--   mysql -u root -p < schema.sql
--
-- After running schema, seed the default admin user:
--   node db/seed.js
-- =============================================================================

CREATE DATABASE IF NOT EXISTS edutest_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE edutest_db;

-- Disable FK checks during creation so table order doesn't matter
SET FOREIGN_KEY_CHECKS = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- USERS
-- Stores admins, teachers, and students.
-- created_by: teacher who created the student account (NULL for admin/teacher)
-- force_password_change: teacher can require student to change pw on next login
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    INT           PRIMARY KEY AUTO_INCREMENT,
  username              VARCHAR(100)  UNIQUE NOT NULL,
  email                 VARCHAR(255)  UNIQUE,
  password_hash         VARCHAR(255)  NOT NULL,
  role                  ENUM('admin','teacher','student') NOT NULL,
  first_name            VARCHAR(100),
  last_name             VARCHAR(100),
  is_active             TINYINT(1)    NOT NULL DEFAULT 1,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            INT           DEFAULT NULL,
  force_password_change TINYINT(1)    NOT NULL DEFAULT 0,
  CONSTRAINT fk_users_created_by FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUPS
-- A teacher creates named groups (e.g. "3rd Grade") to assign tests to.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `groups` (
  id         INT          PRIMARY KEY AUTO_INCREMENT,
  name       VARCHAR(255) NOT NULL,
  teacher_id INT          NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_groups_teacher FOREIGN KEY (teacher_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- GROUP_STUDENTS
-- Many-to-many: students belong to groups.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS group_students (
  group_id   INT NOT NULL,
  student_id INT NOT NULL,
  PRIMARY KEY (group_id, student_id),
  CONSTRAINT fk_gs_group   FOREIGN KEY (group_id)   REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_gs_student FOREIGN KEY (student_id) REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- TESTS
-- Teacher-created tests with configurable settings.
-- title_image: relative URL to uploaded file (e.g. /uploads/abc.png)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tests (
  id                      INT           PRIMARY KEY AUTO_INCREMENT,
  teacher_id              INT           NOT NULL,
  title                   VARCHAR(500)  NOT NULL,
  title_image             TEXT,
  time_limit_minutes      INT           DEFAULT NULL,
  attempts_allowed        INT           NOT NULL DEFAULT 1,
  shuffle_questions       TINYINT(1)    NOT NULL DEFAULT 1,
  shuffle_answers         TINYINT(1)    NOT NULL DEFAULT 1,
  show_grade_on_completion TINYINT(1)   NOT NULL DEFAULT 1,
  show_correct_answers    TINYINT(1)    NOT NULL DEFAULT 0,
  allow_back_navigation   TINYINT(1)    NOT NULL DEFAULT 1,
  status                  ENUM('draft','published') NOT NULL DEFAULT 'draft',
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tests_teacher FOREIGN KEY (teacher_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUESTIONS
-- Belongs to a test. Supports four types:
--   multiple_choice  config: { multi_select: bool }
--   free_text        config: { keywords: [], min_keywords: int, sample_answer: '' }
--   drag_drop        config: null  (items stored in drag_drop_items)
--   true_false       config: { correct_answer: bool }
-- prompt_image: relative URL to uploaded file
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questions (
  id           INT      PRIMARY KEY AUTO_INCREMENT,
  test_id      INT      NOT NULL,
  type         ENUM('multiple_choice','free_text','drag_drop','true_false') NOT NULL,
  prompt       TEXT     NOT NULL,
  prompt_image TEXT,
  points       DECIMAL(8,2) NOT NULL DEFAULT 1,
  order_index  INT      NOT NULL DEFAULT 0,
  config       JSON,
  CONSTRAINT fk_questions_test FOREIGN KEY (test_id)
    REFERENCES tests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUESTION_OPTIONS
-- Answer choices for multiple_choice questions.
-- image: relative URL to uploaded file
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS question_options (
  id          INT        PRIMARY KEY AUTO_INCREMENT,
  question_id INT        NOT NULL,
  text        TEXT,
  image       TEXT,
  is_correct  TINYINT(1) NOT NULL DEFAULT 0,
  order_index INT        NOT NULL DEFAULT 0,
  CONSTRAINT fk_options_question FOREIGN KEY (question_id)
    REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- DRAG_DROP_ITEMS
-- Items for drag_drop questions. correct_position is 0-indexed.
-- item_image: relative URL to uploaded file
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drag_drop_items (
  id               INT          PRIMARY KEY AUTO_INCREMENT,
  question_id      INT          NOT NULL,
  item_text        TEXT,
  item_image       TEXT,
  correct_position INT          NOT NULL,
  category         VARCHAR(255) DEFAULT NULL,
  CONSTRAINT fk_ddi_question FOREIGN KEY (question_id)
    REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST_ASSIGNMENTS
-- Links a test to either a group OR an individual student (not both).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_assignments (
  id          INT      PRIMARY KEY AUTO_INCREMENT,
  test_id     INT      NOT NULL,
  group_id    INT      DEFAULT NULL,
  student_id  INT      DEFAULT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date    DATETIME DEFAULT NULL,
  CONSTRAINT fk_ta_test    FOREIGN KEY (test_id)    REFERENCES tests(id)    ON DELETE CASCADE,
  CONSTRAINT fk_ta_group   FOREIGN KEY (group_id)   REFERENCES `groups`(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_student FOREIGN KEY (student_id) REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- ATTEMPTS
-- One row per student per test attempt.
-- question_order: JSON array of question IDs in the shuffled order shown to student.
-- seed: used to reproduce the shuffle deterministically for review.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attempts (
  id               INT           PRIMARY KEY AUTO_INCREMENT,
  test_id          INT           NOT NULL,
  student_id       INT           NOT NULL,
  started_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at     DATETIME      DEFAULT NULL,
  seed             VARCHAR(64)   DEFAULT NULL,
  question_order   JSON          DEFAULT NULL,
  score            DECIMAL(10,2) DEFAULT NULL,
  max_score        DECIMAL(10,2) DEFAULT NULL,
  status           ENUM('in_progress','submitted','graded') NOT NULL DEFAULT 'in_progress',
  overall_feedback TEXT          DEFAULT NULL,
  CONSTRAINT fk_attempts_test    FOREIGN KEY (test_id)    REFERENCES tests(id),
  CONSTRAINT fk_attempts_student FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- ATTEMPT_ANSWERS
-- One row per question per attempt.
-- answer_data: JSON payload from student
--   multiple_choice: { selected_ids: [1,2,...] }
--   free_text:       { text: "..." }
--   drag_drop:       { order: [id1, id2, ...] }
--   true_false:      { answer: true | false }
-- auto_score: set immediately on submit for auto-graded types
-- manual_score: teacher override; takes precedence over auto_score in totals
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attempt_answers (
  id           INT          PRIMARY KEY AUTO_INCREMENT,
  attempt_id   INT          NOT NULL,
  question_id  INT          NOT NULL,
  answer_data  JSON         DEFAULT NULL,
  option_order JSON         DEFAULT NULL,
  auto_score   DECIMAL(8,2) DEFAULT NULL,
  manual_score DECIMAL(8,2) DEFAULT NULL,
  feedback     TEXT         DEFAULT NULL,
  is_graded    TINYINT(1)   NOT NULL DEFAULT 0,
  CONSTRAINT fk_aa_attempt  FOREIGN KEY (attempt_id)  REFERENCES attempts(id)  ON DELETE CASCADE,
  CONSTRAINT fk_aa_question FOREIGN KEY (question_id) REFERENCES questions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- STUDENT_ATTEMPT_OVERRIDES
-- Teacher can grant a student extra attempts beyond the test default.
-- extra_attempts is cumulative — each reassign increments it by 1.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_attempt_overrides (
  id             INT      PRIMARY KEY AUTO_INCREMENT,
  test_id        INT      NOT NULL,
  student_id     INT      NOT NULL,
  extra_attempts INT      NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_override (test_id, student_id),
  CONSTRAINT fk_sao_test    FOREIGN KEY (test_id)    REFERENCES tests(id) ON DELETE CASCADE,
  CONSTRAINT fk_sao_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-enable FK checks
SET FOREIGN_KEY_CHECKS = 1;
