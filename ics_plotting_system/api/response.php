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

/**
 * Strictly validates a value intended for an is_active (TINYINT(1)) column.
 * The frontend only ever sends 0/1/true/false, but a direct API request
 * could send anything -- silently coercing an arbitrary value (e.g. "2" or
 * "yes") with `(int)!!$v` would let it slide through as a 1 without the
 * caller ever knowing their input wasn't understood. Only these exact forms
 * of 0 and 1 are accepted; everything else is rejected with a 422 so bad
 * data never reaches the database.
 */
function require_strict_bool_int(mixed $value, string $fieldLabel): int {
    if (is_bool($value)) return $value ? 1 : 0;
    if (is_int($value) && ($value === 0 || $value === 1)) return $value;
    if (is_string($value) && ($value === '0' || $value === '1')) return (int)$value;
    json_response(false, "$fieldLabel must be 0 or 1.", null, 422);
}

/**
 * Strictly validates a year level intended for the curriculum's 1st-4th
 * year structure. The frontend UI only offers 1-4, but a direct API
 * request could submit anything -- without this, invalid values like 0, 5,
 * or 7 could enter the database and later break filtering/reporting that
 * assumes year_level is always 1-4.
 */
function require_valid_year_level(mixed $value): int {
    $intVal = filter_var($value, FILTER_VALIDATE_INT);
    if ($intVal === false || $intVal < 1 || $intVal > 4) {
        json_response(false, 'Year level must be 1, 2, 3, or 4.', null, 422);
    }
    return $intVal;
}

function minutes_between(string $start, string $end): int {
    $s = strtotime($start);
    $e = strtotime($end);
    return (int)(($e - $s) / 60);
}
