<?php
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/response.php';

/**
 * Call at the top of any endpoint (after bootstrap.php) that should only be
 * reachable by a logged-in Institute Head. Stops execution with a 401 JSON
 * response if there is no active session.
 */
function require_login(): void {
    if (empty($_SESSION['user_id'])) {
        json_response(false, 'Not authenticated. Please log in again.', null, 401);
    }
}

/**
 * Turns a raw duplicate-key database error (SQLSTATE 23000) into a friendly,
 * specific message instead of exposing raw SQL to the client. Any other kind
 * of error is passed through unchanged.
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
    return $e->getMessage();
}
