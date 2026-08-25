<?php
require_once __DIR__ . '/bootstrap.php';

try {
    $pdo = db();
    // Check current session -- used by the frontend on page load to decide
    // whether to show the login screen or the dashboard.
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (empty($_SESSION['user_id'])) {
            json_response(true, 'Not logged in', ['logged_in' => false, 'csrf_token' => csrf_token()]);
        }
        json_response(true, 'Session active', [
            'logged_in' => true,
            'full_name' => $_SESSION['full_name'],
            'username' => $_SESSION['username'],
            'csrf_token' => csrf_token(),
        ]);
    }

    // Log in.
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        require_csrf();
        $d = input_json();
        require_fields($d, ['username', 'password']);

        $stmt = $pdo->prepare('SELECT * FROM users WHERE username=?');
        $stmt->execute([$d['username']]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($d['password'], $user['password_hash'])) {
            json_response(false, 'Invalid username or password.', null, 401);
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = $user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['full_name'] = $user['full_name'];

        json_response(true, 'Logged in successfully', [
            'full_name' => $user['full_name'],
            'username' => $user['username'],
            'csrf_token' => csrf_token(),
        ]);
    }

    // Log out.
    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        require_csrf();
        $_SESSION = [];
        session_destroy();
        json_response(true, 'Logged out successfully');
    }

    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) {
    json_response(false, friendly_db_error($e), null, 500);
}
