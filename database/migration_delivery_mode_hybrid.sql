-- Run this once if you already had a copy of this project installed before
-- this update.
--
-- delivery_mode was previously stored as either 'face_to_face' (SET 0) or
-- 'online' (SET 1 AND SET 2 both) -- but SET 1/SET 2 are hybrid alternating
-- rotations ("Hybrid Rotation A"/"Hybrid Rotation B" in the UI), not fully
-- online classes. This corrects the stored values to match, and converts
-- any existing rows.
--
-- Done in 3 steps (widen enum -> migrate data -> narrow enum) so any
-- existing rows currently storing 'online' never briefly become an invalid
-- enum value mid-migration.

-- 1. Widen the enum to allow both the old and new values at once.
ALTER TABLE schedules
  MODIFY delivery_mode ENUM('face_to_face','online','hybrid_rotation_a','hybrid_rotation_b') NOT NULL DEFAULT 'face_to_face';

-- 2. Move existing SET 1 / SET 2 rows from the old generic 'online' value
--    to the correct rotation label.
UPDATE schedules SET delivery_mode = 'hybrid_rotation_a' WHERE set_type = 'set_1';
UPDATE schedules SET delivery_mode = 'hybrid_rotation_b' WHERE set_type = 'set_2';

-- 3. Now that no row uses 'online' anymore, drop it from the enum.
ALTER TABLE schedules
  MODIFY delivery_mode ENUM('face_to_face','hybrid_rotation_a','hybrid_rotation_b') NOT NULL DEFAULT 'face_to_face';
