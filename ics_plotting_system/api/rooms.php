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
        $isActive = array_key_exists('is_active', $d) ? require_strict_bool_int($d['is_active'], 'is_active') : 1;
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
        $isActive = array_key_exists('is_active', $d) ? require_strict_bool_int($d['is_active'], 'is_active') : 1;
        $existsStmt = $pdo->prepare('SELECT id, room_type, capacity FROM rooms WHERE id=?');
        $existsStmt->execute([$id]);
        $current = $existsStmt->fetch();
        if (!$current) json_response(false, 'Room not found.', null, 404);

        // Capacity or room type are exactly the fields an existing schedule's
        // validity depends on (whether the room can still fit the section,
        // and whether it still matches the lecture/laboratory requirement).
        // If either changes while the room is already assigned to a
        // schedule, that schedule could silently become invalid. Block the
        // edit and ask for the affected schedules to be reassigned first,
        // the same pattern already used for course structural edits.
        $typeOrCapacityChanged = $current['room_type'] !== $d['room_type'] || (int)$current['capacity'] !== $capacity;
        if ($typeOrCapacityChanged) {
            $affectedStmt = $pdo->prepare(
                'SELECT s.id, c.course_code, sec.program_code, sec.year_level, sec.section_no, sec.student_count, s.component
                 FROM schedules s JOIN courses c ON c.id=s.course_id JOIN sections sec ON sec.id=s.section_id
                 WHERE s.room_id=?'
            );
            $affectedStmt->execute([$id]);
            $affected = $affectedStmt->fetchAll();
            $invalidated = array_filter($affected, function ($row) use ($d, $capacity) {
                $wouldBeTooSmall = (int)$row['student_count'] > $capacity;
                $wouldBeWrongType = $row['component'] === 'laboratory' ? $d['room_type'] !== 'laboratory' : $d['room_type'] !== 'lecture';
                return $wouldBeTooSmall || $wouldBeWrongType;
            });
            if (!empty($invalidated)) {
                $labels = array_map(fn($row) => $row['course_code'] . ' (' . $row['program_code'] . ' ' . $row['year_level'] . '-' . $row['section_no'] . ')', $invalidated);
                json_response(false, 'Cannot change room type/capacity: it would invalidate ' . count($invalidated) . ' existing schedule(s) using this room -- ' . implode(', ', $labels) . '. Reassign those schedules to a different room first.', null, 422);
            }
        }

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
