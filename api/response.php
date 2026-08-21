<?php
header('Content-Type: application/json; charset=utf-8');

// This app is same-origin only (the frontend calls these endpoints from the
// same host it's served from, using credentials: 'same-origin' -- see
// assets/js/app.js). A wildcard 'Access-Control-Allow-Origin: *' is
// unnecessarily permissive for an app that relies on session-cookie
// authentication: it has no legitimate use here and only widens the attack
// surface if the frontend's fetch options ever change. Only echo back the
// Origin header (enabling CORS) when it actually matches this server's own
// origin; otherwise omit CORS headers entirely so cross-origin pages cannot
// read responses.
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$selfOrigin = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin !== '' && $requestOrigin === $selfOrigin) {
    header('Access-Control-Allow-Origin: ' . $requestOrigin);
    header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function json_response(bool $success, string $message, mixed $data = null, int $status = 200): void {
    http_response_code($status);
    echo json_encode([
        'success' => $success,
        'message' => $message,
        'data' => $data,
    ], JSON_PRETTY_PRINT);
    exit;
}

function input_json(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) return $_POST ?: [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function require_fields(array $data, array $fields): void {
    foreach ($fields as $field) {
        if (!isset($data[$field]) || trim((string)$data[$field]) === '') {
            json_response(false, "Missing required field: $field", null, 422);
        }
    }
}

function minutes_between(string $start, string $end): int {
    $s = strtotime($start);
    $e = strtotime($end);
    return (int)(($e - $s) / 60);
}
