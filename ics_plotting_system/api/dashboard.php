<?php
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    $data = [
        'courses' => (int)$pdo->query('SELECT COUNT(*) FROM courses')->fetchColumn(),
        'sections' => (int)$pdo->query('SELECT COUNT(*) FROM sections')->fetchColumn(),
        'faculty' => (int)$pdo->query('SELECT COUNT(*) FROM faculty')->fetchColumn(),
        'rooms' => (int)$pdo->query('SELECT COUNT(*) FROM rooms')->fetchColumn(),
        'schedules' => (int)$pdo->query('SELECT COUNT(*) FROM schedules')->fetchColumn(),
    ];
    json_response(true, 'Dashboard loaded', $data);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
