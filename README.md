# TCGC ICS Plotting System

Technology used:
- HTML
- CSS
- JavaScript
- PHP REST API backend
- MySQL database
- JSON API responses

Theme:
- Maroon theme
- TCGC and ICS logos included in `assets/img`

## Main User
Institute Head only.

## Main Features
- Course management
- Faculty management
- Section management using number-based sections like 172, 173, 174
- Room management with lecture/laboratory type
- Faculty-course assignment
- Manual schedule plotting
- Online / Face-to-Face mode
- SET 0, SET 1, SET 2 support
- Printable schedule list

## Validations Applied
- Instructor conflict checking
- Section/block conflict checking
- Room conflict checking for face-to-face classes only
- Online classes do not require room assignment
- Laboratory component must use laboratory room
- Lecture component must use lecture room
- Room capacity must be enough for section student count
- Faculty can only teach assigned/allowed courses
- Faculty has maximum of 4 preparations only
- Laboratory duration follows: 1 lab unit = 3 hours per week
- Lecture duration follows: 1 lecture unit = 1 hour per week

## Setup in XAMPP
1. Copy the `ics_plotting_system` folder to:
   `C:\xampp\htdocs\`

2. Open phpMyAdmin.

3. Import:
   `database/ics_plotting.sql`

4. Check database connection in:
   `api/config.php`

   Default:
   ```php
   DB_HOST = 127.0.0.1
   DB_PORT = 3306
   DB_NAME = ics_plotting_system
   DB_USER = root
   DB_PASS = empty
   ```

   **If your XAMPP MySQL runs on a different port** (common if you already have another MySQL/MariaDB installed and it's fighting over port 3306 -- e.g. it got bumped to 3307), just change `DB_PORT` in `api/config.php` to match. Check your actual port in XAMPP Control Panel > MySQL > Config > `my.ini` (look for the `port =` line).

   Leave `DB_HOST` as `127.0.0.1` -- don't change it to `localhost`. This isn't just style: PHP's MySQL driver treats `localhost` as "connect via the local Unix socket file," which completely ignores whatever you put in `DB_PORT`. Only `127.0.0.1` (or the actual IP) forces a real TCP connection on the port you specify. This one tripped up testing before it was caught.

5. Open in browser:
   `http://localhost/ics_plotting_system/`

## Default Institute Head Login Record
A login screen now gates the whole app. Default account:
- username: `institute_head`
- password: `ics12345`

Log in with these on first run. (If you already had a copy of this project installed before 2026-07-14, run `database/migration_fixes_2026-07-14.sql` once — it corrects a broken password hash from the old seed data and adds the `delivery_mode` column schedules now needs.)

## API Files
All API files return JSON responses. `courses.php`, `sections.php`, `faculty.php`, `rooms.php`, and `schedules.php` support GET/POST/PUT/DELETE (PUT edits an existing record by `id`). `faculty_courses.php` supports GET/POST/DELETE only. All of these require an active login session except `auth.php` itself:
- `api/auth.php` — GET checks session, POST logs in, DELETE logs out
- `api/dashboard.php`
- `api/courses.php`
- `api/sections.php`
- `api/rooms.php`
- `api/faculty.php`
- `api/faculty_courses.php`
- `api/schedules.php`

## Important Note
This version is focused on the Institute of Computer Studies plotting process and is designed to replace manual Excel plotting with structured validation and conflict detection.


Updated Features:
- Full BSCS prospectus-based courses (1st-4th year + summer)
- SET 0/1/2 classification
- Faculty-course qualification filtering
- Weekly hour validation
- Laboratory room validation
- Section, room, and instructor conflict detection
- Login-gated access (session-based)
- Edit/update support for courses, sections, faculty, rooms, and schedules (not just add/delete)
- Schedule list filtering by school year, year level, semester, section, and faculty
- School year tracking on every schedule (format YYYY-YYYY), so semesters/years don't mix together
- Course year-level is validated against the section's year level when plotting (blocks e.g. a 4th year course for a 1st year section)

## UI/UX Overhaul (2026-07-30)
The interface was refined into a modern admin portal while keeping the maroon/gold/white branding and existing workflow intact:
- Compact header, sidebar organized into "Operations" and "Management" groups
- Add/Edit forms for Courses, Sections, Faculty, Rooms, and Faculty Course Assignments now open in modal dialogs instead of sitting above the table
- Toast notifications (success/error) replace browser `alert()`-style messages
- Custom confirmation dialog replaces the native browser confirm popup before deleting anything
- Every management table now has search, sortable columns, pagination, and a proper empty state (different message when a search finds nothing vs. when the table is genuinely empty)
- Dashboard adds a Recent Activity feed and Quick Actions panel alongside the existing stat cards and validations panel
- The Print button now only appears on the Schedules view (removed from Courses/Sections/Faculty/Rooms/Assignments, where it didn't make sense)
- Disabled fields (e.g. "select a course first") now show a greyed-out state with a tooltip explaining why
- Escape key and clicking outside a modal both close it; focus-visible outlines added for keyboard navigation
- Mobile: sidebar collapses behind a toggle button below 768px width

## Live Conflict Preview + SET-Aware Conflict Rule (2026-07-30)
Plot Schedule now has:
- A **Duration** dropdown (30 min to 3 hrs, or Custom) that auto-computes End Time -- no more manual math
- A **live conflict preview** that checks Instructor/Room/Section conflicts as you fill out the form, before you hit Save (advisory only -- the backend still re-validates everything on Save, which remains the authoritative check)
- **Suggested alternative times** shown automatically when a conflict is detected

The conflict rule itself was corrected to match how SET 0/1/2 actually work:
- **SET 0** is always face-to-face, so it conflicts with anything at the same room/instructor/section/time
- **The same alternating set** (SET 1 + SET 1, or SET 2 + SET 2) always lands on the same week, so it conflicts
- **SET 1 + SET 2** alternate on opposite weeks and are NOT physically simultaneous, so they do **not** conflict by default
- **Exception:** if either side is a lecture component, or a non-major (minor) course, it still conflicts even when SET 1 + SET 2 -- lab components of major courses are the ones that genuinely rotate week-to-week

This rule lives in `is_minor_or_lecture()` and `sets_conflict()` in `api/schedules.php` (authoritative) and is mirrored in `assets/js/app.js` (`isMinorOrLecture()` / `setsConflict()`) for the live preview only.

## Term-Scoped Conflicts + Availability Toggle (2026-08-01)
Two correctness fixes and one new feature:

- **Conflicts are now scoped to the same term.** Instructor/section/room conflict checks, and the faculty "max preparations" count, previously ran against *every* schedule ever plotted, with no regard for school year or semester. That meant a class from SY 2025-2026 could falsely block the same room/time in SY 2026-2027, and a faculty's preparation count never reset between semesters. Both the backend (`api/schedules.php`) and the live preview (`assets/js/app.js`) now scope these checks to the same `school_year` + the course's `semester_type` as the schedule being plotted. Run `database/migration_fixes_2026-08-01.sql` once if upgrading (adds `is_active` -- see below).
- **Faculty and Rooms now have an Active/Unavailable toggle** (`is_active`), editable from their Add/Edit forms with a Status column in each table. Use this instead of deleting when a faculty resigns/goes on leave or a room is under repair -- deleting a faculty or course still cascades and permanently removes every linked schedule, which is rarely what you want. Inactive faculty/rooms are hidden from the Plot Schedule dropdowns (except the one already on the record you're currently editing) and are blocked server-side from being assigned to new schedules.
- **Delete confirmation now shows impact.** Deleting a faculty, course, or section that has linked schedules now tells you how many schedules will also be permanently deleted before you confirm. Deleting a room that's in use tells you how many schedules will have their room unassigned (rooms don't cascade-delete schedules, they just get set to "no room").
- **Bug fix (found during verification):** marking a faculty or room inactive was blocking edits to their *existing* schedules too, even when the faculty/room assignment itself wasn't changing (e.g. just adjusting the time). `api/schedules.php` now only blocks the inactive faculty/room when it represents a *new* assignment -- editing a schedule while keeping its current (now-inactive) faculty/room still works; reassigning to a *different* inactive faculty/room is still correctly blocked.

## Plotting UX Improvements (2026-08-06)
- **Faculty Course Assignments can now be edited**, not just added/deleted.
- **Start/End time are now dropdowns** (30-minute steps, 6:00 AM - 9:00 PM) instead of the native time-wheel picker, which is faster to use than scrolling. End Time stays auto-computed from Duration as before; switching Duration to "Custom" makes it a normal editable dropdown again.
- **Day Pattern now supports custom day combinations.** The quick presets (MWF, TTH, MW, TF, Saturday) are still there for the common cases, but picking "Custom Days" reveals a Mon-Sun checkbox row so you can build any combination (e.g. Monday + Thursday + Saturday). Under the hood, `day_of_week` changed from a fixed list to a flexible column storing the actual day names (e.g. `"Monday,Wednesday,Friday"`), so there's no more mismatch between what's stored and what a "Custom" pattern actually means. Old un-migrated rows using the short codes (MWF/TTH/MW/TF) still work correctly against new rows -- see `database/migration_fixes_2026-08-06.sql` if you have an existing install.
- **Course dropdowns are now grouped by year level** (1st Year / 2nd Year / 3rd Year / 4th Year) in the Plot Schedule and Faculty Course Assignment forms, instead of one long flat list.

## Feedback Loading States (2026-08-12)
Checked the system against Don Norman's 5 design principles (Visibility, Feedback, Constraints, Affordance, Consistency). Found one real gap under Feedback: Save/Log In buttons gave no indication a request was in flight, so a slow connection could look like nothing happened. Fixed:
- Every Save button (Courses, Sections, Faculty, Rooms, Assignments, Schedules) now shows a spinner + "Saving..." and disables itself the instant you submit, and re-enables with its normal label if the request fails.
- The Log In button does the same ("Logging in...").

## User-Journey Test Fixes (2026-08-12)
Walked through the system as a first-time user end-to-end (login through logout) and fixed 3 real gaps found:
- **Room is now marked as conditionally required.** SET 0 (always face-to-face) needs a room, but the field never said so until you got a validation error on Save. The asterisk and a short hint now appear/disappear live as you change the Set Type.
- **Section's 30-student cap is now shown before you hit the limit**, not just as an error message after.
- **Login screen now hints at the default account** (`institute_head`) for first-time setup, without printing the actual password on screen -- it points to this README instead, since showing a password on a login page is bad practice even for a local single-admin system.

## Known Remaining Gaps (not yet implemented)
- Editing a course's units/year-level/semester after schedules already exist for it is not retroactively re-validated against the DB rules -- the app only shows a toast telling you how many schedules to go re-check manually in the Schedules tab
- No visual weekly time-grid view for schedules (list view only, though it now has search/sort/pagination)
- No faculty/section load summary (total units, prep count at a glance)
- No bulk CSV import for courses, no "clone previous semester" shortcut
- No faculty-side login (view-only access to their own load)
- No export to Excel/CSV
- No total-teaching-hours/overload check across a faculty's full schedule (only the "max preparations" count is enforced, and it's now per-term rather than lifetime)
- No per-day/per-time instructor availability/blackout preferences (the Active/Unavailable toggle is all-or-nothing, not day-specific)
- Out of scope by design: individual student-level scheduling (transferees, irregular/deloaded students). This system plots block schedules per section; matching individual students to slots belongs in a separate enrollment/registration system.
