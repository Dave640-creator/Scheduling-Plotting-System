-- Run this once if you already had a copy of this project installed before
-- this update (Subject Offering plotting revision).
--
-- Adds a database-level UNIQUE constraint so the same Course + Section +
-- School Year + Component (e.g. "CIC 111, BSCS 1-36, 2026-2027, Lecture")
-- can never exist as two separate schedule rows -- as defense-in-depth
-- behind the PHP duplicate-component check added in api/schedules.php in
-- the same update. The PHP check is what produces the friendly error
-- message users actually see; this constraint exists so an invalid
-- duplicate can never land in the table even if some other code path (a
-- script, a direct DB edit, a future endpoint) forgets to check first.
--
-- IMPORTANT: if this fails with a duplicate-key error, it means your
-- existing data already has a duplicated component for some
-- course+section+school year combination. Find and resolve those rows
-- first (Schedules tab, or a manual query) before re-running this file:
--
--   SELECT course_id, section_id, school_year, component, COUNT(*)
--   FROM schedules
--   GROUP BY course_id, section_id, school_year, component
--   HAVING COUNT(*) > 1;

ALTER TABLE schedules
  ADD CONSTRAINT uq_schedule_component UNIQUE (course_id, section_id, school_year, component);
