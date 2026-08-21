<?php
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query('SELECT * FROM rooms ORDER BY room_type, room_name')->fetchAll();
        json_response(true, 'Rooms loaded', $rows);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['room_name','room_type','capacity']);
        $capacity = (int)$d['capacity'];
        if ($capacity <= 0) json_response(false, 'Room capacity must be a positive number.', null, 422);
        $isActive = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : 1;
        $stmt = $pdo->prepare('INSERT INTO rooms(room_name,room_type,capacity,is_active) VALUES(?,?,?,?)');
        $stmt->execute([$d['room_name'],$d['room_type'],$capacity,$isActive]);
        json_response(true, 'Room added successfully', ['id'=>$pdo->lastInsertId()], 201);
    }
    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['room_name','room_type','capacity']);
        $capacity = (int)$d['capacity'];
        if ($capacity <= 0) json_response(false, 'Room capacity must be a positive number.', null, 422);
        $isActive = array_key_exists('is_active', $d) ? (int)!!$d['is_active'] : 1;
        $existsStmt = $pdo->prepare('SELECT id FROM rooms WHERE id=?');
        $existsStmt->execute([$id]);
        if (!$existsStmt->fetch()) json_response(false, 'Room not found.', null, 404);
        $stmt = $pdo->prepare('UPDATE rooms SET room_name=?, room_type=?, capacity=?, is_active=? WHERE id=?');
        $stmt->execute([$d['room_name'],$d['room_type'],$capacity,$isActive,$id]);
        json_response(true, 'Room updated successfully');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        $stmt = $pdo->prepare('DELETE FROM rooms WHERE id=?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) json_response(false, 'Room not found.', null, 404);
        json_response(true, 'Room deleted');
    }
    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
