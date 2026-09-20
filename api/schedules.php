<?php
require_once __DIR__ . '/bootstrap.php';
require_login();

function schedule_days(string $pattern): array {
    // Legacy short codes, kept for backward compatibility with rows from
    // before day_of_week became a flexible comma-separated day list.
    $legacyMap = [
        'MWF' => ['Monday','Wednesday','Friday'],
        'TTH' => ['Tuesday','Thursday'],
        'MW' => ['Monday','Wednesday'],
        'TF' => ['Tuesday','Friday'],
    ];
    if (isset($legacyMap[$pattern])) return $legacyMap[$pattern];
    // New format: a comma-separated list of real day names (e.g.
    // "Monday,Wednesday,Friday"), or a single day name like "Saturday".
    return array_map('trim', explode(',', $pattern));
}

function schedules_share_day(string $a, string $b): bool {
    return count(array_intersect(schedule_days($a), schedule_days($b))) > 0;
}

/**
 * Which alternating (hybrid) SET each year level rotates on: 1st and 4th
 * year use SET 1 (F2F Week 1 / Online Week 2), 2nd and 3rd year use the
 * opposite pattern, SET 2 (Online Week 1 / F2F Week 2). This applies
 * identically whether the schedule's target is a regular Block or the
 * SPARE group -- both are keyed off the same year_level.
 */
const ALTERNATING_SET_BY_YEAR_LEVEL = [
    1 => 'set_1',
    2 => 'set_2',
    3 => 'set_2',
    4 => 'set_1',
];

const SET_TYPE_LABELS = ['set_0' => 'SET 0', 'set_1' => 'SET 1', 'set_2' => 'SET 2'];

/**
 * The SET a course starts with (the DEFAULT only -- the scheduler can change it):
 * - LABORATORY defaults to SET 0 (always face-to-face).
 * - LECTURE defaults to the alternating SET of its target's year level
 *   (SET 1 for 1st/4th year, SET 2 for 2nd/3rd year).
 * Used to prefill the SET when none is submitted.
 */
function default_set_type(string $component, int $yearLevel): string {
    if ($component === 'laboratory') return 'set_0';
    return ALTERNATING_SET_BY_YEAR_LEVEL[$yearLevel] ?? 'set_1';
}

/**
 * Every course can be set to SET 0, SET 1 or SET 2, whatever its component
 * or year level -- the scheduler picks per course. (The year-level/component
 * rule above is only the default, no longer a restriction.)
 */
function allowed_set_types(string $component, int $yearLevel): array {
    return array_keys(SET_TYPE_LABELS);
}

/**
 * SET-aware ROOM conflict rule for two schedules that already overlap in
 * day/time and use the same room:
 * - SET 0 is always face-to-face and never alternates, so it conflicts
 *   with anything (SET 0, SET 1 or SET 2).
 * - The same alternating set (SET 1 + SET 1, or SET 2 + SET 2) lands on the
 *   same weeks, so it conflicts.
 * - SET 1 + SET 2 are opposite rotations (one is F2F while the other is
 *   online), so they can share the room -- they do NOT conflict.
 */
function sets_conflict(string $setA, string $setB): bool {
    if ($setA === 'set_0' || $setB === 'set_0') return true;
    return $setA === $setB;
}

/**
 * A schedule targets EITHER a regular Block OR the SPARE group's own
 * separate schedule -- never both. Returns ['type' => 'block'|'spare', 'row' => ...]
 * for whichever one the request specifies, after validating exactly one
 * was given and that it exists.
 */
function resolve_schedule_target(PDO $pdo, array $d): array {
    $hasBlock = !empty($d['block_id']);
    $hasSpare = !empty($d['spare_id']);
    if ($hasBlock === $hasSpare) {
        json_response(false, 'A schedule must target exactly one Block OR the SPARE group, not both or neither.', null, 422);
    }
    if ($hasBlock) {
        $stmt = $pdo->prepare('SELECT * FROM blocks WHERE id=?');
        $stmt->execute([(int)$d['block_id']]);
        $block = $stmt->fetch();
        if (!$block) json_response(false, 'Block not found.', null, 404);
        return ['type' => 'block', 'row' => $block];
    }
    $stmt = $pdo->prepare('SELECT * FROM spares WHERE id=?');
    $stmt->execute([(int)$d['spare_id']]);
    $spare = $stmt->fetch();
    if (!$spare) json_response(false, 'SPARE group not found.', null, 404);
    return ['type' => 'spare', 'row' => $spare];
}

function target_label(string $type, array $row): string {
    return $type === 'block'
        ? $row['program_code'] . ' ' . $row['year_level'] . ' - ' . $row['block_name']
        : $row['program_code'] . ' ' . $row['year_level'] . ' - SPARE';
}

/** True if both targets refer to the same Block, or both refer to the same SPARE group. */
function same_target(array $a, array $b): bool {
    if (!empty($a['block_id']) && !empty($b['block_id'])) return (int)$a['block_id'] === (int)$b['block_id'];
    if (!empty($a['spare_id']) && !empty($b['spare_id'])) return (int)$a['spare_id'] === (int)$b['spare_id'];
    return false;
}

function validate_schedule(PDO $pdo, array $d, ?int $ignoreId = null): void {
    require_fields($d, ['course_id','component','set_type','day_of_week','start_time','end_time','school_year']);

    // Instructor is OPTIONAL while plotting: subjects are often plotted
    // before the final instructor assignment. A missing instructor is NOT a
    // conflict and never blocks a save -- every instructor-specific rule
    // below (eligibility, active status, preparation limit, Lecture/Lab
    // consistency, instructor double-booking) simply runs only when an
    // instructor is actually assigned, i.e. when $facultyId is not null.
    $facultyId = empty($d['faculty_id']) ? null : (int)$d['faculty_id'];

    if (!preg_match('/^\d{4}-\d{4}$/', $d['school_year'])) {
        json_response(false, 'School year must be in the format YYYY-YYYY (e.g. 2026-2027).', null, 422);
    }
    [$syStart, $syEnd] = explode('-', $d['school_year']);
    if ((int)$syEnd !== (int)$syStart + 1) {
        json_response(false, 'School year end must be exactly one year after the start (e.g. 2026-2027).', null, 422);
    }

    $start = $d['start_time'];
    $end = $d['end_time'];
    if (strtotime($end) <= strtotime($start)) {
        json_response(false, 'End time must be later than start time.', null, 422);
    }

    $validDayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    $legacyDayCodes = ['MWF','TTH','MW','TF'];
    if (!in_array($d['day_of_week'], $legacyDayCodes, true)) {
        $submittedDays = array_map('trim', explode(',', $d['day_of_week']));
        $invalidDays = array_diff($submittedDays, $validDayNames);
        if (empty($submittedDays) || !empty($invalidDays)) {
            json_response(false, 'Select at least one valid day of the week.', null, 422);
        }
        // The frontend's checkbox UI can't submit the same day twice, but a
        // direct API call could send e.g. "Monday,Monday,Wednesday". Duplicate
        // days would make the day pattern ambiguous (and inflate any
        // per-week totals shown or computed from it), so reject them (bug #12).
        if (count($submittedDays) !== count(array_unique($submittedDays))) {
            json_response(false, 'Duplicate days are not allowed in the day pattern.', null, 422);
        }
    }

    $courseStmt = $pdo->prepare('SELECT * FROM courses WHERE id=?');
    $courseStmt->execute([(int)$d['course_id']]);
    $course = $courseStmt->fetch();
    if (!$course) json_response(false, 'Course not found.', null, 404);

    $target = resolve_schedule_target($pdo, $d);
    $targetType = $target['type'];
    $targetRow = $target['row'];
    $targetYearLevel = (int)$targetRow['year_level'];

    // A course belongs to exactly one curriculum year level in this
    // system's design, so plotting it against a Block/SPARE of a different
    // year level is almost always a data-entry mistake.
    if ((int)$course['year_level'] !== $targetYearLevel) {
        json_response(false, 'Year level mismatch: "' . $course['course_code'] . '" is a Year ' . $course['year_level'] . ' course, but the selected target is Year ' . $targetYearLevel . '.', null, 422);
    }

    if ($targetType === 'block') {
        // The course must actually be assigned to this block (Assign
        // Courses step) -- Plot Schedule only ever offers assigned
        // courses, but a direct API call could still try to plot an
        // unassigned one.
        $assignedStmt = $pdo->prepare('SELECT COUNT(*) FROM block_courses WHERE block_id=? AND course_id=?');
        $assignedStmt->execute([(int)$targetRow['id'], (int)$course['id']]);
        if ((int)$assignedStmt->fetchColumn() === 0) {
            json_response(false, '"' . $course['course_code'] . '" is not assigned to ' . $targetRow['block_name'] . '. Assign it first in Assign Courses.', null, 422);
        }
    } else {
        // A course can only be plotted directly under SPARE when its SPARE
        // allocation is specifically "separate_schedule" -- a
        // "join_block" allocation means SPARE students simply attend that
        // block's existing class and gets no schedule row of its own.
        $allocStmt = $pdo->prepare('SELECT allocation_type FROM spare_course_allocations WHERE spare_id=? AND course_id=?');
        $allocStmt->execute([(int)$targetRow['id'], (int)$course['id']]);
        $allocation = $allocStmt->fetch();
        if (!$allocation || $allocation['allocation_type'] !== 'separate_schedule') {
            json_response(false, '"' . $course['course_code'] . '" is not configured for a separate SPARE schedule. Set its SPARE allocation to "Separate Schedule" first.', null, 422);
        }
    }

    // SET validation. Any course may use SET 0, SET 1 or SET 2 (the scheduler
    // chooses per course); the backend still rejects any other value, since
    // a direct API call must never be able to store an unknown SET.
    $allowedSetTypes = allowed_set_types((string)$d['component'], $targetYearLevel);
    if (!in_array($d['set_type'], $allowedSetTypes, true)) {
        $allowedLabels = implode(', ', array_map(fn($s) => SET_TYPE_LABELS[$s] ?? $s, $allowedSetTypes));
        json_response(false, 'Invalid SET: "' . $d['set_type'] . '". Choose one of: ' . $allowedLabels . '.', null, 422);
    }

    if ($d['component'] === 'lecture' && (float)$course['lec_units'] <= 0) {
        json_response(false, 'This course has no lecture component.', null, 422);
    }
    if ($d['component'] === 'laboratory' && (float)$course['lab_units'] <= 0) {
        json_response(false, 'This course has no laboratory component.', null, 422);
    }

    // Schedule duration is NOT derived from course units. The plotter picks
    // the Day Pattern, Start Time and Duration per day (End Time is just
    // Start + Duration), so the same 3-unit course can be MWF x 1 hour in a
    // regular semester and Mon-Fri x 3 hours in summer. Units stay as plain
    // academic info on the course. This endpoint only guards against invalid
    // input (end after start, valid days) and schedule conflicts below.
    // If the school ever needs a contact-hour rule for a specific course or
    // term, add it here as its own explicit validation, not as a units x 60
    // formula.

    $faculty = null;
    if ($facultyId !== null) {
        $facultyStmt = $pdo->prepare('SELECT * FROM faculty WHERE id=?');
        $facultyStmt->execute([$facultyId]);
        $faculty = $facultyStmt->fetch();
        if (!$faculty) json_response(false, 'Faculty not found.', null, 404);

        // NOTE: the faculty does NOT have to be assigned to this course in
        // Faculty Course Assignments. Any active instructor can be picked;
        // the scheduler may optionally tick "also assign" (see
        // ensure_faculty_course()), or just use them for this schedule.
    }

    // Instructor consistency + duplicate-component check: a course's Lecture
    // and Laboratory components, for the same target (Block or SPARE) and
    // school year, are the same class split across two meeting types --
    // they must be taught by the same instructor, and each component may
    // only be plotted once per course+target+school year (bug/requirement:
    // "do not duplicate components"). Both checks are done against ALL
    // sibling rows (not just the first one found), so a course that already
    // has both Lecture and Laboratory plotted is checked correctly against
    // either. This is checked regardless of which component was plotted
    // first. The frontend already inherits/locks the faculty field and
    // hides already-plotted components in the normal flow; this is the
    // authoritative backend check (and the fallback for stale UI state /
    // direct API calls / the batched "subject offering" save).
    $targetColumn = $targetType === 'block' ? 'block_id' : 'spare_id';
    $siblingSql = "SELECT s.id, s.faculty_id, s.component, f.faculty_name
                   FROM schedules s LEFT JOIN faculty f ON f.id = s.faculty_id
                   WHERE s.course_id=? AND s.$targetColumn=? AND s.school_year=?";
    $siblingParams = [(int)$d['course_id'], (int)$targetRow['id'], $d['school_year']];
    if ($ignoreId) { $siblingSql .= ' AND s.id<>?'; $siblingParams[] = $ignoreId; }
    $siblingStmt = $pdo->prepare($siblingSql);
    $siblingStmt->execute($siblingParams);
    $siblingSchedules = $siblingStmt->fetchAll();

    $targetLabel = target_label($targetType, $targetRow);

    foreach ($siblingSchedules as $siblingSchedule) {
        if ($siblingSchedule['component'] === $d['component']) {
            json_response(
                false,
                $course['course_code'] . ' already has a ' . ucfirst($siblingSchedule['component']) . ' schedule for ' . $targetLabel . ' in ' . $d['school_year'] . '. Edit the existing schedule instead of creating another one for the same component.',
                [
                    'conflict_type' => 'duplicate_component',
                    'existing_schedule_id' => (int)$siblingSchedule['id'],
                    'existing_component' => $siblingSchedule['component'],
                    'course_code' => $course['course_code'],
                ],
                409
            );
        }
    }

    // Only compares when BOTH sides have an instructor -- a sibling (or this
    // component) with no instructor yet is "not assigned", not a mismatch.
    foreach ($siblingSchedules as $siblingSchedule) {
        if ($facultyId !== null && $siblingSchedule['faculty_id'] !== null && (int)$siblingSchedule['faculty_id'] !== $facultyId) {
            json_response(
                false,
                $course['course_code'] . ' for ' . $targetLabel . ' is already assigned to ' . $siblingSchedule['faculty_name'] . '. Lecture and Laboratory must use the same instructor.',
                [
                    'conflict_type' => 'instructor_mismatch',
                    'existing_schedule_id' => (int)$siblingSchedule['id'],
                    'existing_faculty_id' => (int)$siblingSchedule['faculty_id'],
                    'existing_faculty_name' => $siblingSchedule['faculty_name'],
                    'existing_component' => $siblingSchedule['component'],
                    'course_code' => $course['course_code'],
                ],
                409
            );
        }
    }

    $existingSchedule = null;
    if ($ignoreId) {
        $existingScheduleStmt = $pdo->prepare('SELECT faculty_id, room_id FROM schedules WHERE id=?');
        $existingScheduleStmt->execute([$ignoreId]);
        $existingSchedule = $existingScheduleStmt->fetch();
    }

    if ($faculty !== null && (int)$faculty['is_active'] === 0) {
        $facultyUnchanged = $existingSchedule && (int)$existingSchedule['faculty_id'] === $facultyId;
        if (!$facultyUnchanged) {
            json_response(false, 'This faculty is marked unavailable and cannot be assigned new schedules. Reactivate them in Faculty Management first.', null, 422);
        }
    }

    // Preparations are counted per term (same school year + same semester the
    // course belongs to), not across the faculty's entire history -- otherwise
    // a faculty's load from past semesters would permanently count against them.
    // Skipped entirely when no instructor is assigned yet.
    if ($faculty !== null) {
        $prepSql = 'SELECT COUNT(DISTINCT sch.course_id) FROM schedules sch JOIN courses c2 ON c2.id = sch.course_id
                    WHERE sch.faculty_id=? AND sch.school_year=? AND c2.semester_type=?';
        $prepParams = [$facultyId, $d['school_year'], $course['semester_type']];
        if ($ignoreId) { $prepSql .= ' AND sch.id<>?'; $prepParams[] = $ignoreId; }
        $prepStmt = $pdo->prepare($prepSql);
        $prepStmt->execute($prepParams);
        $currentPreparations = (int)$prepStmt->fetchColumn();

        $courseAlreadySql = 'SELECT COUNT(*) FROM schedules WHERE faculty_id=? AND course_id=? AND school_year=?';
        $courseAlreadyParams = [$facultyId, (int)$d['course_id'], $d['school_year']];
        if ($ignoreId) { $courseAlreadySql .= ' AND id<>?'; $courseAlreadyParams[] = $ignoreId; }
        $courseAlreadyStmt = $pdo->prepare($courseAlreadySql);
        $courseAlreadyStmt->execute($courseAlreadyParams);
        $isNewPreparation = ((int)$courseAlreadyStmt->fetchColumn() === 0);
        $maxPreparations = (int)$faculty['max_preparations'];
        if ($isNewPreparation && $currentPreparations >= $maxPreparations) {
            json_response(false, 'Faculty preparation limit exceeded. Maximum is ' . $maxPreparations . ' unique course preparation(s) for this faculty for ' . $d['school_year'] . ' (' . $course['semester_type'] . ').', null, 422);
        }
    }

    // Room is OPTIONAL while plotting: a schedule can be saved with no room
    // yet (the UI shows a "No room yet" warning). Every room-specific rule
    // below (active room, room type, room conflict) only runs when a room is
    // actually chosen, so a missing room is never a conflict or an error.
    $hasRoom = !empty($d['room_id']);

    $room = null;
    if ($hasRoom) {
        $roomStmt = $pdo->prepare('SELECT * FROM rooms WHERE id=?');
        $roomStmt->execute([(int)$d['room_id']]);
        $room = $roomStmt->fetch();
        if (!$room) json_response(false, 'Room not found.', null, 404);
        if ((int)$room['is_active'] === 0) {
            $roomUnchanged = $existingSchedule && !empty($existingSchedule['room_id']) && (int)$existingSchedule['room_id'] === (int)$d['room_id'];
            if (!$roomUnchanged) {
                json_response(false, 'This room is marked unavailable (e.g. under repair) and cannot be assigned. Reactivate it in Room Management first.', null, 422);
            }
        }
        if ($d['component'] === 'laboratory' && $room['room_type'] !== 'laboratory') {
            json_response(false, 'Laboratory component must use a laboratory room.', null, 422);
        }
        if ($d['component'] === 'lecture' && $room['room_type'] !== 'lecture') {
            json_response(false, 'Lecture component must use a lecture room.', null, 422);
        }
        // NOTE: there is deliberately no room-capacity-vs-headcount check
        // here -- Rooms no longer carry a capacity field and Blocks no
        // longer carry a student count, per the Block/SPARE redesign.
        // Course-level capacity (courses.max_students, when set) is
        // informational only, for the coordinator's own SPARE-allocation
        // judgment calls -- it is not enforced as a plotting gate.
    }

    // Conflicts only matter within the same term -- a room/faculty/target
    // occupied at this day/time in a different school year, or a different
    // semester of the same year, is not actually double-booked.
    $sql = 'SELECT s.* FROM schedules s JOIN courses c ON c.id = s.course_id
            WHERE NOT (s.end_time<=? OR s.start_time>=?) AND s.school_year=? AND c.semester_type=?';
    $params = [$start, $end, $d['school_year'], $course['semester_type']];
    if ($ignoreId) { $sql .= ' AND s.id<>?'; $params[] = $ignoreId; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $existing = $stmt->fetchAll();

    $newTarget = ['block_id' => $d['block_id'] ?? null, 'spare_id' => $d['spare_id'] ?? null];

    foreach ($existing as $row) {
        if (!schedules_share_day($row['day_of_week'], $d['day_of_week'])) continue;

        // The SET 1/SET 2 alternating-week exception is a PHYSICAL ROOM
        // exception only (opposite F2F/Online rotation means the room
        // is free on alternating weeks). It must never be used to bypass an
        // instructor or target (Block/SPARE) double-booking -- those are
        // checked here unconditionally, regardless of which SETs are
        // involved.
        // A schedule with no instructor (either side) can never be an
        // instructor conflict -- "not assigned yet" is a warning shown in the
        // UI, not a double-booking.
        if ($facultyId !== null && $row['faculty_id'] !== null && (int)$row['faculty_id'] === $facultyId) {
            json_response(false, 'Instructor conflict: this faculty already has a class at the selected day/time pattern.', null, 409);
        }
        if (same_target($newTarget, $row)) {
            json_response(false, 'Block conflict: this target already has a class at the selected day/time pattern.', null, 409);
        }
        if ($hasRoom && !empty($row['room_id']) && (int)$row['room_id'] === (int)$d['room_id']) {
            if (sets_conflict($d['set_type'], $row['set_type'])) {
                json_response(false, 'Room conflict: this room is already occupied at the selected day/time pattern.', null, 409);
            }
        }
    }
}

/**
 * delivery_mode mirrors set_type into a human-readable label: SET 0 is
 * always face-to-face; SET 1/SET 2 are the two alternating hybrid
 * rotations, NOT "online" -- they still meet in person, just every other
 * week. (Previously both were stored as the same 'online' value, which
 * didn't match the "Hybrid Rotation A/B" labels shown in the UI.)
 */
function delivery_mode_for_set_type(string $setType): string {
    if ($setType === 'set_1') return 'hybrid_rotation_a';
    if ($setType === 'set_2') return 'hybrid_rotation_b';
    return 'face_to_face';
}

function insert_schedule(PDO $pdo, array $d): int {
    $deliveryMode = delivery_mode_for_set_type($d['set_type']);
    $roomId = empty($d['room_id']) ? null : (int)$d['room_id'];
    $blockId = empty($d['block_id']) ? null : (int)$d['block_id'];
    $spareId = empty($d['spare_id']) ? null : (int)$d['spare_id'];
    $facultyId = empty($d['faculty_id']) ? null : (int)$d['faculty_id'];
    $stmt = $pdo->prepare('INSERT INTO schedules(course_id,block_id,spare_id,faculty_id,room_id,component,delivery_mode,set_type,school_year,day_of_week,start_time,end_time,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([(int)$d['course_id'],$blockId,$spareId,$facultyId,$roomId,$d['component'],$deliveryMode,$d['set_type'],$d['school_year'],$d['day_of_week'],$d['start_time'],$d['end_time'],$d['notes'] ?? null]);
    return (int)$pdo->lastInsertId();
}

/**
 * Optional: make sure the faculty is also listed under this course in
 * Faculty Course Assignments (faculty_courses). Only called when the
 * scheduler ticked "also assign". Safe to call repeatedly.
 */
function ensure_faculty_course(PDO $pdo, $facultyId, int $courseId): void {
    $facultyId = (int)$facultyId;
    if ($facultyId <= 0) return;
    $has = $pdo->prepare('SELECT COUNT(*) FROM faculty_courses WHERE faculty_id=? AND course_id=?');
    $has->execute([$facultyId, $courseId]);
    if ((int)$has->fetchColumn() > 0) return;
    $ins = $pdo->prepare('INSERT INTO faculty_courses(faculty_id, course_id) VALUES(?, ?)');
    $ins->execute([$facultyId, $courseId]);
}

function update_schedule(PDO $pdo, array $d, int $id): void {
    $deliveryMode = delivery_mode_for_set_type($d['set_type']);
    $roomId = empty($d['room_id']) ? null : (int)$d['room_id'];
    $blockId = empty($d['block_id']) ? null : (int)$d['block_id'];
    $spareId = empty($d['spare_id']) ? null : (int)$d['spare_id'];
    $facultyId = empty($d['faculty_id']) ? null : (int)$d['faculty_id'];
    $stmt = $pdo->prepare('UPDATE schedules SET course_id=?, block_id=?, spare_id=?, faculty_id=?, room_id=?, component=?, delivery_mode=?, set_type=?, school_year=?, day_of_week=?, start_time=?, end_time=?, notes=? WHERE id=?');
    $stmt->execute([(int)$d['course_id'],$blockId,$spareId,$facultyId,$roomId,$d['component'],$deliveryMode,$d['set_type'],$d['school_year'],$d['day_of_week'],$d['start_time'],$d['end_time'],$d['notes'] ?? null,$id]);
}

/**
 * "SUBJECT OFFERING" one-save workflow: plots every required component
 * (Lecture, and Laboratory when the course has lab units) for one
 * Course + Block-or-SPARE + School Year in a single atomic request instead
 * of the scheduler having to submit Lecture, then separately hunt down the
 * same course+target again to submit Laboratory.
 *
 * Request body:
 *   {
 *     course_id, block_id OR spare_id, faculty_id (optional), school_year,
 *     components: [
 *       { component: 'lecture'|'laboratory', room_id?, set_type, day_of_week, start_time, end_time, notes?, id? },
 *       ...
 *     ]
 *   }
 *
 * A component entry with an "id" updates that existing schedule row (used
 * when re-opening the form to fix a component that was already saved
 * earlier); an entry without "id" creates a new one. Components already
 * saved for this course+target+school year that are simply left out of the
 * request are untouched -- the completeness check below only requires that
 * every REQUIRED component ends up covered by either an existing row or a
 * row in this request, not that every request re-submits everything.
 *
 * The whole batch is validated and written inside one DB transaction: if
 * any single component fails validation (conflict, instructor mismatch,
 * duplicate, etc.) NONE of the components in this request are saved, so a
 * subject offering can never be left half-plotted by a failed save.
 */
function save_subject_offering(PDO $pdo, array $body): array {
    require_fields($body, ['course_id', 'school_year']);
    $target = resolve_schedule_target($pdo, $body);
    $targetColumn = $target['type'] === 'block' ? 'block_id' : 'spare_id';
    $targetId = (int)$target['row']['id'];

    $components = $body['components'] ?? null;
    if (!is_array($components) || empty($components)) {
        json_response(false, 'At least one component (Lecture and/or Laboratory) is required.', null, 422);
    }

    $courseStmt = $pdo->prepare('SELECT * FROM courses WHERE id=?');
    $courseStmt->execute([(int)$body['course_id']]);
    $course = $courseStmt->fetch();
    if (!$course) json_response(false, 'Course not found.', null, 404);

    $requiredComponents = [];
    if ((float)$course['lec_units'] > 0) $requiredComponents[] = 'lecture';
    if ((float)$course['lab_units'] > 0) $requiredComponents[] = 'laboratory';
    if (empty($requiredComponents)) {
        json_response(false, 'This course has no lecture or laboratory units to plot.', null, 422);
    }

    // What's already saved for this exact offering, so a component doesn't
    // have to be re-submitted every time just to satisfy the completeness
    // check below (see "EXISTING SCHEDULE DETECTION").
    $existingStmt = $pdo->prepare("SELECT id, component FROM schedules WHERE course_id=? AND $targetColumn=? AND school_year=?");
    $existingStmt->execute([(int)$body['course_id'], $targetId, $body['school_year']]);
    $existingComponents = array_column($existingStmt->fetchAll(), 'component', 'id');

    $submittedComponents = [];
    foreach ($components as $c) {
        if (!is_array($c) || empty($c['component'])) {
            json_response(false, 'Each component entry needs a component type (lecture or laboratory).', null, 422);
        }
        if (in_array($c['component'], $submittedComponents, true)) {
            json_response(false, 'Duplicate ' . ucfirst($c['component']) . ' entry in the same save -- only one schedule per component is allowed.', null, 422);
        }
        $submittedComponents[] = $c['component'];
    }

    $coveredComponents = array_unique(array_merge(array_values($existingComponents), $submittedComponents));
    $missing = array_values(array_diff($requiredComponents, $coveredComponents));
    if (!empty($missing)) {
        $missingLabels = array_map('ucfirst', $missing);
        $isPlural = count($missingLabels) > 1;
        $message = $isPlural
            ? $course['course_code'] . ' requires ' . implode(' and ', $missingLabels) . ' schedules. Please complete the following before saving:' . "\n" . implode("\n", array_map(function ($l) { return '- ' . $l; }, $missingLabels))
            : $course['course_code'] . ' requires a ' . $missingLabels[0] . ' schedule. Please complete it before saving.';
        json_response(
            false,
            $message,
            ['conflict_type' => 'incomplete_offering', 'missing_components' => $missing],
            422
        );
    }

    $pdo->beginTransaction();
    $results = [];
    foreach ($components as $c) {
        $d = [
            'course_id' => (int)$body['course_id'],
            'block_id' => $target['type'] === 'block' ? $targetId : null,
            'spare_id' => $target['type'] === 'spare' ? $targetId : null,
            'faculty_id' => empty($body['faculty_id']) ? null : (int)$body['faculty_id'],
            'school_year' => $body['school_year'],
            'component' => $c['component'],
            'set_type' => $c['set_type'] ?? default_set_type((string)$c['component'], (int)$target['row']['year_level']),
            'day_of_week' => $c['day_of_week'] ?? '',
            'start_time' => $c['start_time'] ?? '',
            'end_time' => $c['end_time'] ?? '',
            'room_id' => $c['room_id'] ?? null,
            'notes' => $c['notes'] ?? null,
        ];
        $componentId = isset($c['id']) && $c['id'] ? (int)$c['id'] : null;

        // Ownership check: the submitted id must actually be the row for
        // THIS course + target + school year + component. Without this,
        // a stale/tampered/mismatched id in the request could make an
        // offering for Course A silently overwrite an unrelated schedule
        // row belonging to a completely different course/target -- the
        // same "never trust the frontend alone" principle already applied
        // to the instructor-consistency rule.
        if ($componentId) {
            $ownerStmt = $pdo->prepare('SELECT course_id, block_id, spare_id, school_year, component FROM schedules WHERE id=?');
            $ownerStmt->execute([$componentId]);
            $owner = $ownerStmt->fetch();
            if (!$owner) {
                $pdo->rollBack();
                json_response(false, 'Schedule #' . $componentId . ' was not found.', null, 404);
            }
            $belongsToOffering = (int)$owner['course_id'] === (int)$body['course_id']
                && same_target(['block_id' => $owner['block_id'], 'spare_id' => $owner['spare_id']], ['block_id' => $d['block_id'], 'spare_id' => $d['spare_id']])
                && $owner['school_year'] === $body['school_year']
                && $owner['component'] === $c['component'];
            if (!$belongsToOffering) {
                $pdo->rollBack();
                json_response(false, 'The selected schedule does not belong to this subject offering.', ['conflict_type' => 'offering_mismatch'], 409);
            }
        }

        // validate_schedule() calls json_response()+exit() on any failure,
        // which ends the request without an explicit rollback -- the
        // uncommitted transaction is discarded automatically when the PDO
        // connection closes at process exit, so no partial offering is ever
        // left committed.
        validate_schedule($pdo, $d, $componentId);
        if ($componentId) {
            update_schedule($pdo, $d, $componentId);
            $results[] = ['id' => $componentId, 'component' => $c['component'], 'action' => 'updated'];
        } else {
            $newId = insert_schedule($pdo, $d);
            $results[] = ['id' => $newId, 'component' => $c['component'], 'action' => 'created'];
        }
    }
    if (!empty($body['assign_faculty_to_course']) && !empty($body['faculty_id'])) {
        ensure_faculty_course($pdo, $body['faculty_id'], (int)$body['course_id']);
    }
    $pdo->commit();

    return ['course_code' => $course['course_code'], 'components' => $results];
}

try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query("SELECT s.*, c.course_code, c.course_title, c.semester_type, c.category,
                b.program_code AS block_program_code, b.year_level AS block_year_level, b.block_name,
                sp.program_code AS spare_program_code, sp.year_level AS spare_year_level,
                f.faculty_name, r.room_name
            FROM schedules s
            JOIN courses c ON c.id=s.course_id
            LEFT JOIN blocks b ON b.id=s.block_id
            LEFT JOIN spares sp ON sp.id=s.spare_id
            LEFT JOIN faculty f ON f.id=s.faculty_id
            LEFT JOIN rooms r ON r.id=s.room_id
            ORDER BY s.day_of_week, s.start_time")->fetchAll();

        // Flatten block-or-spare into a single "target" shape the frontend
        // can treat uniformly (program_code/year_level always populated,
        // block_name null when the target is SPARE).
        foreach ($rows as &$row) {
            $isSpare = $row['spare_id'] !== null;
            $row['is_spare'] = $isSpare;
            // Lets the UI show "Instructor not assigned" without re-deriving it.
            $row['instructor_missing'] = $row['faculty_id'] === null;
            $row['program_code'] = $isSpare ? $row['spare_program_code'] : $row['block_program_code'];
            $row['year_level'] = $isSpare ? $row['spare_year_level'] : $row['block_year_level'];
            unset($row['block_program_code'], $row['block_year_level'], $row['spare_program_code'], $row['spare_year_level']);
        }
        unset($row);

        json_response(true, 'Schedules loaded', $rows);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_GET['mode'] ?? '') === 'offering') {
        $body = input_json();
        $result = save_subject_offering($pdo, $body);
        json_response(true, 'Subject offering saved successfully', $result, 201);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        validate_schedule($pdo, $d);
        $newId = insert_schedule($pdo, $d);
        if (!empty($d['assign_faculty_to_course'])) ensure_faculty_course($pdo, $d['faculty_id'] ?? 0, (int)$d['course_id']);
        json_response(true, 'Schedule plotted successfully', ['id' => $newId], 201);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);

        $existingStmt = $pdo->prepare('SELECT id FROM schedules WHERE id=?');
        $existingStmt->execute([$id]);
        if (!$existingStmt->fetch()) json_response(false, 'Schedule not found.', null, 404);

        validate_schedule($pdo, $d, $id);
        update_schedule($pdo, $d, $id);
        if (!empty($d['assign_faculty_to_course'])) ensure_faculty_course($pdo, $d['faculty_id'] ?? 0, (int)$d['course_id']);
        json_response(true, 'Schedule updated successfully');
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        $stmt = $pdo->prepare('DELETE FROM schedules WHERE id=?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) json_response(false, 'Schedule not found.', null, 404);
        json_response(true, 'Schedule deleted');
    }

    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) {
    json_response(false, friendly_db_error($e), null, 500);
}