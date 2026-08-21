<?php
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $facultyId = (int)($_GET['faculty_id'] ?? 0);
        $courseId = (int)($_GET['course_id'] ?? 0);

        if ($facultyId) {
            $stmt = $pdo->prepare('SELECT c.* FROM faculty_courses fc JOIN courses c ON c.id=fc.course_id WHERE fc.faculty_id=? ORDER BY c.course_code');
            $stmt->execute([$facultyId]);
            json_response(true, 'Allowed courses loaded', $stmt->fetchAll());
        }

        if ($courseId) {
            $stmt = $pdo->prepare('SELECT f.* FROM faculty_courses fc JOIN faculty f ON f.id=fc.faculty_id WHERE fc.course_id=? ORDER BY f.faculty_name');
            $stmt->execute([$courseId]);
            json_response(true, 'Qualified faculty loaded', $stmt->fetchAll());
        }

        $rows = $pdo->query('SELECT fc.id, fc.faculty_id, fc.course_id, fc.created_at, f.faculty_name, c.course_code, c.course_title FROM faculty_courses fc JOIN faculty f ON f.id=fc.faculty_id JOIN courses c ON c.id=fc.course_id ORDER BY f.faculty_name, c.course_code')->fetchAll();
        json_response(true, 'Faculty course assignments loaded', $rows);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['faculty_id','course_id']);
        $facultyId = (int)$d['faculty_id'];
        $courseId = (int)$d['course_id'];

        // Check for the duplicate ourselves first so we can name the
        // faculty/course involved, instead of surfacing a generic database
        // constraint error only after the insert is attempted (bug #7).
        $dupStmt = $pdo->prepare('SELECT f.faculty_name, c.course_code FROM faculty_courses fc
            JOIN faculty f ON f.id = fc.faculty_id JOIN courses c ON c.id = fc.course_id
            WHERE fc.faculty_id=? AND fc.course_id=?');
        $dupStmt->execute([$facultyId, $courseId]);
        if ($dup = $dupStmt->fetch()) {
            json_response(false, $dup['faculty_name'] . ' is already assigned to ' . $dup['course_code'] . '.', null, 422);
        }

        $stmt = $pdo->prepare('INSERT INTO faculty_courses(faculty_id,course_id) VALUES(?,?)');
        $stmt->execute([$facultyId, $courseId]);
        json_response(true, 'Course assigned to faculty', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['faculty_id','course_id']);
        $facultyId = (int)$d['faculty_id'];
        $courseId = (int)$d['course_id'];

        $dupStmt = $pdo->prepare('SELECT f.faculty_name, c.course_code FROM faculty_courses fc
            JOIN faculty f ON f.id = fc.faculty_id JOIN courses c ON c.id = fc.course_id
            WHERE fc.faculty_id=? AND fc.course_id=? AND fc.id<>?');
        $dupStmt->execute([$facultyId, $courseId, $id]);
        if ($dup = $dupStmt->fetch()) {
            json_response(false, $dup['faculty_name'] . ' is already assigned to ' . $dup['course_code'] . '.', null, 422);
        }

        $stmt = $pdo->prepare('UPDATE faculty_courses SET faculty_id=?, course_id=? WHERE id=?');
        $stmt->execute([$facultyId, $courseId, $id]);
        json_response(true, 'Assignment updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        $stmt = $pdo->prepare('DELETE FROM faculty_courses WHERE id=?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) json_response(false, 'Faculty course assignment not found.', null, 404);
        json_response(true, 'Faculty course assignment removed');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
