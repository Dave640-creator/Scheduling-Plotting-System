const API = 'api/';
const state = { courses: [], blocks: [], spares: [], blockCourseRows: [], faculty: [], rooms: [], schedules: [], assignments: [] };

// Tracks which record id (if any) each form is currently editing.
// null means the form is in "create new" mode. Blocks are managed through
// their own dedicated modals (Add Block / Rename Block / Assign Courses),
// not the generic entity-modal flow, but a rename-in-progress id is still
// tracked the same way for consistency.
const editing = { courses: null, blocks: null, faculty: null, rooms: null, schedules: null, assignments: null };

// Current schedule list filter selections. `target` is a composite value
// like "block:12" or "spare:3" (or '' for no filter) -- see parseTargetValue().
/** Value of the Faculty filter that shows only schedules with no instructor yet. */
const NO_INSTRUCTOR_FILTER = 'none';
const scheduleFilters = { schoolYear: '', year: '', semester: '', target: '', faculty: '' };
let coursesYearFilter = '';

// Per-table UI state: free-text search, sort column/direction, current page.
const tableState = {};
const PAGE_SIZE = 8;

const formConfig = {
  courses:     { formId: 'courseForm',        submitBtnId: 'courseSubmitBtn',   cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Course',    editLabel: '<i class="fas fa-check"></i> Update Course',    modalId: 'modalCourse',     modalTitleId: 'modalCourseTitle',   addTitle: 'Add Course',    editTitle: 'Edit Course' },
  faculty:     { formId: 'facultyForm',       submitBtnId: 'facultySubmitBtn',  cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Faculty',   editLabel: '<i class="fas fa-check"></i> Update Faculty',   modalId: 'modalFaculty',    modalTitleId: 'modalFacultyTitle',  addTitle: 'Add Faculty',   editTitle: 'Edit Faculty' },
  rooms:       { formId: 'roomForm',          submitBtnId: 'roomSubmitBtn',     cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Room',      editLabel: '<i class="fas fa-check"></i> Update Room',      modalId: 'modalRoom',       modalTitleId: 'modalRoomTitle',     addTitle: 'Add Room',      editTitle: 'Edit Room' },
  assignments: { formId: 'facultyCourseForm', submitBtnId: 'assignmentSubmitBtn', cancelBtnId: null,             addLabel: '<i class="fas fa-plus"></i> Add',        editLabel: '<i class="fas fa-check"></i> Update Assignment', modalId: 'modalAssignment', modalTitleId: 'modalAssignmentTitle', addTitle: 'Assign Courses to Faculty', editTitle: 'Edit Assignment' },
  schedules:   { formId: 'scheduleForm',      submitBtnId: 'scheduleSubmitBtn', cancelBtnId: 'scheduleCancelBtn', addLabel: '<i class="fas fa-save"></i> Save Schedule', editLabel: '<i class="fas fa-check"></i> Update Schedule',  modalId: null,              modalTitleId: null,                 addTitle: '',               editTitle: '' },
};

const deleteConfig = {
  courses:     { endpoint: 'courses.php',         stateKey: 'courses',     labelFn: c => `${c.course_code} - ${c.course_title}` },
  blocks:      { endpoint: 'blocks.php',          stateKey: 'blocks',      labelFn: b => `${b.program_code} ${b.year_level} - ${b.block_name}` },
  faculty:     { endpoint: 'faculty.php',         stateKey: 'faculty',     labelFn: f => f.faculty_name },
  rooms:       { endpoint: 'rooms.php',           stateKey: 'rooms',       labelFn: r => r.room_name },
  assignments: { endpoint: 'faculty_courses.php', stateKey: 'assignments', labelFn: a => `${a.faculty_name} \u2192 ${a.course_code}` },
  schedules:   { endpoint: 'schedules.php',       stateKey: 'schedules',   labelFn: s => `${s.course_code} (${formatDayPattern(s.day_of_week)} ${formatTimeDisplay(s.start_time.slice(0,5))}-${formatTimeDisplay(s.end_time.slice(0,5))})` },
};

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Populated from any response that includes one (auth.php GET/POST). Sent
// back on every state-changing request so the server can verify the request
// actually came from this app and not another site riding the session
// cookie (CSRF protection).
let csrfToken = null;

async function request(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const method = (options.method || 'GET').toUpperCase();
  if (csrfToken && method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
  }
  const res = await fetch(API + endpoint, {
    headers,
    credentials: 'same-origin',
    ...options,
  });
  const json = await res.json();
  if (json.data && json.data.csrf_token) csrfToken = json.data.csrf_token;
  if (res.status === 401) showLogin();
  if (!json.success) {
    const err = new Error(json.message || 'Request failed');
    err.data = json.data;
    err.status = res.status;
    throw err;
  }
  return json.data;
}

/* =====================================================
   TOAST NOTIFICATIONS
   ===================================================== */

function showToast(message, type = 'success') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
  const container = $('toastContainer');

  const existing = Array.from(container.querySelectorAll('.toast')).find(
    (t) => t.dataset.toastKey === `${type}:${message}`
  );
  if (existing) {
    existing.classList.remove('toast-hide');
    clearTimeout(Number(existing.dataset.toastTimer));
    const timer = setTimeout(() => {
      existing.classList.add('toast-hide');
      setTimeout(() => existing.remove(), 200);
    }, 4500);
    existing.dataset.toastTimer = String(timer);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.dataset.toastKey = `${type}:${message}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info} toast-icon"></i><div class="toast-msg">${escapeHtml(message)}</div><button class="toast-close" type="button" aria-label="Dismiss"><i class="fas fa-xmark"></i></button>`;
  const remove = () => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  container.appendChild(toast);
  const timer = setTimeout(remove, 4500);
  toast.dataset.toastTimer = String(timer);
}

/* =====================================================
   CONFIRM DIALOG (replaces window.confirm)
   ===================================================== */

let confirmResolver = null;

function showConfirm(message, title = 'Confirm Deletion', opts = {}) {
  const { confirmLabel = 'Delete', confirmIcon = 'fa-trash', danger = true } = opts;
  $('confirmTitle').textContent = title;
  $('confirmMessage').innerHTML = message;
  $('confirmAcceptBtn').innerHTML = `<i class="fas ${confirmIcon}"></i> ${escapeHtml(confirmLabel)}`;
  $('confirmAcceptBtn').classList.toggle('btn-danger', danger);
  $('confirmAcceptBtn').classList.toggle('btn-primary', !danger);
  $('confirmOverlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function closeConfirm(result) {
  $('confirmOverlay').classList.add('hidden');
  document.body.style.overflow = '';
  if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}
window.closeConfirm = closeConfirm;

/* =====================================================
   INSTRUCTOR CONFLICT MODAL
   Shown instead of a generic error toast when the backend rejects a
   schedule because Lecture/Laboratory of the same course+target (Block or
   SPARE) already has a different instructor. Never silently drops or
   deletes the existing schedule -- just warns, and offers a way to go
   look at it.
   ===================================================== */

const CONFLICT_MODAL_TITLES = {
  instructor_mismatch: '<i class="fas fa-user-lock"></i> Instructor Conflict',
  duplicate_component: '<i class="fas fa-copy"></i> Component Already Scheduled',
};

function showInstructorConflictModal(message, existingScheduleId, conflictType = 'instructor_mismatch') {
  $('instructorConflictTitle').innerHTML = CONFLICT_MODAL_TITLES[conflictType] || CONFLICT_MODAL_TITLES.instructor_mismatch;
  $('instructorConflictMessage').innerHTML = escapeHtml(message);
  const viewBtn = $('instructorConflictViewBtn');
  viewBtn.onclick = () => viewExistingSchedule(existingScheduleId);
  $('modalInstructorConflict').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeInstructorConflictModal() {
  $('modalInstructorConflict').classList.add('hidden');
  document.body.style.overflow = '';
}
window.closeInstructorConflictModal = closeInstructorConflictModal;

/** Builds the composite filter value ("block:12" / "spare:3") for one schedule row. */
function targetValueForSchedule(s) {
  return s.is_spare || s.spare_id ? `spare:${s.spare_id}` : `block:${s.block_id}`;
}

/** Parses a composite target value ("block:12" / "spare:3" / '') into { blockId, spareId } (both null if empty). */
function parseTargetValue(value) {
  if (!value) return { blockId: null, spareId: null };
  const [kind, idStr] = String(value).split(':');
  const id = Number(idStr);
  return kind === 'spare' ? { blockId: null, spareId: id } : { blockId: id, spareId: null };
}

/** Human-readable label for a Block or SPARE row, matching target_label() in api/schedules.php. */
function blockLabel(b) { return `${b.program_code} ${b.year_level} - ${b.block_name}`; }
function spareLabel(sp) { return `${sp.program_code} ${sp.year_level} - SPARE`; }

/**
 * Jumps to the Schedules tab, filtered to the conflicting Block/SPARE, and
 * briefly highlights the existing schedule row so the head can see exactly
 * what it's already assigned to before deciding what to do.
 */
function viewExistingSchedule(scheduleId) {
  closeInstructorConflictModal();
  const sched = state.schedules.find((s) => Number(s.id) === Number(scheduleId));
  scheduleFilters.schoolYear = '';
  scheduleFilters.year = '';
  scheduleFilters.semester = '';
  scheduleFilters.faculty = '';
  scheduleFilters.target = sched ? targetValueForSchedule(sched) : '';
  $('filterSchoolYear').value = '';
  $('filterYear').value = '';
  $('filterSemester').value = '';
  $('filterFaculty').value = '';
  // Year Level filter was just cleared -- refresh Block/SPARE's option list
  // back to "all" before selecting the target one, or it may not exist yet
  // in a list still narrowed from a prior Year Level filter.
  renderFilterOptions();
  $('filterTarget').value = scheduleFilters.target;
  activateView('schedules');
  const qs = currentFiltersQueryString();
  history.replaceState(null, '', qs ? `#schedules?${qs}` : '#schedules');
  getTableState('schedulesTable').page = 1;
  renderTables();
  const row = document.querySelector(`#schedulesTable tr[data-row-id="${scheduleId}"]`);
  if (row) {
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('row-highlight-flash');
    setTimeout(() => row.classList.remove('row-highlight-flash'), 2500);
  }
}
window.viewExistingSchedule = viewExistingSchedule;

/* =====================================================
   UNSAVED-CHANGES PROTECTION
   A form is marked "dirty" only by real user input/change events --
   cascading dropdowns, startEdit() populating fields, and cancelEdit()
   resetting them are all done via JS and never fire those events, so
   this only catches genuine unsaved edits, not programmatic updates.
   ===================================================== */

const dirtyForms = new Set();
const UNSAVED_FORM_COPY = {
  scheduleForm:      { title: 'Unsaved Schedule',   message: 'You have unfinished schedule information. Do you want to leave without saving?' },
  courseForm:        { title: 'Unsaved Course',     message: 'You have unsaved changes to this course. Do you want to leave without saving?' },
  facultyForm:       { title: 'Unsaved Faculty',    message: 'You have unsaved changes to this faculty member. Do you want to leave without saving?' },
  roomForm:          { title: 'Unsaved Room',       message: 'You have unsaved changes to this room. Do you want to leave without saving?' },
  facultyCourseForm: { title: 'Unsaved Assignment', message: 'You have unsaved changes to this assignment. Do you want to leave without saving?' },
};

function markFormDirty(formId) { dirtyForms.add(formId); }
function clearFormDirty(formId) { dirtyForms.delete(formId); }

async function confirmLeaveIfDirty(formId) {
  if (!dirtyForms.has(formId)) return true;
  const copy = UNSAVED_FORM_COPY[formId] || { title: 'Unsaved Changes', message: 'You have unsaved changes. Do you want to leave without saving?' };
  const leave = await showConfirm(copy.message, copy.title, { confirmLabel: 'Leave', confirmIcon: 'fa-right-from-bracket', danger: true });
  if (leave) clearFormDirty(formId);
  return leave;
}

Object.keys(UNSAVED_FORM_COPY).forEach((formId) => {
  const form = $(formId);
  if (!form) return;
  form.addEventListener('input', () => markFormDirty(formId));
  form.addEventListener('change', () => markFormDirty(formId));
});

// Browser-level fallback so an actual page refresh/tab close also warns,
// not just in-app navigation.
window.addEventListener('beforeunload', (e) => {
  if (!dirtyForms.size) return;
  e.preventDefault();
  e.returnValue = '';
});

/* =====================================================
   ENTITY MODALS (Add/Edit forms)
   ===================================================== */

function openEntityModal(entity) {
  cancelEdit(entity);
  const cfg = formConfig[entity];
  $(cfg.modalId).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (entity === 'courses') syncCourseCapacityFromLabUnits();
}
window.openEntityModal = openEntityModal;

/** Course Capacity has a DEFAULT driven by Lab Units -- 30 for a course with
    a Laboratory component, 45 for pure lecture (Lab Units = 0) -- but it is
    editable. The default keeps following Lab Units until the scheduler types
    their own number; a typed number is never overwritten. */
function defaultCourseCapacity() {
  return parseFloat($('labUnits').value || '0') > 0 ? 30 : 45;
}
function syncCourseCapacityFromLabUnits() {
  const input = $('courseMaxStudents');
  if (input.dataset.manual === '1') return;
  input.value = String(defaultCourseCapacity());
}
$('labUnits').addEventListener('input', syncCourseCapacityFromLabUnits);
$('courseMaxStudents').addEventListener('input', () => {
  const input = $('courseMaxStudents');
  input.dataset.manual = input.value.trim() === '' ? '' : '1';
});
// Left blank -> fall back to the default instead of saving "no capacity".
$('courseMaxStudents').addEventListener('blur', () => {
  const input = $('courseMaxStudents');
  if (input.value.trim() === '') { input.dataset.manual = ''; syncCourseCapacityFromLabUnits(); }
});

function closeEntityModal(entity) {
  const cfg = formConfig[entity];
  $(cfg.modalId).classList.add('hidden');
  document.body.style.overflow = '';
  cancelEdit(entity);
}
window.closeEntityModal = closeEntityModal;

// Guarded version for user-initiated closes (X button, backdrop, Escape) --
// confirms first if the form has unsaved edits. formSubmit()'s own success
// path calls closeEntityModal() directly, skipping this, since a save
// just happened and there's nothing left to lose.
async function requestCloseEntityModal(entity) {
  const cfg = formConfig[entity];
  const proceed = await confirmLeaveIfDirty(cfg.formId);
  if (!proceed) return;
  closeEntityModal(entity);
}
window.requestCloseEntityModal = requestCloseEntityModal;

// Guarded version of cancelEdit() for non-modal forms (Plot Schedule's
// "Cancel Edit" button) -- same unsaved-changes confirmation as modals get.
async function requestCancelEdit(entity) {
  const cfg = formConfig[entity];
  const proceed = await confirmLeaveIfDirty(cfg.formId);
  if (!proceed) return;
  cancelEdit(entity);
}
window.requestCancelEdit = requestCancelEdit;

/** Login password field: show the text (eye-slash icon) or hide it as dots (eye icon). */
function setPasswordVisible(show) {
  $('loginPassword').type = show ? 'text' : 'password';
  const btn = $('togglePasswordBtn');
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  btn.setAttribute('aria-pressed', String(show));
  btn.innerHTML = show ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
}

function showLogin() {
  $('appShell').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  setPasswordVisible(false); // never leave the password showing after a logout / expired session
  const btn = $('loginSubmitBtn');
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Log In';
}

function showApp() {
  $('loginScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
}

/* =====================================================
   GENERIC DATA TABLE (search + sort + pagination + empty state)
   ===================================================== */

function getTableState(tableId) {
  if (!tableState[tableId]) tableState[tableId] = { search: '', sortKey: null, sortDir: 'asc', page: 1 };
  return tableState[tableId];
}

function renderDataTable(tableId, columns, data, opts = {}) {
  const st = getTableState(tableId);
  let rows = data;

  if (st.search) {
    const q = st.search.toLowerCase();
    const searchableCols = columns.filter((c) => c.searchable !== false);
    rows = rows.filter((row) => searchableCols.some((c) => String(c.searchValue ? c.searchValue(row) : (row[c.key] ?? '')).toLowerCase().includes(q)));
  }

  if (st.sortKey) {
    const col = columns.find((c) => c.key === st.sortKey);
    rows = [...rows].sort((a, b) => {
      let av = col && col.sortValue ? col.sortValue(a) : a[st.sortKey];
      let bv = col && col.sortValue ? col.sortValue(b) : b[st.sortKey];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return st.sortDir === 'asc' ? -1 : 1;
      if (av > bv) return st.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (st.page > totalPages) st.page = totalPages;
  if (st.page < 1) st.page = 1;
  const pageRows = opts.allRows ? rows : rows.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);

  const theadHtml = '<tr>' + columns.map((c) => {
    if (c.sortable === false) return `<th>${escapeHtml(c.label)}</th>`;
    const active = st.sortKey === c.key;
    const arrow = active ? (st.sortDir === 'asc' ? ' <i class="fas fa-arrow-up sort-icon"></i>' : ' <i class="fas fa-arrow-down sort-icon"></i>') : '';
    return `<th class="sortable" onclick="sortTable('${tableId}','${c.key}')">${escapeHtml(c.label)}${arrow}</th>`;
  }).join('') + '<th>Action</th></tr>';

  let tbodyHtml;
  if (!total) {
    const isSearching = !!st.search;
    const icon = isSearching ? 'fa-magnifying-glass' : (opts.emptyIcon || 'fa-inbox');
    const message = isSearching ? `No results match "${st.search}".` : (opts.emptyMessage || 'No records found.');
    tbodyHtml = `<tr><td colspan="${columns.length + 1}"><div class="table-empty-state"><i class="fas ${icon}"></i><p>${escapeHtml(message)}</p></div></td></tr>`;
  } else {
    tbodyHtml = pageRows.map((row) => `<tr data-row-id="${escapeHtml(String(row.id ?? ''))}">` + columns.map((c) => `<td>${c.render ? c.render(row) : escapeHtml(row[c.key] ?? '')}</td>`).join('') + `<td><div class="table-actions">${opts.rowActions(row)}</div></td></tr>`).join('');
  }

  $(tableId).innerHTML = `<thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody>`;

  const pag = $(tableId + 'Pagination');
  if (pag) {
    pag.innerHTML = totalPages <= 1 ? '' : `
      <button ${st.page <= 1 ? 'disabled' : ''} onclick="changeTablePage('${tableId}',-1)" aria-label="Previous page"><i class="fas fa-chevron-left"></i></button>
      <span>Page ${st.page} of ${totalPages} (${total})</span>
      <button ${st.page >= totalPages ? 'disabled' : ''} onclick="changeTablePage('${tableId}',1)" aria-label="Next page"><i class="fas fa-chevron-right"></i></button>
    `;
  }
}

function sortTable(tableId, key) {
  const st = getTableState(tableId);
  if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  renderTables();
}
window.sortTable = sortTable;

function changeTablePage(tableId, delta) {
  getTableState(tableId).page += delta;
  renderTables();
}
window.changeTablePage = changeTablePage;

function fillSelect(id, data, labelFn, value = 'id', first = 'Select') {
  $(id).innerHTML = `<option value="">${escapeHtml(first)}</option>` + data.map((x) => `<option value="${x[value]}">${escapeHtml(labelFn(x))}</option>`).join('');
}

/**
 * "Instructor not assigned" is a WARNING state, not a conflict: a schedule
 * without an instructor is valid and saveable (plotting usually happens
 * before final instructor assignment), it just gets this indicator. Real
 * instructor conflicts (same instructor double-booked) are a separate,
 * red issue handled by findScheduleConflicts().
 */
/**
 * "No room" is a WARNING state, not an error: a schedule can be saved
 * without a room while the room assignment is still being worked out.
 * A room conflict is only possible once both schedules actually have a room.
 */
const ROOM_MISSING_HTML = '<span class="instructor-missing" title="No room assigned yet. You can assign one later."><i class="fas fa-triangle-exclamation"></i> No room yet</span>';

function roomCellHtml(s) {
  return s.room_id ? escapeHtml(s.room_name) : ROOM_MISSING_HTML;
}

const INSTRUCTOR_MISSING_HTML = '<span class="instructor-missing" title="Instructor not assigned. You can assign one later."><i class="fas fa-triangle-exclamation"></i> Instructor not assigned</span>';

function instructorCellHtml(s) {
  return s.faculty_id ? escapeHtml(s.faculty_name) : INSTRUCTOR_MISSING_HTML;
}

const YEAR_LEVEL_LABELS = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
const SEMESTER_LABELS = { first_semester: 'First Semester', second_semester: 'Second Semester', summer: 'Summer' };

/**
 * Mirrors default_set_type() / allowed_set_types() in api/schedules.php.
 * Every course can be SET 0, SET 1 or SET 2 -- the scheduler chooses per
 * course, for any year level. The component/year-level rule below is only
 * the DEFAULT a course starts with (Laboratory: SET 0; Lecture: SET 1 for
 * 1st/4th year, SET 2 for 2nd/3rd year). The backend remains the
 * authoritative check.
 */
const ALTERNATING_SET_BY_YEAR_LEVEL = { 1: 'set_1', 2: 'set_2', 3: 'set_2', 4: 'set_1' };
const ALL_SET_TYPES = ['set_0', 'set_1', 'set_2'];

function defaultSetType(component, yearLevel) {
  if (component === 'laboratory') return 'set_0';
  return ALTERNATING_SET_BY_YEAR_LEVEL[Number(yearLevel)] || 'set_1';
}

function allowedSetTypes(component, yearLevel) {
  return ALL_SET_TYPES;
}

/** Makes all three SET options selectable in this component's Set Type dropdown and resets the selection to the course's default SET (the scheduler can then change it). */
function updateSetTypeOptions(component) {
  const course = getSelectedCourse();
  const select = $('setType_' + component);
  Array.from(select.options).forEach((opt) => {
    opt.hidden = false;
    opt.disabled = false;
  });
  select.value = defaultSetType(component, course ? course.year_level : null);
}

function fillCourseSelectGrouped(id, courses, first = 'Select') {
  const byYear = {};
  courses.forEach((c) => {
    const y = c.year_level;
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(c);
  });
  const groupsHtml = Object.keys(byYear).sort((a, b) => a - b).map((y) => {
    const options = byYear[y].map((c) => `<option value="${c.id}">${escapeHtml(c.course_code)} - ${escapeHtml(c.course_title)}</option>`).join('');
    return `<optgroup label="${escapeHtml(YEAR_LEVEL_LABELS[y] || `Year ${y}`)}">${options}</optgroup>`;
  }).join('');
  $(id).innerHTML = `<option value="">${escapeHtml(first)}</option>${groupsHtml}`;
}

/* =====================================================
   BLOCK / SPARE HELPERS
   ===================================================== */

/** Course ids currently assigned to a Block (Assign Courses). */
function courseIdsForBlock(blockId) {
  return state.blockCourseRows.filter((r) => Number(r.block_id) === Number(blockId)).map((r) => Number(r.course_id));
}

/** The SPARE group (with its .allocations array) for a given Program+Year Level, or null if none has been created yet. */
function spareGroupForYearLevel(yearLevel, programCode = 'BSCS') {
  return state.spares.find((sp) => Number(sp.year_level) === Number(yearLevel) && sp.program_code === programCode) || null;
}

/** Course ids configured for a "separate_schedule" SPARE allocation under this SPARE group -- the only ones plottable directly under SPARE in Plot Schedule. */
function courseIdsForSeparateSpare(spareId) {
  const spare = state.spares.find((sp) => Number(sp.id) === Number(spareId));
  if (!spare) return [];
  return (spare.allocations || []).filter((a) => a.allocation_type === 'separate_schedule').map((a) => Number(a.course_id));
}

/* =====================================================
   SEARCHABLE COURSE COMBOBOX (reusable)
   Powers both the Plot Schedule course picker and the Faculty Course
   Assignment course picker. The real <select> (filled by
   fillCourseSelectGrouped) stays the single source of truth for course_id
   -- every existing piece of JS that reads/writes that select
   (getSelectedCourse, onCourseChange, form submit, validation) keeps
   working exactly as before. This panel is purely a friendlier way to set
   that same select's value.
   `gateId` is the upstream field that must have a value before Course can
   be picked at all (Year Level for the Assignment picker; the Block/SPARE
   Target picker for Plot Schedule -- Course is gated on Block there, per
   the Year Level -> Block -> Courses workflow). `getAllowedCourseIds()`
   returns null when the gate is empty, or the exact list of course ids to
   offer once it's set (already filtered to the right year level/block by
   the caller).
   ===================================================== */

function createCourseCombobox({ gateId, searchId, listId, selectId, getAllowedCourseIds, emptyPlaceholder }) {
  let flatList = [];
  let activeIndex = -1;

  function groupsFor(filterText) {
    const allowedIds = getAllowedCourseIds();
    if (allowedIds === null) return []; // gated -- nothing to offer until the upstream field is picked
    const allowedSet = new Set(allowedIds.map(Number));
    const q = (filterText || '').trim().toLowerCase();
    const byYear = {};
    state.courses.forEach((c) => {
      if (!allowedSet.has(Number(c.id))) return;
      if (q) {
        const haystack = `${c.course_code} ${c.course_title}`.toLowerCase();
        if (!haystack.includes(q)) return;
      }
      const y = c.year_level;
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(c);
    });
    return Object.keys(byYear).sort((a, b) => a - b).map((y) => ({
      label: YEAR_LEVEL_LABELS[y] || `Year ${y}`,
      courses: byYear[y].slice().sort((a, b) => String(a.course_code).localeCompare(String(b.course_code))),
    }));
  }

  function renderPanel(filterText) {
    const panel = $(listId);
    const grouped = groupsFor(filterText);
    const selectedId = Number($(selectId).value) || null;
    flatList = [];
    activeIndex = -1;

    if (!grouped.length) {
      const gateSet = !!$(gateId).value;
      panel.innerHTML = `<div class="combobox-empty">${gateSet ? 'No matching courses.' : (emptyPlaceholder || 'Make a selection first.')}</div>`;
      return;
    }

    const showGroupLabels = grouped.length > 1;
    panel.innerHTML = grouped.map((g) => {
      const optionsHtml = g.courses.map((c) => {
        const idx = flatList.length;
        flatList.push(c);
        const isSelected = selectedId === Number(c.id);
        return `<div class="combobox-option${isSelected ? ' selected' : ''}" role="option" id="${listId}Option_${idx}" data-index="${idx}" data-course-id="${c.id}">
          <strong>${escapeHtml(c.course_code)}</strong>
          <small>${escapeHtml(c.course_title)}</small>
        </div>`;
      }).join('');
      return `${showGroupLabels ? `<div class="combobox-group-label">${escapeHtml(g.label)}</div>` : ''}${optionsHtml}`;
    }).join('');

    panel.querySelectorAll('.combobox-option').forEach((opt) => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectCourse(Number(opt.dataset.courseId));
      });
    });
  }

  function open(forFocus = false) {
    if ($(searchId).disabled) return;
    renderPanel(forFocus ? '' : $(searchId).value);
    $(listId).classList.remove('hidden');
    $(searchId).setAttribute('aria-expanded', 'true');
  }

  function close() {
    $(listId).classList.add('hidden');
    $(searchId).setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function updateActiveOption(options) {
    options.forEach((opt, i) => opt.classList.toggle('active', i === activeIndex));
    const activeEl = options[activeIndex];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function selectCourse(courseId) {
    const course = state.courses.find((c) => Number(c.id) === courseId);
    $(selectId).value = String(courseId);
    $(searchId).value = course ? `${course.course_code} - ${course.course_title}` : '';
    close();
    $(selectId).dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncDisplay() {
    const courseId = Number($(selectId).value) || null;
    const course = courseId ? state.courses.find((c) => Number(c.id) === courseId) : null;
    $(searchId).value = course ? `${course.course_code} - ${course.course_title}` : '';
  }

  function updateAvailability() {
    const gateVal = $(gateId).value;
    const input = $(searchId);
    input.disabled = !gateVal;
    input.placeholder = gateVal ? 'Search course code or title...' : (emptyPlaceholder || 'Make a selection first');
  }

  /** Upstream gate changed: the previously selected Course (if any) almost certainly no longer applies, so clear it and let the user re-pick from a freshly filtered Course list. Callers that also need to reset downstream fields do that themselves after calling this. */
  function onGateChanged() {
    $(selectId).value = '';
    syncDisplay();
    close();
    updateAvailability();
  }

  const searchInput = $(searchId);
  searchInput.addEventListener('focus', () => { open(true); searchInput.select(); });
  searchInput.addEventListener('click', () => { open(true); searchInput.select(); });
  searchInput.addEventListener('input', () => open(false));
  searchInput.addEventListener('blur', () => {
    setTimeout(() => { close(); syncDisplay(); }, 150);
  });
  searchInput.addEventListener('keydown', (e) => {
    const panel = $(listId);
    if (panel.classList.contains('hidden')) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
      return;
    }
    const options = panel.querySelectorAll('.combobox-option');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!options.length) return;
      activeIndex = Math.min(activeIndex + 1, options.length - 1);
      updateActiveOption(options);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      updateActiveOption(options);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && flatList[activeIndex]) {
        selectCourse(Number(flatList[activeIndex].id));
      }
    } else if (e.key === 'Escape') {
      close();
      syncDisplay();
    }
  });

  return { open, close, renderPanel, selectCourse, syncDisplay, updateAvailability, onGateChanged };
}

// Plot Schedule's Course picker is gated on the Block/SPARE Target select
// (Year Level -> Block -> Courses), and only offers courses actually
// assigned to that target. The Faculty Course Assignment picker keeps its
// old Year-Level-only gating -- it has nothing to do with Blocks.
const scheduleCourseCombobox = createCourseCombobox({
  gateId: 'scheduleTarget', searchId: 'scheduleCourseSearch', listId: 'scheduleCourseList', selectId: 'scheduleCourse',
  emptyPlaceholder: 'Select a block first',
  getAllowedCourseIds: () => {
    const target = getSelectedTarget();
    if (!target) return null;
    const semester = $('scheduleSemester').value;
    const idsForTarget = target.type === 'block' ? courseIdsForBlock(target.id) : courseIdsForSeparateSpare(target.id);
    if (!semester) return idsForTarget;
    return idsForTarget.filter((id) => {
      const course = state.courses.find((c) => Number(c.id) === Number(id));
      return course && course.semester_type === semester;
    });
  },
});
/* =====================================================
   FACULTY ASSIGNMENT PICKER (multi-select)
   Pick an instructor -> filter by Year Level (1st-4th) -> tick as many
   courses as needed -> Add -> review/uncheck in a confirmation step ->
   Confirm & Save. A "Save directly" switch skips the confirmation for
   people who don't want the extra step. Editing an existing assignment
   reuses the same list in single-choice mode.
   ===================================================== */
const ASSIGN_DIRECT_SAVE_KEY = 'ics.assignments.directSave';
function readDirectSavePref() { try { return localStorage.getItem(ASSIGN_DIRECT_SAVE_KEY) === '1'; } catch (e) { return false; } }
function writeDirectSavePref(on) { try { localStorage.setItem(ASSIGN_DIRECT_SAVE_KEY, on ? '1' : '0'); } catch (e) { /* storage unavailable -- preference just isn't remembered */ } }

const assignPicker = (() => {
  const selected = new Set();   // course ids (numbers) ticked to be assigned
  let yearFilter = '1';         // '1'..'4' or 'all'
  let mode = 'add';             // 'add' (multi) | 'edit' (single)
  let searchText = '';

  const courseById = (id) => state.courses.find((c) => Number(c.id) === Number(id));
  const currentFacultyId = () => Number($('assignFaculty').value) || 0;

  /** Course ids this instructor already has (the row being edited doesn't count against itself). */
  function alreadyAssignedIds() {
    const fid = currentFacultyId();
    return new Set(state.assignments
      .filter((a) => Number(a.faculty_id) === fid && !(mode === 'edit' && Number(a.id) === Number(editing.assignments)))
      .map((a) => Number(a.course_id)));
  }

  function visibleCourses() {
    const q = searchText.trim().toLowerCase();
    return state.courses
      .filter((c) => (yearFilter === 'all' || String(c.year_level) === yearFilter)
        && (!q || `${c.course_code} ${c.course_title}`.toLowerCase().includes(q)))
      .sort((a, b) => (Number(a.year_level) - Number(b.year_level))
        || String(a.semester_type).localeCompare(String(b.semester_type))
        || String(a.course_code).localeCompare(String(b.course_code)));
  }

  function renderChips() {
    const chips = [['1', '1st Year'], ['2', '2nd Year'], ['3', '3rd Year'], ['4', '4th Year'], ['all', 'All']];
    $('assignYearChips').innerHTML = chips.map(([value, label]) => {
      const n = value === 'all'
        ? selected.size
        : [...selected].filter((id) => { const c = courseById(id); return c && String(c.year_level) === value; }).length;
      const active = yearFilter === value;
      return `<button type="button" class="year-chip${active ? ' active' : ''}" data-year="${value}" aria-pressed="${active}">${label}${n ? ` <span class="year-chip-count">${n}</span>` : ''}</button>`;
    }).join('');
  }

  function renderList() {
    const box = $('assignCourseChecklist');
    const hasFaculty = currentFacultyId() > 0;
    $('assignSelectAllBtn').disabled = !hasFaculty || mode === 'edit';
    $('assignClearBtn').disabled = !hasFaculty || mode === 'edit';
    if (!state.courses.length) { box.innerHTML = '<div class="combobox-empty assign-empty">No courses yet. Add courses first.</div>'; return; }
    if (!hasFaculty) { box.innerHTML = '<div class="combobox-empty assign-empty"><i class="fas fa-arrow-up"></i> Choose an instructor first.</div>'; return; }
    const assigned = alreadyAssignedIds();
    const list = visibleCourses();
    if (!list.length) { box.innerHTML = '<div class="combobox-empty assign-empty">No matching courses.</div>'; return; }
    let lastGroup = null;
    let html = '';
    list.forEach((c) => {
      const group = `${c.year_level}|${c.semester_type}`;
      if (group !== lastGroup) {
        html += `<div class="assign-group">${escapeHtml(YEAR_LEVEL_LABELS[c.year_level] || 'Year ' + c.year_level)} &middot; ${escapeHtml(SEMESTER_LABELS[c.semester_type] || c.semester_type)}</div>`;
        lastGroup = group;
      }
      const isAssigned = assigned.has(Number(c.id));
      const isPicked = selected.has(Number(c.id));
      html += `<label class="assign-course${isAssigned ? ' is-assigned' : ''}${isPicked ? ' is-selected' : ''}" title="${escapeHtml(c.course_code + ' - ' + c.course_title)}">
        <input type="checkbox" value="${c.id}" ${(isAssigned || isPicked) ? 'checked' : ''} ${isAssigned ? 'disabled' : ''} />
        <span class="assign-course-main"><strong>${escapeHtml(c.course_code)}</strong><span class="assign-course-title">${escapeHtml(c.course_title)}</span></span>
        ${isAssigned ? '<span class="assign-tag">Assigned</span>' : ''}
      </label>`;
    });
    box.innerHTML = html;
  }

  function updateSummary() {
    const n = selected.size;
    $('assignSelectedCount').textContent = mode === 'edit' ? '' : `${n} selected`;
    if (mode === 'add') $('assignmentSubmitBtn').innerHTML = `<i class="fas fa-plus"></i> Add${n ? ` (${n})` : ''}`;
    renderChips();
  }

  function renderAll() { renderList(); updateSummary(); }

  /** Back to a blank "add" state (called whenever the modal opens fresh or is closed). */
  function reset() {
    mode = 'add';
    selected.clear();
    yearFilter = '1';
    searchText = '';
    $('assignCourseFilter').value = '';
    $('assignDirectSave').checked = readDirectSavePref();
    $('assignDirectWrap').classList.remove('hidden');
    $('assignSelectAllBtn').classList.remove('hidden');
    $('assignClearBtn').classList.remove('hidden');
    renderAll();
  }

  /** Edit mode: same list, but single-choice, and no confirmation step / bulk buttons. */
  function beginEdit(assignment) {
    mode = 'edit';
    selected.clear();
    selected.add(Number(assignment.course_id));
    const course = courseById(assignment.course_id);
    yearFilter = course ? String(course.year_level) : 'all';
    searchText = '';
    $('assignCourseFilter').value = '';
    $('assignDirectWrap').classList.add('hidden');
    $('assignSelectAllBtn').classList.add('hidden');
    $('assignClearBtn').classList.add('hidden');
    renderAll();
  }

  $('assignYearChips').addEventListener('click', (e) => {
    const btn = e.target.closest('.year-chip');
    if (!btn) return;
    yearFilter = btn.dataset.year;
    renderAll();
  });

  $('assignCourseChecklist').addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.matches('input[type="checkbox"]')) return;
    const id = Number(cb.value);
    if (mode === 'edit') {
      selected.clear();
      if (cb.checked) selected.add(id);
      renderAll();
      return;
    }
    if (cb.checked) selected.add(id); else selected.delete(id);
    cb.closest('.assign-course').classList.toggle('is-selected', cb.checked);
    updateSummary();   // no list re-render, so the scroll position and focus stay put
  });

  $('assignCourseFilter').addEventListener('input', (e) => {
    e.stopPropagation();   // typing in the filter isn't an "unsaved change"
    searchText = e.target.value;
    renderList();
  });

  $('assignSelectAllBtn').addEventListener('click', () => {
    const assigned = alreadyAssignedIds();
    visibleCourses().forEach((c) => { if (!assigned.has(Number(c.id))) selected.add(Number(c.id)); });
    markFormDirty('facultyCourseForm');
    renderAll();
  });

  $('assignClearBtn').addEventListener('click', () => { selected.clear(); renderAll(); });

  $('assignFaculty').addEventListener('change', () => {
    // A course this instructor already has can't also be "to add".
    const assigned = alreadyAssignedIds();
    [...selected].forEach((id) => { if (assigned.has(id)) selected.delete(id); });
    renderAll();
  });

  $('assignDirectSave').addEventListener('change', (e) => {
    e.stopPropagation();
    writeDirectSavePref(e.target.checked);
  });

  return {
    reset, beginEdit, renderAll,
    isEdit: () => mode === 'edit',
    getSelectedIds: () => [...selected],
    setSelectedIds: (ids) => { selected.clear(); ids.forEach((id) => selected.add(Number(id))); },
    isDirectSave: () => $('assignDirectSave').checked,
  };
})();

/* --- Confirmation step: review the picked courses, uncheck mistakes, then save --- */
let assignConfirmIds = [];        // snapshot of what was picked, so an unchecked row can be re-checked
const assignConfirmChecked = new Set();

function renderAssignConfirm() {
  const facultyRow = state.faculty.find((f) => Number(f.id) === Number($('assignFaculty').value));
  const n = assignConfirmChecked.size;
  $('assignConfirmIntro').innerHTML = `Assign <strong>${n}</strong> course${n === 1 ? '' : 's'} to <strong>${escapeHtml(facultyRow ? facultyRow.faculty_name : '')}</strong>? Uncheck any that were picked by mistake.`;
  const rows = assignConfirmIds
    .map((id) => state.courses.find((c) => Number(c.id) === Number(id)))
    .filter(Boolean)
    .sort((a, b) => (Number(a.year_level) - Number(b.year_level)) || String(a.course_code).localeCompare(String(b.course_code)));
  $('assignConfirmList').innerHTML = rows.map((c) => `
    <label class="checklist-item">
      <input type="checkbox" value="${c.id}" ${assignConfirmChecked.has(Number(c.id)) ? 'checked' : ''} />
      <span><strong>${escapeHtml(c.course_code)}</strong> - ${escapeHtml(c.course_title)} <small class="assign-confirm-year">(${escapeHtml(YEAR_LEVEL_LABELS[c.year_level] || c.year_level)})</small></span>
    </label>`).join('');
  const saveBtn = $('assignConfirmSaveBtn');
  saveBtn.disabled = n === 0;
  saveBtn.innerHTML = `<i class="fas fa-check"></i> Confirm &amp; Save${n ? ` (${n})` : ''}`;
}

function openAssignConfirm() {
  assignConfirmIds = assignPicker.getSelectedIds();
  assignConfirmChecked.clear();
  assignConfirmIds.forEach((id) => assignConfirmChecked.add(Number(id)));
  renderAssignConfirm();
  $('modalAssignConfirm').classList.remove('hidden');
}

/** "Back": return to the picker, keeping whatever is still checked here. */
function closeAssignConfirm() {
  $('modalAssignConfirm').classList.add('hidden');
  assignPicker.setSelectedIds([...assignConfirmChecked]);
  assignPicker.renderAll();
}
window.closeAssignConfirm = closeAssignConfirm;

$('assignConfirmList').addEventListener('change', (e) => {
  const cb = e.target;
  if (!cb.matches('input[type="checkbox"]')) return;
  if (cb.checked) assignConfirmChecked.add(Number(cb.value)); else assignConfirmChecked.delete(Number(cb.value));
  renderAssignConfirm();
});
$('assignConfirmSaveBtn').addEventListener('click', () => saveAssignments([...assignConfirmChecked]));

async function saveAssignments(courseIds) {
  const facultyId = Number($('assignFaculty').value);
  if (!facultyId || !courseIds.length) return;
  const facultyRow = state.faculty.find((f) => Number(f.id) === facultyId);
  const confirmBtn = $('assignConfirmSaveBtn');
  const submitBtn = $('assignmentSubmitBtn');
  const confirmLabel = confirmBtn.innerHTML;
  const submitLabel = submitBtn.innerHTML;
  confirmBtn.disabled = true;
  submitBtn.disabled = true;
  const spinner = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  confirmBtn.innerHTML = spinner;
  submitBtn.innerHTML = spinner;
  try {
    const result = await request('faculty_courses.php', { method: 'POST', body: JSON.stringify({ faculty_id: facultyId, course_ids: courseIds }) });
    const added = result && typeof result.added === 'number' ? result.added : courseIds.length;
    const skipped = result && Array.isArray(result.skipped) ? result.skipped : [];
    let message = `Assigned ${added} course${added === 1 ? '' : 's'} to ${facultyRow ? facultyRow.faculty_name : 'faculty'}.`;
    if (skipped.length) message += ` Already assigned (skipped): ${skipped.join(', ')}.`;
    showToast(message, 'success');
    $('modalAssignConfirm').classList.add('hidden');
    closeEntityModal('assignments');
    await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
    confirmBtn.innerHTML = confirmLabel;
    submitBtn.innerHTML = submitLabel;
    confirmBtn.disabled = false;
    submitBtn.disabled = false;
  }
}

/** Parses $('scheduleTarget').value ("block:12" / "spare:3") into { type: 'block'|'spare', id } or null if nothing is selected. */
function getSelectedTarget() {
  const raw = $('scheduleTarget').value;
  if (!raw) return null;
  const [kind, idStr] = raw.split(':');
  return { type: kind === 'spare' ? 'spare' : 'block', id: Number(idStr) };
}

/** Populates the Block/SPARE Target dropdown for the currently selected Year Level: regular Blocks first, then a "Special" group containing SPARE if that year level's SPARE group already exists. */
function renderTargetOptions() {
  const yearLevel = $('scheduleYearLevel').value;
  const select = $('scheduleTarget');
  if (!yearLevel) {
    select.innerHTML = '<option value="">Select a year level first</option>';
    select.disabled = true;
    return;
  }
  const blocksForYear = state.blocks.filter((b) => Number(b.year_level) === Number(yearLevel)).sort((a, b) => a.block_no - b.block_no);
  const spare = spareGroupForYearLevel(yearLevel);
  const blockOptions = blocksForYear.map((b) => `<option value="block:${b.id}">${escapeHtml(b.block_name)}</option>`).join('');
  const spareOptions = spare ? `<optgroup label="Special"><option value="spare:${spare.id}">SPARE</option></optgroup>` : '';
  if (!blocksForYear.length && !spare) {
    select.innerHTML = `<option value="">No blocks exist for Year ${yearLevel} yet</option>`;
    select.disabled = true;
    return;
  }
  select.innerHTML = `<option value="">Select a block</option>${blockOptions}${spareOptions}`;
  select.disabled = false;
}

/**
 * The Course Offering overview: pick a Year Level (+ Academic Year) and see
 * every Block for that year, plus SPARE, in one continuous report -- like
 * the printed Course Offering sheet -- instead of picking one Block at a
 * time. Each row is one component (Lecture/Laboratory) of one course
 * assigned to that block; clicking a row loads it into the Subject
 * Offering form below (unlocked for editing) via selectOfferingRow().
 */
/**
 * For a PURE LECTURE course (no Lab units) at one year level, works out
 * which of the actual generated Blocks need their own dedicated Lecture
 * section ("required") and which ones automatically join one of those
 * instead ("spare" for this course) -- fully computed, no manual picking.
 *
 * Rule: every Block is assumed to already hold 30 real students (not
 * empty seats). requiredBatches = CEILING(numBlocks x 30 / course
 * Capacity, default 45). The first requiredBatches Blocks (by block_no)
 * each get their own Lecture schedule; every Block beyond that joins one
 * of the required Blocks' section (round-robin, for a rough balance)
 * instead of consuming another room/instructor. The number of blocks is
 * whatever actually exists for this year level -- never hard-coded --
 * and there may be zero, one, or several "spare" blocks depending purely
 * on this calculation, never assumed to always be exactly one.
 *
 * Returns null for a LEC+LAB course (Lab units > 0) or when there are no
 * blocks -- those always run one dedicated section per Block, no
 * batching, and their existing Lec+Lab courses are completely unaffected
 * by this function.
 */
function computePureLectureBatchPlan(course, blocksForCourse) {
  const hasLab = parseFloat(course.lab_units || 0) > 0;
  if (hasLab || !blocksForCourse.length) return null;
  const BLOCK_ASSUMED_SIZE = 30;
  const capacity = Number(course.max_students) > 0 ? Number(course.max_students) : 45;
  const sorted = [...blocksForCourse].sort((a, b) => a.block_no - b.block_no);
  const totalStudents = sorted.length * BLOCK_ASSUMED_SIZE;
  const requiredBatches = Math.min(sorted.length, Math.max(1, Math.ceil(totalStudents / capacity)));
  const requiredBlocks = sorted.slice(0, requiredBatches);
  const spareBlocks = sorted.slice(requiredBatches).map((b, i) => ({ block: b, joinsBlock: requiredBlocks[i % requiredBlocks.length] }));
  return { capacity, totalStudents, requiredBatches, requiredBlocks, spareBlocks };
}

function offeringRowsForCourse(course, blockRow, spareRow, schoolYear) {
  const target = blockRow ? { type: 'block', id: blockRow.id } : { type: 'spare', id: spareRow.id };
  const rows = [];
  COMPONENT_TYPES.forEach((component) => {
    if (!courseRequiresComponent(course, component)) return;
    const existing = findExistingComponentSchedule(course.id, target, schoolYear, component);
    rows.push({ course, target, component, existing });
  });
  return rows;
}

function renderOfferingRow(codeLabel, row) {
  const { course, target, component, existing } = row;
  const targetValue = `${target.type}:${target.id}`;
  const isEditingThis = editing.schedules && existing && Number(existing.id) === Number(editing.schedules);
  if (!existing) {
    return `<tr class="offering-row offering-row-unscheduled" data-target="${targetValue}" data-course-id="${course.id}" data-component="${component}">
      <td class="offering-code-cell">${escapeHtml(codeLabel)}</td>
      <td>\u2013</td>
      <td>${escapeHtml(course.course_code)}</td>
      <td>${escapeHtml(course.course_title)}</td>
      <td>${component === 'laboratory' ? 'LAB' : 'LEC'}</td>
      <td colspan="4">Not yet scheduled \u2014 click to plot</td>
      <td><i class="fas fa-plus"></i></td>
    </tr>`;
  }
  return `<tr class="offering-row${isEditingThis ? ' is-editing' : ''}" data-target="${targetValue}" data-course-id="${course.id}" data-component="${component}" data-schedule-id="${existing.id}">
    <td class="offering-code-cell">${escapeHtml(codeLabel)}</td>
    <td class="offering-cell-editable" data-field="set">${escapeHtml((SET_LABELS_SHORT[existing.set_type] || existing.set_type).replace('SET ', ''))}</td>
    <td>${escapeHtml(course.course_code)}</td>
    <td>${escapeHtml(course.course_title)}</td>
    <td>${component === 'laboratory' ? 'LAB' : 'LEC'}</td>
    <td class="offering-cell-editable" data-field="day">${escapeHtml(formatDayPattern(existing.day_of_week))}</td>
    <td class="offering-cell-editable" data-field="time">${formatTimeDisplay(existing.start_time.slice(0, 5))}-${formatTimeDisplay(existing.end_time.slice(0, 5))}</td>
    <td class="offering-cell-editable" data-field="room">${roomCellHtml(existing)}</td>
    <td>${instructorCellHtml(existing)}</td>
    <td><i class="fas fa-pen"></i></td>
  </tr>`;
}

function renderOfferingOverview() {
  const container = $('offeringOverview');
  const yearLevel = $('scheduleYearLevel').value;
  const schoolYear = $('scheduleSchoolYear').value;
  const semester = $('scheduleSemester').value;

  if (!yearLevel || !schoolYear || !semester) {
    container.innerHTML = `<div class="offering-empty"><i class="fas fa-arrow-up"></i> Select an Academic Year, Year Level, and Semester above to see that semester's course offering.</div>`;
    return;
  }

  const blocksForYear = state.blocks.filter((b) => Number(b.year_level) === Number(yearLevel)).sort((a, b) => a.block_no - b.block_no);
  const programCode = blocksForYear[0]?.program_code || 'BSCS';
  const yearLabel = YEAR_LEVEL_LABELS[yearLevel] || `Year ${yearLevel}`;
  const semesterLabel = SEMESTER_LABELS[semester] || semester;

  if (!blocksForYear.length) {
    container.innerHTML = `<div class="offering-empty"><i class="fas fa-layer-group"></i> No blocks exist yet for ${escapeHtml(yearLabel)}. Create some in Blocks first.</div>`;
    return;
  }

  let codeCounter = 1;
  const codePrefix = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' }[yearLevel] || 'X';
  const cols = '<tr><th>Code</th><th>Set</th><th>Course Code</th><th>Course Title</th><th>Type</th><th>Day</th><th>Time</th><th>Room</th><th>Instructor</th><th></th></tr>';

  // Work out, per pure-lecture course IN THIS SEMESTER, which of THIS year
  // level's actual Blocks need their own dedicated Lecture section vs
  // which ones automatically join another Block instead -- computed fresh
  // every render from however many Blocks actually exist right now, never
  // hard-coded to a fixed count or a fixed "last block is spare" rule.
  // First Semester, Second Semester, and Summer are kept fully separate --
  // a course only ever belongs to one of them, so this never mixes them.
  const pureLectureBatchPlans = new Map();
  blocksForYear.forEach((block) => {
    courseIdsForBlock(block.id).forEach((courseId) => {
      if (pureLectureBatchPlans.has(courseId)) return;
      const course = state.courses.find((c) => Number(c.id) === courseId);
      if (!course || course.semester_type !== semester) return;
      const blocksForCourse = blocksForYear.filter((b) => courseIdsForBlock(b.id).includes(courseId));
      const plan = computePureLectureBatchPlan(course, blocksForCourse);
      if (plan) pureLectureBatchPlans.set(courseId, plan);
    });
  });

  let html = '';

  blocksForYear.forEach((block) => {
    const courseIds = courseIdsForBlock(block.id);
    const courses = courseIds.map((id) => state.courses.find((c) => Number(c.id) === id)).filter((c) => c && c.semester_type === semester)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const rowsHtml = courses.flatMap((course) => {
      const plan = pureLectureBatchPlans.get(Number(course.id));
      const spareEntry = plan && plan.spareBlocks.find((s) => Number(s.block.id) === Number(block.id));
      if (spareEntry) {
        // This Block doesn't need its own Lecture section for this course
        // -- its students automatically sit in on another Block's section,
        // so there is nothing to plot and the row is left out of the table
        // entirely (it also consumes no Code). Any Laboratory component (if
        // this ever had one) is unaffected since computePureLectureBatchPlan
        // only returns a plan for Lab-less courses in the first place.
        return [];
      }
      return offeringRowsForCourse(course, block, null, schoolYear);
    }).map((row) => renderOfferingRow(`${codePrefix}${codeCounter++}`, row)).join('');
    html += `
      <div class="offering-block-section">
        <div class="offering-block-title">${escapeHtml(programCode)}<br>${escapeHtml(yearLabel)} Students (${escapeHtml(block.block_name.toUpperCase())}) &mdash; ${escapeHtml(semesterLabel)}</div>
        <table class="offering-table"><thead>${cols}</thead><tbody>${rowsHtml || `<tr><td colspan="10" class="offering-empty">No ${escapeHtml(semesterLabel)} courses assigned to this block yet.</td></tr>`}</tbody></table>
      </div>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.offering-row').forEach((tr) => {
    // Unscheduled rows (no schedule-id yet) always open the full Plot
    // Schedule popover -- a brand-new schedule needs every field at once,
    // so there's no single cell that makes sense to edit in isolation.
    if (!tr.dataset.scheduleId) {
      tr.addEventListener('click', () => selectOfferingRow(tr.dataset.target, Number(tr.dataset.courseId), tr.dataset.component));
      return;
    }
    // Already-scheduled rows: Set/Day/Time/Room cells each open a tiny
    // Quick Edit popover for just that one field. Clicking anywhere else in
    // the row (course code/title/type, or the pencil icon) falls back to
    // the full Plot Schedule popover, since Faculty/Notes aren't shown as
    // their own cell here.
    tr.querySelectorAll('td[data-field]').forEach((td) => {
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickEditModal(td.dataset.field, Number(tr.dataset.scheduleId));
      });
    });
    tr.addEventListener('click', () => selectOfferingRow(tr.dataset.target, Number(tr.dataset.courseId), tr.dataset.component));
  });
}

/**
 * Moves the real Faculty Assignment + Components sections (and the Save/
 * Cancel buttons) out of the page and into the Plot Schedule popover, then
 * opens it. Every field keeps its original id, so all existing wiring
 * (validation, live conflict preview, faculty inheritance, etc.) keeps
 * working completely unchanged -- only the visual container moves.
 */
function openPlotScheduleModal() {
  const body = $('plotScheduleBody');
  ['facultyAssignmentSection', 'componentsSection', 'scheduleFormActions'].forEach((id) => {
    const el = $(id);
    el.classList.remove('hidden');
    body.appendChild(el);
  });
  $('modalPlotSchedule').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
window.openPlotScheduleModal = openPlotScheduleModal;

/** Puts the relocated sections back where they normally live in the page (right after #scheduleSectionsAnchor), re-hides them, then hides the popover. */
function closePlotScheduleModal() {
  const modal = $('modalPlotSchedule');
  if (modal.classList.contains('hidden')) return;
  const anchor = $('scheduleSectionsAnchor');
  anchor.after($('facultyAssignmentSection'), $('componentsSection'), $('scheduleFormActions'));
  ['facultyAssignmentSection', 'componentsSection', 'scheduleFormActions'].forEach((id) => $(id).classList.add('hidden'));
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}
window.closePlotScheduleModal = closePlotScheduleModal;

/** Loads one course-offering row (Block/SPARE + Course + Component) from the overview table into the Subject Offering form, unlocked for editing, and opens it as a popover right there instead of scrolling down the page. */
function selectOfferingRow(targetValue, courseId, component) {
  $('scheduleTarget').value = targetValue;
  scheduleCourseCombobox.updateAvailability();
  $('scheduleCourse').value = courseId;
  scheduleCourseCombobox.syncDisplay();
  COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); updateSetTypeOptions(c); });
  updateComponentBlocks();
  updateFacultyOptions();
  unlockComponentBlock(component);
  renderOfferingOverview();
  openPlotScheduleModal();
}
window.selectOfferingRow = selectOfferingRow;

/**
 * Quick Edit popover: lets an already-scheduled offering row's Set Type,
 * Day Pattern, Time, or Room be changed on its own, without opening the
 * full Plot Schedule form. Reuses the exact same save endpoint as that form
 * (schedules.php?mode=offering) with a payload built from the schedule's
 * current values plus the one changed field, so every server-side
 * conflict/validation rule still applies exactly as it does for a normal save.
 */
let quickEditState = null;

const QUICK_EDIT_TITLES = { set: 'Edit Set Type', day: 'Edit Day Pattern', time: 'Edit Time', room: 'Edit Room' };
const QUICK_EDIT_SET_TYPE_LABELS = { set_0: 'SET 0 / Always F2F', set_1: 'SET 1 / F2F / Online Rotation', set_2: 'SET 2 / Online / F2F Rotation' };

function openQuickEditModal(field, scheduleId) {
  const existing = state.schedules.find((s) => Number(s.id) === scheduleId);
  if (!existing) return;
  quickEditState = { field, scheduleId };

  $('quickEditTitle').innerHTML = `<i class="fas fa-pen"></i> ${QUICK_EDIT_TITLES[field]} \u2014 ${escapeHtml(existing.course_code)} (${existing.component === 'laboratory' ? 'LAB' : 'LEC'})`;
  const body = $('quickEditBody');

  if (field === 'set') {
    const course = state.courses.find((c) => Number(c.id) === Number(existing.course_id));
    const allowed = allowedSetTypes(existing.component, course ? course.year_level : existing.year_level);
    body.innerHTML = `<div class="form-group full-width">
      <label for="qeSetType"><i class="fas fa-cogs"></i> Set Type</label>
      <select id="qeSetType">${allowed.map((v) => `<option value="${v}">${escapeHtml(QUICK_EDIT_SET_TYPE_LABELS[v] || v)}</option>`).join('')}</select>
    </div>`;
    $('qeSetType').value = existing.set_type;
  } else if (field === 'day') {
    body.innerHTML = `<div class="form-group full-width">
      <label for="qeDayPreset"><i class="fas fa-calendar-days"></i> Day Pattern</label>
      <select id="qeDayPreset">
        <option value="MWF">MWF - Monday/Wednesday/Friday</option>
        <option value="TTH">TTH - Tuesday/Thursday</option>
        <option value="MW">MW - Monday/Wednesday</option>
        <option value="TF">TF - Tuesday/Friday</option>
        <option value="Saturday">Saturday only</option>
        <option value="Custom">Custom Days (choose below)</option>
      </select>
      <div id="qeCustomDaysRow" class="custom-days-row hidden">
        <label class="day-checkbox"><input type="checkbox" value="Monday" /> Mon</label>
        <label class="day-checkbox"><input type="checkbox" value="Tuesday" /> Tue</label>
        <label class="day-checkbox"><input type="checkbox" value="Wednesday" /> Wed</label>
        <label class="day-checkbox"><input type="checkbox" value="Thursday" /> Thu</label>
        <label class="day-checkbox"><input type="checkbox" value="Friday" /> Fri</label>
        <label class="day-checkbox"><input type="checkbox" value="Saturday" /> Sat</label>
        <label class="day-checkbox"><input type="checkbox" value="Sunday" /> Sun</label>
      </div>
    </div>`;
    const daySelect = $('qeDayPreset');
    const customRow = $('qeCustomDaysRow');
    if (DAY_PRESET_VALUES.includes(existing.day_of_week)) {
      daySelect.value = existing.day_of_week;
    } else {
      daySelect.value = 'Custom';
      customRow.classList.remove('hidden');
      const days = scheduleDaysFor(existing.day_of_week);
      customRow.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = days.includes(cb.value); });
    }
    daySelect.addEventListener('change', () => customRow.classList.toggle('hidden', daySelect.value !== 'Custom'));
  } else if (field === 'time') {
    body.innerHTML = `<div class="form-group">
        <label for="qeStartTime"><i class="fas fa-clock"></i> Start Time</label>
        <input type="time" id="qeStartTime" />
      </div>
      <div class="form-group">
        <label for="qeEndTime"><i class="fas fa-clock"></i> End Time</label>
        <input type="time" id="qeEndTime" />
      </div>`;
    $('qeStartTime').value = existing.start_time.slice(0, 5);
    $('qeEndTime').value = existing.end_time.slice(0, 5);
  } else if (field === 'room') {
    body.innerHTML = `<div class="form-group full-width">
      <label for="qeRoom"><i class="fas fa-door-open"></i> Room</label>
      <select id="qeRoom"></select>
    </div>`;
    let roomsList = state.rooms.filter((r) => Number(r.is_active) === 1 || Number(r.id) === Number(existing.room_id));
    roomsList = roomsList.filter((r) => r.room_type === (existing.component === 'laboratory' ? 'laboratory' : 'lecture'));
    fillSelect('qeRoom', roomsList, (r) => `${r.room_name} - ${r.room_type}` + (Number(r.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'No room yet (assign later)');
    $('qeRoom').value = existing.room_id || '';
  }

  $('modalQuickEdit').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
window.openQuickEditModal = openQuickEditModal;

function closeQuickEditModal() {
  $('modalQuickEdit').classList.add('hidden');
  document.body.style.overflow = '';
  quickEditState = null;
}
window.closeQuickEditModal = closeQuickEditModal;

async function submitQuickEdit() {
  if (!quickEditState) return;
  const existing = state.schedules.find((s) => Number(s.id) === quickEditState.scheduleId);
  if (!existing) { closeQuickEditModal(); return; }

  const patch = {};
  if (quickEditState.field === 'set') {
    patch.set_type = $('qeSetType').value;
  } else if (quickEditState.field === 'day') {
    const preset = $('qeDayPreset').value;
    if (preset === 'Custom') {
      const days = [...document.querySelectorAll('#qeCustomDaysRow input[type="checkbox"]:checked')].map((cb) => cb.value);
      if (!days.length) { showToast('Pick at least one day.', 'warning'); return; }
      patch.day_of_week = days.join(',');
    } else {
      patch.day_of_week = preset;
    }
  } else if (quickEditState.field === 'time') {
    const start = $('qeStartTime').value;
    const end = $('qeEndTime').value;
    if (!start || !end) { showToast('Set both a Start Time and End Time.', 'warning'); return; }
    if (end <= start) { showToast('End Time must be after Start Time.', 'warning'); return; }
    patch.start_time = start;
    patch.end_time = end;
  } else if (quickEditState.field === 'room') {
    patch.room_id = $('qeRoom').value;
  }

  const body = {
    school_year: existing.school_year,
    course_id: existing.course_id,
    block_id: existing.block_id,
    spare_id: existing.spare_id,
    faculty_id: existing.faculty_id,
    components: [{
      id: existing.id,
      component: existing.component,
      set_type: existing.set_type,
      day_of_week: existing.day_of_week,
      start_time: existing.start_time.slice(0, 5),
      end_time: existing.end_time.slice(0, 5),
      room_id: existing.room_id || '',
      notes: existing.notes || '',
      ...patch,
    }],
  };

  const saveBtn = $('quickEditSaveBtn');
  const originalLabel = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    await request('schedules.php?mode=offering', { method: 'POST', body: JSON.stringify(body) });
    showToast('Schedule updated', 'success');
    closeQuickEditModal();
    await loadAll();
  } catch (err) {
    if (err.data && (err.data.conflict_type === 'instructor_mismatch' || err.data.conflict_type === 'duplicate_component')) {
      closeQuickEditModal();
      showInstructorConflictModal(err.message, err.data.existing_schedule_id, err.data.conflict_type);
    } else {
      showToast(err.message, 'error');
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalLabel;
  }
}
window.submitQuickEdit = submitQuickEdit;

/** Year Level changed on the Plot Schedule form: rebuild the Block/SPARE Target list, then reset the whole downstream chain (Course, Faculty, component blocks), per the "reset dependent selections" requirement. */
function onYearLevelChange() {
  renderTargetOptions();
  onTargetChange();
  renderOfferingOverview();
}

/** Semester changed: which courses are valid for the current Block depends on this, so reset Course same as a Target/Block change would, then re-render the (now semester-filtered) overview. */
function onSemesterChange() {
  onTargetChange();
  renderOfferingOverview();
}

/** Block/SPARE Target changed: Course is gated on this, so reset it, then reset the rest of the downstream chain same as a course change would. */
function onTargetChange() {
  scheduleCourseCombobox.onGateChanged();
  onOfferingContextChange();
}

async function loadAll() {
  const [dashboard, courses, blocks, blockCourseRows, spares, faculty, rooms, schedules, assignments] = await Promise.all([
    request('dashboard.php'), request('courses.php'), request('blocks.php'), request('block_courses.php'), request('spares.php'), request('faculty.php'), request('rooms.php'), request('schedules.php'), request('faculty_courses.php'),
  ]);
  Object.assign(state, { courses, blocks, blockCourseRows, spares, faculty, rooms, schedules, assignments });
  renderDashboard(dashboard);
  renderActivity();
  renderDashboardInsights();
  renderTables();
  renderSelects();
  renderFilterOptions();
  renderTimetableSelectors();
  renderTimetable();
  renderOfferingOverview();
}

function iconForStatKey(key) {
  const k = key.toLowerCase();
  if (k.includes('course')) return 'fa-book';
  if (k.includes('block')) return 'fa-layer-group';
  if (k.includes('faculty')) return 'fa-chalkboard-user';
  if (k.includes('room')) return 'fa-door-open';
  if (k.includes('schedule')) return 'fa-calendar-check';
  if (k.includes('assignment')) return 'fa-user-tie';
  return 'fa-chart-simple';
}

function renderDashboard(data) {
  $('stats').innerHTML = Object.entries(data).map(([k, v]) => `
    <div class="card stat-card">
      <div class="stat-icon"><i class="fas ${iconForStatKey(k)}"></i></div>
      <div>
        <div class="num">${escapeHtml(v)}</div>
        <div class="label">${escapeHtml(k.replace(/_/g, ' ').toUpperCase())}</div>
      </div>
    </div>`).join('');
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(String(dateStr).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function renderActivity() {
  const items = [
    ...state.courses.map((c) => ({ time: c.created_at, icon: 'fa-book', text: `Course added: ${c.course_code} - ${c.course_title}` })),
    ...state.faculty.map((f) => ({ time: f.created_at, icon: 'fa-chalkboard-user', text: `Faculty added: ${f.faculty_name}` })),
    ...state.schedules.map((s) => ({ time: s.created_at, icon: 'fa-calendar-plus', text: `Schedule plotted: ${s.course_code} (${formatDayPattern(s.day_of_week)} ${formatTimeDisplay(s.start_time.slice(0, 5))}-${formatTimeDisplay(s.end_time.slice(0, 5))})` })),
    ...state.assignments.map((a) => ({ time: a.created_at, icon: 'fa-user-tie', text: `Faculty assigned: ${a.faculty_name} \u2192 ${a.course_code}` })),
  ].filter((i) => i.time).sort((a, b) => new Date(String(b.time).replace(' ', 'T')) - new Date(String(a.time).replace(' ', 'T'))).slice(0, 8);

  const list = $('activityList');
  if (!items.length) {
    list.innerHTML = `<div class="table-empty-state"><i class="fas fa-clock-rotate-left"></i><p>No recent activity yet.</p></div>`;
    return;
  }
  list.innerHTML = items.map((i) => `
    <div class="activity-item">
      <div class="activity-icon"><i class="fas ${i.icon}"></i></div>
      <div class="activity-text">
        <div class="activity-title">${escapeHtml(i.text)}</div>
        <div class="activity-time">${escapeHtml(formatRelativeTime(i.time))}</div>
      </div>
    </div>`).join('');
}

/**
 * Scans every plotted schedule against every other one using the same
 * findScheduleConflicts() rules engine the Plot Schedule form uses live,
 * so the dashboard's numbers always agree with what the plotter would
 * flag. Returns distinct conflicting schedule IDs per conflict type
 * (not raw pair counts, so "Room Conflicts: 2" means 2 slots need fixing).
 */
function scanSystemConflicts() {
  const byType = { faculty: new Set(), room: new Set(), block: new Set() };
  const anyConflict = new Set();
  for (const s of state.schedules) {
    if (!s.day_of_week || !s.start_time || !s.end_time) continue;
    const conflicts = findScheduleConflicts(s.day_of_week, s.start_time.slice(0, 5), s.end_time.slice(0, 5), {
      blockId: s.block_id, spareId: s.spare_id, facultyId: s.faculty_id, roomId: s.room_id, ignoreId: s.id,
      setType: s.set_type,
      schoolYear: s.school_year, semesterType: s.semester_type,
    });
    if (!conflicts.length) continue;
    anyConflict.add(s.id);
    for (const c of conflicts) {
      if (c.type === 'Instructor') byType.faculty.add(s.id);
      if (c.type === 'Room') byType.room.add(s.id);
      if (c.type === 'Block') byType.block.add(s.id);
    }
  }
  return { anyConflict, faculty: byType.faculty.size, room: byType.room.size, block: byType.block.size };
}

/** Faculty currently at or over their max_preparations (distinct courses taught this term). */
function facultyLoadStats() {
  const preps = new Map();
  for (const s of state.schedules) {
    if (!s.faculty_id) continue;
    if (!preps.has(s.faculty_id)) preps.set(s.faculty_id, new Set());
    preps.get(s.faculty_id).add(s.course_id);
  }
  let overloaded = 0;
  let nearLimit = 0;
  for (const f of state.faculty) {
    const count = preps.get(f.id)?.size || 0;
    const max = Number(f.max_preparations) || 4;
    if (count >= max) overloaded += 1;
    else if (count >= max - 1) nearLimit += 1;
  }
  return { overloaded, nearLimit };
}

function renderScheduleHealth() {
  const el = $('scheduleHealth');
  if (!el) return;
  const total = state.schedules.length;
  const conflicts = scanSystemConflicts();
  const healthPct = total ? Math.round(100 - (conflicts.anyConflict.size / total) * 100) : 100;
  const donutColor = healthPct >= 90 ? 'var(--success)' : healthPct >= 70 ? 'var(--accent)' : 'var(--danger)';
  const healthLabel = healthPct >= 90 ? 'Healthy' : healthPct >= 70 ? 'Needs Review' : 'At Risk';

  const eligibleCount = state.schedules.filter((s) => state.assignments.some((a) => Number(a.faculty_id) === Number(s.faculty_id) && Number(a.course_id) === Number(s.course_id))).length;

  const rows = [
    { label: 'Faculty Conflicts', value: conflicts.faculty, icon: 'fa-chalkboard-user' },
    { label: 'Block/SPARE Conflicts', value: conflicts.block, icon: 'fa-layer-group' },
    { label: 'Room Conflicts', value: conflicts.room, icon: 'fa-door-open' },
    { label: 'Eligibility Checks', value: `${eligibleCount} / ${total}`, icon: 'fa-user-check', ok: eligibleCount === total },
  ];

  el.innerHTML = `
    <div class="health-wrap">
      <div class="health-donut" style="--pct:${healthPct}; --donut-color:${donutColor};">
        <div class="health-donut-inner">
          <div class="pct">${healthPct}%</div>
          <div class="pct-label">${escapeHtml(healthLabel)}</div>
        </div>
      </div>
      <div class="health-metrics">
        ${rows.map((r) => {
          const isWarn = r.ok === undefined ? Number(r.value) > 0 : !r.ok;
          return `
          <div class="health-metric-row">
            <span class="health-metric-label"><i class="fas ${isWarn ? 'fa-triangle-exclamation warn' : 'fa-circle-check ok'}"></i> ${escapeHtml(r.label)}</span>
            <span class="health-metric-value ${isWarn ? 'warn' : ''}">${escapeHtml(String(r.value))}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderNeedsAttention() {
  const el = $('needsAttention');
  if (!el) return;
  const conflicts = scanSystemConflicts();
  const unassignedCourses = state.courses.filter((c) => !state.schedules.some((s) => Number(s.course_id) === Number(c.id))).length;
  const load = facultyLoadStats();
  const noInstructor = state.schedules.filter((s) => !s.faculty_id).length;
  const noRoom = state.schedules.filter((s) => !s.room_id).length;

  const items = [];
  if (conflicts.room > 0) {
    items.push({ icon: 'fa-door-open', tone: '', title: `${conflicts.room} Room Conflict${conflicts.room === 1 ? '' : 's'}`, sub: 'Overlapping room bookings detected', view: 'schedules' });
  }
  if (conflicts.faculty > 0) {
    items.push({ icon: 'fa-chalkboard-user', tone: '', title: `${conflicts.faculty} Instructor Conflict${conflicts.faculty === 1 ? '' : 's'}`, sub: 'Faculty double-booked at the same time', view: 'schedules' });
  }
  if (conflicts.block > 0) {
    items.push({ icon: 'fa-layer-group', tone: '', title: `${conflicts.block} Block/SPARE Conflict${conflicts.block === 1 ? '' : 's'}`, sub: 'A block or SPARE group has overlapping classes', view: 'schedules' });
  }
  if (noInstructor > 0) {
    items.push({ icon: 'fa-user-slash', tone: 'warn-amber', title: `${noInstructor} Schedule${noInstructor === 1 ? '' : 's'} Without Instructor`, sub: 'Warning only — assign when ready', view: 'schedules' });
  }
  if (noRoom > 0) {
    items.push({ icon: 'fa-door-closed', tone: 'warn-amber', title: `${noRoom} Schedule${noRoom === 1 ? '' : 's'} Without Room`, sub: 'Warning only — assign when ready', view: 'schedules' });
  }
  if (unassignedCourses > 0) {
    items.push({ icon: 'fa-clipboard-question', tone: 'warn-amber', title: `${unassignedCourses} Unplotted Course${unassignedCourses === 1 ? '' : 's'}`, sub: 'Not yet plotted into any schedule', view: 'courses' });
  }
  if (load.overloaded > 0) {
    items.push({ icon: 'fa-user-clock', tone: 'warn-amber', title: `${load.overloaded} Faculty Overloaded`, sub: 'At or above max preparations', view: 'faculty' });
  } else if (load.nearLimit > 0) {
    items.push({ icon: 'fa-user-clock', tone: 'warn-info', title: `${load.nearLimit} Faculty Near Limit`, sub: 'One prep away from the max', view: 'faculty' });
  }

  if (!items.length) {
    el.innerHTML = `<div class="attention-empty"><i class="fas fa-circle-check"></i><span>All clear — no issues need attention.</span></div>`;
    return;
  }

  el.innerHTML = `<div class="attention-list">${items.map((it) => `
    <button type="button" class="attention-item" data-quick-nav="${it.view}">
      <div class="attention-icon ${it.tone}"><i class="fas ${it.icon}"></i></div>
      <div class="attention-text">
        <div class="attention-title">${escapeHtml(it.title)}</div>
        <div class="attention-sub">${escapeHtml(it.sub)}</div>
      </div>
      <i class="fas fa-chevron-right"></i>
    </button>`).join('')}</div>`;

  el.querySelectorAll('[data-quick-nav]').forEach((btn) => btn.addEventListener('click', () => goToView(btn.dataset.quickNav)));
}

const WEEKLY_OVERVIEW_DAYS = [
  { key: 'Monday', label: 'MON' }, { key: 'Tuesday', label: 'TUE' }, { key: 'Wednesday', label: 'WED' },
  { key: 'Thursday', label: 'THU' }, { key: 'Friday', label: 'FRI' }, { key: 'Saturday', label: 'SAT' },
];

/** Label for a schedule row's target (Block or SPARE) used in dashboard tooltips etc. */
function scheduleTargetLabel(s) {
  return s.is_spare || s.spare_id ? `${s.program_code} ${s.year_level}-SPARE` : `${s.program_code} ${s.year_level}-${s.block_name}`;
}

function renderWeeklyOverview() {
  const el = $('weeklyOverview');
  if (!el) return;
  const conflicts = scanSystemConflicts();
  const startHour = 7;
  const endHour = 17;

  let html = `<div class="wk-cell wk-head"></div>${WEEKLY_OVERVIEW_DAYS.map((d) => `<div class="wk-cell wk-head">${d.label}</div>`).join('')}`;

  for (let h = startHour; h <= endHour; h++) {
    html += `<div class="wk-cell wk-time">${escapeHtml(formatTimeLabel(h * 60))}</div>`;
    const slotStart = h * 60;
    const slotEnd = slotStart + 60;
    for (const day of WEEKLY_OVERVIEW_DAYS) {
      const matches = state.schedules.filter((s) => daysOverlap(day.key, s.day_of_week) && timesOverlap(minutesToTimeStr(slotStart), minutesToTimeStr(slotEnd), s.start_time.slice(0, 5), s.end_time.slice(0, 5)));
      let cls = '';
      if (matches.some((s) => conflicts.anyConflict.has(s.id))) cls = 'wk-conflict';
      else if (matches.length) cls = 'wk-scheduled';
      html += `<div class="wk-cell wk-slot ${cls}" title="${matches.length ? escapeHtml(matches.map((m) => `${m.course_code} (${scheduleTargetLabel(m)})`).join(', ')) : 'No schedule'}"></div>`;
    }
  }
  el.innerHTML = html;
}

function renderDashboardInsights() {
  renderScheduleHealth();
  renderNeedsAttention();
  renderWeeklyOverview();
}

function getSelectedCourse() {
  const courseId = Number($('scheduleCourse').value);
  return state.courses.find((c) => Number(c.id) === courseId) || null;
}

/**
 * The two possible schedule components. A course requires Lecture only
 * (minor/lecture-only subjects) or Lecture + Laboratory (major subjects,
 * determined by the course's own lec_units/lab_units -- never hard-coded).
 */
const COMPONENT_TYPES = ['lecture', 'laboratory'];

function courseRequiresComponent(course, component) {
  if (!course) return false;
  return component === 'lecture' ? Number(course.lec_units) > 0 : Number(course.lab_units) > 0;
}

/** Finds the already-saved schedule row (if any) for one component of the current Course + Block/SPARE + Academic Year "subject offering". */
function findExistingComponentSchedule(courseId, target, schoolYear, component) {
  if (!courseId || !target || !schoolYear) return null;
  return state.schedules.find((s) =>
    Number(s.course_id) === Number(courseId) &&
    (target.type === 'block' ? Number(s.block_id) === Number(target.id) : Number(s.spare_id) === Number(target.id)) &&
    s.school_year === schoolYear &&
    s.component === component
  ) || null;
}

/** true once the scheduler has clicked "Edit" on an already-saved component, unlocking its fields for this session. Reset whenever the Course/Target/Academic Year selection changes. */
const componentUnlocked = { lecture: false, laboratory: false };
const componentHasConflict = { lecture: false, laboratory: false };

/** The id of the existing schedule row backing this component right now, if any (used as the PUT target and as the live-conflict "ignore self" id). */
function existingComponentId(component) {
  const course = getSelectedCourse();
  if (!course) return null;
  const existing = findExistingComponentSchedule(course.id, getSelectedTarget(), $('scheduleSchoolYear').value, component);
  return existing ? Number(existing.id) : null;
}

/** ids of schedule rows currently open for editing in this form, so the faculty-inheritance lookup doesn't treat a component as its own "sibling". */
function currentEditingScheduleIds() {
  return COMPONENT_TYPES.map((c) => (componentUnlocked[c] ? existingComponentId(c) : null)).filter((id) => id !== null);
}

/** All Faculty Course Assignment rows (with course_code/course_title already joined server-side) for one faculty member -- powers the Assigned Courses column on the Faculty table. */
function coursesAssignedToFaculty(facultyId) {
  return state.assignments.filter((a) => Number(a.faculty_id) === Number(facultyId));
}

/** Faculty ids that are formally assigned to this course in Faculty Course Assignments. */
function assignedFacultyIdsForCourse(courseId) {
  return new Set(state.assignments
    .filter((a) => Number(a.course_id) === Number(courseId))
    .map((a) => Number(a.faculty_id)));
}

/**
 * Every instructor the scheduler may pick for this course: ALL active
 * faculty (not just the ones assigned to the course), plus the instructor
 * already on the schedule being edited even if they were deactivated since.
 * Being assigned to the course is only an indicator (a check mark and a
 * group at the top of the list), never a restriction.
 */
function getSelectableFacultyForCourse(courseId) {
  const course = state.courses.find((c) => Number(c.id) === Number(courseId));
  const target = getSelectedTarget();
  const schoolYear = $('scheduleSchoolYear').value;
  const anyExisting = course
    ? COMPONENT_TYPES.map((c) => findExistingComponentSchedule(course.id, target, schoolYear, c)).find(Boolean)
    : null;
  const editingFacultyId = anyExisting && anyExisting.faculty_id ? Number(anyExisting.faculty_id) : null;
  return [...state.faculty]
    .filter((f) => Number(f.is_active) === 1 || Number(f.id) === editingFacultyId)
    .sort((a, b) => String(a.faculty_name).localeCompare(String(b.faculty_name)));
}

/** <option>/<optgroup> markup: instructors assigned to this course first (with a check mark), then everyone else. */
function facultyOptionsHtml(course, selectable, emptyLabel) {
  const assignedIds = assignedFacultyIdsForCourse(course.id);
  const optionHtml = (f, mark) => `<option value="${f.id}">${mark ? '\u2713 ' : ''}${escapeHtml(f.faculty_name)}${Number(f.is_active) === 0 ? ' (Inactive)' : ''}</option>`;
  const assigned = selectable.filter((f) => assignedIds.has(Number(f.id)));
  const others = selectable.filter((f) => !assignedIds.has(Number(f.id)));
  let html = `<option value="">${escapeHtml(emptyLabel)}</option>`;
  if (assigned.length) html += `<optgroup label="\u2713 Assigned to ${escapeHtml(course.course_code)}">${assigned.map((f) => optionHtml(f, true)).join('')}</optgroup>`;
  if (others.length) html += `<optgroup label="${assigned.length ? 'Other instructors' : 'All instructors'} (not assigned to ${escapeHtml(course.course_code)})">${others.map((f) => optionHtml(f, false)).join('')}</optgroup>`;
  return html;
}

function renderSelects() {
  fillCourseSelectGrouped('scheduleCourse', state.courses);
  const prevAssignFaculty = $('assignFaculty').value;
  fillSelect('assignFaculty', state.faculty, (f) => f.faculty_name, 'id', 'Select instructor');
  if (state.faculty.some((f) => String(f.id) === prevAssignFaculty)) $('assignFaculty').value = prevAssignFaculty;
  updateComponentBlocks();
  updateFacultyOptions();
  scheduleCourseCombobox.updateAvailability();
  assignPicker.renderAll();
  renderTargetOptions();
}

function renderFilterOptions() {
  const prevTarget = $('filterTarget').value;
  const prevFaculty = $('filterFaculty').value;
  const prevSchoolYear = $('filterSchoolYear').value;
  const yearFilter = $('filterYear').value;
  // The Block filter must only ever offer blocks (and SPARE) that actually
  // belong to the currently selected Year Level filter -- otherwise picking
  // "2nd Year" still leaves 1st/3rd/4th Year blocks choosable, which
  // produces a filter combination that can never match anything.
  const blocksForFilter = yearFilter
    ? state.blocks.filter((b) => String(b.year_level) === String(yearFilter))
    : state.blocks;
  const sparesForFilter = yearFilter
    ? state.spares.filter((sp) => String(sp.year_level) === String(yearFilter))
    : state.spares;
  const blockOptions = blocksForFilter.map((b) => `<option value="block:${b.id}">${escapeHtml(blockLabel(b))}</option>`).join('');
  const spareOptions = sparesForFilter.map((sp) => `<option value="spare:${sp.id}">${escapeHtml(spareLabel(sp))}</option>`).join('');
  $('filterTarget').innerHTML = `<option value="">All Blocks</option>${blockOptions}${spareOptions}`;
  fillSelect('filterFaculty', state.faculty, (f) => f.faculty_name, 'id', 'All Faculty');
  $('filterFaculty').insertAdjacentHTML('beforeend', `<option value="${NO_INSTRUCTOR_FILTER}">\u26a0 Instructor not assigned</option>`);
  const schoolYears = [...new Set(state.schedules.map((s) => s.school_year))].sort().reverse();
  $('filterSchoolYear').innerHTML = '<option value="">All Academic Years</option>' + schoolYears.map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  if (schoolYears.includes(prevSchoolYear)) $('filterSchoolYear').value = prevSchoolYear;
  const targetStillValid = [...$('filterTarget').options].some((o) => o.value === prevTarget);
  $('filterTarget').value = targetStillValid ? prevTarget : '';
  if (!targetStillValid) scheduleFilters.target = '';
  if (prevFaculty === NO_INSTRUCTOR_FILTER || state.faculty.some((f) => String(f.id) === prevFaculty)) $('filterFaculty').value = prevFaculty;
}

/* =====================================================
   BLOCKS MANAGEMENT (Add Block / Rename / Assign Courses / Delete)
   ===================================================== */

function renderBlocksTable() {
  renderDataTable('blocksTable', [
    { key: 'program_code', label: 'Program' },
    { key: 'year_level', label: 'Year', render: (b) => YEAR_LEVEL_LABELS[b.year_level] || b.year_level },
    { key: 'block_name', label: 'Block' },
    { key: 'courses', label: 'Courses Assigned', sortable: false, render: (b) => String(courseIdsForBlock(b.id).length) },
  ], state.blocks, {
    emptyIcon: 'fa-layer-group',
    emptyMessage: 'No blocks yet.',
    rowActions: (b) => `
      <button class="btn btn-secondary btn-sm" onclick="openAssignBlockCoursesModal(${b.id})" title="Assign Courses" aria-label="Assign courses to this block"><i class="fas fa-book"></i></button>
      <button class="btn btn-secondary btn-sm" onclick="openBlockRenameModal(${b.id})" title="Rename" aria-label="Rename block"><i class="fas fa-pen"></i></button>
      <button class="btn btn-danger btn-sm" onclick="del('blocks',${b.id})" title="Delete" aria-label="Delete block"><i class="fas fa-trash"></i></button>`,
  });
}

function openAddBlockModal() {
  $('blockForm').reset();
  clearFormDirty('blockForm');
  clearValidationState('blockForm');
  $('modalBlock').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
window.openAddBlockModal = openAddBlockModal;

function closeAddBlockModal() {
  $('modalBlock').classList.add('hidden');
  document.body.style.overflow = '';
}
window.closeAddBlockModal = closeAddBlockModal;

$('blockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm('blockForm')) return;
  const submitBtn = $('blockSubmitBtn');
  const originalLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
  try {
    const data = await request('blocks.php', {
      method: 'POST',
      body: JSON.stringify({ year_level: $('blockYearLevel').value, number_of_blocks: $('numberOfBlocks').value }),
    });
    // Auto-assign every course that already exists for this year level to
    // each new block, right away -- no separate trip to "Assign Courses"
    // needed for the common case (blocks of the same year level share the
    // same course offering). Best-effort: if this part fails, the blocks
    // themselves are still created fine and can be assigned manually after.
    const yearLevel = $('blockYearLevel').value;
    const courseIdsForYear = state.courses.filter((c) => Number(c.year_level) === Number(yearLevel)).map((c) => c.id);
    if (courseIdsForYear.length) {
      await Promise.all(data.created.map((b) =>
        request('block_courses.php', { method: 'POST', body: JSON.stringify({ block_id: b.id, course_ids: courseIdsForYear }) }).catch(() => null)
      ));
    }
    showToast(`${data.created.length} block(s) created: ${data.created.map((c) => c.block_name).join(', ')}`, 'success');
    closeAddBlockModal();
    await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
});

let blockRenameTargetId = null;

function openBlockRenameModal(id) {
  const b = state.blocks.find((x) => Number(x.id) === id);
  if (!b) return;
  blockRenameTargetId = id;
  $('blockRenameName').value = b.block_name;
  $('modalBlockRename').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
window.openBlockRenameModal = openBlockRenameModal;

function closeBlockRenameModal() {
  $('modalBlockRename').classList.add('hidden');
  document.body.style.overflow = '';
  blockRenameTargetId = null;
}
window.closeBlockRenameModal = closeBlockRenameModal;

$('blockRenameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!blockRenameTargetId) return;
  const submitBtn = $('blockRenameSubmitBtn');
  const originalLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  try {
    await request('blocks.php', { method: 'PUT', body: JSON.stringify({ id: blockRenameTargetId, block_name: $('blockRenameName').value }) });
    showToast('Block renamed successfully', 'success');
    closeBlockRenameModal();
    await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
});

let assignBlockCoursesTargetId = null;

function openAssignBlockCoursesModal(blockId) {
  const b = state.blocks.find((x) => Number(x.id) === blockId);
  if (!b) return;
  assignBlockCoursesTargetId = blockId;
  $('assignBlockCoursesLabel').textContent = blockLabel(b);
  const assignedIds = new Set(courseIdsForBlock(blockId));
  // A block with nothing saved yet gets every one of this year level's
  // courses pre-checked as a starting point (since blocks of the same year
  // level usually share the same course offering) -- still fully editable
  // before Save, and never overrides a block that already has a saved
  // assignment (even an empty one the user deliberately cleared).
  const isFreshBlock = assignedIds.size === 0;
  const coursesForYear = state.courses.filter((c) => Number(c.year_level) === Number(b.year_level))
    .sort((a, c) => String(a.course_code).localeCompare(String(c.course_code)));
  const list = $('assignBlockCoursesList');
  if (!coursesForYear.length) {
    list.innerHTML = `<div class="combobox-empty">No courses exist yet for ${YEAR_LEVEL_LABELS[b.year_level] || 'Year ' + b.year_level}. Add courses first.</div>`;
  } else {
    list.innerHTML = coursesForYear.map((c) => `
      <label class="checklist-item">
        <input type="checkbox" value="${c.id}" ${(assignedIds.has(Number(c.id)) || isFreshBlock) ? 'checked' : ''} />
        <span><strong>${escapeHtml(c.course_code)}</strong> - ${escapeHtml(c.course_title)}</span>
      </label>`).join('');
  }
  $('modalAssignBlockCourses').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
window.openAssignBlockCoursesModal = openAssignBlockCoursesModal;

function closeAssignBlockCoursesModal() {
  $('modalAssignBlockCourses').classList.add('hidden');
  document.body.style.overflow = '';
  assignBlockCoursesTargetId = null;
}
window.closeAssignBlockCoursesModal = closeAssignBlockCoursesModal;

async function saveAssignBlockCourses() {
  if (!assignBlockCoursesTargetId) return;
  const courseIds = [...document.querySelectorAll('#assignBlockCoursesList input[type="checkbox"]:checked')].map((cb) => Number(cb.value));
  const submitBtn = $('assignBlockCoursesSubmitBtn');
  const originalLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
  try {
    await request('block_courses.php', { method: 'POST', body: JSON.stringify({ block_id: assignBlockCoursesTargetId, course_ids: courseIds }) });
    showToast('Course assignments updated successfully', 'success');
    closeAssignBlockCoursesModal();
    await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
}
window.saveAssignBlockCourses = saveAssignBlockCourses;

/* =====================================================
   SUBJECT OFFERING FORM -- COMPONENT BLOCKS (Lecture/Laboratory)
   ===================================================== */

const SET_LABELS_SHORT = { set_0: 'SET 0', set_1: 'SET 1', set_2: 'SET 2' };
const SET_ROTATION_SUMMARY = {
  set_0: '',
  set_1: 'SET 1 \u2014 F2F \u2194 Online Rotation',
  set_2: 'SET 2 \u2014 Online \u2194 F2F Rotation',
};

function setRotationTagHtml(setType) {
  if (setType !== 'set_1' && setType !== 'set_2') return '';
  return ` <span class="tt-set-tag" title="${escapeHtml(SET_ROTATION_SUMMARY[setType])}">${SET_LABELS_SHORT[setType]}</span>`;
}

const SET_DISPLAY = {
  set_0: { label: 'SET 0', icon: '\u{1F3EB}', rotation: 'F2F' },
  set_1: { label: 'SET 1', icon: '\u{1F504}', rotation: 'F2F \u2194 Online' },
  set_2: { label: 'SET 2', icon: '\u{1F504}', rotation: 'Online \u2194 F2F' },
};

const TT_ROW_HEIGHT = 22;
const TT_BLOCK_LINE_HEIGHT = 10.5;
const TT_BLOCK_VPAD = 2;

function layoutDayBlocks(entries) {
  const sorted = [...entries].sort((a, b) => a.startSlot - b.startSlot || a.endSlot - b.endSlot);
  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  sorted.forEach((e) => {
    if (current.length && e.startSlot >= clusterEnd) {
      clusters.push(current);
      current = [];
      clusterEnd = -Infinity;
    }
    current.push(e);
    clusterEnd = Math.max(clusterEnd, e.endSlot);
  });
  if (current.length) clusters.push(current);

  const result = [];
  clusters.forEach((cluster) => {
    const laneEnds = [];
    cluster.forEach((e) => {
      let lane = laneEnds.findIndex((end) => end <= e.startSlot);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.endSlot); }
      else laneEnds[lane] = e.endSlot;
      e.lane = lane;
    });
    const laneCount = laneEnds.length;
    cluster.forEach((e) => { e.laneCount = laneCount; result.push(e); });
  });
  return result;
}

function renderTtBlock(entry, mode) {
  const { s, startSlot, endSlot, lane, laneCount } = entry;
  const top = startSlot * TT_ROW_HEIGHT;
  const height = (endSlot - startSlot) * TT_ROW_HEIGHT;
  const widthPct = 100 / laneCount;
  const leftPct = lane * widthPct;

  const subLabel = mode === 'block' ? (s.faculty_id ? s.faculty_name : '\u26a0 Instructor not assigned') : scheduleTargetLabel(s);
  const modality = scheduleModality(s);
  const setInfo = SET_DISPLAY[s.set_type] || SET_DISPLAY.set_0;
  const modalityLine = modality.label === 'F2F'
    ? `${setInfo.icon} ${escapeHtml(setInfo.rotation)}${modality.room ? ' \u2022 ' + escapeHtml(modality.room) : ''}`
    : `${setInfo.icon} ${escapeHtml(setInfo.rotation)}`;

  const lines = [
    { cls: 'tt-block-title', html: escapeHtml(s.course_code) },
    ...(laneCount > 1 ? [] : [{ cls: 'tt-block-sub', html: escapeHtml(subLabel) }]),
    { cls: `tt-block-set tt-set-${s.set_type}`, html: escapeHtml(setInfo.label) },
    { cls: 'tt-block-modality-line', html: modalityLine },
  ];
  const maxLines = Math.max(1, Math.floor((height - TT_BLOCK_VPAD) / TT_BLOCK_LINE_HEIGHT));
  const shown = lines.slice(0, Math.min(lines.length, maxLines));

  const tooltip = `${s.course_code} - ${s.course_title} (${modality.label}${s.set_type !== 'set_0' ? ' \u2014 ' + SET_ROTATION_SUMMARY[s.set_type] : ''})`;
  const leftStyle = laneCount > 1 ? `${leftPct}%` : '0';
  const widthStyle = laneCount > 1 ? `${widthPct}%` : '100%';
  const dividerStyle = laneCount > 1 && lane < laneCount - 1 ? 'border-right:2px solid var(--bg-secondary);' : '';

  return `<div class="tt-block ${s.component === 'laboratory' ? 'lab' : ''}" data-set="${escapeHtml(s.set_type)}" style="top:${top}px;height:${height}px;left:${leftStyle};width:${widthStyle};${dividerStyle}" title="${escapeHtml(tooltip)}">
    ${shown.map((l) => `<div class="${l.cls}">${l.html}</div>`).join('')}
  </div>`;
}

let ttMode = 'block';
const TT_DAY_COLUMNS = { Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6, Saturday: 7, Sunday: 8 };
const TT_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * A room is optional while plotting (a missing room only shows a warning),
 * so this is purely a display label, not a "does it have a room" check. SET 0 is straightforwardly Face-to-Face;
 * SET 1/2 are shown as Hybrid since they rotate week-to-week rather than
 * meeting the same way every time.
 */
function scheduleModality(s) {
  return {
    label: s.set_type === 'set_0' ? 'F2F' : 'HYBRID',
    room: s.room_name || '\u26a0 No room yet',
  };
}

function renderTimetableSelectors() {
  const prevSY = $('ttSchoolYear').value;
  const prevSem = $('ttSemester').value;
  const prevTarget = $('ttTarget').value;
  const prevFac = $('ttFaculty').value;
  const schoolYears = [...new Set(state.schedules.map((s) => s.school_year))].sort().reverse();
  const fallbackYear = suggestedSchoolYear();
  $('ttSchoolYear').innerHTML = (schoolYears.length ? schoolYears : [fallbackYear]).map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  if (schoolYears.includes(prevSY)) $('ttSchoolYear').value = prevSY;
  $('ttSemester').value = prevSem;

  const blockOptions = state.blocks.map((b) => `<option value="block:${b.id}">${escapeHtml(blockLabel(b))}</option>`).join('');
  const spareOptions = state.spares.map((sp) => `<option value="spare:${sp.id}">${escapeHtml(spareLabel(sp))}</option>`).join('');
  $('ttTarget').innerHTML = `<option value="">Select a block</option>${blockOptions}${spareOptions}`;
  fillSelect('ttFaculty', state.faculty, (f) => f.faculty_name, 'id', 'Select a faculty');
  if (prevTarget) $('ttTarget').value = prevTarget;
  if (prevFac) $('ttFaculty').value = prevFac;
}

function renderTimetable() {
  const schoolYear = $('ttSchoolYear').value;
  const semester = $('ttSemester').value;
  const semesterLabel = { first_semester: 'First Semester', second_semester: 'Second Semester', summer: 'Summer' }[semester] || '';
  let filtered = state.schedules.filter((s) => s.school_year === schoolYear && (!semester || s.semester_type === semester));
  let heading = '';

  if (ttMode === 'block') {
    const targetValue = $('ttTarget').value;
    const { blockId, spareId } = parseTargetValue(targetValue);
    filtered = targetValue ? filtered.filter((s) => (blockId ? Number(s.block_id) === blockId : Number(s.spare_id) === spareId)) : [];
    const target = blockId ? state.blocks.find((b) => Number(b.id) === blockId) : state.spares.find((sp) => Number(sp.id) === spareId);
    const label = target ? (blockId ? blockLabel(target) : spareLabel(target)) : null;
    heading = label ? `${escapeHtml(label)} &nbsp;|&nbsp; AY ${escapeHtml(schoolYear)}${semesterLabel ? ' &nbsp;|&nbsp; ' + escapeHtml(semesterLabel) : ''}` : 'Select a block above to view its timetable.';
    $('ttSummaryCard').classList.add('hidden');
  } else {
    const facultyId = $('ttFaculty').value;
    filtered = facultyId ? filtered.filter((s) => String(s.faculty_id) === facultyId) : [];
    const fac = state.faculty.find((f) => String(f.id) === facultyId);
    heading = fac ? `${escapeHtml(fac.faculty_name)} &nbsp;|&nbsp; AY ${escapeHtml(schoolYear)}${semesterLabel ? ' &nbsp;|&nbsp; ' + escapeHtml(semesterLabel) : ''}` : 'Select a faculty above to view their load.';
    if (fac) {
      const uniqueCourseIds = [...new Set(filtered.map((s) => s.course_id))];
      const totalUnits = uniqueCourseIds.reduce((sum, cid) => {
        const c = state.courses.find((cc) => Number(cc.id) === Number(cid));
        return sum + (c ? Number(c.lec_units) + Number(c.lab_units) : 0);
      }, 0);
      $('ttSummary').innerHTML = `
        <div class="card stat-card"><div class="stat-icon"><i class="fas fa-book"></i></div><div><div class="num">${uniqueCourseIds.length}</div><div class="label">Preparations</div></div></div>
        <div class="card stat-card"><div class="stat-icon"><i class="fas fa-graduation-cap"></i></div><div><div class="num">${totalUnits}</div><div class="label">Total Units</div></div></div>
        <div class="card stat-card"><div class="stat-icon"><i class="fas fa-calendar-check"></i></div><div><div class="num">${filtered.length}</div><div class="label">Class Meetings</div></div></div>`;
      $('ttSummaryCard').classList.remove('hidden');
    } else {
      $('ttSummaryCard').classList.add('hidden');
    }
  }

  $('ttHeading').innerHTML = heading;

  const selectionMade = ttMode === 'block' ? !!$('ttTarget').value : !!$('ttFaculty').value;
  if (!filtered.length) {
    $('ttGrid').style.display = 'block';
    $('ttGrid').innerHTML = `<div class="table-empty-state"><i class="fas fa-calendar-xmark"></i><p>${selectionMade ? 'No schedules found for this selection.' : 'Make a selection above to view the timetable.'}</p></div>`;
    return;
  }

  let minStart = Math.min(...filtered.map((s) => timeStrToMinutes(s.start_time.slice(0, 5))), 7 * 60);
  let maxEnd = Math.max(...filtered.map((s) => timeStrToMinutes(s.end_time.slice(0, 5))), 19 * 60);
  minStart = Math.floor(minStart / 60) * 60;
  maxEnd = Math.ceil(maxEnd / 60) * 60;
  const totalSlots = (maxEnd - minStart) / 30;

  $('ttGrid').style.display = 'grid';
  $('ttGrid').style.gridTemplateColumns = '70px repeat(7, 1fr)';
  $('ttGrid').style.gridTemplateRows = `36px repeat(${totalSlots}, ${TT_ROW_HEIGHT}px)`;

  let html = '<div class="tt-corner">Time</div>';
  TT_DAY_ORDER.forEach((d) => { html += `<div class="tt-day-header">${d.slice(0, 3)}</div>`; });

  for (let i = 0; i < totalSlots; i++) {
    const mins = minStart + i * 30;
    const isHour = mins % 60 === 0;
    html += `<div class="tt-time-label" style="grid-row:${i + 2};grid-column:1;">${isHour ? escapeHtml(formatTimeLabel(mins)) : ''}</div>`;
    for (let d = 0; d < 7; d++) {
      html += `<div class="tt-cell-bg" style="grid-row:${i + 2};grid-column:${d + 2};"></div>`;
    }
  }

  const dayEntries = {};
  filtered.forEach((s) => {
    const days = scheduleDaysFor(s.day_of_week);
    const startMin = timeStrToMinutes(s.start_time.slice(0, 5));
    const endMin = timeStrToMinutes(s.end_time.slice(0, 5));
    const startSlot = Math.max(0, Math.floor((startMin - minStart) / 30));
    const endSlot = Math.min(totalSlots, Math.ceil((endMin - minStart) / 30));
    days.forEach((d) => {
      const col = TT_DAY_COLUMNS[d];
      if (!col) return;
      (dayEntries[col] = dayEntries[col] || []).push({ s, startSlot, endSlot });
    });
  });

  Object.keys(dayEntries).forEach((col) => {
    const laidOut = layoutDayBlocks(dayEntries[col]);
    html += `<div class="tt-day-col" style="grid-row:2 / span ${totalSlots};grid-column:${col};">`;
    laidOut.forEach((entry) => { html += renderTtBlock(entry, ttMode); });
    html += '</div>';
  });

  $('ttGrid').innerHTML = html;
}

function fillPrintLetterhead(title, subtitle) {
  $('printLetterheadTitle').textContent = title;
  $('printLetterheadSubtitle').textContent = subtitle;
  $('printLetterheadDate').textContent = 'Printed on ' + new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function printSchedules() {
  // Academic Year and Semester are always stated, even when the filter is "All".
  const parts = [
    scheduleFilters.schoolYear ? `Academic Year ${scheduleFilters.schoolYear}` : 'All Academic Years',
    scheduleFilters.semester ? (SEMESTER_LABELS[scheduleFilters.semester] || scheduleFilters.semester) : 'All Semesters',
  ];
  if (scheduleFilters.year) parts.push(YEAR_LEVEL_LABELS[scheduleFilters.year] || `Year ${scheduleFilters.year}`);
  if (scheduleFilters.target) {
    const { blockId, spareId } = parseTargetValue(scheduleFilters.target);
    const target = blockId ? state.blocks.find((b) => Number(b.id) === blockId) : state.spares.find((sp) => Number(sp.id) === spareId);
    if (target) parts.push(blockId ? blockLabel(target) : spareLabel(target));
  }
  if (scheduleFilters.faculty) {
    const fac = state.faculty.find((f) => String(f.id) === String(scheduleFilters.faculty));
    if (fac) parts.push(fac.faculty_name);
  }
  fillPrintLetterhead('Class Schedule', parts.join(' \u00b7 '));

  renderSchedulesTable(true);
  const restore = () => { renderSchedulesTable(false); window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}
window.printSchedules = printSchedules;

function printTimetable() {
  const heading = $('ttHeading').textContent.trim();
  fillPrintLetterhead(ttMode === 'block' ? 'Block Timetable' : 'Faculty Load Timetable', heading);
  window.print();
}
window.printTimetable = printTimetable;

/**
 * Prints just the Course Offering table from the Plot Schedule view.
 * The whole plotting view lives inside <form id="scheduleForm">, and the
 * base print stylesheet hides every form -- so instead of restructuring
 * the page, this flips a `printing-offering` class on <body> that a
 * dedicated print block in style.css uses to un-hide the form and show
 * only #offeringOverviewSection inside it. The class is removed again on
 * afterprint so the screen view is untouched.
 */
function printOffering() {
  const schoolYear = $('scheduleSchoolYear').value;
  const yearLevel = $('scheduleYearLevel').value;
  const semester = $('scheduleSemester').value;
  if (!schoolYear || !yearLevel || !semester) {
    showToast('Select an Academic Year, Year Level, and Semester first.', 'warning');
    return;
  }
  const blocksForYear = state.blocks.filter((b) => Number(b.year_level) === Number(yearLevel));
  const programCode = blocksForYear[0]?.program_code || 'BSCS';
  const subtitle = [
    programCode,
    YEAR_LEVEL_LABELS[yearLevel] || `Year ${yearLevel}`,
    SEMESTER_LABELS[semester] || semester,
    `Academic Year ${schoolYear}`,
  ].join(' \u00b7 ');
  fillPrintLetterhead('Course Offering', subtitle);

  document.body.classList.add('printing-offering');
  const restore = () => {
    document.body.classList.remove('printing-offering');
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
window.printOffering = printOffering;

/* =====================================================
   PAGE REPORTS
   Faculty Assignments (Faculty Assignments page), Room Utilization (Rooms
   page), Unscheduled Courses (Courses page) and Incomplete Schedule
   Assignments (Schedules page) each have a Print button that opens a small
   options popup (Academic Year, Semester, and filters that fit the report).
   The report is built here from the data already loaded in `state` and
   printed through the hidden #printReportRoot container.

   Printing works by adding `printing-report` to <body>: the print CSS then
   hides every view and shows only #printReportRoot under the letterhead.
   ===================================================== */

const REPORT_META = {
  facultyAssignments: {
    title: 'Faculty Assignments',
    icon: 'fa-user-tie',
    desc: 'Courses each instructor is assigned to teach.',
    filters: ['semester', 'year'],
  },
  roomUtilization: {
    title: 'Room Utilization',
    icon: 'fa-door-open',
    desc: 'Classes held in each room and the weekly hours they use.',
    filters: ['semester', 'room'],
  },
  unscheduledCourses: {
    title: 'Unscheduled Courses',
    icon: 'fa-clipboard-question',
    desc: 'Courses assigned to a block or SPARE that still have no Lecture or Laboratory schedule.',
    filters: ['semester', 'year'],
  },
  incompleteAssignments: {
    title: 'Incomplete Schedule Assignments',
    icon: 'fa-user-slash',
    desc: 'Plotted schedules that still need an instructor, a room, or both.',
    filters: ['semester', 'year', 'issue'],
  },
};

let activeReport = 'unscheduledCourses';

const COMPONENT_LABELS = { lecture: 'Lecture', laboratory: 'Laboratory' };

function getReportFilters() {
  return {
    schoolYear: $('reportSchoolYear').value || suggestedSchoolYear(),
    semester: $('reportSemester').value,
    year: $('reportYear').value,
    room: $('reportRoom').value,
    issue: $('reportIssue').value,
  };
}

function reportSemesterLabel(semester) {
  return semester ? (SEMESTER_LABELS[semester] || semester) : 'All Semesters';
}

/** "BSCS 1-Block A" or "BSCS 1-SPARE", the same naming scheduleTargetLabel() uses. */
function reportTargetLabel(programCode, yearLevel, blockName) {
  return `${programCode} ${yearLevel}-${blockName || 'SPARE'}`;
}

function reportScheduleText(s) {
  return `${formatDayPattern(s.day_of_week)} ${formatTimeDisplay(s.start_time.slice(0, 5))} to ${formatTimeDisplay(s.end_time.slice(0, 5))}`;
}

function scheduleWeeklyMinutes(s) {
  const meeting = timeStrToMinutes(s.end_time.slice(0, 5)) - timeStrToMinutes(s.start_time.slice(0, 5));
  return meeting * scheduleDaysFor(s.day_of_week).length;
}

function formatReportHours(minutes) {
  return `${Math.round((minutes / 60) * 100) / 100} hrs`;
}

function findCourseById(id) {
  return state.courses.find((c) => Number(c.id) === Number(id)) || null;
}

/* ---------- Report builders ----------
   Each returns { title, details: [[label, value]], sections: [{ heading?, note?, columns, rows }], emptyMessage }.
   A cell is a plain string, or { text, cls } when it needs a style. */

function buildFacultyAssignmentsReport(f) {
  const rows = state.assignments
    .map((a) => ({ a, course: findCourseById(a.course_id) }))
    .filter(({ course }) => course
      && (!f.semester || course.semester_type === f.semester)
      && (!f.year || String(course.year_level) === String(f.year)))
    .sort((x, y) => x.a.faculty_name.localeCompare(y.a.faculty_name) || x.course.course_code.localeCompare(y.course.course_code));

  let lastFaculty = null;
  const tableRows = rows.map(({ a, course }) => {
    // Show the instructor's name once, then leave it blank for their other courses.
    const showName = a.faculty_name !== lastFaculty;
    lastFaculty = a.faculty_name;
    return [
      showName ? { text: a.faculty_name, cls: 'pr-strong' } : '',
      course.course_code,
      course.course_title,
      YEAR_LEVEL_LABELS[course.year_level] || `Year ${course.year_level}`,
      SEMESTER_LABELS[course.semester_type] || course.semester_type,
      String(Number(course.lec_units) + Number(course.lab_units)),
    ];
  });

  return {
    title: REPORT_META.facultyAssignments.title,
    details: [
      ['Year Level', f.year ? (YEAR_LEVEL_LABELS[f.year] || f.year) : 'All Year Levels'],
      ['Instructors', String(new Set(rows.map(({ a }) => a.faculty_id)).size)],
      ['Assignments', String(rows.length)],
    ],
    sections: [{ columns: ['Instructor', 'Course Code', 'Course Title', 'Year Level', 'Semester', 'Units'], rows: tableRows }],
    emptyMessage: 'No faculty course assignments match these filters.',
  };
}

function buildRoomUtilizationReport(f) {
  const rooms = state.rooms
    .filter((r) => !f.room || String(r.id) === String(f.room))
    .slice()
    .sort((a, b) => a.room_name.localeCompare(b.room_name, undefined, { numeric: true }));

  const inScope = state.schedules.filter((s) => s.school_year === f.schoolYear && (!f.semester || s.semester_type === f.semester));
  const withoutRoom = inScope.filter((s) => !s.room_id).length;
  const dayIndex = (s) => ALL_WEEKDAYS.indexOf(scheduleDaysFor(s.day_of_week)[0]);

  const perRoom = rooms.map((room) => {
    const list = inScope
      .filter((s) => Number(s.room_id) === Number(room.id))
      .sort((a, b) => dayIndex(a) - dayIndex(b) || a.start_time.localeCompare(b.start_time));
    return { room, list, minutes: list.reduce((sum, s) => sum + scheduleWeeklyMinutes(s), 0) };
  });

  const typeLabel = (room) => (room.room_type === 'laboratory' ? 'Laboratory' : 'Lecture');
  const sections = [{
    heading: 'Summary',
    columns: ['Room', 'Type', 'Classes', 'Hours per Week'],
    rows: perRoom.map(({ room, list, minutes }) => [{ text: room.room_name, cls: 'pr-strong' }, typeLabel(room), String(list.length), list.length ? formatReportHours(minutes) : 'None']),
  }];

  perRoom.forEach(({ room, list, minutes }) => {
    sections.push({
      heading: `${room.room_name} (${typeLabel(room)})`,
      note: list.length ? `${list.length} class${list.length === 1 ? '' : 'es'}, ${formatReportHours(minutes)} per week` : 'No classes scheduled in this room.',
      columns: ['Schedule', 'Course', 'Block/SPARE', 'Instructor', 'SET'],
      rows: list.map((s) => [
        reportScheduleText(s),
        courseWithComponent(s),
        scheduleTargetLabel(s),
        s.faculty_name || 'Not assigned',
        String(s.set_type || '').replace('set_', 'SET '),
      ]),
    });
  });

  const room = f.room ? state.rooms.find((r) => String(r.id) === String(f.room)) : null;
  return {
    title: REPORT_META.roomUtilization.title,
    details: [
      ['Room', room ? room.room_name : 'All Rooms'],
      ['Rooms Listed', String(rooms.length)],
      ['Schedules Without a Room', String(withoutRoom)],
    ],
    sections,
    emptyMessage: 'No rooms found.',
  };
}

/** "IT 101" for a lecture-only course, "IT 101 (Laboratory)" when the course also has a lab part so the two rows can be told apart. */
function courseWithComponent(s) {
  const course = findCourseById(s.course_id);
  const hasBoth = course && Number(course.lec_units) > 0 && Number(course.lab_units) > 0;
  return hasBoth ? `${s.course_code} (${COMPONENT_LABELS[s.component] || s.component})` : s.course_code;
}

function buildUnscheduledCoursesReport(f) {
  const rows = [];

  const requiredComponents = (course) => [
    Number(course.lec_units) > 0 ? 'lecture' : null,
    Number(course.lab_units) > 0 ? 'laboratory' : null,
  ].filter(Boolean);

  const missingFor = (course, target) => requiredComponents(course).filter((component) => !state.schedules.some((s) =>
    Number(s.course_id) === Number(course.id)
    && s.school_year === f.schoolYear
    && s.component === component
    && (target.type === 'block' ? Number(s.block_id) === Number(target.id) : Number(s.spare_id) === Number(target.id))));

  const courseMatches = (course) => course
    && (!f.semester || course.semester_type === f.semester)
    && (!f.year || String(course.year_level) === String(f.year));

  const pushIfMissing = (course, target, label) => {
    const missing = missingFor(course, target);
    if (!missing.length) return;
    const required = requiredComponents(course).length;
    rows.push({
      year: Number(course.year_level),
      target: label,
      code: course.course_code,
      cells: [
        { text: course.course_code, cls: 'pr-strong' },
        course.course_title,
        label,
        missing.map((c) => COMPONENT_LABELS[c]).join(' and '),
        missing.length === required ? 'Not plotted' : 'Partly plotted',
      ],
    });
  };

  // Courses assigned to a block (Assign Courses).
  state.blocks.forEach((b) => {
    state.blockCourseRows
      .filter((r) => Number(r.block_id) === Number(b.id))
      .map((r) => findCourseById(r.course_id))
      .filter(courseMatches)
      .forEach((course) => pushIfMissing(course, { type: 'block', id: b.id }, reportTargetLabel(b.program_code, b.year_level, b.block_name)));
  });

  // Courses given their own SPARE schedule ("join block" allocations attend a block's class, so they are not listed here).
  state.spares.forEach((sp) => {
    (sp.allocations || [])
      .filter((al) => al.allocation_type === 'separate_schedule')
      .map((al) => findCourseById(al.course_id))
      .filter(courseMatches)
      .forEach((course) => pushIfMissing(course, { type: 'spare', id: sp.id }, reportTargetLabel(sp.program_code, sp.year_level, null)));
  });

  // Courses that are not assigned to any block or SPARE at all.
  state.courses.filter(courseMatches).forEach((course) => {
    const inBlock = state.blockCourseRows.some((r) => Number(r.course_id) === Number(course.id));
    const inSpare = state.spares.some((sp) => (sp.allocations || []).some((al) => Number(al.course_id) === Number(course.id) && al.allocation_type === 'separate_schedule'));
    if (inBlock || inSpare) return;
    rows.push({
      year: Number(course.year_level),
      target: '',
      code: course.course_code,
      cells: [{ text: course.course_code, cls: 'pr-strong' }, course.course_title, 'Not assigned', requiredComponents(course).map((c) => COMPONENT_LABELS[c]).join(' and '), 'Not assigned to a block'],
    });
  });

  rows.sort((a, b) => a.year - b.year || a.target.localeCompare(b.target) || a.code.localeCompare(b.code));

  const columns = ['Course Code', 'Course Title', 'Block/SPARE', 'Missing', 'Status'];
  const sections = [...new Set(rows.map((r) => r.year))].map((year) => {
    const yearRows = rows.filter((r) => r.year === year);
    return { heading: YEAR_LEVEL_LABELS[year] || `Year ${year}`, note: `${yearRows.length} item${yearRows.length === 1 ? '' : 's'}`, columns, rows: yearRows.map((r) => r.cells) };
  });

  return {
    title: REPORT_META.unscheduledCourses.title,
    details: [
      ['Year Level', f.year ? (YEAR_LEVEL_LABELS[f.year] || f.year) : 'All Year Levels'],
      ['Items Needing a Schedule', String(rows.length)],
    ],
    sections,
    emptyMessage: 'Every course is fully scheduled for this selection.',
  };
}

function buildIncompleteAssignmentsReport(f) {
  const ISSUE_LABELS = { instructor: 'Needs Instructor', room: 'Needs Room', both: 'Needs Instructor & Room' };
  const issueOf = (s) => {
    const noInstructor = !s.faculty_id;
    const noRoom = !s.room_id;
    if (noInstructor && noRoom) return 'both';
    return noInstructor ? 'instructor' : (noRoom ? 'room' : null);
  };
  const matchesIssueFilter = (issue) => !f.issue
    || (f.issue === 'instructor' && (issue === 'instructor' || issue === 'both'))
    || (f.issue === 'room' && (issue === 'room' || issue === 'both'));

  const rows = state.schedules
    .filter((s) => s.school_year === f.schoolYear
      && (!f.semester || s.semester_type === f.semester)
      && (!f.year || String(s.year_level) === String(f.year)))
    .map((s) => ({ s, issue: issueOf(s) }))
    .filter(({ issue }) => issue && matchesIssueFilter(issue))
    .sort((a, b) => Number(a.s.year_level) - Number(b.s.year_level)
      || scheduleTargetLabel(a.s).localeCompare(scheduleTargetLabel(b.s))
      || a.s.course_code.localeCompare(b.s.course_code));

  const issueFilterLabel = { '': 'All Issues', instructor: 'Needs Instructor', room: 'Needs Room' }[f.issue];
  return {
    title: REPORT_META.incompleteAssignments.title,
    details: [
      ['Year Level', f.year ? (YEAR_LEVEL_LABELS[f.year] || f.year) : 'All Year Levels'],
      ['Issue', issueFilterLabel],
      ['Schedules Listed', String(rows.length)],
    ],
    sections: [{
      columns: ['Course', 'Block/SPARE', 'Schedule', 'Instructor', 'Room', 'Status'],
      rows: rows.map(({ s, issue }) => [
        { text: courseWithComponent(s), cls: 'pr-strong' },
        scheduleTargetLabel(s),
        reportScheduleText(s),
        s.faculty_name || 'Not assigned',
        s.room_name || 'TBA',
        { text: ISSUE_LABELS[issue], cls: 'pr-status' },
      ]),
    }],
    emptyMessage: 'No incomplete schedule assignments for this selection.',
  };
}

function buildReport(key) {
  const f = getReportFilters();
  if (key === 'facultyAssignments') return buildFacultyAssignmentsReport(f);
  if (key === 'roomUtilization') return buildRoomUtilizationReport(f);
  if (key === 'incompleteAssignments') return buildIncompleteAssignmentsReport(f);
  return buildUnscheduledCoursesReport(f);
}

/** Turns a report object into HTML. Used for both the on-screen preview and the print container. */
function renderReportHtml(report) {
  const cellHtml = (cell) => {
    if (cell && typeof cell === 'object') return `<td class="${cell.cls || ''}">${escapeHtml(cell.text)}</td>`;
    return `<td>${escapeHtml(cell)}</td>`;
  };

  const details = report.details
    .map(([label, value]) => `<div class="pr-detail"><span>${escapeHtml(label)}:</span> <strong>${escapeHtml(value)}</strong></div>`)
    .join('');

  const hasRows = report.sections.some((sec) => sec.rows.length);
  if (!hasRows) {
    return `<div class="pr-details">${details}</div><p class="pr-empty">${escapeHtml(report.emptyMessage)}</p>`;
  }

  const sections = report.sections.map((sec) => {
    const heading = sec.heading ? `<h3 class="pr-section-title">${escapeHtml(sec.heading)}</h3>` : '';
    const note = sec.note ? `<p class="pr-note">${escapeHtml(sec.note)}</p>` : '';
    if (!sec.rows.length) return `<section class="pr-section">${heading}${note}</section>`;
    const head = sec.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const body = sec.rows.map((row) => `<tr>${row.map(cellHtml).join('')}</tr>`).join('');
    return `<section class="pr-section">${heading}${note}<table class="pr-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
  }).join('');

  return `<div class="pr-details">${details}</div>${sections}`;
}

/* ---------- Reports view (screen) ---------- */

function renderReportSelectors() {
  const prevYear = $('reportSchoolYear').value;
  const prevRoom = $('reportRoom').value;
  const years = new Set(state.schedules.map((s) => s.school_year));
  years.add(suggestedSchoolYear());
  const sorted = [...years].sort().reverse();
  $('reportSchoolYear').innerHTML = sorted.map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  $('reportSchoolYear').value = sorted.includes(prevYear) ? prevYear : suggestedSchoolYear();

  const rooms = state.rooms.slice().sort((a, b) => a.room_name.localeCompare(b.room_name, undefined, { numeric: true }));
  $('reportRoom').innerHTML = '<option value="">All Rooms</option>' + rooms.map((r) => `<option value="${r.id}">${escapeHtml(r.room_name)}</option>`).join('');
  if (rooms.some((r) => String(r.id) === prevRoom)) $('reportRoom').value = prevRoom;
}

/* ---------- Print options popup ---------- */

function openPrintOptions(key) {
  if (!REPORT_META[key]) return;
  activeReport = key;
  const meta = REPORT_META[key];
  $('printOptionsTitle').innerHTML = `<i class="fas fa-print"></i> Print ${escapeHtml(meta.title)}`;
  $('printOptionsDesc').textContent = meta.desc;
  renderReportSelectors();
  // Only show the filters that apply to this report.
  document.querySelectorAll('#modalPrintOptions [data-report-filter]').forEach((el) => {
    el.classList.toggle('hidden', !meta.filters.includes(el.dataset.reportFilter));
  });
  $('modalPrintOptions').classList.remove('hidden');
}
window.openPrintOptions = openPrintOptions;

function closePrintOptions() {
  $('modalPrintOptions').classList.add('hidden');
}
window.closePrintOptions = closePrintOptions;

$('printOptionsConfirmBtn').addEventListener('click', () => {
  closePrintOptions();
  printReport(activeReport);
});

/** Prints one of the four page-level reports using the filters chosen in the print options popup. */
function printReport(key = activeReport) {
  const report = buildReport(key);
  const f = getReportFilters();
  fillPrintLetterhead(report.title, `Academic Year ${f.schoolYear} \u00b7 ${reportSemesterLabel(f.semester)}`);
  $('printReportRoot').innerHTML = renderReportHtml(report);
  document.body.classList.add('printing-report');
  const restore = () => {
    document.body.classList.remove('printing-report');
    $('printReportRoot').innerHTML = '';
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}
window.printReport = printReport;

document.querySelectorAll('.timetable-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timetable-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ttMode = btn.dataset.ttMode;
    $('ttTargetGroup').classList.toggle('hidden', ttMode !== 'block');
    $('ttFacultyGroup').classList.toggle('hidden', ttMode !== 'faculty');
    renderTimetable();
  });
});

['ttSchoolYear', 'ttSemester', 'ttTarget', 'ttFaculty'].forEach((id) => {
  $(id).addEventListener('change', renderTimetable);
});

function setComponentFieldsEnabled(component, enabled) {
  const wrap = $('componentFields_' + component);
  wrap.classList.toggle('hidden', !enabled);
  wrap.querySelectorAll('select, input').forEach((el) => { el.disabled = !enabled; });
  if (enabled) {
    $('endTime_' + component).disabled = $('scheduleDuration_' + component).value !== 'custom';
  }
}

function componentSummaryText(schedule) {
  if (!schedule) return '';
  const fac = state.faculty.find((f) => Number(f.id) === Number(schedule.faculty_id));
  const room = schedule.room_name || '\u26a0 No room yet';
  return `${formatDayPattern(schedule.day_of_week)} ${formatTimeDisplay(schedule.start_time.slice(0, 5))}-${formatTimeDisplay(schedule.end_time.slice(0, 5))} \u00b7 ${room}` + (fac ? ` \u00b7 ${fac.faculty_name}` : ' \u00b7 \u26a0 Instructor not assigned');
}

function hasEditableComponent() {
  return COMPONENT_TYPES.some((c) => {
    const block = $('componentBlock_' + c);
    if (block.classList.contains('hidden')) return false;
    return !$('componentFields_' + c).classList.contains('hidden');
  });
}

function refreshSubmitButtonState() {
  const submitBtn = $('scheduleSubmitBtn');
  if (!hasEditableComponent()) {
    submitBtn.disabled = true;
    submitBtn.title = 'All required components are already scheduled. Click Edit on a component above to make changes.';
    return;
  }
  const hasConflict = COMPONENT_TYPES.some((c) => componentHasConflict[c]);
  submitBtn.disabled = hasConflict;
  submitBtn.title = hasConflict ? 'Resolve the conflict(s) shown above before saving.' : '';
}

function updateComponentBlocks() {
  const course = getSelectedCourse();
  const target = getSelectedTarget();
  const schoolYear = $('scheduleSchoolYear').value;

  let requiredCount = 0;
  let scheduledCount = 0;

  COMPONENT_TYPES.forEach((c) => {
    const block = $('componentBlock_' + c);
    const required = courseRequiresComponent(course, c);

    if (!required) {
      block.classList.add('hidden');
      setComponentFieldsEnabled(c, false);
      componentUnlocked[c] = false;
      return;
    }

    block.classList.remove('hidden');
    requiredCount++;

    const existing = findExistingComponentSchedule(course.id, target, schoolYear, c);
    const editable = !existing || componentUnlocked[c];
    const icon = $('componentStatusIcon_' + c);
    const summaryEl = $('componentSummary_' + c);
    const editBtn = $('componentEditBtn_' + c);

    if (existing) scheduledCount++;

    if (editable) {
      setComponentFieldsEnabled(c, true);
      summaryEl.textContent = '';
      editBtn.classList.add('hidden');
      if (existing) {
        icon.innerHTML = '<i class="fas fa-pen"></i> Editing';
        icon.className = 'component-status-icon editing';
      } else {
        icon.innerHTML = '<i class="fas fa-circle"></i> Not Scheduled';
        icon.className = 'component-status-icon pending';
      }
    } else {
      setComponentFieldsEnabled(c, false);
      summaryEl.textContent = componentSummaryText(existing);
      editBtn.classList.remove('hidden');
      icon.innerHTML = '<i class="fas fa-circle-check"></i> Scheduled';
      icon.className = 'component-status-icon done';
    }

    updateRoomOptions(c);
  });

  const statusEl = $('componentsStatus');
  if (!course || !target || !schoolYear) {
    statusEl.textContent = '\ud83d\udd12 Select a course, block, and academic year first to see the required components.';
  } else if (requiredCount === 0) {
    statusEl.textContent = '\u26a0 This course has no lecture or laboratory units to plot.';
  } else {
    statusEl.textContent = (scheduledCount === requiredCount ? '\u2713 ' : '') + `${scheduledCount} of ${requiredCount} component${requiredCount === 1 ? '' : 's'} scheduled.`;
  }

  refreshSubmitButtonState();
}

/**
 * Finds the OTHER component's schedule (Lecture <-> Laboratory) already
 * plotted for the same course+target, if any -- regardless of whether
 * Lecture or Laboratory was plotted first. Excludes the rows currently
 * unlocked for editing so a component doesn't "conflict with itself".
 * Mirrors the sibling lookup in api/schedules.php.
 */
function getSiblingScheduleForCourseTarget(courseId, target, schoolYear, ignoreIds = []) {
  if (!courseId || !target || !schoolYear) return null;
  return state.schedules.find((s) =>
    Number(s.course_id) === Number(courseId) &&
    (target.type === 'block' ? Number(s.block_id) === Number(target.id) : Number(s.spare_id) === Number(target.id)) &&
    s.school_year === schoolYear &&
    !ignoreIds.includes(Number(s.id))
  ) || null;
}

function toggleFacultyLockBadge(show) {
  const badge = $('facultyLockBadge');
  if (badge) badge.classList.toggle('hidden', !show);
  const select = $('scheduleFaculty');
  if (select) select.classList.toggle('faculty-locked', !!show);
}

function updateFacultyOptions() {
  const course = getSelectedCourse();
  const hint = $('facultyHint');
  const noInstructorLabel = 'Not assigned \u2014 assign later';

  // Instructor is OPTIONAL -- every branch below leaves the field blank-able
  // and never blocks saving. "Not assigned" is only a warning.
  if (!course) {
    $('scheduleFaculty').innerHTML = '<option value="">Select course first</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Select a course first.';
    if (hint) hint.textContent = '\ud83d\udd12 Select a course first.';
    toggleFacultyLockBadge(false);
    updateAssignAlsoPrompt();
    return;
  }

  const selectable = getSelectableFacultyForCourse(course.id);
  if (!selectable.length) {
    $('scheduleFaculty').innerHTML = `<option value="">${noInstructorLabel}</option>`;
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'There are no available instructors yet. Add faculty first.';
    if (hint) hint.textContent = '\u26a0 No instructors available yet. Add faculty in Faculty Management.';
    toggleFacultyLockBadge(false);
    updateAssignAlsoPrompt();
    return;
  }

  const target = getSelectedTarget();
  const schoolYear = $('scheduleSchoolYear').value;
  const sibling = getSiblingScheduleForCourseTarget(course.id, target, schoolYear, currentEditingScheduleIds());
  // A sibling with no instructor has nothing to inherit.
  const inheritedFacultyId = sibling && sibling.faculty_id ? Number(sibling.faculty_id) : null;
  const inheritedIsListed = inheritedFacultyId && selectable.some((f) => Number(f.id) === inheritedFacultyId);

  if (sibling && inheritedIsListed) {
    $('scheduleFaculty').innerHTML = facultyOptionsHtml(course, selectable, noInstructorLabel);
    $('scheduleFaculty').value = String(inheritedFacultyId);
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = `Instructor inherited from the existing ${course.course_code} schedule for this target \u2014 Lecture and Laboratory must share the same instructor.`;
    const targetLabel = target ? (target.type === 'block' ? blockLabel(state.blocks.find((b) => Number(b.id) === target.id) || {}) : spareLabel(state.spares.find((sp) => Number(sp.id) === target.id) || {})) : 'this target';
    if (hint) hint.innerHTML = `\ud83d\udd12 Instructor inherited from existing <strong>${escapeHtml(course.course_code)}</strong> schedule for <strong>${escapeHtml(targetLabel)}</strong> (${escapeHtml(sibling.component)}).`;
    toggleFacultyLockBadge(true);
    updateAssignAlsoPrompt();
    return;
  }

  const previousValue = $('scheduleFaculty').value;
  $('scheduleFaculty').innerHTML = facultyOptionsHtml(course, selectable, noInstructorLabel);
  $('scheduleFaculty').disabled = false;
  $('scheduleFaculty').title = '';
  if (previousValue && selectable.some((f) => String(f.id) === previousValue)) {
    $('scheduleFaculty').value = previousValue;
  }
  toggleFacultyLockBadge(false);
  const assignedCount = selectable.filter((f) => assignedFacultyIdsForCourse(course.id).has(Number(f.id))).length;
  if (hint) {
    hint.textContent = assignedCount
      ? `\u2713 marks the ${assignedCount} instructor${assignedCount === 1 ? '' : 's'} assigned to ${course.course_code}. You can also pick anyone else, or leave it blank and assign later.`
      : `No instructor is assigned to ${course.course_code} yet. Pick anyone, or leave it blank and assign later.`;
  }
  updateAssignAlsoPrompt();
}

/**
 * When the chosen instructor is NOT assigned to this course, offer an
 * optional tick-box to also add them to Faculty Course Assignments. Leaving
 * it unticked still saves the schedule with that instructor.
 */
function updateAssignAlsoPrompt() {
  const wrap = $('assignAlsoWrap');
  if (!wrap) return;
  const course = getSelectedCourse();
  const select = $('scheduleFaculty');
  const facultyId = Number(select.value) || 0;
  const show = !!course && facultyId > 0 && !select.disabled && !assignedFacultyIdsForCourse(course.id).has(facultyId);
  wrap.classList.toggle('hidden', !show);
  if (!show) { $('assignAlsoCheck').checked = false; return; }
  const fac = state.faculty.find((f) => Number(f.id) === facultyId);
  $('assignAlsoText').textContent = `Also assign ${fac ? fac.faculty_name : 'this instructor'} to ${course.course_code} (adds them to Faculty Course Assignments)`;
}

function updateRoomOptions(component) {
  const editingId = existingComponentId(component);
  const editingRoomId = editingId ? Number((state.schedules.find((s) => Number(s.id) === editingId) || {}).room_id) : null;
  let roomsList = state.rooms.filter((r) => Number(r.is_active) === 1 || Number(r.id) === editingRoomId);

  if (component === 'lecture') roomsList = roomsList.filter((r) => r.room_type === 'lecture');
  if (component === 'laboratory') roomsList = roomsList.filter((r) => r.room_type === 'laboratory');

  fillSelect('scheduleRoom_' + component, roomsList, (r) => `${r.room_name} - ${r.room_type}` + (Number(r.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'No room yet (assign later)');
}

const SET_TYPE_HINTS = {
  set_0: 'Always F2F, every meeting.',
  set_1: 'Starts F2F, alternates with Online. Default for 1st & 4th year Lecture. Can share room/time with SET 2 — instructor/block conflicts are still checked.',
  set_2: 'Starts Online, alternates with F2F. Default for 2nd & 3rd year Lecture. Can share room/time with SET 1 — instructor/block conflicts are still checked.',
};

const ROOM_HINTS = {
  set_0: 'Optional — leave blank to assign the room later (a warning shows until you do).',
  set_1: 'Optional — leave blank to assign the room later (a warning shows until you do).',
  set_2: 'Optional — leave blank to assign the room later (a warning shows until you do).',
};

function updateRoomRequirement(component) {
  const setType = $('setType_' + component).value;
  // Room is never required; the hint just explains that.
  $('roomRequiredMark_' + component).classList.add('hidden');
  $('roomRequiredHint_' + component).classList.remove('hidden');
  $('roomRequiredHint_' + component).textContent = ROOM_HINTS[setType] || '';
  $('scheduleRoom_' + component).required = false;
  $('setTypeHint_' + component).textContent = SET_TYPE_HINTS[setType] || '';
}

/* =====================================================
   LIVE CONFLICT PREVIEW (Plot Schedule form)
   Mirrors the backend's exact day-pattern overlap rule
   (schedule_days / schedules_share_day in api/schedules.php)
   so the preview and the final server validation agree.
   This is advisory only -- the backend remains the source
   of truth and re-validates everything on Save.
   ===================================================== */

const LEGACY_DAY_CODES = {
  MWF: ['Monday', 'Wednesday', 'Friday'],
  TTH: ['Tuesday', 'Thursday'],
  MW: ['Monday', 'Wednesday'],
  TF: ['Tuesday', 'Friday'],
};

const ALL_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function scheduleDaysFor(pattern) {
  if (LEGACY_DAY_CODES[pattern]) return LEGACY_DAY_CODES[pattern];
  return String(pattern).split(',').map((d) => d.trim()).filter(Boolean);
}

function formatDayPattern(pattern) {
  const days = scheduleDaysFor(pattern);
  const abbrev = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
  return days.map((d) => abbrev[d] || d).join('/');
}

function daysOverlap(patternA, patternB) {
  const a = scheduleDaysFor(patternA);
  const b = scheduleDaysFor(patternB);
  return a.some((d) => b.includes(d));
}

/** Mirrors sets_conflict() in api/schedules.php (room conflicts only): SET 0 never alternates so it conflicts with anything; the same alternating set conflicts; SET 1 + SET 2 don't. */
function setsConflict(setA, setB) {
  if (setA === 'set_0' || setB === 'set_0') return true;
  return setA === setB;
}

function timeStrToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0');
  const m = (mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatTimeLabel(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
}

/** "15:30" -> "3:30 PM" -- for showing a start/end time as plain text anywhere in the UI. Never use this for an <input type="time"> value or an API payload -- those must stay 24-hour "HH:MM". */
function formatTimeDisplay(hhmm) {
  return formatTimeLabel(timeStrToMinutes(hhmm));
}

function populateTimeSelect(selectId, { startHour = 6, endHour = 21, stepMinutes = 30 } = {}) {
  const select = $(selectId);
  const options = [];
  for (let mins = startHour * 60; mins <= endHour * 60; mins += stepMinutes) {
    const value = minutesToTimeStr(mins);
    options.push(`<option value="${value}">${formatTimeLabel(mins)}</option>`);
  }
  select.innerHTML = options.join('');
}

function timesOverlap(start1, end1, start2, end2) {
  return !(timeStrToMinutes(end1) <= timeStrToMinutes(start2) || timeStrToMinutes(start1) >= timeStrToMinutes(end2));
}

function getDurationMinutes(component) {
  const val = $('scheduleDuration_' + component).value;
  if (val === 'custom') {
    const s = $('startTime_' + component).value;
    const e = $('endTime_' + component).value;
    if (!s || !e) return null;
    const diff = timeStrToMinutes(e) - timeStrToMinutes(s);
    return diff > 0 ? diff : null;
  }
  return Number(val);
}

function updateEndTimeFromDuration(component) {
  const durationVal = $('scheduleDuration_' + component).value;
  const endTimeSelect = $('endTime_' + component);
  const autoTag = $('endTimeAutoTag_' + component);
  $('customDurationHint_' + component).classList.toggle('hidden', durationVal !== 'custom');

  if (durationVal === 'custom') {
    endTimeSelect.disabled = false;
    autoTag.classList.add('hidden');
    return;
  }

  endTimeSelect.disabled = true;
  autoTag.classList.remove('hidden');
  const start = $('startTime_' + component).value;
  if (!start) return;
  const maxMin = 23 * 60 + 30;
  const targetMin = Math.min(timeStrToMinutes(start) + Number(durationVal), maxMin);
  const targetStr = minutesToTimeStr(targetMin);

  const hasOption = [...endTimeSelect.options].some((o) => o.value === targetStr);
  if (!hasOption) {
    const opt = document.createElement('option');
    opt.value = targetStr;
    opt.textContent = formatTimeLabel(targetMin);
    endTimeSelect.appendChild(opt);
  }
  endTimeSelect.value = targetStr;
}

/** True if both targets refer to the same Block, or both refer to the same SPARE group. Mirrors same_target() in api/schedules.php. */
function sameTarget(a, b) {
  if (a.blockId && b.blockId) return Number(a.blockId) === Number(b.blockId);
  if (a.spareId && b.spareId) return Number(a.spareId) === Number(b.spareId);
  return false;
}

function findScheduleConflicts(dayPattern, start, end, { blockId, spareId, facultyId, roomId, ignoreId, setType, schoolYear, semesterType }) {
  if (!dayPattern || !start || !end) return [];
  const newTarget = { blockId, spareId };
  const conflicts = [];
  for (const s of state.schedules) {
    if (ignoreId && Number(s.id) === Number(ignoreId)) continue;
    if (schoolYear && s.school_year !== schoolYear) continue;
    if (semesterType && s.semester_type !== semesterType) continue;
    if (!daysOverlap(dayPattern, s.day_of_week)) continue;
    if (!timesOverlap(start, end, s.start_time.slice(0, 5), s.end_time.slice(0, 5))) continue;

    const timeLabel = `${formatDayPattern(s.day_of_week)} ${formatTimeDisplay(s.start_time.slice(0, 5))}-${formatTimeDisplay(s.end_time.slice(0, 5))}`;
    if (facultyId && Number(s.faculty_id) === Number(facultyId)) {
      conflicts.push({ type: 'Instructor', name: s.faculty_name, timeLabel });
    }
    if ((blockId || spareId) && sameTarget(newTarget, { blockId: s.block_id, spareId: s.spare_id })) {
      conflicts.push({ type: 'Block', name: scheduleTargetLabel(s), timeLabel });
    }
    if (roomId && Number(s.room_id) === Number(roomId)) {
      if (setsConflict(setType, s.set_type)) {
        conflicts.push({ type: 'Room', name: s.room_name, timeLabel });
      }
    }
  }
  return conflicts;
}

function suggestAlternativeTimes(dayPattern, durationMin, ctx, maxSuggestions = 2, requestedStart = null) {
  if (!dayPattern || !durationMin) return [];

  const requestedMins = requestedStart ? timeStrToMinutes(requestedStart) : 7 * 60;
  const candidates = [];
  for (let mins = 7 * 60; mins + durationMin <= 19 * 60; mins += 30) {
    const startStr = minutesToTimeStr(mins);
    const endStr = minutesToTimeStr(mins + durationMin);
    const conflicts = findScheduleConflicts(dayPattern, startStr, endStr, ctx);
    if (!conflicts.length) {
      candidates.push({ start: startStr, end: endStr, mins, distance: Math.abs(mins - requestedMins) });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance || a.mins - b.mins);
  const picked = candidates.slice(0, maxSuggestions);
  picked.sort((a, b) => a.mins - b.mins);
  return picked.map(({ start, end }) => ({ start, end }));
}

function renderConflictPreview(component, conflicts, suggestions) {
  const el = $('conflictPreview_' + component);

  if (conflicts === null) {
    el.innerHTML = '';
    componentHasConflict[component] = false;
    refreshSubmitButtonState();
    return;
  }

  if (!conflicts.length) {
    el.innerHTML = '<div class="preview-status available"><i class="fas fa-circle-check"></i> Available - no conflicts detected</div>';
    componentHasConflict[component] = false;
    refreshSubmitButtonState();
    return;
  }

  componentHasConflict[component] = true;
  const listHtml = conflicts.map((c) => `<div class="preview-conflict-item"><i class="fas fa-circle-exclamation"></i> <strong>${escapeHtml(c.type)} conflict:</strong>&nbsp;${escapeHtml(c.name)} (${escapeHtml(c.timeLabel)})</div>`).join('');
  const suggestionsHtml = suggestions.length
    ? `<div class="preview-suggestions"><span class="suggestion-label">Suggested:</span> ${suggestions.map((s) => `<button type="button" class="suggestion-chip" onclick="applySuggestedTime('${component}','${s.start}','${s.end}')"><i class="fas fa-check"></i> ${s.start}-${s.end}</button>`).join(' ')}</div>`
    : '';

  el.innerHTML = `<div class="preview-status conflict"><i class="fas fa-circle-exclamation"></i> Conflict Detected</div><div class="preview-conflict-list">${listHtml}</div>${suggestionsHtml}`;
  refreshSubmitButtonState();
}

function getEffectiveDayPattern(component) {
  const preset = $('dayOfWeek_' + component).value;
  if (preset !== 'Custom') return preset;
  const checked = [...document.querySelectorAll('#customDaysRow_' + component + ' input[type="checkbox"]:checked')].map((cb) => cb.value);
  return checked.join(',');
}

/* =====================================================
   WEEKLY TOTAL (Plot Schedule form) -- informational only

   Duration is chosen by the plotter (Duration per day), never derived from
   the course's units. This summary just shows what the current pattern adds
   up to so the plotter can sanity-check it. It never blocks Save. Conflict
   checks (instructor, block, room) are the only things that do.
   ===================================================== */

function dayPatternOccurrences(pattern) {
  if (!pattern) return null;
  const days = scheduleDaysFor(pattern);
  return days.length || null;
}

function formatHours(totalMinutes) {
  const hrs = Math.round((totalMinutes / 60) * 100) / 100;
  return `${hrs} hour${hrs === 1 ? '' : 's'}`;
}

function renderWeeklyHoursSummary(component) {
  const el = $('weeklyHoursSummary_' + component);
  if (!el) return;

  const occurrences = dayPatternOccurrences(getEffectiveDayPattern(component));
  const perDay = getDurationMinutes(component);

  if (!occurrences || !perDay) {
    el.innerHTML = '';
    el.className = 'weekly-hours-summary';
    return;
  }

  el.className = 'weekly-hours-summary info';
  el.innerHTML = `
    <div class="weekly-hours-rows">
      <div class="weekly-hours-row"><span>Per meeting day:</span> <strong>${formatHours(perDay)}</strong></div>
      <div class="weekly-hours-row"><span>Meeting days:</span> <strong>${occurrences}</strong></div>
      <div class="weekly-hours-row"><span>Total per week:</span> <strong>${formatHours(perDay * occurrences)}</strong></div>
    </div>`;
}

/** Re-renders the weekly total, Save button state and live conflict check after any Day Pattern / Start / Duration change. */
function refreshWeeklyHoursUI(component) {
  renderWeeklyHoursSummary(component);
  refreshSubmitButtonState();
  checkLiveConflict(component);
}

function checkLiveConflict(component) {
  const dayPattern = getEffectiveDayPattern(component);
  const start = $('startTime_' + component).value;
  const end = $('endTime_' + component).value;
  const course = getSelectedCourse();
  const target = getSelectedTarget();
  const ctx = {
    blockId: target && target.type === 'block' ? target.id : null,
    spareId: target && target.type === 'spare' ? target.id : null,
    facultyId: $('scheduleFaculty').value,
    roomId: $('scheduleRoom_' + component).value,
    ignoreId: existingComponentId(component),
    setType: $('setType_' + component).value,
    schoolYear: $('scheduleSchoolYear').value,
    semesterType: (course || {}).semester_type,
  };

  if (!dayPattern || !start || !end) {
    renderConflictPreview(component, null);
    return;
  }

  const conflicts = findScheduleConflicts(dayPattern, start, end, ctx);
  const suggestions = conflicts.length ? suggestAlternativeTimes(dayPattern, getDurationMinutes(component), ctx, 2, start) : [];
  renderConflictPreview(component, conflicts, suggestions);
}

function applySuggestedTime(component, start, end) {
  $('startTime_' + component).value = start;
  if ($('scheduleDuration_' + component).value === 'custom') {
    $('endTime_' + component).value = end;
  } else {
    updateEndTimeFromDuration(component);
  }
  renderWeeklyHoursSummary(component);
  refreshSubmitButtonState();
  checkLiveConflict(component);
}
window.applySuggestedTime = applySuggestedTime;

function filteredSchedules() {
  return state.schedules.filter((s) => {
    if (scheduleFilters.schoolYear && s.school_year !== scheduleFilters.schoolYear) return false;
    if (scheduleFilters.year && String(s.year_level) !== scheduleFilters.year) return false;
    if (scheduleFilters.semester && s.semester_type !== scheduleFilters.semester) return false;
    if (scheduleFilters.target && targetValueForSchedule(s) !== scheduleFilters.target) return false;
    if (scheduleFilters.faculty === NO_INSTRUCTOR_FILTER) { if (s.faculty_id) return false; }
    else if (scheduleFilters.faculty && String(s.faculty_id) !== scheduleFilters.faculty) return false;
    return true;
  });
}

/** Which instructors' course lists are currently expanded in the Faculty Course Assignments table. */
const expandedAssignmentFaculty = new Set();

/** Faculty Course Assignment rows grouped so each instructor appears once, with their courses inside. */
function groupedAssignments() {
  const groups = new Map();
  state.assignments.forEach((a) => {
    const fid = Number(a.faculty_id);
    if (!groups.has(fid)) groups.set(fid, { id: fid, faculty_id: fid, faculty_name: a.faculty_name, courses: [] });
    groups.get(fid).courses.push({ assignment_id: a.id, course_id: a.course_id, course_code: a.course_code, course_title: a.course_title });
  });
  const list = [...groups.values()];
  list.forEach((g) => g.courses.sort((x, y) => String(x.course_code).localeCompare(String(y.course_code))));
  return list.sort((x, y) => String(x.faculty_name).localeCompare(String(y.faculty_name)));
}

function toggleAssignmentGroup(facultyId) {
  const id = Number(facultyId);
  if (expandedAssignmentFaculty.has(id)) expandedAssignmentFaculty.delete(id); else expandedAssignmentFaculty.add(id);
  renderTables();
}
window.toggleAssignmentGroup = toggleAssignmentGroup;

/** "+" on an instructor's row: open the Assign modal with that instructor already chosen. */
function assignMoreToFaculty(facultyId) {
  openEntityModal('assignments');
  $('assignFaculty').value = String(facultyId);
  assignPicker.renderAll();
}
window.assignMoreToFaculty = assignMoreToFaculty;

function renderTables() {
  const coursesForTable = coursesYearFilter ? state.courses.filter((c) => String(c.year_level) === coursesYearFilter) : state.courses;
  renderDataTable('coursesTable', [
    { key: 'course_code', label: 'Code' },
    { key: 'course_title', label: 'Title' },
    { key: 'year_level', label: 'Year' },
    { key: 'semester_type', label: 'Semester' },
    { key: 'lec_units', label: 'Lec' },
    { key: 'lab_units', label: 'Lab' },
    { key: 'category', label: 'Category' },
    { key: 'max_students', label: 'Capacity', render: (c) => c.max_students ? escapeHtml(String(c.max_students)) : '\u2013' },
  ], coursesForTable, {
    emptyIcon: 'fa-book',
    emptyMessage: coursesYearFilter ? 'No courses for this year level yet.' : 'No courses yet.',
    rowActions: (c) => `<button class="btn btn-secondary btn-sm" onclick="editCourse(${c.id})" title="Edit" aria-label="Edit course"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('courses',${c.id})" title="Delete" aria-label="Delete course"><i class="fas fa-trash"></i></button>`,
  });

  renderBlocksTable();

  renderDataTable('facultyTable', [
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'max_preparations', label: 'Max Preparations' },
    { key: 'is_active', label: 'Status', sortValue: (f) => Number(f.is_active), render: (f) => Number(f.is_active) === 1 ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Unavailable</span>' },
    { key: 'assigned_courses', label: 'Assigned Courses',
      searchValue: (f) => coursesAssignedToFaculty(f.id).map((a) => `${a.course_code} ${a.course_title}`).join(' '),
      render: (f) => {
        const courses = coursesAssignedToFaculty(f.id);
        if (!courses.length) return '<span class="faculty-no-courses">No courses assigned yet</span>';
        const rows = courses.map((a) => {
          const schedules = state.schedules.filter((s) => Number(s.course_id) === Number(a.course_id) && Number(s.faculty_id) === Number(f.id));
          if (!schedules.length) {
            return `<div class="faculty-course-row">
              <span class="faculty-course-code" title="${escapeHtml(a.course_title)}">${escapeHtml(a.course_code)}</span>
              <span class="faculty-course-unscheduled">Not yet scheduled</span>
            </div>`;
          }
          return schedules.map((s) => `<div class="faculty-course-row">
            <span class="faculty-course-code" title="${escapeHtml(s.course_title)}">${escapeHtml(s.course_code)} (${s.component === 'laboratory' ? 'LAB' : 'LEC'})</span>
            <span class="faculty-course-detail">${escapeHtml(formatDayPattern(s.day_of_week))} ${formatTimeDisplay(s.start_time.slice(0, 5))}-${formatTimeDisplay(s.end_time.slice(0, 5))} &middot; ${escapeHtml(s.room_name || 'No room')} &middot; ${escapeHtml(scheduleTargetLabel(s))}</span>
          </div>`).join('');
        }).join('');
        return `<div class="faculty-course-list">${rows}</div>`;
      } },
  ], state.faculty, {
    emptyIcon: 'fa-chalkboard-user',
    emptyMessage: 'No faculty yet.',
    rowActions: (f) => `<button class="btn btn-secondary btn-sm" onclick="editFaculty(${f.id})" title="Edit" aria-label="Edit faculty"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('faculty',${f.id})" title="Delete" aria-label="Delete faculty"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('roomsTable', [
    { key: 'room_name', label: 'Room' },
    { key: 'room_type', label: 'Type' },
    { key: 'is_active', label: 'Status', sortValue: (r) => Number(r.is_active), render: (r) => Number(r.is_active) === 1 ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Unavailable</span>' },
  ], state.rooms, {
    emptyIcon: 'fa-door-open',
    emptyMessage: 'No rooms yet.',
    rowActions: (r) => `<button class="btn btn-secondary btn-sm" onclick="editRoom(${r.id})" title="Edit" aria-label="Edit room"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('rooms',${r.id})" title="Delete" aria-label="Delete room"><i class="fas fa-trash"></i></button>`,
  });

  // One row per instructor (the name appears once); their courses are
  // tucked behind a View button so the table stays short.
  renderDataTable('assignmentsTable', [
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'course_count', label: 'Courses',
      searchValue: (g) => g.courses.map((c) => `${c.course_code} ${c.course_title}`).join(' '),
      sortValue: (g) => g.courses.length,
      render: (g) => {
        const open = expandedAssignmentFaculty.has(Number(g.faculty_id));
        const list = open ? `<div class="assign-group-list">${g.courses.map((c) => `
          <div class="assign-group-row">
            <span class="assign-group-code">${escapeHtml(c.course_code)}</span>
            <span class="assign-group-title">${escapeHtml(c.course_title)}</span>
            <span class="assign-group-actions">
              <button class="btn btn-secondary btn-sm" onclick="editAssignment(${c.assignment_id})" title="Edit" aria-label="Edit ${escapeHtml(c.course_code)}"><i class="fas fa-pen"></i></button>
              <button class="btn btn-danger btn-sm" onclick="del('assignments',${c.assignment_id})" title="Remove" aria-label="Remove ${escapeHtml(c.course_code)}"><i class="fas fa-trash"></i></button>
            </span>
          </div>`).join('')}</div>` : '';
        return `<button type="button" class="btn btn-secondary btn-sm assign-view-btn" onclick="toggleAssignmentGroup(${g.faculty_id})" aria-expanded="${open}">
          <i class="fas fa-chevron-${open ? 'down' : 'right'}"></i> ${open ? 'Hide' : 'View'} ${g.courses.length} course${g.courses.length === 1 ? '' : 's'}</button>${list}`;
      } },
  ], groupedAssignments(), {
    emptyIcon: 'fa-user-tie',
    emptyMessage: 'No faculty-course assignments yet.',
    rowActions: (g) => `<button class="btn btn-secondary btn-sm" onclick="assignMoreToFaculty(${g.faculty_id})" title="Assign more courses" aria-label="Assign more courses to ${escapeHtml(g.faculty_name)}"><i class="fas fa-plus"></i></button>`,
  });

  renderSchedulesTable();
}

const SCHEDULES_TABLE_COLUMNS = [
  { key: 'school_year', label: 'AY' },
  { key: 'day_of_week', label: 'Day Pattern', render: (s) => escapeHtml(formatDayPattern(s.day_of_week)) },
  { key: 'start_time', label: 'Time', render: (s) => `${formatTimeDisplay(s.start_time.slice(0, 5))}-${formatTimeDisplay(s.end_time.slice(0, 5))}` },
  { key: 'course_code', label: 'Course', searchValue: (s) => `${s.course_code} ${s.course_title}`, render: (s) => `${escapeHtml(s.course_code)}<br><small>${escapeHtml(s.course_title)}</small>` },
  { key: 'component', label: 'Component', render: (s) => `<span class="badge ${s.component === 'laboratory' ? 'lab' : 'lec'}">${escapeHtml(s.component)}</span>` },
  { key: 'block_name', label: 'Block', searchValue: (s) => scheduleTargetLabel(s), render: (s) => escapeHtml(s.is_spare || s.spare_id ? `${s.program_code} ${s.year_level} - SPARE` : `${s.program_code} ${s.year_level} - ${s.block_name}`) },
  { key: 'faculty_name', label: 'Faculty', render: (s) => instructorCellHtml(s) },
  { key: 'set_type', label: 'Set' },
  { key: 'modality', label: 'Modality', searchValue: (s) => scheduleModality(s).label, render: (s) => {
      const m = scheduleModality(s);
      const setTag = setRotationTagHtml(s.set_type);
      return m.label === 'F2F'
        ? `<span class="tt-modality tt-modality-f2f">F2F</span>${setTag} &bull; ${s.room_id ? escapeHtml(m.room) : ROOM_MISSING_HTML}`
        : `<span class="tt-modality tt-modality-online">ONLINE</span>${setTag}`;
    } },
];

function renderSchedulesTable(allRows = false) {
  renderDataTable('schedulesTable', SCHEDULES_TABLE_COLUMNS, filteredSchedules(), {
    emptyIcon: 'fa-calendar-xmark',
    emptyMessage: 'No schedules yet.',
    allRows,
    rowActions: (s) => `<button class="btn btn-secondary btn-sm" onclick="editSchedule(${s.id})" title="Edit" aria-label="Edit schedule"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('schedules',${s.id})" title="Delete" aria-label="Delete schedule"><i class="fas fa-trash"></i></button>`,
  });
}

const CASCADE_FIELD = { faculty: 'faculty_id', courses: 'course_id', blocks: 'block_id' };

function del_impactMessage(entity, id) {
  const field = CASCADE_FIELD[entity];
  if (field) {
    const count = state.schedules.filter((s) => Number(s[field]) === Number(id)).length;
    if (count > 0) {
      return `This will also permanently delete <strong>${count}</strong> linked schedule${count === 1 ? '' : 's'}. This cannot be undone.`;
    }
    return '';
  }
  if (entity === 'rooms') {
    const count = state.schedules.filter((s) => Number(s.room_id) === Number(id)).length;
    if (count > 0) {
      return `This room is currently assigned to <strong>${count}</strong> schedule${count === 1 ? '' : 's'} — they will be unassigned (set to "No room") rather than deleted, so re-check them afterward.`;
    }
  }
  return '';
}

async function del(entity, id) {
  const cfg = deleteConfig[entity];
  const record = state[cfg.stateKey].find((x) => Number(x.id) === Number(id));
  const label = record ? cfg.labelFn(record) : 'this record';
  const impact = del_impactMessage(entity, id);
  const message = `Are you sure you want to delete <strong>${escapeHtml(label)}</strong>?` + (impact ? ` ${impact}` : ' This action cannot be undone.');
  const ok = await showConfirm(message);
  if (!ok) return;
  try {
    await request(`${cfg.endpoint}?id=${id}`, { method: 'DELETE' });
    showToast('Deleted successfully', 'success');
    loadAll();
  } catch (e) { showToast(e.message, 'error'); }
}
window.del = del;

function suggestedSchoolYear() {
  const now = new Date();
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 6 ? y : y - 1;
  return `${startYear}-${startYear + 1}`;
}

function startEdit(entity, id) {
  editing[entity] = id;
  const cfg = formConfig[entity];
  $(cfg.submitBtnId).innerHTML = cfg.editLabel;
  if (cfg.cancelBtnId) $(cfg.cancelBtnId).classList.remove('hidden');
  if (cfg.modalId) {
    if (cfg.modalTitleId) $(cfg.modalTitleId).textContent = cfg.editTitle;
    $(cfg.modalId).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  } else {
    const formEl = $(cfg.formId);
    if (typeof formEl.scrollIntoView === 'function') formEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/**
 * Resets a form back to "create new" mode. For the Plot Schedule form, pass
 * `{ keepPlottingContext: true }` after a SUCCESSFUL plot: this clears the
 * per-course fields (Target, Course, Faculty, Components) the same as an
 * intentional cancel would, but keeps School Year, Year Level, and Semester
 * as the user left them, so they land right back on the Course Offering
 * list for that same context and can plot the next course immediately
 * instead of re-picking Year Level and Semester from scratch. An explicit
 * Cancel/Close always resets everything, since that IS the user asking to
 * leave the current plotting context.
 */
function cancelEdit(entity, { keepPlottingContext = false } = {}) {
  editing[entity] = null;
  const cfg = formConfig[entity];
  $(cfg.submitBtnId).innerHTML = cfg.addLabel;
  $(cfg.submitBtnId).disabled = false;
  if (cfg.cancelBtnId) $(cfg.cancelBtnId).classList.add('hidden');
  const keptSchoolYear = (entity === 'schedules' && keepPlottingContext) ? $('scheduleSchoolYear').value : null;
  const keptYearLevel = (entity === 'schedules' && keepPlottingContext) ? $('scheduleYearLevel').value : null;
  const keptSemester = (entity === 'schedules' && keepPlottingContext) ? $('scheduleSemester').value : null;
  $(cfg.formId).reset();
  if (entity === 'courses') $('courseMaxStudents').dataset.manual = '';
  clearFormDirty(cfg.formId);
  clearValidationState(cfg.formId);
  if (cfg.modalTitleId) $(cfg.modalTitleId).textContent = cfg.addTitle;
  if (entity === 'schedules') {
    $('scheduleSchoolYear').value = keptSchoolYear || suggestedSchoolYear();
    if (keptYearLevel) $('scheduleYearLevel').value = keptYearLevel;
    if (keptSemester) $('scheduleSemester').value = keptSemester;
    scheduleCourseCombobox.syncDisplay();
    scheduleCourseCombobox.updateAvailability();
    COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); });
    renderTargetOptions();
    updateComponentBlocks();
    updateFacultyOptions();
    renderOfferingOverview();
  }
  if (entity === 'assignments') {
    assignPicker.reset();
  }
}
window.cancelEdit = cancelEdit;

function editCourse(id) {
  const c = state.courses.find((x) => Number(x.id) === id);
  if (!c) return;
  $('courseCode').value = c.course_code;
  $('courseTitle').value = c.course_title;
  $('courseYear').value = c.year_level;
  $('courseSemester').value = c.semester_type;
  $('lecUnits').value = c.lec_units;
  $('labUnits').value = c.lab_units;
  $('category').value = c.category;
  // Show the saved capacity. A value that differs from the default is a custom
  // one and stays put; a default (or empty) capacity keeps following Lab Units.
  const capInput = $('courseMaxStudents');
  const storedCap = Number(c.max_students);
  if (storedCap > 0 && storedCap !== defaultCourseCapacity()) {
    capInput.value = String(storedCap);
    capInput.dataset.manual = '1';
  } else {
    capInput.dataset.manual = '';
    syncCourseCapacityFromLabUnits();
  }
  startEdit('courses', id);
}
window.editCourse = editCourse;

function editFaculty(id) {
  const f = state.faculty.find((x) => Number(x.id) === id);
  if (!f) return;
  $('facultyName').value = f.faculty_name;
  $('maxPreparations').value = f.max_preparations;
  $('facultyActive').checked = Number(f.is_active) !== 0;
  startEdit('faculty', id);
}
window.editFaculty = editFaculty;

function editRoom(id) {
  const r = state.rooms.find((x) => Number(x.id) === id);
  if (!r) return;
  $('roomName').value = r.room_name;
  $('roomType').value = r.room_type;
  $('roomActive').checked = Number(r.is_active) !== 0;
  startEdit('rooms', id);
}
window.editRoom = editRoom;

function editAssignment(id) {
  const a = state.assignments.find((x) => Number(x.id) === id);
  if (!a) return;
  $('assignFaculty').value = a.faculty_id;
  assignPicker.beginEdit(a);
  startEdit('assignments', id);
}
window.editAssignment = editAssignment;

function ensureTimeOption(selectId, value, label) {
  const select = $(selectId);
  if (![...select.options].some((o) => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label || formatTimeLabel(timeStrToMinutes(value));
    select.appendChild(opt);
  }
}

const DAY_PRESET_VALUES = ['MWF', 'TTH', 'MW', 'TF', 'Saturday'];

function setDayPatternUI(component, dayOfWeek) {
  const daySelect = $('dayOfWeek_' + component);
  const customRow = $('customDaysRow_' + component);
  if (DAY_PRESET_VALUES.includes(dayOfWeek)) {
    daySelect.value = dayOfWeek;
    customRow.classList.add('hidden');
    customRow.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
    return;
  }
  daySelect.value = 'Custom';
  customRow.classList.remove('hidden');
  const days = scheduleDaysFor(dayOfWeek);
  customRow.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = days.includes(cb.value);
  });
}

function resetComponentFields(component) {
  updateSetTypeOptions(component);
  setDayPatternUI(component, 'MWF');
  $('scheduleDuration_' + component).value = '60';
  $('notes_' + component).value = '';
  $('startTime_' + component).value = '';
  updateEndTimeFromDuration(component);
  updateRoomRequirement(component);
  $('conflictPreview_' + component).innerHTML = '';
  componentHasConflict[component] = false;
  $('weeklyHoursSummary_' + component).innerHTML = '';
  $('weeklyHoursSummary_' + component).className = 'weekly-hours-summary';
}

function prefillComponentFields(component, schedule) {
  // Reset the options first, THEN apply the saved SET so the SET the scheduler already chose is kept.
  updateSetTypeOptions(component);
  $('setType_' + component).value = schedule.set_type;
  setDayPatternUI(component, schedule.day_of_week);
  $('scheduleDuration_' + component).value = 'custom';
  updateEndTimeFromDuration(component);
  const startVal = schedule.start_time.slice(0, 5);
  const endVal = schedule.end_time.slice(0, 5);
  ensureTimeOption('startTime_' + component, startVal);
  ensureTimeOption('endTime_' + component, endVal);
  $('startTime_' + component).value = startVal;
  $('endTime_' + component).value = endVal;
  $('notes_' + component).value = schedule.notes || '';
}

function unlockComponentBlock(component) {
  componentUnlocked[component] = true;
  const course = getSelectedCourse();
  const target = getSelectedTarget();
  const schoolYear = $('scheduleSchoolYear').value;
  const existing = course ? findExistingComponentSchedule(course.id, target, schoolYear, component) : null;

  updateComponentBlocks();
  updateFacultyOptions();

  if (existing) {
    prefillComponentFields(component, existing);
    if (!$('scheduleFaculty').disabled) {
      const stillQualified = [...$('scheduleFaculty').options].some((o) => o.value === String(existing.faculty_id));
      if (stillQualified) $('scheduleFaculty').value = String(existing.faculty_id);
      updateAssignAlsoPrompt();
    }
    updateRoomOptions(component);
    $('scheduleRoom_' + component).value = existing.room_id || '';
    updateRoomRequirement(component);
    refreshWeeklyHoursUI(component);
  }
  markFormDirty('scheduleForm');
  startEdit('schedules', editing.schedules || (existing ? existing.id : true));
}
window.unlockComponentBlock = unlockComponentBlock;

/**
 * Loads a whole subject offering (Course + Block/SPARE + Academic Year) into
 * the Plot Schedule form for editing, unlocking the one component the
 * scheduler clicked Edit on from the Schedules table. Any sibling
 * component keeps showing as its locked, read-only summary unless it's
 * separately unlocked.
 */
function editSchedule(id) {
  const s = state.schedules.find((x) => Number(x.id) === id);
  if (!s) return;
  editing.schedules = id;
  $('scheduleSchoolYear').value = s.school_year;
  const course = state.courses.find((c) => Number(c.id) === Number(s.course_id));
  $('scheduleYearLevel').value = course ? course.year_level : '';
  renderTargetOptions();
  $('scheduleTarget').value = targetValueForSchedule(s);
  scheduleCourseCombobox.updateAvailability();
  $('scheduleCourse').value = s.course_id;
  scheduleCourseCombobox.syncDisplay();
  COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); updateSetTypeOptions(c); });
  updateComponentBlocks();
  updateFacultyOptions();
  unlockComponentBlock(s.component);
  activateView('plotting');
  startEdit('schedules', id);
  renderOfferingOverview();
}
window.editSchedule = editSchedule;

/* =====================================================
   HASH-BASED VIEW ROUTING
   The active view (dashboard, schedules, blocks, ...) and, for Schedules,
   the current filters, are mirrored into the URL hash
   (#schedules?sy=2026-2027&target=block:3) so a page refresh returns the
   user to where they were instead of resetting to the Dashboard, and
   Back/Forward moves between views as expected.
   ===================================================== */

function currentFiltersQueryString() {
  const params = new URLSearchParams();
  if (scheduleFilters.schoolYear) params.set('sy', scheduleFilters.schoolYear);
  if (scheduleFilters.year) params.set('year', scheduleFilters.year);
  if (scheduleFilters.semester) params.set('sem', scheduleFilters.semester);
  if (scheduleFilters.target) params.set('target', scheduleFilters.target);
  if (scheduleFilters.faculty) params.set('faculty', scheduleFilters.faculty);
  return params.toString();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const [view, qs] = raw.split('?');
  return { view: view || 'dashboard', params: new URLSearchParams(qs || '') };
}

function restoreScheduleFiltersFromParams(params) {
  scheduleFilters.schoolYear = params.get('sy') || '';
  scheduleFilters.year = params.get('year') || '';
  scheduleFilters.semester = params.get('sem') || '';
  scheduleFilters.target = params.get('target') || '';
  scheduleFilters.faculty = params.get('faculty') || '';
  $('filterSchoolYear').value = scheduleFilters.schoolYear;
  $('filterYear').value = scheduleFilters.year;
  $('filterSemester').value = scheduleFilters.semester;
  renderFilterOptions();
  $('filterTarget').value = scheduleFilters.target;
  $('filterFaculty').value = scheduleFilters.faculty;
}

function activateView(view) {
  document.querySelectorAll('.nav-item,.view').forEach((el) => el.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');
  const viewEl = $(view);
  if (viewEl) viewEl.classList.add('active');
}

// Applies whatever the URL hash says right now. Used on initial load
// (refresh) and whenever the hash changes from Back/Forward navigation.
function applyRouteFromHash() {
  const { view, params } = parseHash();
  const validViews = Array.from(document.querySelectorAll('.view')).map((v) => v.id);
  const target = validViews.includes(view) ? view : 'dashboard';
  if (target === 'schedules') restoreScheduleFiltersFromParams(params);
  activateView(target);
  if (target === 'schedules') { getTableState('schedulesTable').page = 1; renderTables(); }
}
window.addEventListener('hashchange', applyRouteFromHash);

// Keeps the hash's query string in sync whenever the Schedules filters
// change, without spamming browser history (replaceState, not pushState).
function syncScheduleFiltersToHash() {
  if (!$('schedules').classList.contains('active')) return;
  const qs = currentFiltersQueryString();
  const newHash = '#schedules' + (qs ? '?' + qs : '');
  if (location.hash !== newHash) history.replaceState(null, '', newHash);
}

// Switches views, guarding against losing an in-progress Plot Schedule
// form, and records the new view (plus filters, for Schedules) in the hash.
async function goToView(view) {
  const leavingPlotting = $('plotting').classList.contains('active') && view !== 'plotting';
  if (leavingPlotting) {
    const proceed = await confirmLeaveIfDirty('scheduleForm');
    if (!proceed) return;
  }
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('show');
  const qs = view === 'schedules' ? currentFiltersQueryString() : '';
  const newHash = '#' + view + (qs ? '?' + qs : '');
  if (location.hash === newHash) {
    activateView(view);
  } else {
    location.hash = newHash; // triggers hashchange -> applyRouteFromHash
  }
}
window.goToView = goToView;

document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => goToView(btn.dataset.view)));
document.querySelectorAll('[data-quick-nav]').forEach((btn) => btn.addEventListener('click', () => goToView(btn.dataset.quickNav)));
// Dashboard quick actions that open an Add form (Add a Course / Add Faculty / Assign Faculty to Course).
document.querySelectorAll('[data-quick-open-modal]').forEach((btn) => btn.addEventListener('click', () => {
  const entity = Object.keys(formConfig).find((k) => formConfig[k].modalId === btn.dataset.quickOpenModal);
  if (entity) openEntityModal(entity);
}));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('confirmOverlay').classList.contains('hidden')) { closeConfirm(false); return; }
  if (!$('modalPrintOptions').classList.contains('hidden')) { closePrintOptions(); return; }
  if (!$('modalAssignConfirm').classList.contains('hidden')) { closeAssignConfirm(); return; }
  if (!$('modalInstructorConflict').classList.contains('hidden')) { closeInstructorConflictModal(); return; }
  Object.keys(formConfig).forEach((entity) => {
    const cfg = formConfig[entity];
    if (cfg.modalId && !$(cfg.modalId).classList.contains('hidden')) requestCloseEntityModal(entity);
  });
});

/* Mobile sidebar toggle */
$('sidebarToggleBtn').addEventListener('click', () => {
  $('sidebar').classList.toggle('open');
  $('sidebarOverlay').classList.toggle('show');
});
$('sidebarOverlay').addEventListener('click', () => {
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('show');
});

/* =====================================================
   REAL-TIME FIELD VALIDATION
   Same pattern everywhere: green/red border + icon while
   typing, an inline message under the field, a shake on a
   failed submit attempt, and an error summary box listing
   everything wrong at the top of the form.
   ===================================================== */

const ICON_VALID = '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const ICON_INVALID = '<svg viewBox="0 0 24 24"><path d="M12 2 1 21h22zm1 14h-2v2h2zm0-8h-2v6h2z"/></svg>';

// One rule set per field id. `required` fields must be non-empty; empty
// optional fields are left in a neutral (unstyled) state rather than shown
// as invalid.
const validationRules = {
  loginUsername: { required: true, label: 'Username' },
  loginPassword: { required: true, label: 'Password' },

  courseCode: { required: true, minLength: 2, label: 'Course code' },
  courseTitle: { required: true, minLength: 3, label: 'Course title' },
  courseYear: { required: true, numeric: true, min: 1, max: 4, label: 'Year level' },
  lecUnits: { numeric: true, min: 0, label: 'Lecture units' },
  labUnits: { numeric: true, min: 0, label: 'Laboratory units' },
  courseMaxStudents: { pattern: /^[1-9]\d*$/, label: 'Course capacity', message: 'Course capacity must be a whole number of 1 or more.' },

  blockYearLevel: { required: true, numeric: true, min: 1, max: 4, label: 'Year level' },
  numberOfBlocks: { required: true, numeric: true, min: 1, max: 20, label: 'Number of blocks', message: 'Number of blocks must be between 1 and 20.' },

  facultyName: { required: true, minLength: 2, label: 'Faculty name' },
  maxPreparations: { required: true, numeric: true, min: 1, max: 20, label: 'Max preparations', message: 'Max preparations must be between 1 and 20.' },

  roomName: { required: true, label: 'Room name' },

  assignFaculty: { required: true, label: 'Faculty' },

  scheduleSchoolYear: { required: true, pattern: /^\d{4}-\d{4}$/, label: 'School year', message: 'School year must be in the format YYYY-YYYY (e.g. 2026-2027).' },
  scheduleCourse: { required: true, label: 'Course' },
  scheduleTarget: { required: true, label: 'Block' },
  scheduleFaculty: { required: false, label: 'Instructor' },
  startTime_lecture: { required: true, label: 'Lecture start time' },
  endTime_lecture: { required: true, label: 'Lecture end time' },
  startTime_laboratory: { required: true, label: 'Laboratory start time' },
  endTime_laboratory: { required: true, label: 'Laboratory end time' },
};

// Which fields belong to which <form>, for "validate everything and show
// the summary" on submit. A disabled field (locked-summary or hidden
// component block) is skipped by validateField(), so both components can
// always be listed here regardless of which one is actually editable.
const formFieldMap = {
  loginForm: ['loginUsername', 'loginPassword'],
  courseForm: ['courseCode', 'courseTitle', 'courseYear', 'lecUnits', 'labUnits', 'courseMaxStudents'],
  blockForm: ['blockYearLevel', 'numberOfBlocks'],
  facultyForm: ['facultyName', 'maxPreparations'],
  roomForm: ['roomName'],
  facultyCourseForm: ['assignFaculty'],
  scheduleForm: ['scheduleSchoolYear', 'scheduleCourse', 'scheduleTarget', 'scheduleFaculty', 'startTime_lecture', 'endTime_lecture', 'startTime_laboratory', 'endTime_laboratory'],
};

function shakeEl(el) {
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
}

/** Wraps a text/number/password input in a .field-wrap div with a status-icon slot. Selects are left unwrapped (no icon) to avoid colliding with the native dropdown arrow. */
function ensureFieldWrap(input) {
  if (input.tagName !== 'INPUT') return input;
  if (input.parentElement.classList.contains('field-wrap')) return input.parentElement;
  const wrap = document.createElement('div');
  wrap.className = 'field-wrap';
  input.parentElement.insertBefore(wrap, input);
  wrap.appendChild(input);
  const icon = document.createElement('span');
  icon.className = 'field-status-icon';
  icon.id = input.id + 'StatusIcon';
  wrap.appendChild(icon);
  return wrap;
}

/** Creates (once) the small inline message shown under a field, separate from any pre-existing static .field-hint so we never clobber existing help text. */
function ensureValidationHint(input) {
  let hint = document.getElementById(input.id + 'ValidationHint');
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'field-hint validation-hint';
    hint.id = input.id + 'ValidationHint';
    const anchor = input.closest('.field-wrap') || input;
    anchor.insertAdjacentElement('afterend', hint);
  }
  return hint;
}

function validateField(id, opts = {}) {
  const rule = validationRules[id];
  const el = $(id);
  if (!rule || !el || el.disabled) return true;

  const icon = document.getElementById(id + 'StatusIcon');
  const hint = document.getElementById(id + 'ValidationHint');
  const value = el.value;

  const setState = (state, message) => {
    el.classList.toggle('field-valid', state === 'valid');
    el.classList.toggle('field-invalid', state === 'invalid');
    if (icon) {
      icon.classList.toggle('show', state !== 'neutral');
      icon.classList.toggle('valid', state === 'valid');
      icon.classList.toggle('invalid', state === 'invalid');
      icon.innerHTML = state === 'valid' ? ICON_VALID : state === 'invalid' ? ICON_INVALID : '';
    }
    if (hint) {
      const showHint = state === 'invalid';
      hint.style.display = showHint ? 'block' : 'none';
      hint.classList.toggle('valid-text', state === 'valid');
      hint.classList.toggle('invalid-text', state === 'invalid');
      if (showHint && message) hint.textContent = message;
    }
  };

  if (value.trim() === '') {
    if (rule.required) {
      setState('invalid', rule.message || `${rule.label} is required.`);
      if (!opts.silent) shakeEl(el);
      return false;
    }
    setState('neutral');
    return true;
  }

  let ok = true;
  let message = rule.successMessage || 'Looks good!';

  if (rule.minLength && value.trim().length < rule.minLength) {
    ok = false;
    message = rule.message || `${rule.label} must be at least ${rule.minLength} characters.`;
  } else if (rule.pattern && !rule.pattern.test(value.trim())) {
    ok = false;
    message = rule.message || `Please enter a valid ${rule.label.toLowerCase()}.`;
  } else if (rule.numeric) {
    const num = parseFloat(value);
    if (isNaN(num)) {
      ok = false;
      message = `${rule.label} must be a number.`;
    } else if (rule.min !== undefined && num < rule.min) {
      ok = false;
      message = rule.message || `${rule.label} must be at least ${rule.min}.`;
    } else if (rule.max !== undefined && num > rule.max) {
      ok = false;
      message = rule.message || `${rule.label} must be at most ${rule.max}.`;
    }
  }

  setState(ok ? 'valid' : 'invalid', message);
  if (!ok && !opts.silent) shakeEl(el);
  return ok;
}

function getOrCreateErrorSummary(formId) {
  const form = $(formId);
  let summary = form.querySelector(':scope > .form-error-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'form-error-summary';
    summary.innerHTML = '<strong><i class="fas fa-triangle-exclamation"></i> Please check the following:</strong><ul></ul>';
    form.insertBefore(summary, form.firstChild);
  }
  return summary;
}

function showFormErrorSummary(formId, errors) {
  const summary = getOrCreateErrorSummary(formId);
  if (!errors.length) {
    summary.classList.remove('show');
    return;
  }
  summary.querySelector('ul').innerHTML = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
  summary.classList.add('show');
}

function hideFormErrorSummary(formId) {
  const form = $(formId);
  const summary = form.querySelector(':scope > .form-error-summary');
  if (summary) summary.classList.remove('show');
}

/** Clears every validation visual for a form -- called whenever a form/modal is reset or reopened so stale red/green states don't linger. */
function clearValidationState(formId) {
  (formFieldMap[formId] || []).forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.classList.remove('field-valid', 'field-invalid', 'shake');
    const icon = document.getElementById(id + 'StatusIcon');
    if (icon) { icon.classList.remove('show', 'valid', 'invalid'); icon.innerHTML = ''; }
    const hint = document.getElementById(id + 'ValidationHint');
    if (hint) { hint.style.display = 'none'; hint.classList.remove('valid-text', 'invalid-text'); }
  });
  hideFormErrorSummary(formId);
}

/** Validates every field in a form, shows the error summary + shakes invalid fields, and focuses the first problem. Returns true only if the whole form is clean. */
function validateForm(formId) {
  const ids = formFieldMap[formId] || [];
  const errors = [];
  let firstInvalid = null;

  ids.forEach((id) => {
    const ok = validateField(id, { silent: true });
    if (!ok) {
      const hint = document.getElementById(id + 'ValidationHint');
      errors.push(hint ? hint.textContent : `${validationRules[id].label} is invalid.`);
      if (!firstInvalid) firstInvalid = id;
    }
  });

  // Cross-field rule: a course needs at least one of lecture/lab units > 0.
  if (formId === 'courseForm') {
    const lec = parseFloat($('lecUnits').value) || 0;
    const lab = parseFloat($('labUnits').value) || 0;
    if (lec <= 0 && lab <= 0) {
      const msg = 'A course must have at least a lecture or a laboratory unit greater than 0.';
      ['lecUnits', 'labUnits'].forEach((id) => {
        $(id).classList.add('field-invalid');
        $(id).classList.remove('field-valid');
        const hint = document.getElementById(id + 'ValidationHint');
        if (hint) { hint.style.display = 'block'; hint.textContent = msg; hint.classList.add('invalid-text'); hint.classList.remove('valid-text'); }
      });
      errors.push(msg);
      if (!firstInvalid) firstInvalid = 'lecUnits';
    }
  }

  showFormErrorSummary(formId, errors);

  if (errors.length > 0) {
    ids.forEach((id) => { const el = $(id); if (el && el.classList.contains('field-invalid')) shakeEl(el); });
    if (firstInvalid) $(firstInvalid).focus();
    return false;
  }
  return true;
}

function initRealtimeValidation() {
  Object.keys(validationRules).forEach((id) => {
    const el = $(id);
    if (!el) return;
    ensureFieldWrap(el);
    ensureValidationHint(el);
    el.addEventListener('input', () => validateField(id, { silent: true }));
    el.addEventListener('change', () => validateField(id, { silent: true }));
    el.addEventListener('blur', () => validateField(id, { silent: false }));
  });

  // Re-check the lec/lab cross-field rule live as either unit changes, so
  // the shared error clears the moment the pair becomes valid again.
  ['lecUnits', 'labUnits'].forEach((id) => {
    $(id).addEventListener('input', () => {
      const lec = parseFloat($('lecUnits').value) || 0;
      const lab = parseFloat($('labUnits').value) || 0;
      if (lec > 0 || lab > 0) {
        ['lecUnits', 'labUnits'].forEach((fid) => {
          const hint = document.getElementById(fid + 'ValidationHint');
          if (hint && hint.textContent.includes('lecture or a laboratory')) hint.style.display = 'none';
          $(fid).classList.remove('field-invalid');
        });
      }
    });
  });
}
initRealtimeValidation();

function formSubmit(id, build, endpoint, entity, onSuccess, preSubmitCheck) {
  $(id).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm(id)) return;
    const cfg = formConfig[entity];
    const editId = editing[entity];
    if (preSubmitCheck) {
      const proceed = await preSubmitCheck(editId, build());
      if (!proceed) return;
    }
    const submitBtn = cfg ? $(cfg.submitBtnId) : e.target.querySelector('[type="submit"]');
    const originalLabel = submitBtn ? submitBtn.innerHTML : null;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    try {
      const payload = build();
      if (editId) {
        payload.id = editId;
        await request(endpoint, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Updated successfully', 'success');
      } else {
        await request(endpoint, { method: 'POST', body: JSON.stringify(payload) });
        showToast('Saved successfully', 'success');
      }
      if (onSuccess) onSuccess(editId, payload);
      if (cfg && cfg.modalId) {
        closeEntityModal(entity);
      } else if (cfg) {
        cancelEdit(entity);
      } else {
        e.target.reset();
      }
      await loadAll();
    } catch (err) {
      if (err.data && err.data.conflict_type === 'instructor_mismatch') {
        showInstructorConflictModal(err.message, err.data.existing_schedule_id);
      } else {
        showToast(err.message, 'error');
      }
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
    }
  });
}

/**
 * Editing a course's units/year-level/semester/category after schedules
 * already exist for it is blocked server-side now (api/courses.php), so
 * this pre-submit check only needs to warn about it BEFORE the request is
 * even sent -- letting the institute head cancel early instead of hitting
 * a 422 after already filling out the form.
 */
async function confirmCourseEditImpact(editId, payload) {
  if (!editId) return true;
  const before = state.courses.find((c) => Number(c.id) === Number(editId));
  if (!before) return true;
  const changed = ['year_level', 'semester_type', 'lec_units', 'lab_units', 'category'].some((k) => String(before[k]) !== String(payload[k]));
  if (!changed) return true;
  const affected = state.schedules.filter((s) => Number(s.course_id) === Number(editId));
  if (!affected.length) return true;
  const message = `This course is already used in <strong>${affected.length}</strong> existing schedule${affected.length === 1 ? '' : 's'}. Changing units, year level, semester, or category is not allowed while those schedules exist -- delete or update them first.`;
  await showConfirm(message, 'This Change Affects Existing Schedules', { confirmLabel: 'OK', confirmIcon: 'fa-circle-info', danger: false });
  return false;
}

/* =====================================================
   BULK CSV IMPORT (Courses / Blocks)
   One shared modal + hidden <input type=file>, reused for both entities.
   Parsing and validation happen server-side (api/import.php) so quoted
   fields / embedded commas are handled correctly and the same business
   rules as the single-record forms apply per row.
   ===================================================== */

const IMPORT_CONFIG = {
  courses: { title: 'Import Courses', intro: 'Upload a CSV of courses. Required columns: course_code, course_title, year_level, semester_type. lec_units/lab_units are each optional individually, but at least one of the two must be greater than 0. Optional: category.', stateKey: 'courses' },
  blocks: { title: 'Import Blocks', intro: 'Upload a CSV of blocks. Required columns: year_level, number_of_blocks. Optional: program_code (default BSCS). Blocks are auto-named "Block N", continuing after any that already exist for that year level.', stateKey: 'blocks' },
};

let importEntity = null;

function triggerCsvImport(entity) {
  importEntity = entity;
  const cfg = IMPORT_CONFIG[entity];
  $('modalImportTitle').textContent = cfg.title;
  $('importIntro').textContent = cfg.intro;
  $('importTemplateLink').href = `${API}import.php?template=${entity}`;
  $('importResults').classList.add('hidden');
  $('importErrorList').innerHTML = '';
  $('importLoading').classList.add('hidden');
  $('importChooseFileBtn').disabled = false;
  $('importFileInput').value = '';
  $('modalImport').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
window.triggerCsvImport = triggerCsvImport;

function closeImportModal() {
  $('modalImport').classList.add('hidden');
  document.body.style.overflow = '';
  importEntity = null;
}
window.closeImportModal = closeImportModal;

$('importFileInput').addEventListener('change', async () => {
  const file = $('importFileInput').files[0];
  if (!file || !importEntity) return;
  const entity = importEntity;

  $('importResults').classList.add('hidden');
  $('importLoading').classList.remove('hidden');
  $('importChooseFileBtn').disabled = true;

  try {
    const csvText = await file.text();
    const data = await request('import.php', { method: 'POST', body: JSON.stringify({ type: entity, csv: csvText }) });
    showToast(data.inserted ? `Imported ${data.inserted} row${data.inserted === 1 ? '' : 's'}` : 'No rows were imported', data.inserted ? 'success' : 'warning');
    $('importSummary').textContent = `${data.inserted} row${data.inserted === 1 ? '' : 's'} imported${data.errors.length ? `, ${data.errors.length} skipped` : ''}.`;
    $('importErrorList').innerHTML = data.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
    $('importResults').classList.remove('hidden');
    if (data.inserted) await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    $('importLoading').classList.add('hidden');
    $('importChooseFileBtn').disabled = false;
    $('importFileInput').value = '';
  }
});

formSubmit('courseForm', () => ({ course_code: $('courseCode').value, course_title: $('courseTitle').value, year_level: $('courseYear').value, semester_type: $('courseSemester').value, lec_units: $('lecUnits').value, lab_units: $('labUnits').value, category: $('category').value, max_students: $('courseMaxStudents').value }), 'courses.php', 'courses', null, confirmCourseEditImpact);
formSubmit('facultyForm', () => ({ faculty_name: $('facultyName').value, max_preparations: $('maxPreparations').value, is_active: $('facultyActive').checked ? 1 : 0 }), 'faculty.php', 'faculty');
formSubmit('roomForm', () => ({ room_name: $('roomName').value, room_type: $('roomType').value, is_active: $('roomActive').checked ? 1 : 0 }), 'rooms.php', 'rooms');
// Faculty Assignments: multi-select Add (with optional confirmation step) or
// single-course Edit. Handled here instead of formSubmit() because one Add
// can create many rows.
$('facultyCourseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm('facultyCourseForm')) return;
  const ids = assignPicker.getSelectedIds();
  if (!ids.length) {
    showToast('Pick at least one course to assign.', 'error');
    return;
  }
  if (assignPicker.isEdit()) {
    const submitBtn = $('assignmentSubmitBtn');
    const originalLabel = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    try {
      await request('faculty_courses.php', { method: 'PUT', body: JSON.stringify({ id: editing.assignments, faculty_id: $('assignFaculty').value, course_id: ids[0] }) });
      showToast('Updated successfully', 'success');
      closeEntityModal('assignments');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
    }
    return;
  }
  if (assignPicker.isDirectSave()) await saveAssignments(ids);
  else openAssignConfirm();
});

/**
 * Custom submit handler for the Subject Offering form (not the generic
 * formSubmit() helper, since one submit here can create/update up to two
 * schedule rows -- Lecture and Laboratory -- atomically in one request. Only
 * components that are currently unlocked/editable are included: an
 * already-saved, still-locked sibling component is left untouched
 * server-side and still counts toward the completeness check there.
 */
async function submitScheduleForm() {
  if (!validateForm('scheduleForm')) return;

  const componentsPayload = COMPONENT_TYPES
    .filter((c) => !$('componentBlock_' + c).classList.contains('hidden') && !$('componentFields_' + c).classList.contains('hidden'))
    .map((c) => {
      const payload = {
        component: c,
        set_type: $('setType_' + c).value,
        day_of_week: getEffectiveDayPattern(c),
        start_time: $('startTime_' + c).value,
        end_time: $('endTime_' + c).value,
        room_id: $('scheduleRoom_' + c).value,
        notes: $('notes_' + c).value,
      };
      const existingId = existingComponentId(c);
      if (existingId && componentUnlocked[c]) payload.id = existingId;
      return payload;
    });

  if (!componentsPayload.length) {
    showToast('Nothing to save. Click Edit on a component to change it.', 'warning');
    return;
  }

  const target = getSelectedTarget();
  const body = {
    school_year: $('scheduleSchoolYear').value,
    course_id: $('scheduleCourse').value,
    block_id: target && target.type === 'block' ? target.id : null,
    spare_id: target && target.type === 'spare' ? target.id : null,
    faculty_id: $('scheduleFaculty').value,
    assign_faculty_to_course: !$('assignAlsoWrap').classList.contains('hidden') && $('assignAlsoCheck').checked,
    components: componentsPayload,
  };

  const submitBtn = $('scheduleSubmitBtn');
  const originalLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    await request('schedules.php?mode=offering', { method: 'POST', body: JSON.stringify(body) });
    showToast('Subject offering saved successfully', 'success');
    closePlotScheduleModal();
    cancelEdit('schedules', { keepPlottingContext: true });
    await loadAll();
  } catch (err) {
    if (err.data && (err.data.conflict_type === 'instructor_mismatch' || err.data.conflict_type === 'duplicate_component')) {
      showInstructorConflictModal(err.message, err.data.existing_schedule_id, err.data.conflict_type);
    } else {
      showToast(err.message, 'error');
    }
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
}

// The native <form> submit (Enter key, or the relocated Save Schedule button
// which keeps form="scheduleForm") still goes through the normal event --
// just delegate it to the extracted function above.
$('scheduleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  submitScheduleForm();
});

function onOfferingContextChange() {
  COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); updateSetTypeOptions(c); });
  updateComponentBlocks();
  updateFacultyOptions();
  COMPONENT_TYPES.forEach((c) => checkLiveConflict(c));
  renderOfferingOverview();
}

$('scheduleYearLevel').addEventListener('change', onYearLevelChange);
$('scheduleSemester').addEventListener('change', onSemesterChange);
$('scheduleTarget').addEventListener('change', onTargetChange);
$('scheduleCourse').addEventListener('change', onOfferingContextChange);
$('scheduleSchoolYear').addEventListener('change', onOfferingContextChange);

COMPONENT_TYPES.forEach((c) => {
  $('scheduleDuration_' + c).addEventListener('change', () => { updateEndTimeFromDuration(c); refreshWeeklyHoursUI(c); });
  $('startTime_' + c).addEventListener('change', () => { updateEndTimeFromDuration(c); refreshWeeklyHoursUI(c); });
  $('endTime_' + c).addEventListener('change', () => { renderWeeklyHoursSummary(c); refreshSubmitButtonState(); checkLiveConflict(c); });
  $('setType_' + c).addEventListener('change', () => { updateRoomRequirement(c); checkLiveConflict(c); });
  $('scheduleRoom_' + c).addEventListener('change', () => checkLiveConflict(c));
  $('scheduleFaculty').addEventListener('change', () => { updateAssignAlsoPrompt(); checkLiveConflict(c); });
  $('dayOfWeek_' + c).addEventListener('change', () => {
    $('customDaysRow_' + c).classList.toggle('hidden', $('dayOfWeek_' + c).value !== 'Custom');
    refreshWeeklyHoursUI(c);
  });
  $('customDaysRow_' + c).querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => refreshWeeklyHoursUI(c));
  });
  updateRoomRequirement(c);
});

['filterSchoolYear', 'filterYear', 'filterSemester', 'filterTarget', 'filterFaculty'].forEach((id) => {
  $(id).addEventListener('change', () => {
    scheduleFilters.schoolYear = $('filterSchoolYear').value;
    scheduleFilters.year = $('filterYear').value;
    scheduleFilters.semester = $('filterSemester').value;
    scheduleFilters.target = $('filterTarget').value;
    scheduleFilters.faculty = $('filterFaculty').value;
    if (id === 'filterYear') renderFilterOptions();
    getTableState('schedulesTable').page = 1;
    renderTables();
    syncScheduleFiltersToHash();
  });
});

$('clearFiltersBtn').addEventListener('click', () => {
  $('filterSchoolYear').value = ''; $('filterYear').value = ''; $('filterSemester').value = ''; $('filterTarget').value = ''; $('filterFaculty').value = '';
  scheduleFilters.schoolYear = ''; scheduleFilters.year = ''; scheduleFilters.semester = ''; scheduleFilters.target = ''; scheduleFilters.faculty = '';
  renderFilterOptions();
  getTableState('schedulesTable').page = 1;
  renderTables();
  syncScheduleFiltersToHash();
});

// Guarded (not a plain $() call) on purpose: if this element is ever
// missing -- e.g. index.html and app.js get out of sync during an update --
// this must not throw and take down every listener registered after it
// (search boxes, the login form, etc.) along with it.
const coursesYearFilterEl = document.getElementById('coursesYearFilter');
if (coursesYearFilterEl) {
  coursesYearFilterEl.addEventListener('change', () => {
    coursesYearFilter = coursesYearFilterEl.value;
    getTableState('coursesTable').page = 1;
    renderTables();
  });
}

/* Free-text search boxes for every table */
[
  ['coursesSearch', 'coursesTable'],
  ['blocksSearch', 'blocksTable'],
  ['facultySearch', 'facultyTable'],
  ['roomsSearch', 'roomsTable'],
  ['assignmentsSearch', 'assignmentsTable'],
  ['schedulesSearch', 'schedulesTable'],
].forEach(([inputId, tableId]) => {
  $(inputId).addEventListener('input', () => {
    const st = getTableState(tableId);
    st.search = $(inputId).value;
    st.page = 1;
    renderTables();
  });
});

// mousedown would pull focus off the password field and trigger its "required" error.
$('togglePasswordBtn').addEventListener('mousedown', (e) => e.preventDefault());
$('togglePasswordBtn').addEventListener('click', () => {
  setPasswordVisible($('loginPassword').type === 'password');
  $('loginPassword').focus();
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm('loginForm')) return;
  $('loginError').textContent = '';
  const btn = $('loginSubmitBtn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
  try {
    await request('auth.php', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value }) });
    $('loginForm').reset();
    clearValidationState('loginForm');
    showApp();
    loadAll().then(applyRouteFromHash).catch((err) => showToast(err.message, 'error'));
  } catch (err) {
    $('loginError').textContent = err.message;
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await request('auth.php', { method: 'DELETE' }); } catch (e) { /* ignore */ }
  Object.assign(state, { courses: [], blocks: [], blockCourseRows: [], spares: [], faculty: [], rooms: [], schedules: [], assignments: [] });
  showLogin();
});

$('scheduleSchoolYear').value = suggestedSchoolYear();
populateTimeSelect('startTime_lecture', { startHour: 6, endHour: 21 });
populateTimeSelect('endTime_lecture', { startHour: 6, endHour: 21 });
populateTimeSelect('startTime_laboratory', { startHour: 6, endHour: 21 });
populateTimeSelect('endTime_laboratory', { startHour: 6, endHour: 21 });
COMPONENT_TYPES.forEach((c) => resetComponentFields(c));
updateComponentBlocks();

(async () => {
  try {
    const session = await request('auth.php');
    if (session.logged_in) {
      showApp();
      await loadAll();
      applyRouteFromHash();
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();