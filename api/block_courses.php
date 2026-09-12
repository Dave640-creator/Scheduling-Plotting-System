<?php
/**
 * Block <-> Course assignment ("Assign Courses": Year Level + Block ->
 * pick Courses). A course may be assigned to many blocks and a block may
 * carry many courses (many-to-many). Plot Schedule reads this table to
 * show only the courses actually assigned to the selected block.
 *
 * GET    ?block_id=X   -> course_ids currently assigned to that block.
 * GET    (no params)   -> every block_courses row (block_id, course_id),
 *                         used by the frontend to build the full
 *                         block -> courses map in one request.
 * POST   { block_id, course_ids: [..] } -> REPLACES the full set of
 *         courses assigned to that block with course_ids (add + remove
 *         in one call, so the "Assign Courses" checklist UI can just send
 *         its current checked state).
 */
require_once __DIR__ . '/bootstrap.php';
require_login();
try {
    $pdo = db();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if (!empty($_GET['block_id'])) {
            $blockId = (int)$_GET['block_id'];
            $stmt = $pdo->prepare('SELECT course_id FROM block_courses WHERE block_id=?');
            $stmt->execute([$blockId]);
            json_response(true, 'Block courses loaded', array_map('intval', array_column($stmt->fetchAll(), 'course_id')));
        }
        $rows = $pdo->query('SELECT block_id, course_id FROM block_courses')->fetchAll();
        json_response(true, 'Block course assignments loaded', $rows);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $d = input_json();
        require_fields($d, ['block_id']);
        $blockId = (int)$d['block_id'];
        $courseIds = array_values(array_unique(array_map('intval', $d['course_ids'] ?? [])));

        $blockStmt = $pdo->prepare('SELECT id, year_level FROM blocks WHERE id=?');
        $blockStmt->execute([$blockId]);
        $block = $blockStmt->fetch();
        if (!$block) json_response(false, 'Block not found.', null, 404);

        if (!empty($courseIds)) {
            $placeholders = implode(',', array_fill(0, count($courseIds), '?'));
            $courseStmt = $pdo->prepare("SELECT id, year_level FROM courses WHERE id IN ($placeholders)");
            $courseStmt->execute($courseIds);
            $courses = $courseStmt->fetchAll();
            if (count($courses) !== count($courseIds)) {
                json_response(false, 'One or more selected courses were not found.', null, 404);
            }
            $mismatched = array_filter($courses, fn($c) => (int)$c['year_level'] !== (int)$block['year_level']);
            if (!empty($mismatched)) {
                json_response(false, 'All assigned courses must belong to the same Year Level as the Block.', null, 422);
            }
        }

        // Removing a course from a block that already has a schedule
        // plotted against it would leave an orphaned/inconsistent
        // schedule, so block that removal specifically and ask for the
        // schedule to be dealt with first -- same pattern used elsewhere
        // (course/room structural edits) for edits existing schedules
        // depend on.
        $existingStmt = $pdo->prepare('SELECT course_id FROM block_courses WHERE block_id=?');
        $existingStmt->execute([$blockId]);
        $existingCourseIds = array_map('intval', array_column($existingStmt->fetchAll(), 'course_id'));
        $removedCourseIds = array_diff($existingCourseIds, $courseIds);

        if (!empty($removedCourseIds)) {
            $placeholders = implode(',', array_fill(0, count($removedCourseIds), '?'));
            $scheduledStmt = $pdo->prepare(
                "SELECT c.course_code FROM schedules s JOIN courses c ON c.id = s.course_id
                 WHERE s.block_id = ? AND s.course_id IN ($placeholders)"
            );
            $scheduledStmt->execute(array_merge([$blockId], array_values($removedCourseIds)));
            $blocked = array_unique(array_column($scheduledStmt->fetchAll(), 'course_code'));
            if (!empty($blocked)) {
                json_response(false, 'Cannot unassign the following course(s) from this block because schedules already exist for them: ' . implode(', ', $blocked) . '. Delete those schedules first.', null, 422);
            }
        }

        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM block_courses WHERE block_id=?')->execute([$blockId]);
        if (!empty($courseIds)) {
            $insertStmt = $pdo->prepare('INSERT INTO block_courses(block_id, course_id) VALUES(?,?)');
            foreach ($courseIds as $courseId) {
                $insertStmt->execute([$blockId, $courseId]);
            }
        }
        $pdo->commit();

        json_response(true, 'Course assignments updated successfully', ['course_ids' => $courseIds]);
    }

    json_response(false, 'Method not allowed', null, 405);
} catch (Throwable $e) { json_response(false, friendly_db_error($e), null, 500); }
