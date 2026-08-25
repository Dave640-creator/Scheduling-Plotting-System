<?php
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query('SELECT * FROM courses ORDER BY year_level, semester_type, course_code')->fetchAll();
        json_response(true, 'Courses loaded', $rows);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['course_code','course_title','year_level','semester_type']);
        $yearLevel = require_valid_year_level($d['year_level']);
        $lecUnits = (float)($d['lec_units'] ?? 0);
        $labUnits = (float)($d['lab_units'] ?? 0);
        if ($lecUnits < 0 || $labUnits < 0) {
            json_response(false, 'Lecture and laboratory units cannot be negative.', null, 422);
        }
        if ($lecUnits <= 0 && $labUnits <= 0) {
            json_response(false, 'A course must have at least a lecture or a laboratory unit greater than 0.', null, 422);
        }
        $stmt = $pdo->prepare('INSERT INTO courses(course_code,course_title,year_level,semester_type,lec_units,lab_units,category) VALUES(?,?,?,?,?,?,?)');
        $stmt->execute([$d['course_code'],$d['course_title'],$yearLevel,$d['semester_type'],$lecUnits,$labUnits,$d['category']??'major']);
        json_response(true, 'Course added successfully', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['course_code','course_title','year_level','semester_type']);
        $yearLevel = require_valid_year_level($d['year_level']);

        $lecUnits = (float)($d['lec_units'] ?? 0);
        $labUnits = (float)($d['lab_units'] ?? 0);
        if ($lecUnits < 0 || $labUnits < 0) {
            json_response(false, 'Lecture and laboratory units cannot be negative.', null, 422);
        }
        if ($lecUnits <= 0 && $labUnits <= 0) {
            json_response(false, 'A course must have at least a lecture or a laboratory unit greater than 0.', null, 422);
        }

        $currentStmt = $pdo->prepare('SELECT * FROM courses WHERE id=?');
        $currentStmt->execute([$id]);
        $current = $currentStmt->fetch();
        if (!$current) json_response(false, 'Course not found.', null, 404);

        $newCategory = $d['category'] ?? 'major';

        // Lecture/lab units, year level, semester, and category are exactly
        // the fields an existing schedule's validity depends on (required
        // weekly hours, which component is allowed, which section year
        // level it can be plotted for, and -- for category -- the SET1/SET2
        // alternating-week conflict exemption rule in schedules.php's
        // is_minor_or_lecture()). If any of these change while schedules
        // already reference this course, those schedules could silently
        // become inconsistent with the (now-edited) course record. Block
        // the edit instead -- Option A from the bug report -- and ask for
        // the schedules to be dealt with first.
        $structuralChanged =
            abs((float)$current['lec_units'] - $lecUnits) > 0.0001 ||
            abs((float)$current['lab_units'] - $labUnits) > 0.0001 ||
            (int)$current['year_level'] !== $yearLevel ||
            $current['semester_type'] !== $d['semester_type'] ||
            $current['category'] !== $newCategory;

        if ($structuralChanged) {
            $countStmt = $pdo->prepare('SELECT COUNT(*) FROM schedules WHERE course_id=?');
            $countStmt->execute([$id]);
            if ((int)$countStmt->fetchColumn() > 0) {
                json_response(false, 'Cannot change lecture/laboratory units, year level, semester, or category for this course because it already has plotted schedules. Delete or update those schedules first, then edit the course.', null, 422);
            }
        }

        $stmt = $pdo->prepare('UPDATE courses SET course_code=?, course_title=?, year_level=?, semester_type=?, lec_units=?, lab_units=?, category=? WHERE id=?');
        $stmt->execute([$d['course_code'],$d['course_title'],$yearLevel,$d['semester_type'],$lecUnits,$labUnits,$newCategory,$id]);
        json_response(true, 'Course updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        $stmt = $pdo->prepare('DELETE FROM courses WHERE id=?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) json_response(false, 'Course not found.', null, 404);
        json_response(true, 'Course deleted');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
