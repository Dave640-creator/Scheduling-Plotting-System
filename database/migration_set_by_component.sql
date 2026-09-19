-- SET rule by component (2026-09-19)
-- Laboratory  -> always SET 0 (face-to-face)
-- Lecture     -> never SET 0; uses its year level's alternating SET
--                (1st/4th year = SET 1, 2nd/3rd year = SET 2)
--
-- STEP 1: review the rows that break the rule. Run this first.
SELECT s.id, c.course_code, s.component, s.set_type,
       COALESCE(b.year_level, sp.year_level) AS year_level,
       CASE
         WHEN s.component = 'laboratory' THEN 'set_0'
         WHEN COALESCE(b.year_level, sp.year_level) IN (1, 4) THEN 'set_1'
         ELSE 'set_2'
       END AS correct_set_type
FROM schedules s
JOIN courses c ON c.id = s.course_id
LEFT JOIN blocks b ON b.id = s.block_id
LEFT JOIN spares sp ON sp.id = s.spare_id
WHERE s.set_type <> CASE
         WHEN s.component = 'laboratory' THEN 'set_0'
         WHEN COALESCE(b.year_level, sp.year_level) IN (1, 4) THEN 'set_1'
         ELSE 'set_2'
       END;

-- STEP 2: fix them. Labs first, then lectures.
UPDATE schedules
SET set_type = 'set_0', delivery_mode = 'face_to_face'
WHERE component = 'laboratory' AND set_type <> 'set_0';

UPDATE schedules s
LEFT JOIN blocks b ON b.id = s.block_id
LEFT JOIN spares sp ON sp.id = s.spare_id
SET s.set_type = IF(COALESCE(b.year_level, sp.year_level) IN (1, 4), 'set_1', 'set_2'),
    s.delivery_mode = IF(COALESCE(b.year_level, sp.year_level) IN (1, 4), 'hybrid_rotation_a', 'hybrid_rotation_b')
WHERE s.component = 'lecture'
  AND s.set_type <> IF(COALESCE(b.year_level, sp.year_level) IN (1, 4), 'set_1', 'set_2');

-- STEP 3: fixing the SET can expose room conflicts that the old rule allowed.
-- Open the Dashboard and check the Room Conflicts count afterwards.
