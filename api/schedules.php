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
 * a lecture component or a non-major (minor) course. Lab components of
 * major courses are the ones that genuinely alternate week-to-week.
 */
function is_minor_or_lecture(string $component, string $category): bool {
    return $component === 'lecture' || $category !== 'major';
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

    if ($d['component'] === 'lecture' && (float)$course['lec_units'] <= 0) {
        json_response(false, 'This course has no lecture component.', null, 422);
    }
    if ($d['component'] === 'laboratory' && (float)$course['lab_units'] <= 0) {
        json_response(false, 'This course has no laboratory component.', null, 422);
    }

    // Important correction: 1 lab unit = 3 hours PER WEEK, not always 3 hours in one day.
    // MWF 1 hour = 3 hours/week, TTH 1.5 hours = 3 hours/week, etc.
    $meetingMinutes = minutes_between($start, $end);
    $dayCount = count(schedule_days($d['day_of_week']));
    if ($d['day_of_week'] === 'Custom') $dayCount = 1;
    $weeklyMinutes = $meetingMinutes * $dayCount;

    $requiredMinutes = $d['component'] === 'laboratory'
        ? (int)((float)$course['lab_units'] * 3 * 60)
        : (int)((float)$course['lec_units'] * 60);

    if ($weeklyMinutes < $requiredMinutes) {
        json_response(false, 'Weekly duration is too short. Required: ' . ($requiredMinutes / 60) . ' hour(s) per week. Your pattern gives only ' . ($weeklyMinutes / 60) . ' hour(s) per week.', null, 422);
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

    // SET logic: SET 0 is always face-to-face, so room is required.
    // SET 1 and SET 2 are hybrid classifications. The system stores the set but does not simulate week-by-week online/F2F rotation.
    $hasRoom = !empty($d['room_id']);
    if ($d['set_type'] === 'set_0' && !$hasRoom) {
        json_response(false, 'Room is required for SET 0 because it is always face-to-face.', null, 422);
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

        $rowIsExempt = is_minor_or_lecture($row['component'], $row['course_category']);
        if (!sets_conflict($d['set_type'], $row['set_type'], $newIsExempt, $rowIsExempt)) continue;

        if ((int)$row['faculty_id'] === (int)$d['faculty_id']) {
            json_response(false, 'Instructor conflict: this faculty already has a class at the selected day/time pattern.', null, 409);
        }
        if ((int)$row['section_id'] === (int)$d['section_id']) {
            json_response(false, 'Section conflict: this section already has a class at the selected day/time pattern.', null, 409);
        }
        if ($hasRoom && !empty($row['room_id']) && (int)$row['room_id'] === (int)$d['room_id']) {
            json_response(false, 'Room conflict: this room is already occupied at the selected day/time pattern.', null, 409);
        }
    }
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

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        validate_schedule($pdo, $d);
        $deliveryMode = $d['set_type'] === 'set_0' ? 'face_to_face' : 'online';
        $roomId = empty($d['room_id']) ? null : (int)$d['room_id'];
        $stmt = $pdo->prepare('INSERT INTO schedules(course_id,section_id,faculty_id,room_id,component,delivery_mode,set_type,school_year,day_of_week,start_time,end_time,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([(int)$d['course_id'],(int)$d['section_id'],(int)$d['faculty_id'],$roomId,$d['component'],$deliveryMode,$d['set_type'],$d['school_year'],$d['day_of_week'],$d['start_time'],$d['end_time'],$d['notes'] ?? null]);
        json_response(true, 'Schedule plotted successfully', ['id'=>$pdo->lastInsertId()], 201);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);

        $existingStmt = $pdo->prepare('SELECT id FROM schedules WHERE id=?');
        $existingStmt->execute([$id]);
        if (!$existingStmt->fetch()) json_response(false, 'Schedule not found.', null, 404);

        validate_schedule($pdo, $d, $id);
        $deliveryMode = $d['set_type'] === 'set_0' ? 'face_to_face' : 'online';
        $roomId = empty($d['room_id']) ? null : (int)$d['room_id'];
        $stmt = $pdo->prepare('UPDATE schedules SET course_id=?, section_id=?, faculty_id=?, room_id=?, component=?, delivery_mode=?, set_type=?, school_year=?, day_of_week=?, start_time=?, end_time=?, notes=? WHERE id=?');
        $stmt->execute([(int)$d['course_id'],(int)$d['section_id'],(int)$d['faculty_id'],$roomId,$d['component'],$deliveryMode,$d['set_type'],$d['school_year'],$d['day_of_week'],$d['start_time'],$d['end_time'],$d['notes'] ?? null,$id]);
        json_response(true, 'Schedule updated successfully');
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        $pdo->prepare('DELETE FROM schedules WHERE id=?')->execute([$id]);
        json_response(true, 'Schedule deleted');
    }

    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) {
    json_response(false, friendly_db_error($e), null, 500);
}
