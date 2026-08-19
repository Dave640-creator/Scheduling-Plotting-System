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
        $isActive = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : 1;
        $stmt = $pdo->prepare('INSERT INTO faculty(faculty_name,max_preparations,is_active) VALUES(?,?,?)');
        $stmt->execute([$d['faculty_name'], (int)($d['max_preparations'] ?? 4), $isActive]);
        json_response(true, 'Faculty added successfully', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['faculty_name']);
        $isActive = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : 1;
        $stmt = $pdo->prepare('UPDATE faculty SET faculty_name=?, max_preparations=?, is_active=? WHERE id=?');
        $stmt->execute([$d['faculty_name'], (int)($d['max_preparations'] ?? 4), $isActive, $id]);
        json_response(true, 'Faculty updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        $pdo->prepare('DELETE FROM faculty WHERE id=?')->execute([$id]);
        json_response(true, 'Faculty deleted');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
