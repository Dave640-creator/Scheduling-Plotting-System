<?php
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query('SELECT * FROM faculty ORDER BY faculty_name')->fetchAll();
        json_response(true, 'Faculty loaded', $rows);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['faculty_name']);
        $maxPreparations = (int)($d['max_preparations'] ?? 4);
        if ($maxPreparations < 1 || $maxPreparations > 20) {
            json_response(false, 'Max preparations must be between 1 and 20.', null, 422);
        }
        $isActive = array_key_exists('is_active', $d) ? require_strict_bool_int($d['is_active'], 'is_active') : 1;
        $stmt = $pdo->prepare('INSERT INTO faculty(faculty_name,max_preparations,is_active) VALUES(?,?,?)');
        $stmt->execute([$d['faculty_name'], $maxPreparations, $isActive]);
        json_response(true, 'Faculty added successfully', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['faculty_name']);
        $maxPreparations = (int)($d['max_preparations'] ?? 4);
        if ($maxPreparations < 1 || $maxPreparations > 20) {
            json_response(false, 'Max preparations must be between 1 and 20.', null, 422);
        }
        $isActive = array_key_exists('is_active', $d) ? require_strict_bool_int($d['is_active'], 'is_active') : 1;
        $existsStmt = $pdo->prepare('SELECT id, max_preparations FROM faculty WHERE id=?');
        $existsStmt->execute([$id]);
        $current = $existsStmt->fetch();
        if (!$current) json_response(false, 'Faculty not found.', null, 404);

        // Preparations are counted per school_year + semester (see
        // schedules.php validate_schedule()), so a lowered max must be
        // checked against every term the faculty currently has schedules
        // in -- not just an overall total -- otherwise a faculty already at
        // e.g. 4/4 in one term could end up 4 existing / 2 allowed the
        // moment the max is reduced.
        if ($maxPreparations < (int)$current['max_preparations']) {
            $loadStmt = $pdo->prepare(
                'SELECT sch.school_year, c2.semester_type, COUNT(DISTINCT sch.course_id) AS prep_count
                 FROM schedules sch JOIN courses c2 ON c2.id = sch.course_id
                 WHERE sch.faculty_id=?
                 GROUP BY sch.school_year, c2.semester_type
                 HAVING COUNT(DISTINCT sch.course_id) > ?'
            );
            $loadStmt->execute([$id, $maxPreparations]);
            $overloaded = $loadStmt->fetchAll();
            if (!empty($overloaded)) {
                $semLabels = ['first_semester' => 'First Semester', 'second_semester' => 'Second Semester', 'summer' => 'Summer'];
                $labels = array_map(fn($row) => $row['school_year'] . ' (' . ($semLabels[$row['semester_type']] ?? $row['semester_type']) . '): ' . $row['prep_count'] . ' existing', $overloaded);
                json_response(false, 'Cannot lower max preparations to ' . $maxPreparations . ': this faculty already exceeds that limit in ' . implode(', ', $labels) . '. Reassign or remove schedules first.', null, 422);
            }
        }

        $stmt = $pdo->prepare('UPDATE faculty SET faculty_name=?, max_preparations=?, is_active=? WHERE id=?');
        $stmt->execute([$d['faculty_name'], $maxPreparations, $isActive, $id]);
        json_response(true, 'Faculty updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        $stmt = $pdo->prepare('DELETE FROM faculty WHERE id=?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) json_response(false, 'Faculty not found.', null, 404);
        json_response(true, 'Faculty deleted');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
