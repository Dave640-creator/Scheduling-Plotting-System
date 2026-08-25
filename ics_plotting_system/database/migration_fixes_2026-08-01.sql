-- Run this once if you already had a copy of this project installed before 2026-08-01.
-- Adds an Active/Unavailable toggle for faculty and rooms so the institute head
-- can take someone off the roster (resigned, on leave) or a room out of service
-- (under repair) WITHOUT deleting them -- deleting cascades and permanently wipes
-- every schedule tied to that faculty/course, which is almost never what you want.

ALTER TABLE faculty ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER max_preparations;
ALTER TABLE rooms   ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER capacity;
