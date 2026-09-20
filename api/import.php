<?php
/**
 * Bulk CSV import for Courses and Blocks.
 *
 * GET  ?template=courses|blocks   -> downloads a starter CSV with the
 *      expected header row and one example row.
 * POST { type: 'courses'|'blocks', csv: '<raw csv text>' }
 *      -> parses the CSV server-side (so quoting/commas-in-fields are
 *      handled correctly instead of relying on a naive JS split), validates
 *      each row with the exact same rules as the single-record endpoints,
 *      and inserts the valid ones. A bad row does NOT abort the whole file
 *      -- it's skipped and reported back with its row number and reason so
 *      the user can fix just that row and re-import, Google-Sheets-import
 *      style, rather than losing an otherwise-good batch over one typo.
 *
 * Blocks are still auto-named "Block N" here, exactly like the single
 * "Add Block" endpoint (api/blocks.php) -- the CSV only supplies
 * year_level + number_of_blocks per row, never a block name/number.
 */
require_once __DIR__ . '/bootstrap.php';
require_login();

const IMPORT_REQUIRED_COLUMNS = [
    'courses' => ['course_code', 'course_title', 'year_level', 'semester_type'],
    'blocks' => ['year_level', 'number_of_blocks'],
];

const IMPORT_MAX_ROWS = 1000;

function import_normalize_header(string $h): string {
    $h = preg_replace('/^\xEF\xBB\xBF/', '', $h); // strip BOM if it landed on the first header cell
    return strtolower(trim(preg_replace('/\s+/', '_', $h)));
}

function import_parse_csv_text(string $text): array {
    $text = preg_replace('/^\xEF\xBB\xBF/', '', $text);
    $lines = preg_split('/\r\n|\r|\n/', $text);
    $rows = [];
    foreach ($lines as $line) {
        if (trim($line) === '') continue;
        $rows[] = str_getcsv($line);
    }
    return $rows;
}

try {
    $pdo = db();

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $type = $_GET['template'] ?? '';
        if (!isset(IMPORT_REQUIRED_COLUMNS[$type])) {
            json_response(false, 'Unknown import type. Use "courses" or "blocks".', null, 422);
        }
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $type . '_import_template.csv"');
        echo $type === 'courses'
            ? "course_code,course_title,year_level,semester_type,lec_units,lab_units,category\nCS101,Introduction to Computing,1,first_semester,3,0,major\n"
            : "program_code,year_level,number_of_blocks\nBSCS,1,3\n";
        exit;
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        json_response(false, 'Method not allowed', null, 405);
    }

    $d = input_json();
    $type = $d['type'] ?? '';
    $csvText = (string)($d['csv'] ?? '');
    if (!isset(IMPORT_REQUIRED_COLUMNS[$type])) {
        json_response(false, 'Unknown import type. Use "courses" or "blocks".', null, 422);
    }
    if (trim($csvText) === '') {
        json_response(false, 'No CSV data received.', null, 422);
    }

    $rows = import_parse_csv_text($csvText);
    if (count($rows) < 1) {
        json_response(false, 'The CSV file is empty.', null, 422);
    }
    $header = array_map('import_normalize_header', array_shift($rows));
    if (count($rows) < 1) {
        json_response(false, 'The CSV file needs a header row plus at least one data row.', null, 422);
    }
    if (count($rows) > IMPORT_MAX_ROWS) {
        json_response(false, 'That file has too many rows (max ' . IMPORT_MAX_ROWS . ' per import). Split it into smaller batches.', null, 422);
    }

    $colIndex = [];
    foreach ($header as $i => $name) $colIndex[$name] = $i;

    foreach (IMPORT_REQUIRED_COLUMNS[$type] as $req) {
        if (!isset($colIndex[$req])) {
            json_response(false, "CSV is missing required column: $req", null, 422);
        }
    }

    $cell = function (array $row, string $col) use ($colIndex) {
        $i = $colIndex[$col] ?? null;
        return $i !== null && isset($row[$i]) ? trim((string)$row[$i]) : '';
    };

    $inserted = 0;
    $errors = [];
    $rowNum = 1; // header occupies row 1 in the file

    if ($type === 'courses') {
        $stmt = $pdo->prepare('INSERT INTO courses(course_code,course_title,year_level,semester_type,lec_units,lab_units,category,max_students) VALUES(?,?,?,?,?,?,?,?)');
        $validSemesters = ['first_semester', 'second_semester', 'summer'];
        $validCategories = ['major', 'ge', 'pathfit', 'nstp', 'luxmundi', 'elective', 'other'];

        foreach ($rows as $row) {
            $rowNum++;
            if (implode('', $row) === '') continue; // skip blank lines

            $code = $cell($row, 'course_code');
            $title = $cell($row, 'course_title');
            $year = $cell($row, 'year_level');
            $sem = strtolower($cell($row, 'semester_type'));
            $lecRaw = $cell($row, 'lec_units');
            $labRaw = $cell($row, 'lab_units');
            $category = strtolower($cell($row, 'category')) ?: 'major';

            if ($code === '' || $title === '' || $year === '' || $sem === '') {
                $errors[] = "Row $rowNum: missing course code, title, year level, or semester.";
                continue;
            }
            if (!ctype_digit($year) || (int)$year < 1 || (int)$year > 4) {
                $errors[] = "Row $rowNum: year level must be 1-4.";
                continue;
            }
            if (!in_array($sem, $validSemesters, true)) {
                $errors[] = "Row $rowNum: invalid semester_type \"$sem\" (expected first_semester, second_semester, or summer).";
                continue;
            }
            $lecUnits = is_numeric($lecRaw) ? (float)$lecRaw : 0;
            $labUnits = is_numeric($labRaw) ? (float)$labRaw : 0;
            if ($lecUnits < 0 || $labUnits < 0) {
                $errors[] = "Row $rowNum: lecture/lab units cannot be negative.";
                continue;
            }
            if ($lecUnits <= 0 && $labUnits <= 0) {
                $errors[] = "Row $rowNum: must have at least a lecture or a lab unit greater than 0.";
                continue;
            }
            if (!in_array($category, $validCategories, true)) $category = 'major';

            try {
                // Default Course Capacity: 30 with a Laboratory component, 45 pure lecture.
                $stmt->execute([$code, $title, (int)$year, $sem, $lecUnits, $labUnits, $category, $labUnits > 0 ? 30 : 45]);
                $inserted++;
            } catch (PDOException $e) {
                $errors[] = $e->getCode() === '23000'
                    ? "Row $rowNum: course \"$code\" already exists for that year level and semester -- skipped."
                    : "Row $rowNum: could not be saved ($code).";
            }
        }
    } else { // blocks
        $insertStmt = $pdo->prepare('INSERT INTO blocks(program_code,year_level,block_name,block_no) VALUES(?,?,?,?)');
        $maxStmt = $pdo->prepare('SELECT COALESCE(MAX(block_no), 0) FROM blocks WHERE program_code=? AND year_level=?');

        foreach ($rows as $row) {
            $rowNum++;
            if (implode('', $row) === '') continue;

            $program = $cell($row, 'program_code') ?: 'BSCS';
            $year = $cell($row, 'year_level');
            $countRaw = $cell($row, 'number_of_blocks');

            if ($year === '' || $countRaw === '') {
                $errors[] = "Row $rowNum: missing year level or number of blocks.";
                continue;
            }
            if (!ctype_digit($year) || (int)$year < 1 || (int)$year > 4) {
                $errors[] = "Row $rowNum: year level must be 1-4.";
                continue;
            }
            if (!ctype_digit($countRaw) || (int)$countRaw < 1 || (int)$countRaw > 20) {
                $errors[] = "Row $rowNum: number_of_blocks must be a whole number between 1 and 20.";
                continue;
            }

            try {
                $maxStmt->execute([$program, (int)$year]);
                $startNo = (int)$maxStmt->fetchColumn() + 1;
                for ($i = 0; $i < (int)$countRaw; $i++) {
                    $no = $startNo + $i;
                    $insertStmt->execute([$program, (int)$year, 'Block ' . $no, $no]);
                    $inserted++;
                }
            } catch (PDOException $e) {
                $errors[] = "Row $rowNum: could not create blocks for $program Year $year.";
            }
        }
    }

    $summary = "$inserted row" . ($inserted === 1 ? '' : 's') . ' imported' . (count($errors) ? ', ' . count($errors) . ' skipped' : '') . '.';
    json_response(true, $summary, ['inserted' => $inserted, 'errors' => $errors]);
} catch (Throwable $e) {
    json_response(false, friendly_db_error($e), null, 500);
}
