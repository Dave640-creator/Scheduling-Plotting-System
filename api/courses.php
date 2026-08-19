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
        $stmt = $pdo->prepare('INSERT INTO courses(course_code,course_title,year_level,semester_type,lec_units,lab_units,category) VALUES(?,?,?,?,?,?,?)');
        $stmt->execute([$d['course_code'],$d['course_title'],(int)$d['year_level'],$d['semester_type'],(float)($d['lec_units']??0),(float)($d['lab_units']??0),$d['category']??'major']);
        json_response(true, 'Course added successfully', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['course_code','course_title','year_level','semester_type']);
        $stmt = $pdo->prepare('UPDATE courses SET course_code=?, course_title=?, year_level=?, semester_type=?, lec_units=?, lab_units=?, category=? WHERE id=?');
        $stmt->execute([$d['course_code'],$d['course_title'],(int)$d['year_level'],$d['semester_type'],(float)($d['lec_units']??0),(float)($d['lab_units']??0),$d['category']??'major',$id]);
        json_response(true, 'Course updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        $pdo->prepare('DELETE FROM courses WHERE id=?')->execute([$id]);
        json_response(true, 'Course deleted');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
