<?php
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query('SELECT * FROM sections ORDER BY year_level, section_no')->fetchAll();
        json_response(true, 'Sections loaded', $rows);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['year_level','section_no','student_count']);
        if ((int)$d['student_count'] > 30) json_response(false, 'BSCS maximum student per section is 30.', null, 422);
        $stmt = $pdo->prepare('INSERT INTO sections(program_code,year_level,section_no,student_count) VALUES(?,?,?,?)');
        $stmt->execute([$d['program_code'] ?? 'BSCS',(int)$d['year_level'],$d['section_no'],(int)$d['student_count']]);
        json_response(true, 'Section added successfully', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['year_level','section_no','student_count']);
        if ((int)$d['student_count'] > 30) json_response(false, 'BSCS maximum student per section is 30.', null, 422);
        $stmt = $pdo->prepare('UPDATE sections SET program_code=?, year_level=?, section_no=?, student_count=? WHERE id=?');
        $stmt->execute([$d['program_code'] ?? 'BSCS',(int)$d['year_level'],$d['section_no'],(int)$d['student_count'],$id]);
        json_response(true, 'Section updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        $pdo->prepare('DELETE FROM sections WHERE id=?')->execute([$id]);
        json_response(true, 'Section deleted');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
