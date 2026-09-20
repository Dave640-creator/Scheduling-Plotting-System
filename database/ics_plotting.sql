-- =====================================================================
-- ICS Plotting System -- COMPLETE DATABASE (ONE file, no migrations needed)
-- Tangub City Global College - Institute of Computer Studies
--
-- WHAT THIS FILE CONTAINS (all loaded automatically on import):
--   * every table + constraints the system needs
--   * login account ............ institute_head / ics12345
--   * 5 rooms and the starter Blocks
--   * 16 instructors (Faculty page)
--   * 63 BSCS Curriculum 2023-2024 courses with code, title, year level,
--     semester, lecture units, laboratory units and default Course Capacity
--     (30 with a Lab, 45 pure lecture) -- all visible on the Courses page
--   * Block <-> Course assignments, so every course also shows up in
--     Assign Courses, Plot Schedule and the Course Offering table
--
-- HOW TO IMPORT
--   ONLINE HOSTING (cPanel / phpMyAdmin / shared hosting):
--     1. Create an EMPTY database in your hosting panel.
--     2. Open that database in phpMyAdmin -> Import -> choose this file.
--     3. Put that database's host, name, user and password in api/config.php
--        and set APP_DEBUG = false.
--   LOCAL XAMPP: create an empty database named ics_plotting_system and
--     import this file into it (or un-comment the two lines below and
--     import from the phpMyAdmin home page).
--
-- The CREATE DATABASE / USE lines are commented out on purpose: hosting
-- providers do not allow creating databases from an import, and a fixed
-- name here would send the tables to the wrong (or a non-existent) database.
--
-- WARNING: it DROPS and recreates every table. Importing it ERASES ALL
-- existing data in that database (plotted schedules, faculty assignments,
-- rooms, blocks, courses). Export first if you want to keep anything.
--
-- Already folded in (the old migration files are gone / not needed):
--   * delivery_mode = face_to_face / hybrid_rotation_a / hybrid_rotation_b
--   * schedules.school_year, schedules.day_of_week as a flexible day list
--   * is_active on faculty and rooms; faculty_courses.created_at
--   * instructor is optional (schedules.faculty_id may be NULL)
--   * one schedule row per Course + Block/SPARE + School Year + Component
--   * CHECK constraints on courses, faculty and SPARE allocations
--   * Blocks, Block Courses, SPARE groups and SPARE allocations
--   * SET 0 / SET 1 / SET 2 is chosen per schedule (no schema change needed)
--
-- Requires MySQL 8.0.16+ or MariaDB 10.2.1+ (CHECK constraints, generated column).
-- =====================================================================

-- CREATE DATABASE IF NOT EXISTS ics_plotting_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE ics_plotting_system;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS spare_course_allocations;
DROP TABLE IF EXISTS spares;
DROP TABLE IF EXISTS block_courses;
DROP TABLE IF EXISTS faculty_courses;
DROP TABLE IF EXISTS faculty;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('institute_head') NOT NULL DEFAULT 'institute_head',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_code VARCHAR(30) NOT NULL,
  course_title VARCHAR(180) NOT NULL,
  year_level TINYINT NOT NULL,
  semester_type ENUM('first_semester','second_semester','summer') NOT NULL,
  lec_units DECIMAL(3,1) NOT NULL DEFAULT 0,
  lab_units DECIMAL(3,1) NOT NULL DEFAULT 0,
  category ENUM('major','ge','pathfit','nstp','luxmundi','elective','other') DEFAULT 'major',
  -- Course/class capacity. Default 30 for a course with a Laboratory component,
  -- 45 for pure lecture (both editable in the app). This is
  -- the ONLY place a student-count-style capacity lives in the system --
  -- Blocks do not have a capacity and Rooms do not have a capacity. NULL
  -- means "no capacity limit is being tracked for this course". It exists
  -- so the coordinator has a reference point for deciding when SPARE
  -- allocation is needed for a course, NOT to gate schedule plotting.
  max_students INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_course (course_code, semester_type, year_level),
  CONSTRAINT chk_courses_lec_units CHECK (lec_units >= 0),
  CONSTRAINT chk_courses_lab_units CHECK (lab_units >= 0),
  CONSTRAINT chk_courses_max_students CHECK (max_students IS NULL OR max_students > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BLOCK replaces SECTION as the student-grouping unit. A Block identifies a
-- student group under a Year Level ONLY -- it deliberately has no capacity
-- column (see requirement: "Block does NOT have a capacity field"). Blocks
-- are created in a batch via api/blocks.php ("Add Block": Year Level +
-- Number of Blocks -> auto-generates Block 1..N), never typed in by hand.
CREATE TABLE blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_code VARCHAR(20) NOT NULL DEFAULT 'BSCS',
  year_level TINYINT NOT NULL,
  block_name VARCHAR(30) NOT NULL,
  block_no INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_block (program_code, year_level, block_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Many-to-many: which Courses are assigned to which Block ("Assign
-- Courses": Year Level + Block -> pick Courses). The same course can be
-- assigned to many blocks, and a block can carry many courses. Plot
-- Schedule reads from this table to show only the courses that actually
-- belong to the selected block.
CREATE TABLE block_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  block_id INT NOT NULL,
  course_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY unique_block_course (block_id, course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SPARE is a special allocation group, kept as its own entity -- it is NOT
-- "Block N" and is never auto-generated by "Add Block". One SPARE group
-- exists per Program + Year Level (created on demand from the Spare
-- Allocation screen).
CREATE TABLE spares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_code VARCHAR(20) NOT NULL DEFAULT 'BSCS',
  year_level TINYINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_spare (program_code, year_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-course SPARE handling. A course is course-dependent: SPARE students
-- for Course A may simply JOIN an existing regular Block's class
-- (allocation_type='join_block', target_block_id required, no separate
-- schedule needed), while Course C may need its own SEPARATE schedule
-- plotted specifically for the SPARE group (allocation_type='separate_schedule',
-- target_block_id must be NULL -- see schedules.spare_id).
CREATE TABLE spare_course_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  spare_id INT NOT NULL,
  course_id INT NOT NULL,
  allocation_type ENUM('join_block','separate_schedule') NOT NULL,
  target_block_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spare_id) REFERENCES spares(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (target_block_id) REFERENCES blocks(id) ON DELETE CASCADE,
  UNIQUE KEY unique_spare_course (spare_id, course_id),
  CONSTRAINT chk_spare_allocation_target CHECK (
    (allocation_type = 'join_block' AND target_block_id IS NOT NULL) OR
    (allocation_type = 'separate_schedule' AND target_block_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_name VARCHAR(50) NOT NULL UNIQUE,
  room_type ENUM('lecture','laboratory') NOT NULL,
  -- No capacity column: Room Capacity was removed from Add Room entirely.
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE faculty (
  id INT AUTO_INCREMENT PRIMARY KEY,
  faculty_name VARCHAR(100) NOT NULL,
  max_preparations INT NOT NULL DEFAULT 4,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_faculty_max_preparations CHECK (max_preparations BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE faculty_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  faculty_id INT NOT NULL,
  course_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY unique_faculty_course (faculty_id, course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A schedule is plotted against EITHER a regular Block (block_id) OR a
-- SPARE group's own separate schedule (spare_id) -- never both, and never
-- neither. target_ref is a generated column that folds whichever one is
-- set into a single comparable value ('B12' or 'S3'), so the uniqueness
-- constraint below (one row per Course+Target+School Year+Component) works
-- correctly even though block_id/spare_id are individually nullable (plain
-- multi-column UNIQUE keys in MySQL do not treat two NULLs as equal, so
-- without this a duplicate could otherwise slip in whichever column stays
-- NULL).
CREATE TABLE schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  block_id INT NULL,
  spare_id INT NULL,
  target_ref VARCHAR(20) GENERATED ALWAYS AS (
    CASE WHEN block_id IS NOT NULL THEN CONCAT('B', block_id) ELSE CONCAT('S', spare_id) END
  ) STORED,
  faculty_id INT NULL, -- optional: NULL = instructor not assigned yet (a warning, not a conflict)
  room_id INT NULL,
  component ENUM('lecture','laboratory') NOT NULL,
  set_type ENUM('set_0','set_1','set_2') NOT NULL DEFAULT 'set_0',
  delivery_mode ENUM('face_to_face','hybrid_rotation_a','hybrid_rotation_b') NOT NULL DEFAULT 'face_to_face',
  school_year VARCHAR(9) NOT NULL DEFAULT '2026-2027',
  day_of_week VARCHAR(60) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE,
  FOREIGN KEY (spare_id) REFERENCES spares(id) ON DELETE CASCADE,
  FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  CONSTRAINT chk_schedule_target CHECK (
    (block_id IS NOT NULL AND spare_id IS NULL) OR (block_id IS NULL AND spare_id IS NOT NULL)
  ),
  -- One schedule row per Component (Lecture/Laboratory) per Course +
  -- Block-or-SPARE + School Year -- prevents plotting e.g. two Lecture
  -- schedules for the same subject offering. Backed up by an app-level
  -- check in api/schedules.php that produces a friendly error message.
  CONSTRAINT uq_schedule_component UNIQUE (course_id, target_ref, school_year, component)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users(full_name, username, password_hash) VALUES
('ICS Institute Head','institute_head', '$2y$10$h/CsqRpS6Rl3ntcb0vlWIOM6QpTNI/hsnrVWWfEbVXysDy.E4jd7K'); -- password: ics12345

INSERT INTO rooms(room_name, room_type) VALUES
('MB 205 / Lab 1','laboratory'),
('MB 207 / Lab 2','laboratory'),
('MB 209 / Lab 3','laboratory'),
('Lecture Room 1','lecture'),
('Lecture Room 2','lecture');

-- Day pattern guide:
-- MWF = Monday/Wednesday/Friday, usually 1 hour per meeting
-- TTH = Tuesday/Thursday, usually 1.5 hours per meeting
-- Laboratory hour validation is based on total weekly hours, not always 3 hours in one day.

INSERT INTO blocks(program_code, year_level, block_name, block_no) VALUES
('BSCS',1,'Block 1',1),
('BSCS',2,'Block 1',1),('BSCS',2,'Block 2',2),('BSCS',2,'Block 3',3),
('BSCS',3,'Block 1',1),
('BSCS',4,'Block 1',1);

-- Instructors (16). max_preparations 4 each (editable per instructor in the Faculty page).
INSERT INTO faculty(faculty_name,max_preparations) VALUES
('Cabatingan, Carin',4),
('Selatona, Janziel',4),
('Magbanua, Danica Ave',4),
('Abing, Jamaica',4),
('Bachiller, Precy',4),
('Casipong, Christopher',4),
('Zapanta, Jessel',4),
('Febrio, James Bernard',4),
('Suerto, Denise Brylle',4),
('Ajim, All Nojor',4),
('Atay, Eljun Karl',4),
('Devinagracia, Ruby Ann',4),
('Buenafe, Maria Raizha',4),
('Hilot, Genevieve',4),
('Lacpao, Erwin',4),
('Tia, Jenieffer',4);


-- =====================================================================
-- COURSES: BSCS Curriculum 2023-2024, Tangub City Global College (63 courses)
-- 1st year 21, 2nd year 21, 3rd year 14, 4th year 7.
-- max_students (Course Capacity) default: 30 if the course has a Laboratory
-- component (Lab Units > 0), 45 if it is pure lecture. Editable in the app.
-- =====================================================================
INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category, max_students)
VALUES
-- FIRST YEAR - First Semester (9 courses)
('GE PurCom', 'Purposive Communication', 1, 'first_semester', 3, 0, 'ge', 45),
('GE USelf', 'Understanding the Self', 1, 'first_semester', 3, 0, 'ge', 45),
('GE ArtApp', 'Art Appreciation', 1, 'first_semester', 3, 0, 'ge', 45),
('GE ModMat', 'Mathematics in the Modern World', 1, 'first_semester', 3, 0, 'ge', 45),
('CIC 111', 'Introduction to Computing', 1, 'first_semester', 2, 1, 'major', 30),
('CIC 112', 'Computer Programming 1 (Fundamental)', 1, 'first_semester', 2, 1, 'major', 30),
('PATH-FIT 1', 'Movement Competency Training', 1, 'first_semester', 2, 0, 'pathfit', 45),
('NSTP 1', 'National Service Training Program 1', 1, 'first_semester', 3, 0, 'nstp', 45),
('LuxMundi 1', 'Spirituality and Values Formation', 1, 'first_semester', 2, 0, 'luxmundi', 45),

-- FIRST YEAR - Second Semester (9 courses)
('GE STS', 'Science, Technology and Society', 1, 'second_semester', 3, 0, 'ge', 45),
('GE ConWor', 'The Contemporary World', 1, 'second_semester', 3, 0, 'ge', 45),
('GE RPHis', 'Readings in Philippine History', 1, 'second_semester', 3, 0, 'ge', 45),
('CIC 121', 'Computer Programming 2 (Intermediate)', 1, 'second_semester', 2, 1, 'major', 30),
('CIC 122', 'Data Structures and Algorithms', 1, 'second_semester', 2, 1, 'major', 30),
('MSC 121', 'Discrete Structures 1', 1, 'second_semester', 3, 0, 'major', 45),
('PATH-FIT 2', 'Fitness Training', 1, 'second_semester', 2, 0, 'pathfit', 45),
('NSTP 2', 'National Service Training Program 2', 1, 'second_semester', 3, 0, 'nstp', 45),
('LuxMundi 2', 'Responsible Citizenship and Good Governance', 1, 'second_semester', 2, 0, 'luxmundi', 45),

-- FIRST YEAR - Summer (3 courses)
('MSC 131', 'Discrete Structures 2', 1, 'summer', 3, 0, 'major', 45),
('PSC 131', 'Digital Logic Design', 1, 'summer', 3, 0, 'major', 45),
('PSC 132', 'Algorithms and Complexity', 1, 'summer', 3, 0, 'major', 45),

-- SECOND YEAR - First Semester (9 courses)
('GE Ethics', 'Ethics', 2, 'first_semester', 3, 0, 'ge', 45),
('PSC 211', 'Automata Theory & Formal Languages', 2, 'first_semester', 3, 0, 'major', 45),
('MSC 212', 'Advanced Statistics & Probability, Numerical Methods', 2, 'first_semester', 3, 0, 'major', 45),
('PSC 212', 'Programming Languages', 2, 'first_semester', 2, 1, 'major', 30),
('PSC 213', 'Object-Oriented Programming', 2, 'first_semester', 2, 1, 'major', 30),
('CIC 211', 'Information Management', 2, 'first_semester', 2, 1, 'major', 30),
('ESC 211', 'CS Elective 1 - PC Troubleshooting and Networking', 2, 'first_semester', 2, 1, 'elective', 30),
('PATH-FIT 3', 'Dance', 2, 'first_semester', 2, 0, 'pathfit', 45),
('LuxMundi 3', 'Life Skills in the Post Modern Era', 2, 'first_semester', 2, 0, 'luxmundi', 45),

-- SECOND YEAR - Second Semester (9 courses)
('GEE LITERA', 'Living in the IT Era', 2, 'second_semester', 3, 0, 'ge', 45),
('MSC 221', 'Calculus 1 with Analytic Geometry', 2, 'second_semester', 3, 0, 'major', 45),
('CIC 221', 'Applications Development and Emerging Technologies', 2, 'second_semester', 2, 1, 'major', 30),
('PSC 221', 'Software Engineering 1', 2, 'second_semester', 2, 1, 'major', 30),
('PSC 223', 'Operating Systems', 2, 'second_semester', 2, 1, 'major', 30),
('PSC 222', 'Architecture and Organization', 2, 'second_semester', 2, 1, 'major', 30),
('ESC 221', 'CS Elective 2 - Mobile Application Development', 2, 'second_semester', 2, 1, 'elective', 30),
('PATH-FIT 4', 'Individual & Team Sports', 2, 'second_semester', 2, 0, 'pathfit', 45),
('LuxMundi 4', 'Professional and Personality Development', 2, 'second_semester', 2, 0, 'luxmundi', 45),

-- SECOND YEAR - Summer (3 courses)
('MSC 231', 'Linear Algebra', 2, 'summer', 3, 0, 'major', 45),
('PSC 231', 'Information Assurance and Security', 2, 'summer', 3, 0, 'major', 45),
('ESC 231', 'Research Methodology', 2, 'summer', 3, 0, 'major', 45),

-- THIRD YEAR - First Semester (7 courses)
('GE JRiz', 'The Life and Works of Rizal', 3, 'first_semester', 3, 0, 'ge', 45),
('PSC 311', 'Software Engineering 2', 3, 'first_semester', 2, 1, 'major', 30),
('PSC 312', 'Human Computer Interaction', 3, 'first_semester', 2, 1, 'major', 30),
('ESC 314', 'Multimedia Systems', 3, 'first_semester', 2, 1, 'major', 30),
('ESC 311', 'CS Elective 3', 3, 'first_semester', 3, 0, 'elective', 45),
('ESC 312', 'Compiler Design', 3, 'first_semester', 2, 1, 'elective', 30),
('ESC 313', 'Web Application Development', 3, 'first_semester', 2, 1, 'elective', 30),

-- THIRD YEAR - Second Semester (7 courses)
('GEE PPOP', 'Philippine Pop Culture', 3, 'second_semester', 3, 0, 'ge', 45),
('PSC 321', 'Thesis 1 (Research Project Analysis and Design)', 3, 'second_semester', 2, 1, 'major', 30),
('PSC 322', 'Networks and Communications', 3, 'second_semester', 2, 1, 'major', 30),
('PSC 323', 'Social Issues and Professional Practice', 3, 'second_semester', 3, 0, 'major', 45),
('ESC 321', 'CS Elective 4', 3, 'second_semester', 2, 1, 'elective', 30),
('ESC 322', 'Business Analytics', 3, 'second_semester', 2, 1, 'elective', 30),
('ESC 323', 'Modeling and Simulation', 3, 'second_semester', 2, 1, 'elective', 30),

-- FOURTH YEAR - First Semester (6 courses)
('GEE GENSOC', 'Gender and Society', 4, 'first_semester', 3, 0, 'ge', 45),
('ESC 411', 'IT Seminars', 4, 'first_semester', 0, 1, 'elective', 30),
('ESC 412', 'CS Elective 5', 4, 'first_semester', 2, 1, 'elective', 30),
('ESC 413', 'CS Elective 6', 4, 'first_semester', 2, 1, 'elective', 30),
('PEC 411', 'Professional Enhancement Course', 4, 'first_semester', 3, 0, 'elective', 45),
('PSC 411', 'Thesis 2 (Project Implementation)', 4, 'first_semester', 2, 1, 'major', 30),

-- FOURTH YEAR - Second Semester (1 course)
('PSC 421', 'On the Job Training (500 Hours)', 4, 'second_semester', 6, 0, 'major', 45);

-- =====================================================================
-- BLOCK COURSES ("Assign Courses"): every course of a year level is assigned to
-- every Block of that year level, so all courses show up in Plot Schedule and in
-- the Course Offering table right away. You can still add/remove per Block in
-- the app (Assign Courses).
-- =====================================================================
INSERT INTO block_courses(block_id, course_id)
SELECT b.id, c.id
FROM blocks b
JOIN courses c ON c.year_level = b.year_level
ORDER BY b.year_level, b.block_no, c.semester_type, c.course_code;

-- Quick check after importing (expected: 1st year 9/9/3 per Block; 2nd year 9/9/3; 3rd year 7/7/0; 4th year 6/1/0):
-- SELECT b.year_level, b.block_name, c.semester_type, COUNT(*) AS assigned
-- FROM block_courses bc JOIN blocks b ON b.id = bc.block_id JOIN courses c ON c.id = bc.course_id
-- GROUP BY b.id, b.year_level, b.block_name, b.block_no, c.semester_type
-- ORDER BY b.year_level, b.block_no, c.semester_type;

SET FOREIGN_KEY_CHECKS = 1;
