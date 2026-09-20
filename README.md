TCGC ICS Plotting System

A local web-based scheduling and subject-offering management system for the Institute of Computer Studies (ICS) of Tangub City Global College (TCGC).

The system is designed for an Institute Head/coordinator to manage courses, blocks, faculty, rooms, faculty-course assignments, SPARE allocations, and weekly class schedules while automatically checking important scheduling constraints.

1. Technology Stack

Frontend: HTML5, CSS3, JavaScript (ES6+)

Backend: PHP REST-style API

Database: MySQL / MariaDB

Database Access: PHP PDO

Authentication: PHP sessions with password hashing

API Format: JSON

Icons: Font Awesome CDN

Server Environment: XAMPP/Apache + MySQL

No Node.js, npm, Composer, or build step is required.

2. Main System Functions

Dashboard

The dashboard provides an overview of the current scheduling data, including:

Schedule statistics

Weekly schedule overview

Schedule health/validation information

Items that need attention

Recent activity

Quick actions

The conflict rule itself was corrected to match how SET 0/1/2 actually work. **Important: this rule governs ROOM conflicts only.** Instructor and section conflicts are always checked independently, at the same day/time, regardless of which SETs are involved -- the SET 1/SET 2 alternation never excuses a faculty or a section being double-booked, only a room being shared.
- **SET 0** is always face-to-face and never alternates, so it room-conflicts with anything at the same room/time
- **The same alternating set** (SET 1 + SET 1, or SET 2 + SET 2) always lands on the same week, so it room-conflicts
- **SET 1 + SET 2** are opposite rotations and are NOT physically simultaneous, so they do **not** room-conflict

### Which SET a course uses

- **Every course can be SET 0, SET 1 or SET 2, at any year level.** The scheduler picks the SET per course (Plot Schedule form, or the Set cell in the Course Offering table).
- The SET a course starts with is only a **default**: Laboratory = SET 0; Lecture = SET 1 for 1st/4th year, SET 2 for 2nd/3rd year. It is not a restriction.
- The room-conflict rule (`sets_conflict()`) is unchanged.

The default lives in `default_set_type()` in `api/schedules.php` (authoritative; `allowed_set_types()` now returns all three) and is mirrored in `assets/js/app.js` (`defaultSetType()` / `setsConflict()`). The old one-time SET data-fix migration has been removed -- the SET is chosen per schedule and is never overwritten by the database file.

## Instructor Is Optional While Plotting (2026-09-19)

Plotting usually happens before final instructor assignment, so a schedule can now be saved **without** an instructor.

- **No instructor** -> saves normally, shown with an amber "Not assigned" warning (schedule tables, timetable cards, the Course Offering table, and a Dashboard "Needs Attention" item). The Schedules filter also has an "Instructor not assigned" option.
- **Instructor assigned, no conflict** -> normal.
- **Instructor double-booked** -> still a real conflict (red) and still blocks the save. A missing instructor is never treated as a conflict, and two unassigned schedules never conflict with each other.
- Every instructor-specific rule (eligibility for the course, active status, max preparations, Lecture/Lab same-instructor, double-booking) runs only once an instructor is chosen, so assigning one later is when it gets checked.

`schedules.faculty_id` is nullable. This is already built into `database/ics_plotting.sql`; no migration is needed.

Plot Schedule

The scheduler follows this general flow:

Academic Year → Year Level → Block/SPARE → Course Offering → Component → Schedule Details

A schedule can contain:

Lecture component

Laboratory component

Faculty

Room

SET type

Day pattern

Start/end time

School year

Notes

Already-plotted course components can be edited instead of being duplicated.

Schedules

The Schedules view provides:

Complete schedule list

Filtering by school year

Filtering by year level

Filtering by semester

Filtering by Block/SPARE target

Filtering by faculty

Search/sorting/pagination

Schedule conflict indicators

Quick editing of schedule fields

Printing

Timetables

The Timetables view generates a weekly timetable for:

Block

Faculty

Timetables display the scheduled time, course, faculty, room, and SET information and can be printed.

Reports and Print Preview

Every report follows the same flow: Page, then Print Preview, then Print. Nothing prints straight from a page. The Print Preview button opens a popup with the school header and the formatted report, and only the Print button inside that popup opens the browser print dialog. The preview is built from the same data the page is showing (its filters, and for the Schedule List also the search box and sort), so the printout never differs from the screen.

Where each report lives:

Schedules page, Schedule List: Class Schedule (Print Preview button beside the search box).

Schedules page, Incomplete Assignments tab: Incomplete Schedule Assignments (schedules with no instructor, no room, or neither).

Timetables page: Block Timetable and Faculty Load.

Plot Schedule page: Course Offering.

Rooms page, Room Utilization tab: classes per room and weekly hours.

Courses page, Unscheduled Courses tab: courses assigned to a block or separate SPARE that still lack a Lecture or Laboratory schedule, plus courses not assigned to any block.

Faculty Assignments page, Assignments Report tab: courses per instructor (filtered by Semester and Year Level; assignments are not tied to an Academic Year).

Each tab shows its filters, a summary line (for example "Showing 5 schedules that still need instructor and/or room assignments."), and the live report table. Every preview and printout has the school letterhead, the report title, the Academic Year and Semester (where the report has them), the filters used, and the print date. Long lists continue onto more pages with the table header repeated, and wide reports print in landscape. The sidebar, filters and buttons are never printed.

The tab reports are built from data already loaded in the browser, so they need no extra API or database changes.

Day patterns are shown as school-style codes: MWF, TTh, MW, S, Su, MTWThF.

Course Management

Courses contain:

Course code

Course title

Year level

Semester

Lecture units

Laboratory units

Category

Course capacity (default 30 for a course with a Lab, 45 for pure lecture; editable)

Course capacity is informational only. It is not used as a hard scheduling restriction.

Block Management

Blocks replace the previous Section-based grouping model.

To create blocks:

Select a year level.

Enter the number of blocks to create.

The system automatically creates Block 1, Block 2, etc.

Adding more blocks later continues from the highest existing block number.

Blocks do not have a capacity field.

Assign Courses

Courses are assigned to Blocks through a many-to-many relationship.

This means:

One Block can have many Courses.

One Course can belong to many Blocks.

Only courses assigned to the selected Block appear in the normal Block scheduling flow.

SPARE Allocation

SPARE is a separate allocation group for students/courses that cannot simply be represented by the normal Block structure.

There is one SPARE group per Program + Year Level.

Each course can be configured as:

Join Block

SPARE students join an existing Block's class.

No separate SPARE schedule is created.

A target Block is selected.

The allocation is informational/scheduling linkage.

Separate Schedule

The SPARE course receives its own class schedule.

The SPARE group becomes a scheduling target.

A separate instructor, room, day/time, and component schedule can be plotted.

The course must be explicitly configured as separate_schedule.

Faculty Management

Faculty records contain:

Faculty name

Maximum preparations

Active/Unavailable status

Inactive faculty cannot be assigned to new schedules.

Existing schedules can still be edited when the inactive faculty remains assigned to that schedule.

Room Management

Rooms contain:

Room name

Room type

Active/Unavailable status

Supported room types:

Lecture

Laboratory

There is no room capacity field.

Inactive rooms cannot be assigned to new schedules.

Faculty Course Assignments

A faculty member must be assigned to a course before that faculty member can teach it in a schedule.

Assignments can be:

Added

Edited

Deleted

CSV Import

CSV import is available for:

Courses

Blocks

Course imports support the required course information plus optional fields such as category and units.

Block imports use:

year_level

number_of_blocks

optional program_code

Blocks are automatically named by the system.

CSV templates can be obtained from the Import interface.

3. Scheduling Rules

The backend is the authoritative source for schedule validation. The frontend also provides live/advisory conflict feedback while entering a schedule.

Schedule Duration Rule

Schedule duration is NOT derived from course units.

Units stay on the course as academic information only. When plotting, the scheduler picks:

Day Pattern

Start Time

Duration per day (applies to every selected meeting day)

End Time is computed automatically: Start Time + Duration per day.

Examples:

Regular semester: 3 units, M/W/F, 8:00 AM to 9:00 AM (1 hour per meeting day)

Summer: 3 units, M/T/W/Th/F, 8:00 AM to 11:00 AM (3 hours per meeting day)

The system does not assume 3 units = 3 hours/week and does not restrict the selectable duration by units. Its job is to check schedule conflicts (instructor, block, room) and basic input rules. If the school needs a contact-hour rule for a specific course or term, it should be added as its own explicit validation rule.

Valid Days

Schedules support:

Monday

Tuesday

Wednesday

Thursday

Friday

Saturday

Sunday

Common presets include:

MWF

TTH

MW

TF

Saturday

Custom Days

Custom Days allow any valid combination of weekdays.

SET Types

The system supports:

SET 0 — always face-to-face

SET 1 — alternating hybrid rotation

SET 2 — alternating hybrid rotation

Any course can use any SET, at any year level. The default when plotting:

Year Level

Default SET (Lecture)

1st Year

SET 1

2nd Year

SET 2

3rd Year

SET 2

4th Year

SET 1

Laboratory defaults to SET 0. All three SETs stay selectable for every course.

SET 1 and SET 2 are hybrid rotations, not permanently online classes. They still have face-to-face weeks.

Room Requirement

A room is required for all SET types because every supported SET includes a face-to-face meeting period.

SET 0: room required for face-to-face meetings

SET 1: room required during its face-to-face week

SET 2: room required during its face-to-face week

Room type must also match the component:

Lecture → Lecture room

Laboratory → Laboratory room

Instructor Consistency

For the same course, target, and school year:

Lecture and Laboratory must use the same instructor.

The same component cannot be plotted twice.

If a Lecture already exists for a course/Block, another Lecture schedule cannot be created for that same offering.

Faculty Preparation Limit

The system counts unique course preparations for a faculty member by:

School Year + Semester

The faculty member's max_preparations value is enforced when a new course preparation would exceed the limit.

A course's Lecture and Laboratory components do not count as two separate preparations.

Conflict Detection

The system checks for:

Instructor conflicts

Block/SPARE target conflicts

Room conflicts

Duplicate course components

Instructor mismatch between course components

Conflicts are scoped to the same:

School year

Semester

Day/time overlap

A schedule in a different school year or semester does not create a conflict with the current term.

SET-Aware Room Conflict

For physical room conflicts:

SET 0 conflicts with any overlapping schedule.

SET 1 + SET 1 conflicts.

SET 2 + SET 2 conflicts.

SET 1 + SET 2 may share a room/time because their F2F weeks alternate.

However, the SET exception never bypasses instructor or Block/SPARE conflicts.

Lectures and specified non-alternating minor categories continue to conflict for room usage even when SET 1 and SET 2 are opposite rotations.

4. Authentication

The system currently includes a login/logout flow.

Default database account:

Username: institute_head
Password: ics12345

This account is created by database/ics_plotting.sql.

Important

The default password is intended for initial/local setup. Change the password before using the system in a real deployment.

5. Project Structure

ics_plotting_system/
│
├── index.html
│
├── api/
│   ├── auth.php
│   ├── blocks.php
│   ├── block_courses.php
│   ├── bootstrap.php
│   ├── config.php
│   ├── courses.php
│   ├── dashboard.php
│   ├── faculty.php
│   ├── faculty_courses.php
│   ├── import.php
│   ├── response.php
│   ├── rooms.php
│   ├── schedules.php
│   ├── sections.php
│   └── spares.php
│
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── img/
│       ├── ics-logo.png
│       └── tcgc-logo.jpg
│
├── database/
│   └── ics_plotting.sql          <- the ONE complete database file (schema + courses + instructors); no migration files
│
└── UI_IMPROVEMENTS.md

Note: The current application uses Blocks, not Sections. If an old sections.php or Section-related file exists in a copy of the project, it should not be treated as part of the current Block/SPARE workflow.

6. Database Structure

The main database is:

ics_plotting_system

Important tables:

Table

Purpose

users

Login accounts

courses

Course/curriculum information

blocks

Student grouping by year level

block_courses

Block-to-course assignments

spares

SPARE groups

spare_course_allocations

Course-specific SPARE handling

faculty

Faculty information

faculty_courses

Faculty-to-course assignments

rooms

Room information

schedules

Plotted schedules

The schedules table targets either:

a regular Block, or

a SPARE group

but never both at the same time.

7. Installation Using XAMPP

Requirements

Install:

XAMPP

Apache

MySQL/MariaDB

A modern web browser

Step 1 — Copy the Project

Place the project in the XAMPP htdocs directory.

Example:

C:\xampp\htdocs\ics_plotting_system\

Step 2 — Start XAMPP

Start:

Apache

MySQL

Step 3 — Configure the Database Connection

Open:

api/config.php

The current configuration is:

const DB_HOST = '127.0.0.1';
const DB_PORT = '3307';
const DB_NAME = 'ics_plotting_system';
const DB_USER = 'root';
const DB_PASS = '';

If MySQL uses the normal XAMPP port, change:

const DB_PORT = '3306';

If your MySQL uses another port, use that port instead.

Keep DB_HOST as 127.0.0.1 when relying on the configured TCP port.

Step 4 — Import the Database

Create an empty database (locally: `ics_plotting_system`; online: the database created in your hosting panel), open it in phpMyAdmin and import:

database/ics_plotting.sql

This ONE file is the complete database: it creates all tables and constraints, and loads the starter data (login, rooms, blocks, the 16 instructors, all 63 BSCS 2023-2024 curriculum courses, and the Block-Course assignments). No migration files are needed. Online, also set the database host/name/user/password in `api/config.php`. **It drops and recreates every table, so importing it erases existing data -- export your current database first if you want to keep it.**

Because the current Block/SPARE design is a breaking schema change, a fresh import of ics_plotting.sql is recommended for a new installation rather than mixing old Section-based data with the new schema.

Step 5 — Disable Debug Mode Before Real Use

Open:

api/config.php

Change:

const APP_DEBUG = true;

to:

const APP_DEBUG = false;

Debug mode can expose server/database exception details and should not remain enabled for real use.

Step 6 — Open the System

Use:

http://localhost/ics_plotting_system/

Log in using the configured account.

8. Recommended Initial Workflow

For a new academic schedule:

Log in.

Add/check Courses.

Add/check Faculty.

Add/check Rooms.

Assign Courses to Faculty.

Create Blocks for each Year Level.

Assign Courses to the appropriate Blocks.

Configure SPARE allocations when necessary.

Open Plot Schedule.

Select Academic Year, Year Level, and Block/SPARE.

Review the generated course offering.

Plot the required Lecture/Laboratory components.

Resolve any validation/conflict messages.

Review the Schedules list.

Check the Timetables view.

Print the required timetable/schedule.

9. Security Features

The backend includes several protections:

Password verification using PHP password hashing

PHP session authentication

Session ID regeneration after login

HttpOnly session cookies

SameSite cookie protection

HTTPS-aware Secure cookie configuration

CSRF token generation and validation

Prepared SQL statements through PDO

Backend validation of schedule rules

Friendly database error handling

HTML escaping in frontend-generated content

The frontend's validation is only advisory where applicable. The backend performs the authoritative validation before saving schedules.

10. Current Limitations

The following are intentionally not fully implemented:

Editing a course's year level/semester/units after schedules already exist does not automatically re-validate every existing schedule against the new course definition.

No faculty-side account/login for view-only teaching loads.

No Excel/CSV export of schedules.

No full faculty teaching-hours/overload calculation; only maximum unique course preparations are enforced.

No day-specific or time-specific faculty availability/blackout settings.

Timetable cells may visually stack schedules when legitimate alternating SET schedules occupy the same time slot.

Individual student-level scheduling is outside the system scope. The system works with Block schedules rather than individual enrollment schedules.

SPARE currently supports one SPARE group per Program + Year Level.

11. Important Design Decisions

Blocks instead of Sections

The current system intentionally uses Block as the student grouping unit.

Blocks:

Are created automatically.

Do not store capacity.

Are connected to courses through block_courses.

Course Capacity

courses.max_students defaults to 30 (course has a Lab) or 45 (pure lecture), can be edited, and is informational.

It is not:

a Block capacity,

a Room capacity,

or a hard schedule-planning restriction.

It can be used as a reference when deciding whether a SPARE allocation is necessary.

Laboratory Hours

Laboratory units are academic information only, the same as lecture units. They decide whether a Laboratory component must be plotted, not how long it runs. The duration is chosen per component when plotting.

SPARE

SPARE is deliberately separated from regular Blocks.

A SPARE course either:

joins an existing Block, or

receives its own separate SPARE schedule.

12. API Endpoints

The frontend communicates with these PHP endpoints:

api/auth.php
api/blocks.php
api/block_courses.php
api/courses.php
api/dashboard.php
api/faculty.php
api/faculty_courses.php
api/import.php
api/rooms.php
api/schedules.php
api/spares.php

All protected management/scheduling endpoints require an authenticated session.

State-changing requests are protected by the CSRF token mechanism.

13. Frontend Notes

The main frontend files are:

index.html
assets/css/style.css
assets/js/app.js

The UI includes:

Responsive sidebar

Dashboard cards

Modal-based forms

Toast notifications

Confirmation dialogs

Search

Sorting

Pagination

Live scheduling conflict preview

Suggested alternative times

Quick schedule editing

Responsive layouts

Print-specific styling

Loading states for save/login actions

Keyboard-friendly focus states

Font Awesome is currently loaded from a CDN, so the icons require network access unless the dependency is changed to a local copy.

14. Development / Maintenance Notes

When changing scheduling rules, update both:

api/schedules.php

and the corresponding frontend logic in:

assets/js/app.js

The backend must remain the authoritative validator.

When changing the database schema:

Update the main schema/migration as appropriate.

Check all related PHP APIs.

Check frontend state and forms.

Test existing schedule conflict behavior.

Test Block and SPARE flows.

Re-test timetable generation and printing.

15. Project Status

The current system includes the core workflow for:

Course → Faculty → Block/SPARE → Course Assignment → Schedule Plotting → Conflict Validation → Schedule List → Timetable/Printing

The current data model is based on Blocks + SPARE, not the previous Section model.

For a clean installation, use the current database/ics_plotting.sql schema and configure the MySQL port in api/config.php to match the local XAMPP installation.

## Room Is Optional While Plotting (2026-09-20)

Like the instructor, a room can be assigned later. A schedule with no room saves normally and shows an amber "No room yet" warning (Course Offering table, Schedules table, Dashboard "Needs Attention"). A **room conflict** (same room double-booked, SET rules unchanged) and the room rules (active room, lecture room for lectures, lab room for labs) only apply once a room is actually chosen.

This is already built into `database/ics_plotting.sql` (`schedules.room_id` is nullable); no migration is needed -- just import that one file.

## Faculty Assignments: Multi-Select (2026-09-20)

Faculty Assignments -> **Assign** now works like this:

1. Pick the **Instructor**.
2. Use the **1st / 2nd / 3rd / 4th Year** chips (or All) to filter the course list, and the filter box to search by code/title. Picks are kept when you switch years.
3. Tick as many courses as needed (courses the instructor already has are ticked and locked). "Select all shown" / "Clear" help with bulk picking.
4. Click **Add (n)** -> a confirmation step lists the picked courses; uncheck any mistakes, then **Confirm & Save**. Or turn on **Save directly (skip confirmation)** (remembered in the browser) to save straight from Add.

Editing an existing assignment (pencil icon) reuses the same list in single-choice mode. The API accepts `{ faculty_id, course_ids: [...] }` on `POST api/faculty_courses.php` (all-or-nothing transaction; already-assigned courses are skipped and reported). The old single `{ faculty_id, course_id }` form still works.

## Faculty Assignments Table + Instructor Picker (2026-09-20)

- **Faculty Course Assignments** now shows each instructor **once**. The **View n courses** button expands that instructor's courses (with edit/remove per course); **+** opens the Assign modal with that instructor already chosen. Searching a course code still finds the instructor.
- **Plot Schedule -> Instructor** lists **every active instructor**. Instructors assigned to the selected course are marked with a check mark and grouped first; everyone else is under "Other instructors". Being assigned to the course is only an indicator, never a restriction.
- Picking an instructor who is **not** assigned to the course shows an optional tick-box: **"Also assign <name> to <course>"**. Ticked -> they are added to Faculty Course Assignments when the schedule is saved. Unticked -> the schedule is still saved with that instructor and the assignments list is left alone.
- No database change is needed for this.
