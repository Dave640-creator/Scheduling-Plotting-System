-- Run this once if you already had a copy of this project installed before
-- 2026-08-21.
--
-- Adds database-level CHECK constraints as defense-in-depth behind the PHP
-- validation added in the same update. The PHP checks are what produce the
-- friendly error messages users actually see; these constraints exist so
-- that invalid rows can never land in the table even if some other code
-- path (a script, a direct DB edit, a future endpoint) forgets to validate.
-- Requires MySQL 8.0.16+ / MariaDB 10.2.1+ for CHECK enforcement.

ALTER TABLE sections
  ADD CONSTRAINT chk_sections_student_count CHECK (student_count BETWEEN 1 AND 30);

ALTER TABLE rooms
  ADD CONSTRAINT chk_rooms_capacity CHECK (capacity > 0);

ALTER TABLE faculty
  ADD CONSTRAINT chk_faculty_max_preparations CHECK (max_preparations BETWEEN 1 AND 20);

ALTER TABLE courses
  ADD CONSTRAINT chk_courses_lec_units CHECK (lec_units >= 0),
  ADD CONSTRAINT chk_courses_lab_units CHECK (lab_units >= 0);
