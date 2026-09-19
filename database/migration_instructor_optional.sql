-- Instructor is now optional while plotting (2026-09-19)
-- A schedule can be saved with no instructor ("Instructor not assigned" is
-- a warning, not a conflict). Run this once if you already had a copy of
-- this project installed before this update. Fresh installs of
-- ics_plotting.sql already include this change.
--
-- Existing rows are untouched; they all keep their current instructor.
ALTER TABLE schedules MODIFY faculty_id INT NULL;
