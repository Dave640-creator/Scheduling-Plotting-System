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
        $isActive = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : 1;
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
        $isActive = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : 1;
        $existsStmt = $pdo->prepare('SELECT id FROM faculty WHERE id=?');
        $existsStmt->execute([$id]);
        if (!$existsStmt->fetch()) json_response(false, 'Faculty not found.', null, 404);
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
