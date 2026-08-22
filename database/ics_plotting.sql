CREATE DATABASE IF NOT EXISTS ics_plotting_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ics_plotting_system;

DROP TABLE IF EXISTS schedules;
DROP TABLE IF EXISTS faculty_courses;
DROP TABLE IF EXISTS faculty;
DROP TABLE IF EXISTS rooms;
DROP TABLE IF EXISTS sections;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('institute_head') NOT NULL DEFAULT 'institute_head',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_code VARCHAR(30) NOT NULL,
  course_title VARCHAR(180) NOT NULL,
  year_level TINYINT NOT NULL,
  semester_type ENUM('first_semester','second_semester','summer') NOT NULL,
  lec_units DECIMAL(3,1) NOT NULL DEFAULT 0,
  lab_units DECIMAL(3,1) NOT NULL DEFAULT 0,
  category ENUM('major','ge','pathfit','nstp','luxmundi','elective','other') DEFAULT 'major',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_course (course_code, semester_type, year_level),
  CONSTRAINT chk_courses_lec_units CHECK (lec_units >= 0),
  CONSTRAINT chk_courses_lab_units CHECK (lab_units >= 0)
);

CREATE TABLE sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  program_code VARCHAR(20) NOT NULL DEFAULT 'BSCS',
  year_level TINYINT NOT NULL,
  section_no VARCHAR(20) NOT NULL,
  student_count INT NOT NULL DEFAULT 30,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_section (program_code, year_level, section_no),
  CONSTRAINT chk_sections_student_count CHECK (student_count BETWEEN 1 AND 30)
);

CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_name VARCHAR(50) NOT NULL UNIQUE,
  room_type ENUM('lecture','laboratory') NOT NULL,
  capacity INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_rooms_capacity CHECK (capacity > 0)
);

CREATE TABLE faculty (
  id INT AUTO_INCREMENT PRIMARY KEY,
  faculty_name VARCHAR(100) NOT NULL,
  max_preparations INT NOT NULL DEFAULT 4,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_faculty_max_preparations CHECK (max_preparations BETWEEN 1 AND 20)
);

CREATE TABLE faculty_courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  faculty_id INT NOT NULL,
  course_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  UNIQUE KEY unique_faculty_course (faculty_id, course_id)
);

CREATE TABLE schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  section_id INT NOT NULL,
  faculty_id INT NOT NULL,
  room_id INT NULL,
  component ENUM('lecture','laboratory') NOT NULL,
  set_type ENUM('set_0','set_1','set_2') NOT NULL DEFAULT 'set_0',
  delivery_mode ENUM('face_to_face','online') NOT NULL DEFAULT 'face_to_face',
  school_year VARCHAR(9) NOT NULL DEFAULT '2026-2027',
  day_of_week VARCHAR(60) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
  FOREIGN KEY (faculty_id) REFERENCES faculty(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
  -- One schedule row per Component (Lecture/Laboratory) per Course +
  -- Section + School Year -- prevents plotting e.g. two Lecture schedules
  -- for the same subject offering. Backed up by an app-level check in
  -- api/schedules.php that produces a friendly error message.
  CONSTRAINT uq_schedule_component UNIQUE (course_id, section_id, school_year, component)
);

INSERT INTO users(full_name, username, password_hash) VALUES
('ICS Institute Head','institute_head', '$2y$10$h/CsqRpS6Rl3ntcb0vlWIOM6QpTNI/hsnrVWWfEbVXysDy.E4jd7K'); -- password: ics12345

INSERT INTO rooms(room_name, room_type, capacity) VALUES
('MB 205 / Lab 1','laboratory',30),
('MB 207 / Lab 2','laboratory',30),
('MB 209 / Lab 3','laboratory',30),
('Lecture Room 1','lecture',40),
('Lecture Room 2','lecture',40);

-- Day pattern guide:
-- MWF = Monday/Wednesday/Friday, usually 1 hour per meeting
-- TTH = Tuesday/Thursday, usually 1.5 hours per meeting
-- Laboratory hour validation is based on total weekly hours, not always 3 hours in one day.

INSERT INTO sections(program_code, year_level, section_no, student_count) VALUES
('BSCS',2,'172',30),('BSCS',2,'173',30),('BSCS',2,'174',30),('BSCS',1,'101',30),('BSCS',3,'301',30),('BSCS',4,'401',25);

INSERT INTO faculty(faculty_name,max_preparations) VALUES
('Ma\'am Janz',4),('Faculty 1',4),('Faculty 2',4),('Faculty 3',4);


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GE PurCom', 'Purposive Communication', 1, 'first_semester', 3, 0, 'ge'),
('GE USelf', 'Understanding the Self', 1, 'first_semester', 3, 0, 'ge'),
('GE ArtApp', 'Art Appreciation', 1, 'first_semester', 3, 0, 'ge'),
('GE ModMat', 'Mathematics in the Modern World', 1, 'first_semester', 3, 0, 'ge'),
('CIC 111', 'Introduction to Computing', 1, 'first_semester', 2, 1, 'major'),
('CIC 112', 'Computer Programming 1 (Fundamental)', 1, 'first_semester', 2, 1, 'major'),
('PATH-FIT 1', 'Movement Competency Training', 1, 'first_semester', 2, 0, 'pathfit'),
('NSTP 1', 'National Service Training Program 1', 1, 'first_semester', 0, 0, 'nstp'),
('LuxMundi 1', 'Spirituality and Values Formation', 1, 'first_semester', 0, 0, 'luxmundi');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GE STS', 'Science, Technology and Society', 1, 'second_semester', 3, 0, 'ge'),
('GE ConWor', 'The Contemporary World', 1, 'second_semester', 3, 0, 'ge'),
('GE RPHis', 'Readings in Philippine History', 1, 'second_semester', 3, 0, 'ge'),
('CIC 121', 'Computer Programming 2 (Intermediate)', 1, 'second_semester', 2, 1, 'major'),
('CIC 122', 'Data Structures and Algorithms', 1, 'second_semester', 2, 1, 'major'),
('MSC 121', 'Discrete Structures 1', 1, 'second_semester', 3, 0, 'major'),
('PATH-FIT 2', 'Fitness Training', 1, 'second_semester', 2, 0, 'pathfit'),
('NSTP 2', 'National Service Training Program 2', 1, 'second_semester', 0, 0, 'nstp'),
('LuxMundi 2', 'Responsible Citizenship and Good Governance', 1, 'second_semester', 0, 0, 'luxmundi');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('MSC 131', 'Discrete Structures 2', 1, 'summer', 3, 0, 'major'),
('PSC 131', 'Digital Logic Design', 1, 'summer', 3, 0, 'major'),
('PSC 132', 'Algorithms and Complexity', 1, 'summer', 3, 0, 'major');




INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GE Ethics', 'Ethics', 2, 'first_semester', 3, 0, 'ge'),
('PSC 211', 'Automata Theory and Formal Languages', 2, 'first_semester', 3, 0, 'major'),
('MSC 212', 'Advanced Statistics and Probability, Numerical Methods', 2, 'first_semester', 3, 0, 'major'),
('PSC 212', 'Programming Languages', 2, 'first_semester', 2, 1, 'major'),
('PSC 213', 'Object-Oriented Programming', 2, 'first_semester', 2, 1, 'major'),
('CIC 211', 'Information Management', 2, 'first_semester', 2, 1, 'major'),
('ESC 211', 'CS Elective 1 - PC Troubleshooting and Networking', 2, 'first_semester', 2, 1, 'elective'),
('PATH-FIT 3', 'Dance', 2, 'first_semester', 2, 0, 'pathfit'),
('LuxMundi 3', 'Life Skills in the Post Modern Era', 2, 'first_semester', 0, 0, 'luxmundi');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GEE LITERA', 'Living in the IT Era', 2, 'second_semester', 3, 0, 'ge'),
('MSC 221', 'Calculus 1 with Analytic Geometry', 2, 'second_semester', 3, 0, 'major'),
('CIC 221', 'Applications Development and Emerging Technologies', 2, 'second_semester', 2, 1, 'major'),
('PSC 221', 'Software Engineering 1', 2, 'second_semester', 2, 1, 'major'),
('PSC 223', 'Operating Systems', 2, 'second_semester', 2, 1, 'major'),
('PSC 222', 'Architecture and Organization', 2, 'second_semester', 2, 1, 'major'),
('ESC 221', 'CS Elective 2 - Mobile Application Development', 2, 'second_semester', 2, 1, 'elective'),
('PATH-FIT 4', 'Individual & Team Sports', 2, 'second_semester', 2, 0, 'pathfit'),
('LuxMundi 4', 'Professional and Personality Development', 2, 'second_semester', 0, 0, 'luxmundi');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('MSC 231', 'Linear Algebra', 2, 'summer', 3, 0, 'major'),
('PSC 231', 'Information Assurance and Security', 2, 'summer', 3, 0, 'major'),
('ESC 231', 'Research Methodology', 2, 'summer', 3, 0, 'major');




INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GE JRiz', 'The Life and Works of Rizal', 3, 'first_semester', 3, 0, 'ge'),
('PSC 311', 'Software Engineering 2', 3, 'first_semester', 2, 1, 'major'),
('PSC 312', 'Human Computer Interaction', 3, 'first_semester', 2, 1, 'major'),
('ESC 314', 'Multimedia Systems', 3, 'first_semester', 2, 1, 'major'),
('ESC 311', 'CS Elective 3', 3, 'first_semester', 3, 0, 'elective'),
('ESC 312', 'Compiler Design', 3, 'first_semester', 2, 1, 'elective'),
('ESC 313', 'Web Application Development', 3, 'first_semester', 2, 1, 'elective');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GEE PPOP', 'Philippine Pop Culture', 3, 'second_semester', 3, 0, 'ge'),
('PSC 321', 'Thesis 1 (Research Project Analysis and Design)', 3, 'second_semester', 2, 1, 'major'),
('PSC 322', 'Networks and Communications', 3, 'second_semester', 2, 1, 'major'),
('PSC 323', 'Social Issues and Professional Practice', 3, 'second_semester', 3, 0, 'major'),
('ESC 321', 'CS Elective 4', 3, 'second_semester', 2, 1, 'elective'),
('ESC 322', 'Business Analytics', 3, 'second_semester', 2, 1, 'elective'),
('ESC 323', 'Modeling and Simulation', 3, 'second_semester', 2, 1, 'elective');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('GEE GENSOC', 'Gender and Society', 4, 'first_semester', 3, 0, 'ge'),
('ESC 411', 'IT Seminars', 4, 'first_semester', 1, 0, 'elective'),
('ESC 412', 'CS Elective 5', 4, 'first_semester', 2, 1, 'elective'),
('ESC 413', 'CS Elective 6', 4, 'first_semester', 2, 1, 'elective'),
('PEC 411', 'Professional Enhancement Course', 4, 'first_semester', 3, 0, 'elective'),
('PSC 411', 'Thesis 2 (Project Implementation)', 4, 'first_semester', 2, 1, 'major');


INSERT INTO courses(course_code, course_title, year_level, semester_type, lec_units, lab_units, category) 
VALUES
('PSC 421', 'On the Job Training (500 Hours)', 4, 'second_semester', 6, 0, 'major');

