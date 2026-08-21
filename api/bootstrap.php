<?php
if (session_status() === PHP_SESSION_NONE) {
    // Harden the session cookie (bug #10). HttpOnly blocks JS/XSS access to
    // the cookie, SameSite=Lax stops it being sent on cross-site requests
    // (also mitigates CSRF as defense-in-depth), and Secure is enabled
    // automatically once the app is actually served over HTTPS instead of
    // plain localhost/XAMPP.
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $isHttps,
    ]);
    session_start();
}
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/response.php';

// Every session (even before login) gets a CSRF token. Issuing it early
// means the login form itself is also covered, not just the logged-in CRUD
// endpoints.
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

/** The current session's CSRF token, for endpoints to hand back to the frontend. */
function csrf_token(): string {
    return $_SESSION['csrf_token'];
}

/**
 * Verifies the X-CSRF-Token request header against the session's token for
 * any state-changing request (bug #2). GET/HEAD/OPTIONS are read-only and
 * are not checked. Stops execution with a 403 JSON response on mismatch.
 */
function require_csrf(): void {
    $method = $_SERVER['REQUEST_METHOD'];
    if (!in_array($method, ['POST', 'PUT', 'DELETE', 'PATCH'], true)) {
        return;
    }
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if ($sent === '' || empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $sent)) {
        json_response(false, 'Invalid or missing CSRF token. Please refresh the page and try again.', null, 403);
    }
}

/**
 * Call at the top of any endpoint (after bootstrap.php) that should only be
 * reachable by a logged-in Institute Head. Stops execution with a 401 JSON
 * response if there is no active session, and (for state-changing methods)
 * enforces the CSRF token check above.
 */
function require_login(): void {
    if (empty($_SESSION['user_id'])) {
        json_response(false, 'Not authenticated. Please log in again.', null, 401);
    }
    require_csrf();
}

/**
 * Turns a raw duplicate-key database error (SQLSTATE 23000) into a friendly,
 * specific message instead of exposing raw SQL to the client. Any other kind
 * of error is logged server-side and reported to the client only as a
 * generic message -- raw exception text (SQL, table/column names, driver
 * details) must never reach the browser (bug #9).
 */
function friendly_db_error(Throwable $e): string {
    if ($e instanceof PDOException && $e->getCode() === '23000') {
        $msg = $e->getMessage();
        if (str_contains($msg, 'unique_course')) {
            return 'A course with this code already exists for that year level and semester.';
        }
        if (str_contains($msg, 'unique_section')) {
            return 'A section with this program, year level, and section number already exists.';
        }
        if (str_contains($msg, 'unique_faculty_course')) {
            return 'This faculty member is already assigned to this course.';
        }
        return 'This entry already exists. Please check for duplicates and try again.';
    }
    error_log('[ICS Plotting System] ' . get_class($e) . ': ' . $e->getMessage());
    return 'An unexpected server error occurred. Please try again or contact the administrator.';
}
