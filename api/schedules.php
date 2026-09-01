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
 * A course/component is exempt from the SET_1/SET_2 alternation rule (i.e.
 * it still conflicts even against the "opposite" alternating set) when it's
 * a lecture component or one of these specific non-alternating minor
 * categories (GE, PATHFIT, NSTP, LuxMundi) -- these meet every week, not on
 * alternating weeks, so SET 1 and SET 2 of one of these still coincide.
 * Deliberately NOT "any non-major category": electives (and "other") can
 * have real major-style lab components (e.g. ESC 211/221/312/321/322/323/
 * 412/413) that DO alternate week-to-week like a major's lab, so treating
 * every non-major category as exempt would incorrectly block a valid
 * SET1/SET2 elective-lab pairing.
 */
const NON_ALTERNATING_MINOR_CATEGORIES = ['ge', 'pathfit', 'nstp', 'luxmundi'];

/**
 * Which SET types a section's year level is allowed to use. Per the actual
 * school business rules: 1st and 4th year sections rotate on SET 1
 * (F2F Week 1 / Online Week 2), while 2nd and 3rd year sections rotate on
 * the opposite pattern, SET 2 (Online Week 1 / F2F Week 2). SET 0
 * (always face-to-face) is available to every year level. This is
 * intentionally NOT "any year can use any SET" -- a 1st year section
 * submitting SET 2, for example, must be rejected.
 */
const ALLOWED_SET_TYPES_BY_YEAR_LEVEL = [
    1 => ['set_0', 'set_1'],
    2 => ['set_0', 'set_2'],
    3 => ['set_0', 'set_2'],
    4 => ['set_0', 'set_1'],
];

const SET_TYPE_LABELS = ['set_0' => 'SET 0', 'set_1' => 'SET 1', 'set_2' => 'SET 2'];

function is_minor_or_lecture(string $component, string $category): bool {
    return $component === 'lecture' || in_array($category, NON_ALTERNATING_MINOR_CATEGORIES, true);
}

/**
 * SET-aware conflict rule for two schedules that already overlap in day/time:
 * - SET 0 is always face-to-face, so it conflicts with anything.
 * - The same alternating set (SET 1 + SET 1, or SET 2 + SET 2) always
 *   coincides on the same weeks, so it conflicts.
 * - SET 1 + SET 2 alternate on opposite weeks and are NOT physically
 *   simultaneous -- UNLESS either side is a lecture component or a minor
 *   course, in which case it still conflicts.
 */
function sets_conflict(string $setA, string $setB, bool $exemptA, bool $exemptB): bool {
    if ($setA === 'set_0' || $setB === 'set_0') return true;
    if ($setA === $setB) return true;
    return $exemptA || $exemptB;
}

function validate_schedule(PDO $pdo, array $d, ?int $ignoreId = null): void {
    require_fields($d, ['course_id','section_id','faculty_id','component','set_type','day_of_week','start_time','end_time','school_year']);

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
            json_response(false, 'Please select at least one valid day of the week.', null, 422);
        }
        // The frontend's checkbox UI can't submit the same day twice, but a
        // direct API call could send e.g. "Monday,Monday,Wednesday". Without
        // this check, the duplicate would inflate $dayCount below and let a
        // schedule pass the weekly-hours requirement with fewer distinct
        // meeting days than actually required (bug #12).
        if (count($submittedDays) !== count(array_unique($submittedDays))) {
            json_response(false, 'Duplicate days are not allowed in the day pattern.', null, 422);
        }
    }

    $courseStmt = $pdo->prepare('SELECT * FROM courses WHERE id=?');
    $courseStmt->execute([(int)$d['course_id']]);
    $course = $courseStmt->fetch();
    if (!$course) json_response(false, 'Course not found.', null, 404);

    $sectionStmt = $pdo->prepare('SELECT * FROM sections WHERE id=?');
    $sectionStmt->execute([(int)$d['section_id']]);
    $section = $sectionStmt->fetch();
    if (!$section) json_response(false, 'Section not found.', null, 404);

    // A course belongs to exactly one curriculum year level in this system's
    // design, so plotting it for a section of a different year level is
    // almost always a data-entry mistake (e.g. picking a 4th year elective
    // for a 1st year block section).
    if ((int)$course['year_level'] !== (int)$section['year_level']) {
        json_response(false, 'Year level mismatch: "' . $course['course_code'] . '" is a Year ' . $course['year_level'] . ' course, but the selected section is Year ' . $section['year_level'] . '.', null, 422);
    }

    // Year-level -> allowed SET type validation. This is enforced here in
    // the backend regardless of what the frontend hides, since a direct API
    // call (or stale UI state) must never be able to plot an invalid
    // SET/year-level combination.
    $sectionYearLevel = (int)$section['year_level'];
    $allowedSetTypes = ALLOWED_SET_TYPES_BY_YEAR_LEVEL[$sectionYearLevel] ?? ['set_0'];
    if (!in_array($d['set_type'], $allowedSetTypes, true)) {
        $allowedLabels = implode(' or ', array_map(fn($s) => SET_TYPE_LABELS[$s] ?? $s, $allowedSetTypes));
        $submittedLabel = SET_TYPE_LABELS[$d['set_type']] ?? $d['set_type'];
        json_response(
            false,
            'Invalid SET for this section: Year ' . $sectionYearLevel . ' sections may only use ' . $allowedLabels . '. "' . $submittedLabel . '" is not allowed.',
            null,
            422
        );
    }

    if ($d['component'] === 'lecture' && (float)$course['lec_units'] <= 0) {
        json_response(false, 'This course has no lecture component.', null, 422);
    }
    if ($d['component'] === 'laboratory' && (float)$course['lab_units'] <= 0) {
        json_response(false, 'This course has no laboratory component.', null, 422);
    }

    // Single source of truth for weekly-hour requirements in this app:
    // 1 UNIT = 1 HOUR PER WEEK, for BOTH lecture and laboratory units. This
    // deliberately does NOT follow the common college rule of "1 laboratory
    // unit = 3 hours"; that rule does not apply here. A 3-unit course is
    // required to total 3 hours/week regardless of component -- e.g. MWF x
    // 1 hour = 3 hours/week, or TTH x 1.5 hours = 3 hours/week. Mirrored in
    // assets/js/app.js's componentRequiredWeeklyMinutes() -- keep both in
    // sync if this ever changes.
    $meetingMinutes = minutes_between($start, $end);
    $dayCount = count(schedule_days($d['day_of_week']));
    if ($d['day_of_week'] === 'Custom') $dayCount = 1;
    $weeklyMinutes = $meetingMinutes * $dayCount;

    $requiredMinutes = $d['component'] === 'laboratory'
        ? (int)((float)$course['lab_units'] * 60)
        : (int)((float)$course['lec_units'] * 60);

    // The schedule must MATCH the required weekly hours exactly -- not just
    // meet or exceed them. A 2-unit course scheduled for 3 hours/week (e.g.
    // MWF x 1 hour when only TTH x 1 hour is correct) is just as invalid as
    // one scheduled for too little, so this checks !=, not just <.
    if ($weeklyMinutes !== $requiredMinutes) {
        $tooShort = $weeklyMinutes < $requiredMinutes;
        json_response(
            false,
            'Schedule does not meet the required weekly hours. Required: ' . ($requiredMinutes / 60) . ' hour(s) per week. Selected pattern totals ' . ($weeklyMinutes / 60) . ' hour(s) per week (' . ($tooShort ? 'too short' : 'exceeds the requirement') . ').',
            null,
            422
        );
    }

    $facultyStmt = $pdo->prepare('SELECT * FROM faculty WHERE id=?');
    $facultyStmt->execute([(int)$d['faculty_id']]);
    $faculty = $facultyStmt->fetch();
    if (!$faculty) json_response(false, 'Faculty not found.', null, 404);

    $allowedStmt = $pdo->prepare('SELECT COUNT(*) FROM faculty_courses WHERE faculty_id=? AND course_id=?');
    $allowedStmt->execute([(int)$d['faculty_id'], (int)$d['course_id']]);
    if ((int)$allowedStmt->fetchColumn() === 0) {
        json_response(false, 'Faculty is not assigned/allowed to teach this course. Assign the course to the faculty first in Faculty Courses.', null, 422);
    }

    // Instructor consistency + duplicate-component check: a course's Lecture
    // and Laboratory components, for the same section and school year, are
    // the same class split across two meeting types -- they must be taught
    // by the same instructor, and each component may only be plotted once
    // per course+section+school year (bug/requirement: "do not duplicate
    // components"). Both checks are done against ALL sibling rows (not just
    // the first one found), so a course that already has both Lecture and
    // Laboratory plotted is checked correctly against either. This is
    // checked regardless of which component was plotted first. The frontend
    // already inherits/locks the faculty field and hides already-plotted
    // components in the normal flow; this is the authoritative backend
    // check (and the fallback for stale UI state / direct API calls / the
    // batched "subject offering" save).
    $siblingSql = 'SELECT s.id, s.faculty_id, s.component, f.faculty_name
                   FROM schedules s JOIN faculty f ON f.id = s.faculty_id
                   WHERE s.course_id=? AND s.section_id=? AND s.school_year=?';
    $siblingParams = [(int)$d['course_id'], (int)$d['section_id'], $d['school_year']];
    if ($ignoreId) { $siblingSql .= ' AND s.id<>?'; $siblingParams[] = $ignoreId; }
    $siblingStmt = $pdo->prepare($siblingSql);
    $siblingStmt->execute($siblingParams);
    $siblingSchedules = $siblingStmt->fetchAll();

    $sectionLabel = $section['program_code'] . ' ' . $section['year_level'] . '-' . $section['section_no'];

    foreach ($siblingSchedules as $siblingSchedule) {
        if ($siblingSchedule['component'] === $d['component']) {
            json_response(
                false,
                $course['course_code'] . ' already has a ' . ucfirst($siblingSchedule['component']) . ' schedule for ' . $sectionLabel . ' in ' . $d['school_year'] . '. Edit the existing schedule instead of creating another one for the same component.',
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

    foreach ($siblingSchedules as $siblingSchedule) {
        if ((int)$siblingSchedule['faculty_id'] !== (int)$d['faculty_id']) {
            json_response(
                false,
                $course['course_code'] . ' for ' . $sectionLabel . ' is already assigned to ' . $siblingSchedule['faculty_name'] . '. Lecture and Laboratory must use the same instructor.',
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

    if ((int)$faculty['is_active'] === 0) {
        $facultyUnchanged = $existingSchedule && (int)$existingSchedule['faculty_id'] === (int)$d['faculty_id'];
        if (!$facultyUnchanged) {
            json_response(false, 'This faculty is marked unavailable and cannot be assigned new schedules. Reactivate them in Faculty Management first.', null, 422);
        }
    }

    // Preparations are counted per term (same school year + same semester the
    // course belongs to), not across the faculty's entire history -- otherwise
    // a faculty's load from past semesters would permanently count against them.
    $prepSql = 'SELECT COUNT(DISTINCT sch.course_id) FROM schedules sch JOIN courses c2 ON c2.id = sch.course_id
                WHERE sch.faculty_id=? AND sch.school_year=? AND c2.semester_type=?';
    $prepParams = [(int)$d['faculty_id'], $d['school_year'], $course['semester_type']];
    if ($ignoreId) { $prepSql .= ' AND sch.id<>?'; $prepParams[] = $ignoreId; }
    $prepStmt = $pdo->prepare($prepSql);
    $prepStmt->execute($prepParams);
    $currentPreparations = (int)$prepStmt->fetchColumn();

    $courseAlreadySql = 'SELECT COUNT(*) FROM schedules WHERE faculty_id=? AND course_id=? AND school_year=?';
    $courseAlreadyParams = [(int)$d['faculty_id'], (int)$d['course_id'], $d['school_year']];
    if ($ignoreId) { $courseAlreadySql .= ' AND id<>?'; $courseAlreadyParams[] = $ignoreId; }
    $courseAlreadyStmt = $pdo->prepare($courseAlreadySql);
    $courseAlreadyStmt->execute($courseAlreadyParams);
    $isNewPreparation = ((int)$courseAlreadyStmt->fetchColumn() === 0);
    $maxPreparations = (int)$faculty['max_preparations'];
    if ($isNewPreparation && $currentPreparations >= $maxPreparations) {
        json_response(false, 'Faculty preparation limit exceeded. Maximum is ' . $maxPreparations . ' unique course preparation(s) for this faculty for ' . $d['school_year'] . ' (' . $course['semester_type'] . ').', null, 422);
    }

    // SET logic: SET 0 is always face-to-face, so a room is required. SET 1
    // and SET 2 are hybrid, NOT permanently online -- they still have a
    // face-to-face week every other week, so a room is required for them
    // too. The system stores the set but does not simulate week-by-week
    // online/F2F rotation; the room on file is the one used during that
    // component's F2F weeks.
    $hasRoom = !empty($d['room_id']);
    if (!$hasRoom) {
        $roomRequiredReason = $d['set_type'] === 'set_0'
            ? 'Room is required for SET 0 because it is always face-to-face.'
            : 'Room is required for ' . (SET_TYPE_LABELS[$d['set_type']] ?? $d['set_type']) . ' because it still meets face-to-face during its F2F week.';
        json_response(false, $roomRequiredReason, null, 422);
    }

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
        if ((int)$section['student_count'] > (int)$room['capacity']) {
            json_response(false, 'Room capacity is not enough for this section.', null, 422);
        }
    }

    $newIsExempt = is_minor_or_lecture($d['component'], $course['category']);

    // Conflicts only matter within the same term -- a room/faculty/section
    // occupied at this day/time in a different school year, or a different
    // semester of the same year, is not actually double-booked.
    $sql = 'SELECT s.*, c.category AS course_category FROM schedules s JOIN courses c ON c.id = s.course_id
            WHERE NOT (s.end_time<=? OR s.start_time>=?) AND s.school_year=? AND c.semester_type=?';
    $params = [$start, $end, $d['school_year'], $course['semester_type']];
    if ($ignoreId) { $sql .= ' AND s.id<>?'; $params[] = $ignoreId; }
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $existing = $stmt->fetchAll();

    foreach ($existing as $row) {
        if (!schedules_share_day($row['day_of_week'], $d['day_of_week'])) continue;

        // The SET 1/SET 2 alternating-week exception is a PHYSICAL ROOM
        // exception only (rule: opposite F2F/Online rotation means the room
        // is free on alternating weeks). It must never be used to bypass an
        // instructor or section double-booking -- those are checked here
        // unconditionally, regardless of which SETs are involved.
        if ((int)$row['faculty_id'] === (int)$d['faculty_id']) {
            json_response(false, 'Instructor conflict: this faculty already has a class at the selected day/time pattern.', null, 409);
        }
        if ((int)$row['section_id'] === (int)$d['section_id']) {
            json_response(false, 'Section conflict: this section already has a class at the selected day/time pattern.', null, 409);
        }
        if ($hasRoom && !empty($row['room_id']) && (int)$row['room_id'] === (int)$d['room_id']) {
            $rowIsExempt = is_minor_or_lecture($row['component'], $row['course_category']);
            if (sets_conflict($d['set_type'], $row['set_type'], $newIsExempt, $rowIsExempt)) {
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
    $stmt = $pdo->prepare('INSERT INTO schedules(course_id,section_id,faculty_id,room_id,component,delivery_mode,set_type,school_year,day_of_week,start_time,end_time,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    $stmt->execute([(int)$d['course_id'],(int)$d['section_id'],(int)$d['faculty_id'],$roomId,$d['component'],$deliveryMode,$d['set_type'],$d['school_year'],$d['day_of_week'],$d['start_time'],$d['end_time'],$d['notes'] ?? null]);
    return (int)$pdo->lastInsertId();
}

function update_schedule(PDO $pdo, array $d, int $id): void {
    $deliveryMode = delivery_mode_for_set_type($d['set_type']);
    $roomId = empty($d['room_id']) ? null : (int)$d['room_id'];
    $stmt = $pdo->prepare('UPDATE schedules SET course_id=?, section_id=?, faculty_id=?, room_id=?, component=?, delivery_mode=?, set_type=?, school_year=?, day_of_week=?, start_time=?, end_time=?, notes=? WHERE id=?');
    $stmt->execute([(int)$d['course_id'],(int)$d['section_id'],(int)$d['faculty_id'],$roomId,$d['component'],$deliveryMode,$d['set_type'],$d['school_year'],$d['day_of_week'],$d['start_time'],$d['end_time'],$d['notes'] ?? null,$id]);
}

/**
 * "SUBJECT OFFERING" one-save workflow: plots every required component
 * (Lecture, and Laboratory when the course has lab units) for one
 * Course + Section + School Year in a single atomic request instead of the
 * scheduler having to submit Lecture, then separately hunt down the same
 * course+section again to submit Laboratory.
 *
 * Request body:
 *   {
 *     course_id, section_id, faculty_id, school_year,
 *     components: [
 *       { component: 'lecture'|'laboratory', room_id?, set_type, day_of_week, start_time, end_time, notes?, id? },
 *       ...
 *     ]
 *   }
 *
 * A component entry with an "id" updates that existing schedule row (used
 * when re-opening the form to fix a component that was already saved
 * earlier); an entry without "id" creates a new one. Components already
 * saved for this course+section+school year that are simply left out of the
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
    require_fields($body, ['course_id', 'section_id', 'faculty_id', 'school_year']);
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
    $existingStmt = $pdo->prepare('SELECT id, component FROM schedules WHERE course_id=? AND section_id=? AND school_year=?');
    $existingStmt->execute([(int)$body['course_id'], (int)$body['section_id'], $body['school_year']]);
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
            'section_id' => (int)$body['section_id'],
            'faculty_id' => (int)$body['faculty_id'],
            'school_year' => $body['school_year'],
            'component' => $c['component'],
            'set_type' => $c['set_type'] ?? 'set_0',
            'day_of_week' => $c['day_of_week'] ?? '',
            'start_time' => $c['start_time'] ?? '',
            'end_time' => $c['end_time'] ?? '',
            'room_id' => $c['room_id'] ?? null,
            'notes' => $c['notes'] ?? null,
        ];
        $componentId = isset($c['id']) && $c['id'] ? (int)$c['id'] : null;

        // Ownership check: the submitted id must actually be the row for
        // THIS course + section + school year + component. Without this,
        // a stale/tampered/mismatched id in the request could make an
        // offering for Course A silently overwrite an unrelated schedule
        // row belonging to a completely different course/section -- the
        // same "never trust the frontend alone" principle already applied
        // to the instructor-consistency rule.
        if ($componentId) {
            $ownerStmt = $pdo->prepare('SELECT course_id, section_id, school_year, component FROM schedules WHERE id=?');
            $ownerStmt->execute([$componentId]);
            $owner = $ownerStmt->fetch();
            if (!$owner) {
                $pdo->rollBack();
                json_response(false, 'Schedule #' . $componentId . ' was not found.', null, 404);
            }
            $belongsToOffering = (int)$owner['course_id'] === (int)$body['course_id']
                && (int)$owner['section_id'] === (int)$body['section_id']
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
    $pdo->commit();

    return ['course_code' => $course['course_code'], 'components' => $results];
}

try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query("SELECT s.*, c.course_code, c.course_title, c.semester_type, c.category, sec.program_code, sec.year_level, sec.section_no, f.faculty_name, r.room_name
            FROM schedules s
            JOIN courses c ON c.id=s.course_id
            JOIN sections sec ON sec.id=s.section_id
            JOIN faculty f ON f.id=s.faculty_id
            LEFT JOIN rooms r ON r.id=s.room_id
            ORDER BY s.day_of_week, s.start_time")->fetchAll();
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
