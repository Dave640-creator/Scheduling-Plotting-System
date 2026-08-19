-- Run this ONLY if you already imported ics_plotting.sql before 2026-07-14
-- and don't want to lose existing data by re-importing the full schema.
-- Safe to run once. If the column already exists, MySQL/MariaDB will show
-- an error saying "Duplicate column name" -- that just means it's already applied.

USE ics_plotting_system;

ALTER TABLE schedules
  ADD COLUMN delivery_mode ENUM('face_to_face','online') NOT NULL DEFAULT 'face_to_face'
  AFTER set_type;

-- Backfill existing rows based on their set_type, matching the app's own rule
-- (SET 0 = always face-to-face, SET 1/2 = online) so old rows aren't left
-- with the wrong default.
UPDATE schedules SET delivery_mode = 'face_to_face' WHERE set_type = 'set_0';
UPDATE schedules SET delivery_mode = 'online' WHERE set_type IN ('set_1','set_2');

-- Separate, unrelated fix: the password hash originally seeded for
-- 'institute_head' does not actually match the documented password
-- 'ics12345' (it was a placeholder). This replaces it with a hash that
-- verifies correctly. Only run this if you haven't already changed
-- this account's password.
UPDATE users SET password_hash = '$2y$10$h/CsqRpS6Rl3ntcb0vlWIOM6QpTNI/hsnrVWWfEbVXysDy.E4jd7K'
WHERE username = 'institute_head';

-- Adds school year tracking to schedules, so multiple semesters/school years
-- don't all mix together in one flat list. Existing rows are backfilled with
-- '2026-2027' as a placeholder -- update them manually if that's wrong for
-- your existing plotted schedules.
ALTER TABLE schedules
  ADD COLUMN school_year VARCHAR(9) NOT NULL DEFAULT '2026-2027'
  AFTER delivery_mode;

-- Adds a timestamp to faculty_courses so the dashboard's "recently assigned
-- faculty" widget has something to sort by.
ALTER TABLE faculty_courses
  ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
