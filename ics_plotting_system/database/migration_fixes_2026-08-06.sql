-- Run this once if you already had a copy of this project installed before 2026-08-06.
-- Changes day_of_week from a fixed list (MWF/TTH/MW/TF/Saturday/Custom) to a
-- flexible column storing actual comma-separated day names (e.g.
-- "Monday,Wednesday,Friday"). This lets the Plot Schedule form offer custom
-- day combinations beyond the fixed presets, while keeping the presets as
-- quick-select shortcuts in the UI.

-- Convert existing preset values to real day names first (while the column
-- can still hold the old short codes).
UPDATE schedules SET day_of_week = 'Monday,Wednesday,Friday' WHERE day_of_week = 'MWF';
UPDATE schedules SET day_of_week = 'Tuesday,Thursday' WHERE day_of_week = 'TTH';
UPDATE schedules SET day_of_week = 'Monday,Wednesday' WHERE day_of_week = 'MW';
UPDATE schedules SET day_of_week = 'Tuesday,Friday' WHERE day_of_week = 'TF';
-- 'Saturday' and any already-custom values are left as-is; a plain 'Custom'
-- string can't be retroactively converted since we don't know which days
-- were originally meant -- if you have old rows still showing 'Custom',
-- re-check and re-save them from the Schedules tab after this migration.

ALTER TABLE schedules MODIFY day_of_week VARCHAR(60) NOT NULL;
