<?php
/**
 * BLOCK replaces SECTION as the student-grouping unit.
 *
 * GET    -> list all blocks.
 * POST   -> "Add Block": { year_level, number_of_blocks, program_code? }.
 *           Creates that many NEW blocks for the year level, auto-named
 *           "Block N" -- N continues after the highest existing block_no
 *           for that program+year level, so repeated "Add Block" calls
 *           never collide with or renumber blocks that already exist.
 *           The coordinator never types a block name/number by hand.
 * PUT    -> rename a single block (id, block_name only -- year level and
 *           numbering are structural and not editable after creation).
 * DELETE -> remove a single block (?id=).
 *
 * Blocks intentionally carry NO capacity field -- see database schema
 * comment on the `blocks` table.
 */
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $rows = $pdo->query('SELECT * FROM blocks ORDER BY year_level, block_no')->fetchAll();
        json_response(true, 'Blocks loaded', $rows);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['year_level', 'number_of_blocks']);
        $yearLevel = require_valid_year_level($d['year_level']);
        $programCode = $d['program_code'] ?? 'BSCS';
        $count = filter_var($d['number_of_blocks'], FILTER_VALIDATE_INT);
        if ($count === false || $count < 1 || $count > 20) {
            json_response(false, 'Number of blocks must be a whole number between 1 and 20.', null, 422);
        }

        // Continue numbering after whatever already exists for this
        // program + year level, so this never collides with (or silently
        // renumbers) blocks created by an earlier "Add Block" call.
        $maxStmt = $pdo->prepare('SELECT COALESCE(MAX(block_no), 0) FROM blocks WHERE program_code=? AND year_level=?');
        $maxStmt->execute([$programCode, $yearLevel]);
        $startNo = (int)$maxStmt->fetchColumn() + 1;

        $pdo->beginTransaction();
        $insertStmt = $pdo->prepare('INSERT INTO blocks(program_code, year_level, block_name, block_no) VALUES(?,?,?,?)');
        $created = [];
        for ($i = 0; $i < $count; $i++) {
            $no = $startNo + $i;
            $name = 'Block ' . $no;
            $insertStmt->execute([$programCode, $yearLevel, $name, $no]);
            $created[] = ['id' => (int)$pdo->lastInsertId(), 'block_name' => $name];
        }
        $pdo->commit();

        json_response(true, count($created) . ' block(s) created successfully', ['created' => $created], 201);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        $d = input_json();
        $id = (int)($d['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        require_fields($d, ['block_name']);

        $existsStmt = $pdo->prepare('SELECT id FROM blocks WHERE id=?');
        $existsStmt->execute([$id]);
        if (!$existsStmt->fetch()) json_response(false, 'Block not found.', null, 404);

        $stmt = $pdo->prepare('UPDATE blocks SET block_name=? WHERE id=?');
        $stmt->execute([$d['block_name'], $id]);
        json_response(true, 'Block renamed successfully');
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) json_response(false, 'Missing id', null, 422);
        $stmt = $pdo->prepare('DELETE FROM blocks WHERE id=?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) json_response(false, 'Block not found.', null, 404);
        json_response(true, 'Block deleted');
    }

    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
