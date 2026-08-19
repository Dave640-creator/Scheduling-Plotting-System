<?php
// Database connection for ICS Plotting System
// Update these values based on your local XAMPP/MySQL setup.
//
// IMPORTANT: DB_HOST is '127.0.0.1', not 'localhost'. This matters --
// PHP's MySQL driver treats 'localhost' as "always connect via the local
// Unix socket," which silently IGNORES the port setting below. If you
// change DB_PORT (e.g. to 3307 because something else is already using
// 3306), you must keep DB_HOST as '127.0.0.1' or the port change won't
// actually take effect and you'll get a confusing connection error.
const DB_HOST = '127.0.0.1';
const DB_PORT = '3307'; // Chang    e this if your XAMPP MySQL runs on a different port (e.g. 3307)
const DB_NAME = 'ics_plotting_system';
const DB_USER = 'root';
const DB_PASS = '';

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    return $pdo;
}
