const API = 'api/';
const state = { courses: [], sections: [], faculty: [], rooms: [], schedules: [], assignments: [] };

// Tracks which record id (if any) each form is currently editing.
// null means the form is in "create new" mode.
const editing = { courses: null, sections: null, faculty: null, rooms: null, schedules: null, assignments: null };

// Current schedule list filter selections.
const scheduleFilters = { schoolYear: '', year: '', semester: '', section: '', faculty: '' };

// Per-table UI state: free-text search, sort column/direction, current page.
const tableState = {};
const PAGE_SIZE = 8;

const formConfig = {
  courses:     { formId: 'courseForm',        submitBtnId: 'courseSubmitBtn',   cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Course',    editLabel: '<i class="fas fa-check"></i> Update Course',    modalId: 'modalCourse',     modalTitleId: 'modalCourseTitle',   addTitle: 'Add Course',    editTitle: 'Edit Course' },
  sections:    { formId: 'sectionForm',       submitBtnId: 'sectionSubmitBtn',  cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Section',   editLabel: '<i class="fas fa-check"></i> Update Section',   modalId: 'modalSection',    modalTitleId: 'modalSectionTitle',  addTitle: 'Add Section',   editTitle: 'Edit Section' },
  faculty:     { formId: 'facultyForm',       submitBtnId: 'facultySubmitBtn',  cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Faculty',   editLabel: '<i class="fas fa-check"></i> Update Faculty',   modalId: 'modalFaculty',    modalTitleId: 'modalFacultyTitle',  addTitle: 'Add Faculty',   editTitle: 'Edit Faculty' },
  rooms:       { formId: 'roomForm',          submitBtnId: 'roomSubmitBtn',     cancelBtnId: null,               addLabel: '<i class="fas fa-plus"></i> Add Room',      editLabel: '<i class="fas fa-check"></i> Update Room',      modalId: 'modalRoom',       modalTitleId: 'modalRoomTitle',     addTitle: 'Add Room',      editTitle: 'Edit Room' },
  assignments: { formId: 'facultyCourseForm', submitBtnId: 'assignmentSubmitBtn', cancelBtnId: null,             addLabel: '<i class="fas fa-plus"></i> Assign',        editLabel: '<i class="fas fa-check"></i> Update Assignment', modalId: 'modalAssignment', modalTitleId: 'modalAssignmentTitle', addTitle: 'Assign Course to Faculty', editTitle: 'Edit Assignment' },
  schedules:   { formId: 'scheduleForm',      submitBtnId: 'scheduleSubmitBtn', cancelBtnId: 'scheduleCancelBtn', addLabel: '<i class="fas fa-save"></i> Save Schedule', editLabel: '<i class="fas fa-check"></i> Update Schedule',  modalId: null,              modalTitleId: null,                 addTitle: '',               editTitle: '' },
};

const deleteConfig = {
  courses:     { endpoint: 'courses.php',         stateKey: 'courses',     labelFn: c => `${c.course_code} - ${c.course_title}` },
  sections:    { endpoint: 'sections.php',        stateKey: 'sections',    labelFn: s => `${s.program_code} ${s.year_level} - Section ${s.section_no}` },
  faculty:     { endpoint: 'faculty.php',         stateKey: 'faculty',     labelFn: f => f.faculty_name },
  rooms:       { endpoint: 'rooms.php',           stateKey: 'rooms',       labelFn: r => r.room_name },
  assignments: { endpoint: 'faculty_courses.php', stateKey: 'assignments', labelFn: a => `${a.faculty_name} \u2192 ${a.course_code}` },
  schedules:   { endpoint: 'schedules.php',       stateKey: 'schedules',   labelFn: s => `${s.course_code} (${formatDayPattern(s.day_of_week)} ${s.start_time.slice(0,5)}-${s.end_time.slice(0,5)})` },
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

  // Prevent the same message/type from stacking multiple times in a row --
  // e.g. clicking "Update Faculty" repeatedly while a real server error
  // keeps happening used to pile up one identical toast per click.
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

/* Kept for internal fallback use; toasts are the primary feedback mechanism now. */
function alertBox(message, type = 'success') {
  showToast(message, type === 'error' ? 'error' : 'success');
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
   schedule because Lecture/Laboratory of the same course+section already
   has a different instructor. Never silently drops or deletes the
   existing schedule -- just warns, and offers a way to go look at it.
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

/**
 * Jumps to the Schedules tab, filtered to the conflicting section, and
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
  scheduleFilters.section = sched ? String(sched.section_id) : '';
  $('filterSchoolYear').value = '';
  $('filterYear').value = '';
  $('filterSemester').value = '';
  $('filterFaculty').value = '';
  // Year Level filter was just cleared -- refresh Section's option list
  // back to "all sections" before selecting the target one, or it may not
  // exist yet in a list still narrowed from a prior Year Level filter.
  renderFilterOptions();
  $('filterSection').value = scheduleFilters.section;
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
  sectionForm:       { title: 'Unsaved Section',    message: 'You have unsaved changes to this section. Do you want to leave without saving?' },
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
}
window.openEntityModal = openEntityModal;

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

function showLogin() {
  $('appShell').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
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
  // Printing needs every filtered/sorted row, not just the rows visible on
  // the current on-screen page -- otherwise the printed report silently
  // drops everything outside the current pagination page (bug: incomplete
  // printed reports).
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

const YEAR_LEVEL_LABELS = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };

/**
 * Mirrors ALLOWED_SET_TYPES_BY_YEAR_LEVEL in api/schedules.php: 1st/4th year
 * sections rotate on SET 1, 2nd/3rd year sections rotate on SET 2, and every
 * year level can use SET 0. This only hides the invalid choices earlier in
 * the UI -- the backend remains the authoritative check.
 */
const ALLOWED_SET_TYPES_BY_YEAR_LEVEL = {
  1: ['set_0', 'set_1'],
  2: ['set_0', 'set_2'],
  3: ['set_0', 'set_2'],
  4: ['set_0', 'set_1'],
};

/** Shows only the SET options valid for the selected course's year level in one component's Set Type dropdown, and resets the selection if it's no longer valid. */
function updateSetTypeOptions(component) {
  const course = getSelectedCourse();
  const select = $('setType_' + component);
  const allowed = course
    ? (ALLOWED_SET_TYPES_BY_YEAR_LEVEL[Number(course.year_level)] || ['set_0'])
    : ['set_0', 'set_1', 'set_2'];
  Array.from(select.options).forEach((opt) => {
    const isAllowed = allowed.includes(opt.value);
    opt.hidden = !isAllowed;
    opt.disabled = !isAllowed;
  });
  if (!allowed.includes(select.value)) {
    select.value = allowed.includes('set_0') ? 'set_0' : allowed[0];
  }
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
   SEARCHABLE COURSE COMBOBOX (reusable)
   Powers both the Plot Schedule course picker and the Course Assignment
   course picker: pick a Year Level, then search/select from just that
   year's courses. The real <select> (filled by fillCourseSelectGrouped)
   stays the single source of truth for course_id -- every existing piece
   of JS that reads/writes that select (getSelectedCourse, onCourseChange,
   form submit, validation) keeps working exactly as before. This panel is
   purely a friendlier way to set that same select's value, so a course
   list too long to browse comfortably can be found by typing its code or
   title. One factory instance is created per picker (see the bottom of
   this file) so the two pickers never share filter/keyboard-nav state.
   ===================================================== */

function createCourseCombobox({ yearLevelId, searchId, listId, selectId }) {
  let flatList = [];
  let activeIndex = -1;

  function groupsFor(filterText) {
    const yearLevel = $(yearLevelId).value;
    if (!yearLevel) return []; // Course is gated on Year Level -- nothing to offer until one is picked
    const q = (filterText || '').trim().toLowerCase();
    const byYear = {};
    state.courses.forEach((c) => {
      if (Number(c.year_level) !== Number(yearLevel)) return;
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
      const yearLevel = $(yearLevelId).value;
      panel.innerHTML = `<div class="combobox-empty">${yearLevel ? 'No matching courses.' : 'Select a year level first.'}</div>`;
      return;
    }

    // With Course gated on Year Level, there's normally exactly one group
    // (the selected year), so the group label is redundant -- only show it
    // if somehow more than one year level is present.
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
      // mousedown (not click) fires before the search input's blur handler,
      // so the selection is committed before blur would otherwise close the
      // panel and discard the click.
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectCourse(Number(opt.dataset.courseId));
      });
    });
  }

  function open() {
    if ($(searchId).disabled) return; // gated: pick a Year Level first
    renderPanel($(searchId).value);
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

  /** Sets the hidden source <select>'s value and fires the same 'change' event a native selection would, so every existing course-change listener keeps running exactly as before. */
  function selectCourse(courseId) {
    const course = state.courses.find((c) => Number(c.id) === courseId);
    $(selectId).value = String(courseId);
    $(searchId).value = course ? `${course.course_code} - ${course.course_title}` : '';
    close();
    $(selectId).dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Re-syncs the search input's displayed text with whatever course_id the hidden select currently holds -- used whenever the select's value is set programmatically (edit, cancel/reset) instead of through the panel. */
  function syncDisplay() {
    const courseId = Number($(selectId).value) || null;
    const course = courseId ? state.courses.find((c) => Number(c.id) === courseId) : null;
    $(searchId).value = course ? `${course.course_code} - ${course.course_title}` : '';
  }

  /** Enables/disables the Course search input based on whether a Year Level is currently selected -- Course is only pickable once its parent Year Level is set. */
  function updateAvailability() {
    const yearLevel = $(yearLevelId).value;
    const input = $(searchId);
    input.disabled = !yearLevel;
    input.placeholder = yearLevel ? 'Search course code or title...' : 'Select a year level first';
  }

  /** Year Level changed: the previously selected Course (if any) almost certainly no longer belongs to the new year level, so clear it and let the user re-pick from a freshly filtered Course list. Callers that also need to reset downstream fields (Section, Faculty, etc.) do that themselves after calling this. */
  function onYearLevelChanged() {
    $(selectId).value = '';
    syncDisplay();
    close();
    updateAvailability();
  }

  const searchInput = $(searchId);
  searchInput.addEventListener('focus', open);
  searchInput.addEventListener('input', open);
  searchInput.addEventListener('blur', () => {
    // Delayed so a mousedown-selected option (see renderPanel) still lands
    // before the panel closes and the display text is restored.
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

  return { open, close, renderPanel, selectCourse, syncDisplay, updateAvailability, onYearLevelChanged };
}

// One instance per picker. Created here (rather than lazily) so every other
// piece of code below can call these directly, same as the old dedicated
// scheduleCourse-only functions did.
const scheduleCourseCombobox = createCourseCombobox({ yearLevelId: 'scheduleYearLevel', searchId: 'scheduleCourseSearch', listId: 'scheduleCourseList', selectId: 'scheduleCourse' });
const assignCourseCombobox = createCourseCombobox({ yearLevelId: 'assignYearLevel', searchId: 'assignCourseSearch', listId: 'assignCourseList', selectId: 'assignCourse' });

/** Year Level changed on the Plot Schedule form: also resets the whole downstream chain (Section, Faculty, component blocks), per the "reset dependent selections" requirement -- the Course Assignment picker has no such downstream chain, so it just calls assignCourseCombobox.onYearLevelChanged() directly (wired below). */
function onYearLevelChange() {
  scheduleCourseCombobox.onYearLevelChanged();
  onCourseChange();
}

async function loadAll() {
  const [dashboard, courses, sections, faculty, rooms, schedules, assignments] = await Promise.all([
    request('dashboard.php'), request('courses.php'), request('sections.php'), request('faculty.php'), request('rooms.php'), request('schedules.php'), request('faculty_courses.php'),
  ]);
  Object.assign(state, { courses, sections, faculty, rooms, schedules, assignments });
  renderDashboard(dashboard);
  renderActivity();
  renderDashboardInsights();
  renderTables();
  renderSelects();
  renderFilterOptions();
  renderTimetableSelectors();
  renderTimetable();
}

function iconForStatKey(key) {
  const k = key.toLowerCase();
  if (k.includes('course')) return 'fa-book';
  if (k.includes('section')) return 'fa-layer-group';
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
    ...state.schedules.map((s) => ({ time: s.created_at, icon: 'fa-calendar-plus', text: `Schedule plotted: ${s.course_code} (${formatDayPattern(s.day_of_week)} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)})` })),
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
  const byType = { faculty: new Set(), room: new Set(), section: new Set() };
  const anyConflict = new Set();
  for (const s of state.schedules) {
    if (!s.day_of_week || !s.start_time || !s.end_time) continue;
    const conflicts = findScheduleConflicts(s.day_of_week, s.start_time.slice(0, 5), s.end_time.slice(0, 5), {
      sectionId: s.section_id, facultyId: s.faculty_id, roomId: s.room_id, ignoreId: s.id,
      setType: s.set_type, component: s.component, category: s.category,
      schoolYear: s.school_year, semesterType: s.semester_type,
    });
    if (!conflicts.length) continue;
    anyConflict.add(s.id);
    for (const c of conflicts) {
      if (c.type === 'Instructor') byType.faculty.add(s.id);
      if (c.type === 'Room') byType.room.add(s.id);
      if (c.type === 'Section') byType.section.add(s.id);
    }
  }
  return { anyConflict, faculty: byType.faculty.size, room: byType.room.size, section: byType.section.size };
}

/** Faculty currently at or over their max_preparations (distinct courses taught this term). */
function facultyLoadStats() {
  const preps = new Map();
  for (const s of state.schedules) {
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
    { label: 'Section Conflicts', value: conflicts.section, icon: 'fa-layer-group' },
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

  const items = [];
  if (conflicts.room > 0) {
    items.push({ icon: 'fa-door-open', tone: '', title: `${conflicts.room} Room Conflict${conflicts.room === 1 ? '' : 's'}`, sub: 'Overlapping room bookings detected', view: 'schedules' });
  }
  if (conflicts.faculty > 0) {
    items.push({ icon: 'fa-chalkboard-user', tone: '', title: `${conflicts.faculty} Instructor Conflict${conflicts.faculty === 1 ? '' : 's'}`, sub: 'Faculty double-booked at the same time', view: 'schedules' });
  }
  if (conflicts.section > 0) {
    items.push({ icon: 'fa-layer-group', tone: '', title: `${conflicts.section} Section Conflict${conflicts.section === 1 ? '' : 's'}`, sub: 'A section has overlapping classes', view: 'schedules' });
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

  // Newly-added buttons need the same quick-nav wiring the static ones got at load time.
  el.querySelectorAll('[data-quick-nav]').forEach((btn) => btn.addEventListener('click', () => goToView(btn.dataset.quickNav)));
}

const WEEKLY_OVERVIEW_DAYS = [
  { key: 'Monday', label: 'MON' }, { key: 'Tuesday', label: 'TUE' }, { key: 'Wednesday', label: 'WED' },
  { key: 'Thursday', label: 'THU' }, { key: 'Friday', label: 'FRI' }, { key: 'Saturday', label: 'SAT' },
];

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
      html += `<div class="wk-cell wk-slot ${cls}" title="${matches.length ? escapeHtml(matches.map((m) => `${m.course_code} (${m.program_code} ${m.year_level}-${m.section_no})`).join(', ')) : 'No schedule'}"></div>`;
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

/** Finds the already-saved schedule row (if any) for one component of the current Course + Section + School Year "subject offering". */
function findExistingComponentSchedule(courseId, sectionId, schoolYear, component) {
  if (!courseId || !sectionId || !schoolYear) return null;
  return state.schedules.find((s) =>
    Number(s.course_id) === Number(courseId) &&
    Number(s.section_id) === Number(sectionId) &&
    s.school_year === schoolYear &&
    s.component === component
  ) || null;
}

/** true once the scheduler has clicked "Edit" on an already-saved component, unlocking its fields for this session. Reset whenever the Course/Section/School Year selection changes. */
const componentUnlocked = { lecture: false, laboratory: false };
const componentHasConflict = { lecture: false, laboratory: false };
/** true when the component's currently selected Day Pattern + Duration does NOT total the course's required weekly hours exactly (see WEEKLY HOURS VALIDATION below). Blocks Save the same way componentHasConflict does. */
const componentHoursInvalid = { lecture: false, laboratory: false };

/** The id of the existing schedule row backing this component right now, if any (used as the PUT target and as the live-conflict "ignore self" id). */
function existingComponentId(component) {
  const course = getSelectedCourse();
  if (!course) return null;
  const existing = findExistingComponentSchedule(course.id, $('scheduleSection').value, $('scheduleSchoolYear').value, component);
  return existing ? Number(existing.id) : null;
}

/** ids of schedule rows currently open for editing in this form, so the faculty-inheritance lookup doesn't treat a component as its own "sibling". */
function currentEditingScheduleIds() {
  return COMPONENT_TYPES.map((c) => (componentUnlocked[c] ? existingComponentId(c) : null)).filter((id) => id !== null);
}

function getQualifiedFacultyForCourse(courseId) {
  const assignedFacultyIds = state.assignments
    .filter((a) => Number(a.course_id) === Number(courseId))
    .map((a) => Number(a.faculty_id));
  const course = state.courses.find((c) => Number(c.id) === Number(courseId));
  const sectionId = $('scheduleSection').value;
  const schoolYear = $('scheduleSchoolYear').value;
  const anyExisting = course
    ? COMPONENT_TYPES.map((c) => findExistingComponentSchedule(course.id, sectionId, schoolYear, c)).find(Boolean)
    : null;
  const editingFacultyId = anyExisting ? Number(anyExisting.faculty_id) : null;
  return state.faculty.filter((f) => assignedFacultyIds.includes(Number(f.id)) && (Number(f.is_active) === 1 || Number(f.id) === editingFacultyId));
}

function renderSelects() {
  fillCourseSelectGrouped('scheduleCourse', state.courses);
  fillCourseSelectGrouped('assignCourse', state.courses);
  fillSelect('assignFaculty', state.faculty, (f) => f.faculty_name);
  updateComponentBlocks();
  updateFacultyOptions();
  scheduleCourseCombobox.updateAvailability();
  assignCourseCombobox.updateAvailability();
  updateSectionOptions();
}

function renderFilterOptions() {
  const prevSection = $('filterSection').value;
  const prevFaculty = $('filterFaculty').value;
  const prevSchoolYear = $('filterSchoolYear').value;
  const yearFilter = $('filterYear').value;
  // The Section filter must only ever offer sections that actually belong
  // to the currently selected Year Level filter -- otherwise picking
  // "2nd Year" still leaves 1st/3rd/4th Year sections choosable, which
  // produces a filter combination that can never match anything.
  const sectionsForFilter = yearFilter
    ? state.sections.filter((s) => String(s.year_level) === String(yearFilter))
    : state.sections;
  fillSelect('filterSection', sectionsForFilter, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no}`, 'id', 'All Sections');
  fillSelect('filterFaculty', state.faculty, (f) => f.faculty_name, 'id', 'All Faculty');
  const schoolYears = [...new Set(state.schedules.map((s) => s.school_year))].sort().reverse();
  $('filterSchoolYear').innerHTML = '<option value="">All School Years</option>' + schoolYears.map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  // Keep the previous Section pick only if it's still valid for the
  // (possibly just-changed) Year Level filter; otherwise fall back to
  // "All Sections" instead of silently keeping a now-mismatched value.
  const prevStillValid = !prevSection || sectionsForFilter.some((s) => String(s.id) === prevSection);
  $('filterSection').value = prevStillValid ? prevSection : '';
  $('filterFaculty').value = prevFaculty;
  $('filterSchoolYear').value = prevSchoolYear;
}

/* =====================================================
   TIMETABLES (printable per-section / per-faculty grid)
   ===================================================== */

let ttMode = 'section';
const TT_DAY_COLUMNS = { Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6, Saturday: 7, Sunday: 8 };
const TT_DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function renderTimetableSelectors() {
  const prevSY = $('ttSchoolYear').value;
  const prevSem = $('ttSemester').value;
  const prevSec = $('ttSection').value;
  const prevFac = $('ttFaculty').value;
  const schoolYears = [...new Set(state.schedules.map((s) => s.school_year))].sort().reverse();
  const fallbackYear = suggestedSchoolYear();
  $('ttSchoolYear').innerHTML = (schoolYears.length ? schoolYears : [fallbackYear]).map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  if (schoolYears.includes(prevSY)) $('ttSchoolYear').value = prevSY;
  $('ttSemester').value = prevSem;

  fillSelect('ttSection', state.sections, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no}`, 'id', 'Select a section');
  fillSelect('ttFaculty', state.faculty, (f) => f.faculty_name, 'id', 'Select a faculty');
  if (prevSec) $('ttSection').value = prevSec;
  if (prevFac) $('ttFaculty').value = prevFac;
}

function renderTimetable() {
  const schoolYear = $('ttSchoolYear').value;
  const semester = $('ttSemester').value;
  const semesterLabel = { first_semester: 'First Semester', second_semester: 'Second Semester', summer: 'Summer' }[semester] || '';
  let filtered = state.schedules.filter((s) => s.school_year === schoolYear && (!semester || s.semester_type === semester));
  let heading = '';

  if (ttMode === 'section') {
    const sectionId = $('ttSection').value;
    filtered = sectionId ? filtered.filter((s) => String(s.section_id) === sectionId) : [];
    const sec = state.sections.find((s) => String(s.id) === sectionId);
    heading = sec ? `${escapeHtml(sec.program_code)} ${sec.year_level} - Section ${escapeHtml(sec.section_no)} &nbsp;|&nbsp; SY ${escapeHtml(schoolYear)}${semesterLabel ? ' &nbsp;|&nbsp; ' + escapeHtml(semesterLabel) : ''}` : 'Select a section above to view its timetable.';
    $('ttSummaryCard').classList.add('hidden');
  } else {
    const facultyId = $('ttFaculty').value;
    filtered = facultyId ? filtered.filter((s) => String(s.faculty_id) === facultyId) : [];
    const fac = state.faculty.find((f) => String(f.id) === facultyId);
    heading = fac ? `${escapeHtml(fac.faculty_name)} &nbsp;|&nbsp; SY ${escapeHtml(schoolYear)}${semesterLabel ? ' &nbsp;|&nbsp; ' + escapeHtml(semesterLabel) : ''}` : 'Select a faculty above to view their load.';
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

  const selectionMade = ttMode === 'section' ? !!$('ttSection').value : !!$('ttFaculty').value;
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
  $('ttGrid').style.gridTemplateRows = `36px repeat(${totalSlots}, 22px)`;

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

  filtered.forEach((s) => {
    const days = scheduleDaysFor(s.day_of_week);
    const startMin = timeStrToMinutes(s.start_time.slice(0, 5));
    const endMin = timeStrToMinutes(s.end_time.slice(0, 5));
    const startRow = 2 + Math.max(0, Math.floor((startMin - minStart) / 30));
    const endRow = 2 + Math.min(totalSlots, Math.ceil((endMin - minStart) / 30));
    days.forEach((d) => {
      const col = TT_DAY_COLUMNS[d];
      if (!col) return; // skip unrecognized/legacy literal 'Custom' data
      const subLabel = ttMode === 'section' ? s.faculty_name : `${s.program_code} ${s.year_level}-${s.section_no}`;
      html += `<div class="tt-block ${s.component === 'laboratory' ? 'lab' : ''}" style="grid-row:${startRow} / ${endRow};grid-column:${col};" title="${escapeHtml(s.course_code)} - ${escapeHtml(s.course_title)}">
        <div class="tt-block-title">${escapeHtml(s.course_code)}</div>
        <div class="tt-block-sub">${escapeHtml(subLabel)}</div>
        <div class="tt-block-sub">${escapeHtml(s.room_name || 'Online')}</div>
      </div>`;
    });
  });

  $('ttGrid').innerHTML = html;
}

/**
 * Fill in the print-only letterhead with real content, then trigger the
 * browser print dialog. The letterhead itself is invisible on screen
 * (display:none) and only shown by the @media print stylesheet, so the
 * screen UI is unaffected -- the printed page shows a clean official
 * document instead of the app's sidebar/topbar/filter controls.
 */
function fillPrintLetterhead(title, subtitle) {
  $('printLetterheadTitle').textContent = title;
  $('printLetterheadSubtitle').textContent = subtitle;
}

function printSchedules() {
  const parts = [];
  if (scheduleFilters.schoolYear) parts.push(`SY ${scheduleFilters.schoolYear}`);
  if (scheduleFilters.semester) {
    const label = { first_semester: 'First Semester', second_semester: 'Second Semester', summer: 'Summer' }[scheduleFilters.semester] || scheduleFilters.semester;
    parts.push(label);
  }
  if (scheduleFilters.year) parts.push(`Year ${scheduleFilters.year}`);
  if (scheduleFilters.section) {
    const sec = state.sections.find((s) => String(s.id) === String(scheduleFilters.section));
    if (sec) parts.push(`${sec.program_code} ${sec.year_level} - Section ${sec.section_no}`);
  }
  if (scheduleFilters.faculty) {
    const fac = state.faculty.find((f) => String(f.id) === String(scheduleFilters.faculty));
    if (fac) parts.push(fac.faculty_name);
  }
  fillPrintLetterhead('Class Schedule', parts.length ? parts.join(' \u2014 ') : 'All Schedules');

  // Swap to a fully-rendered (unpaginated) table just for the print, then
  // restore the normal paginated view once the print dialog closes --
  // otherwise the printed report would only contain whichever page of
  // results happened to be on screen.
  renderSchedulesTable(true);
  const restore = () => { renderSchedulesTable(false); window.removeEventListener('afterprint', restore); };
  window.addEventListener('afterprint', restore);
  window.print();
}
window.printSchedules = printSchedules;

function printTimetable() {
  const heading = $('ttHeading').textContent.trim();
  fillPrintLetterhead(ttMode === 'section' ? 'Section Timetable' : 'Faculty Load Timetable', heading);
  window.print();
}
window.printTimetable = printTimetable;

document.querySelectorAll('.timetable-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timetable-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ttMode = btn.dataset.ttMode;
    $('ttSectionGroup').classList.toggle('hidden', ttMode !== 'section');
    $('ttFacultyGroup').classList.toggle('hidden', ttMode !== 'faculty');
    renderTimetable();
  });
});

['ttSchoolYear', 'ttSemester', 'ttSection', 'ttFaculty'].forEach((id) => {
  $(id).addEventListener('change', renderTimetable);
});

/** Enables/disables and shows/hides one component's editable field block. Disabled fields are skipped by both native and custom form validation and left out of the save payload. */
function setComponentFieldsEnabled(component, enabled) {
  const wrap = $('componentFields_' + component);
  wrap.classList.toggle('hidden', !enabled);
  wrap.querySelectorAll('select, input').forEach((el) => { el.disabled = !enabled; });
  if (enabled) {
    // Re-apply the auto-computed End Time lock, which setComponentFieldsEnabled(true) above just cleared.
    $('endTime_' + component).disabled = $('scheduleDuration_' + component).value !== 'custom';
  }
}

function componentSummaryText(schedule) {
  if (!schedule) return '';
  const fac = state.faculty.find((f) => Number(f.id) === Number(schedule.faculty_id));
  const room = schedule.room_name || 'No room selected';
  return `${formatDayPattern(schedule.day_of_week)} ${schedule.start_time.slice(0, 5)}-${schedule.end_time.slice(0, 5)} \u00b7 ${room}` + (fac ? ` \u00b7 ${fac.faculty_name}` : '');
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
  const hasBadHours = COMPONENT_TYPES.some((c) => componentHoursInvalid[c]);
  submitBtn.disabled = hasConflict || hasBadHours;
  submitBtn.title = hasConflict
    ? 'Resolve the conflict(s) shown above before saving.'
    : (hasBadHours ? 'Fix the weekly-hours mismatch shown above before saving.' : '');
}

/**
 * Renders the Components panel: for the current Course, shows only the
 * required components (Lecture, and Laboratory when the course has lab
 * units), each either as a locked read-only summary (already saved -- click
 * Edit to change it) or as an open, editable field set (still needs to be
 * plotted, or was just unlocked for editing). Also updates the
 * "N of M components scheduled" status line.
 */
function updateComponentBlocks() {
  const course = getSelectedCourse();
  const sectionId = $('scheduleSection').value;
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

    const existing = findExistingComponentSchedule(course.id, sectionId, schoolYear, c);
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
  if (!course || !sectionId || !schoolYear) {
    statusEl.textContent = '\ud83d\udd12 Select a course, section, and school year first to see the required components.';
  } else if (requiredCount === 0) {
    statusEl.textContent = '\u26a0 This course has no lecture or laboratory units to plot.';
  } else {
    statusEl.textContent = (scheduledCount === requiredCount ? '\u2713 ' : '') + `${scheduledCount} of ${requiredCount} component${requiredCount === 1 ? '' : 's'} scheduled.`;
  }

  refreshSubmitButtonState();
}

/**
 * Finds the OTHER component's schedule (Lecture <-> Laboratory) already
 * plotted for the same course+section+school year, if any -- regardless of
 * whether Lecture or Laboratory was plotted first. Excludes the rows
 * currently unlocked for editing so a component doesn't "conflict with
 * itself". Mirrors the sibling lookup in api/schedules.php.
 */
function getSiblingScheduleForCourseSection(courseId, sectionId, schoolYear, ignoreIds = []) {
  if (!courseId || !sectionId || !schoolYear) return null;
  return state.schedules.find((s) =>
    Number(s.course_id) === Number(courseId) &&
    Number(s.section_id) === Number(sectionId) &&
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
  if (!course) {
    $('scheduleFaculty').innerHTML = '<option value="">Select course first</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Select a course first.';
    if (hint) hint.textContent = '\ud83d\udd12 Select a course first to choose an eligible faculty.';
    toggleFacultyLockBadge(false);
    return;
  }

  const qualifiedFaculty = getQualifiedFacultyForCourse(course.id);
  if (!qualifiedFaculty.length) {
    $('scheduleFaculty').innerHTML = '<option value="">No assigned faculty for this course</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Assign a faculty member to this course first (Faculty Course Assignments).';
    if (hint) hint.textContent = '\u26a0 No faculty assigned to this course yet -- add one in Faculty Course Assignments first.';
    toggleFacultyLockBadge(false);
    return;
  }

  // Auto-inherit the instructor from the course's other component (Lecture
  // or Laboratory) already plotted for this exact section + school year, so
  // the head never has to pick the same person twice and can't accidentally
  // assign the second component to someone else.
  const sectionId = $('scheduleSection').value;
  const schoolYear = $('scheduleSchoolYear').value;
  const sibling = getSiblingScheduleForCourseSection(course.id, sectionId, schoolYear, currentEditingScheduleIds());
  const inheritedFacultyId = sibling ? Number(sibling.faculty_id) : null;
  const inheritedIsQualified = inheritedFacultyId && qualifiedFaculty.some((f) => Number(f.id) === inheritedFacultyId);

  if (sibling && inheritedIsQualified) {
    fillSelect('scheduleFaculty', qualifiedFaculty, (f) => f.faculty_name + (Number(f.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'Select assigned faculty');
    $('scheduleFaculty').value = String(inheritedFacultyId);
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = `Instructor inherited from the existing ${course.course_code} schedule for this section -- Lecture and Laboratory must share the same instructor.`;
    const section = state.sections.find((s) => Number(s.id) === Number(sectionId));
    const sectionLabel = section ? `${section.program_code} ${section.year_level}-${section.section_no}` : 'this section';
    if (hint) hint.innerHTML = `\ud83d\udd12 Instructor inherited from existing <strong>${escapeHtml(course.course_code)}</strong> schedule for <strong>${escapeHtml(sectionLabel)}</strong> (${escapeHtml(sibling.component)}).`;
    toggleFacultyLockBadge(true);
    return;
  }

  const previousValue = $('scheduleFaculty').value;
  fillSelect('scheduleFaculty', qualifiedFaculty, (f) => f.faculty_name + (Number(f.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'Select assigned faculty');
  $('scheduleFaculty').disabled = false;
  $('scheduleFaculty').title = '';
  if (previousValue && qualifiedFaculty.some((f) => String(f.id) === previousValue)) {
    $('scheduleFaculty').value = previousValue;
  }
  toggleFacultyLockBadge(false);
  if (hint) hint.textContent = `\u2713 ${qualifiedFaculty.length} eligible faculty member${qualifiedFaculty.length === 1 ? '' : 's'} found.`;
}

function updateRoomOptions(component) {
  const editingId = existingComponentId(component);
  const editingRoomId = editingId ? Number((state.schedules.find((s) => Number(s.id) === editingId) || {}).room_id) : null;
  let roomsList = state.rooms.filter((r) => Number(r.is_active) === 1 || Number(r.id) === editingRoomId);

  if (component === 'lecture') roomsList = roomsList.filter((r) => r.room_type === 'lecture');
  if (component === 'laboratory') roomsList = roomsList.filter((r) => r.room_type === 'laboratory');

  fillSelect('scheduleRoom_' + component, roomsList, (r) => `${r.room_name} - ${r.room_type} (${r.capacity})` + (Number(r.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'No room selected');
}

const SET_TYPE_HINTS = {
  set_0: 'SET 0: 🏫 F2F every week (Week 1-4). Always face-to-face -- a room is required.',
  set_1: 'SET 1: 🏫 F2F Week 1 → 💻 Online Week 2 → 🏫 F2F Week 3 → 💻 Online Week 4 (repeats). Alternates week-to-week with SET 2 (won\'t conflict with it), but still conflicts with any lecture or minor-course schedule, since those meet every week.',
  set_2: 'SET 2: 💻 Online Week 1 → 🏫 F2F Week 2 → 💻 Online Week 3 → 🏫 F2F Week 4 (repeats). Alternates week-to-week with SET 1 (won\'t conflict with it), but still conflicts with any lecture or minor-course schedule, since those meet every week.',
};

const ROOM_HINTS = {
  set_0: 'SET 0 is always face-to-face, so a room is required.',
  set_1: 'Optional -- select the room used during this class\'s F2F weeks (Week 1, 3, ...).',
  set_2: 'Optional -- select the room used during this class\'s F2F weeks (Week 2, 4, ...).',
};

function updateRoomRequirement(component) {
  const setType = $('setType_' + component).value;
  const isSet0 = setType === 'set_0';
  $('roomRequiredMark_' + component).classList.toggle('hidden', !isSet0);
  $('roomRequiredHint_' + component).classList.remove('hidden');
  $('roomRequiredHint_' + component).textContent = ROOM_HINTS[setType] || '';
  $('scheduleRoom_' + component).required = isSet0;
  $('setTypeHint_' + component).textContent = SET_TYPE_HINTS[setType] || '';
}

function updateSectionOptions() {
  const course = getSelectedCourse();
  const yearLevel = $('scheduleYearLevel').value;
  const sectionSelect = $('scheduleSection');
  const editingSectionId = editing.schedules ? Number((state.schedules.find((s) => Number(s.id) === Number(editing.schedules)) || {}).section_id) : null;

  if (!course) {
    // Section still waits for a Course pick, but if a Year Level is already
    // chosen we can narrow the list that far ahead of time -- less
    // scrolling, and it can never show a mismatched year level.
    const sectionsSoFar = yearLevel
      ? state.sections.filter((s) => Number(s.year_level) === Number(yearLevel))
      : state.sections;
    fillSelect('scheduleSection', sectionsSoFar, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no} (${s.student_count})`);
    sectionSelect.disabled = false;
    sectionSelect.title = '';
    return;
  }

  // Only list sections that actually match the course's year level -- this
  // is the same "Year level mismatch" rule the backend/live-conflict check
  // already enforces, just applied earlier so the mismatch can't be picked
  // in the first place instead of surfacing as an error after the fact.
  // The section being edited stays selectable even if it no longer matches,
  // so an existing (already-saved) schedule doesn't silently disappear.
  const matchingSections = state.sections.filter(
    (s) => Number(s.year_level) === Number(course.year_level) || Number(s.id) === editingSectionId
  );

  if (!matchingSections.length) {
    sectionSelect.innerHTML = `<option value="">No Year ${course.year_level} sections available</option>`;
    sectionSelect.disabled = true;
    sectionSelect.title = `"${course.course_code}" is a Year ${course.year_level} course, but no Year ${course.year_level} sections exist yet.`;
    return;
  }

  fillSelect('scheduleSection', matchingSections, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no} (${s.student_count})`);
  sectionSelect.disabled = false;
  sectionSelect.title = '';
}

/* =====================================================
   LIVE CONFLICT PREVIEW (Plot Schedule form)
   Mirrors the backend's exact day-pattern overlap rule
   (schedule_days / schedules_share_day in api/schedules.php)
   so the preview and the final server validation agree.
   This is advisory only -- the backend remains the source
   of truth and re-validates everything on Save.
   ===================================================== */

// Legacy short codes, kept for backward compatibility with rows from before
// day_of_week became a flexible comma-separated day list. Mirrors
// schedule_days() in api/schedules.php.
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

/**
 * Mirrors is_minor_or_lecture() in api/schedules.php: lecture components
 * and non-alternating minor categories (GE/PATHFIT/NSTP/LuxMundi) are
 * exempt from SET1/SET2 alternation. Electives and "other" are NOT
 * included here -- some electives (e.g. the ESC series) have real
 * major-style lab components that genuinely alternate.
 */
const NON_ALTERNATING_MINOR_CATEGORIES = ['ge', 'pathfit', 'nstp', 'luxmundi'];

function isMinorOrLecture(component, category) {
  return component === 'lecture' || NON_ALTERNATING_MINOR_CATEGORIES.includes(category);
}

/**
 * Mirrors sets_conflict() in api/schedules.php: SET 0 always conflicts;
 * the same alternating set always conflicts; SET 1 + SET 2 alternate on
 * opposite weeks and do NOT conflict unless either side is a lecture
 * component or a minor course.
 */
function setsConflict(setA, setB, exemptA, exemptB) {
  if (setA === 'set_0' || setB === 'set_0') return true;
  if (setA === setB) return true;
  return exemptA || exemptB;
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

  // The computed end time should already exist as an option since durations
  // are multiples of 30 minutes matching the select's step, but add it
  // dynamically if it's ever missing (e.g. very late start times) so the
  // exact computed time is always selectable and correct.
  const hasOption = [...endTimeSelect.options].some((o) => o.value === targetStr);
  if (!hasOption) {
    const opt = document.createElement('option');
    opt.value = targetStr;
    opt.textContent = formatTimeLabel(targetMin);
    endTimeSelect.appendChild(opt);
  }
  endTimeSelect.value = targetStr;
}

function findScheduleConflicts(dayPattern, start, end, { sectionId, facultyId, roomId, ignoreId, setType, component, category, schoolYear, semesterType }) {
  if (!dayPattern || !start || !end) return [];
  const newIsExempt = isMinorOrLecture(component, category);
  const conflicts = [];
  for (const s of state.schedules) {
    if (ignoreId && Number(s.id) === Number(ignoreId)) continue;
    // Mirrors the backend: a class only conflicts within the same term
    // (same school year + same semester), not against every term ever plotted.
    if (schoolYear && s.school_year !== schoolYear) continue;
    if (semesterType && s.semester_type !== semesterType) continue;
    if (!daysOverlap(dayPattern, s.day_of_week)) continue;
    if (!timesOverlap(start, end, s.start_time.slice(0, 5), s.end_time.slice(0, 5))) continue;

    const rowIsExempt = isMinorOrLecture(s.component, s.category);
    if (!setsConflict(setType, s.set_type, newIsExempt, rowIsExempt)) continue;

    const timeLabel = `${formatDayPattern(s.day_of_week)} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`;
    if (facultyId && Number(s.faculty_id) === Number(facultyId)) {
      conflicts.push({ type: 'Instructor', name: s.faculty_name, timeLabel });
    }
    if (roomId && Number(s.room_id) === Number(roomId)) {
      conflicts.push({ type: 'Room', name: s.room_name, timeLabel });
    }
    if (sectionId && Number(s.section_id) === Number(sectionId)) {
      conflicts.push({ type: 'Section', name: `${s.program_code} ${s.year_level} - Section ${s.section_no}`, timeLabel });
    }
  }
  return conflicts;
}

function suggestAlternativeTimes(dayPattern, durationMin, ctx, maxSuggestions = 2, requestedStart = null) {
  if (!dayPattern || !durationMin) return [];

  // Build every open time slot in the day, then rank them by how close they
  // are to the time the user originally wanted -- scanning outward in BOTH
  // directions (earlier AND later) instead of only sweeping forward from
  // 7:00 AM. The old forward-only sweep stopped as soon as it found 2 free
  // slots, so if those happened to fall before the conflict it would never
  // even look at slots after it -- even when "after" was completely vacant.
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
  picked.sort((a, b) => a.mins - b.mins); // show left-to-right in chronological order
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
   WEEKLY HOURS VALIDATION (Plot Schedule form)
   School rule: 1 lecture unit = 1 hour of class time per week; 1 laboratory
   unit = 3 hours of class time per week (see README.md). Weekly hours are
   the selected Day Pattern's occurrences-per-week multiplied by the
   meeting duration -- e.g. 3 units, MWF x 1hr = 3 hrs/week, or TTH x 1.5hr
   = 3 hrs/week. The schedule must match the required weekly hours exactly,
   not merely meet or exceed them.
   ===================================================== */

/** Required weekly minutes for one component of a course, or null if that component isn't required (0 units) or no course is selected yet. Mirrors required_minutes() in api/schedules.php. */
function componentRequiredWeeklyMinutes(course, component) {
  if (!course) return null;
  if (component === 'laboratory') {
    const units = Number(course.lab_units);
    return units > 0 ? Math.round(units * 3 * 60) : null;
  }
  const units = Number(course.lec_units);
  return units > 0 ? Math.round(units * 60) : null;
}

/** Number of weekly meeting occurrences for a day pattern -- MWF=3, TTH/MW/TF=2, Saturday=1, a Custom selection = however many day checkboxes are currently checked (null if none). Mirrors schedule_days()/dayPatternOccurrences conventions already used for conflict detection. */
function dayPatternOccurrences(pattern) {
  if (!pattern) return null;
  const days = scheduleDaysFor(pattern);
  return days.length || null;
}

/** The component's actual scheduled weekly minutes given its current Day Pattern + Duration selection, or null if not enough is selected yet to compute it. */
function computeScheduledWeeklyMinutes(component) {
  const dayPattern = getEffectiveDayPattern(component);
  const occurrences = dayPatternOccurrences(dayPattern);
  const durationMin = getDurationMinutes(component);
  if (!occurrences || !durationMin) return null;
  return occurrences * durationMin;
}

function formatHours(totalMinutes) {
  const hrs = Math.round((totalMinutes / 60) * 100) / 100;
  return `${hrs} hour${hrs === 1 ? '' : 's'}`;
}

/**
 * Hides/disables the preset Day Pattern options (MWF/TTH/MW/TF/Saturday)
 * that CANNOT reach the course's required weekly hours with ANY of this
 * component's fixed (non-custom) Duration presets -- e.g. a 2-unit course
 * needs 40 min/meeting on MWF, which isn't a duration option, so MWF is
 * disabled for that course. "Custom Days" is always left available since
 * its occurrence count is chosen live via the day checkboxes, and "Custom"
 * duration is always left available as a manual escape hatch.
 */
function applyDayPatternFiltering(component) {
  const course = getSelectedCourse();
  const required = componentRequiredWeeklyMinutes(course, component);
  const daySelect = $('dayOfWeek_' + component);
  const durationPresets = [...$('scheduleDuration_' + component).options]
    .map((o) => o.value)
    .filter((v) => v !== 'custom')
    .map(Number);

  Array.from(daySelect.options).forEach((opt) => {
    if (opt.value === 'Custom') { opt.hidden = false; opt.disabled = false; opt.title = ''; return; }
    if (required == null) { opt.hidden = false; opt.disabled = false; opt.title = ''; return; }
    const occurrences = dayPatternOccurrences(opt.value);
    const fits = occurrences && durationPresets.some((mins) => mins * occurrences === required);
    opt.disabled = !fits;
    opt.hidden = !fits;
    opt.title = fits ? '' : `No duration option totals ${formatHours(required)}/week with this pattern.`;
  });
}

/**
 * Hides/disables the Duration options that don't total the course's
 * required weekly hours given the CURRENTLY selected Day Pattern -- e.g.
 * a 3-unit course on TTH only makes sense at 1.5 hours/meeting. "Custom"
 * duration is always left available as a manual escape hatch.
 */
function applyDurationFiltering(component) {
  const course = getSelectedCourse();
  const required = componentRequiredWeeklyMinutes(course, component);
  const dayPattern = getEffectiveDayPattern(component);
  const occurrences = dayPatternOccurrences(dayPattern);
  const durationSelect = $('scheduleDuration_' + component);

  Array.from(durationSelect.options).forEach((opt) => {
    if (opt.value === 'custom') { opt.hidden = false; opt.disabled = false; return; }
    if (required == null || !occurrences) { opt.hidden = false; opt.disabled = false; return; }
    const fits = Number(opt.value) * occurrences === required;
    opt.disabled = !fits;
    opt.hidden = !fits;
  });
}

/**
 * Fresh-start only: if filtering just made the currently selected Day
 * Pattern or Duration invalid, switch to the first still-valid option (or
 * "Custom" as a last resort). Deliberately NOT called when unlocking an
 * already-saved component for editing, so opening an existing (possibly
 * legacy) schedule never silently changes its values just from viewing it.
 */
function ensureValidComponentDefaults(component) {
  applyDayPatternFiltering(component);
  const daySelect = $('dayOfWeek_' + component);
  if (daySelect.options[daySelect.selectedIndex]?.disabled) {
    const firstValid = [...daySelect.options].find((o) => !o.disabled);
    if (firstValid) setDayPatternUI(component, firstValid.value);
  }

  applyDurationFiltering(component);
  const durationSelect = $('scheduleDuration_' + component);
  if (durationSelect.options[durationSelect.selectedIndex]?.disabled) {
    const firstValid = [...durationSelect.options].find((o) => !o.disabled);
    if (firstValid) durationSelect.value = firstValid.value;
  }
  updateEndTimeFromDuration(component);
}

/** Renders the "Required weekly hours / Scheduled weekly hours / Status" readout and updates componentHoursInvalid so an INVALID combination blocks Save, mirroring how componentHasConflict blocks it. */
function renderWeeklyHoursSummary(component) {
  const el = $('weeklyHoursSummary_' + component);
  if (!el) return;
  const course = getSelectedCourse();
  const required = componentRequiredWeeklyMinutes(course, component);

  if (required == null) {
    el.innerHTML = '';
    el.className = 'weekly-hours-summary';
    componentHoursInvalid[component] = false;
    return;
  }

  const scheduled = computeScheduledWeeklyMinutes(component);
  const isValid = scheduled != null && scheduled === required;
  componentHoursInvalid[component] = scheduled != null && !isValid;

  const stateClass = scheduled == null ? 'pending' : (isValid ? 'valid' : 'invalid');
  const statusIcon = scheduled == null ? 'fa-circle-question' : (isValid ? 'fa-circle-check' : 'fa-triangle-exclamation');
  const statusText = scheduled == null
    ? 'Set a day pattern and duration to check.'
    : (isValid
      ? `VALID - matches the required ${formatHours(required)}/week.`
      : `INVALID - course requires ${formatHours(required)}/week, but the selected schedule totals ${formatHours(scheduled)}/week.`);

  el.className = 'weekly-hours-summary ' + stateClass;
  el.innerHTML = `
    <div class="weekly-hours-rows">
      <div class="weekly-hours-row"><span>Required weekly hours:</span> <strong>${formatHours(required)}</strong></div>
      <div class="weekly-hours-row"><span>Scheduled weekly hours:</span> <strong>${scheduled == null ? '\u2013' : formatHours(scheduled)}</strong></div>
    </div>
    <div class="weekly-hours-status"><i class="fas ${statusIcon}"></i> ${escapeHtml(statusText)}</div>`;
}

/** Runs the full weekly-hours pipeline for one component: refresh which Day Pattern/Duration options make sense, show the Required/Scheduled/Status readout, and re-run the existing conflict check -- called from every place that used to just call checkLiveConflict(). */
function refreshWeeklyHoursUI(component, { autoCorrect = false } = {}) {
  if (autoCorrect) {
    ensureValidComponentDefaults(component);
  } else {
    applyDayPatternFiltering(component);
    applyDurationFiltering(component);
  }
  renderWeeklyHoursSummary(component);
  refreshSubmitButtonState();
  checkLiveConflict(component);
}

function checkLiveConflict(component) {
  const dayPattern = getEffectiveDayPattern(component);
  const start = $('startTime_' + component).value;
  const end = $('endTime_' + component).value;
  const course = getSelectedCourse();
  const ctx = {
    sectionId: $('scheduleSection').value,
    facultyId: $('scheduleFaculty').value,
    roomId: $('scheduleRoom_' + component).value,
    ignoreId: existingComponentId(component),
    setType: $('setType_' + component).value,
    component,
    category: (course || {}).category,
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
    if (scheduleFilters.section && String(s.section_id) !== scheduleFilters.section) return false;
    if (scheduleFilters.faculty && String(s.faculty_id) !== scheduleFilters.faculty) return false;
    return true;
  });
}

function renderTables() {
  renderDataTable('coursesTable', [
    { key: 'course_code', label: 'Code' },
    { key: 'course_title', label: 'Title' },
    { key: 'year_level', label: 'Year' },
    { key: 'semester_type', label: 'Semester' },
    { key: 'lec_units', label: 'Lec' },
    { key: 'lab_units', label: 'Lab' },
    { key: 'category', label: 'Category' },
  ], state.courses, {
    emptyIcon: 'fa-book',
    emptyMessage: 'No courses have been added yet.',
    rowActions: (c) => `<button class="btn btn-secondary btn-sm" onclick="editCourse(${c.id})" title="Edit" aria-label="Edit course"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('courses',${c.id})" title="Delete" aria-label="Delete course"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('sectionsTable', [
    { key: 'program_code', label: 'Program' },
    { key: 'year_level', label: 'Year' },
    { key: 'section_no', label: 'Section' },
    { key: 'student_count', label: 'Students' },
  ], state.sections, {
    emptyIcon: 'fa-layer-group',
    emptyMessage: 'No sections have been created yet.',
    rowActions: (s) => `<button class="btn btn-secondary btn-sm" onclick="editSection(${s.id})" title="Edit" aria-label="Edit section"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('sections',${s.id})" title="Delete" aria-label="Delete section"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('facultyTable', [
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'max_preparations', label: 'Max Preparations' },
    { key: 'is_active', label: 'Status', sortValue: (f) => Number(f.is_active), render: (f) => Number(f.is_active) === 1 ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Unavailable</span>' },
  ], state.faculty, {
    emptyIcon: 'fa-chalkboard-user',
    emptyMessage: 'No faculty members have been added yet.',
    rowActions: (f) => `<button class="btn btn-secondary btn-sm" onclick="editFaculty(${f.id})" title="Edit" aria-label="Edit faculty"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('faculty',${f.id})" title="Delete" aria-label="Delete faculty"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('roomsTable', [
    { key: 'room_name', label: 'Room' },
    { key: 'room_type', label: 'Type' },
    { key: 'capacity', label: 'Capacity' },
    { key: 'is_active', label: 'Status', sortValue: (r) => Number(r.is_active), render: (r) => Number(r.is_active) === 1 ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Unavailable</span>' },
  ], state.rooms, {
    emptyIcon: 'fa-door-open',
    emptyMessage: 'No rooms have been added yet.',
    rowActions: (r) => `<button class="btn btn-secondary btn-sm" onclick="editRoom(${r.id})" title="Edit" aria-label="Edit room"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('rooms',${r.id})" title="Delete" aria-label="Delete room"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('assignmentsTable', [
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'course_code', label: 'Course Code' },
    { key: 'course_title', label: 'Course Title' },
  ], state.assignments, {
    emptyIcon: 'fa-user-tie',
    emptyMessage: 'No faculty-course assignments yet.',
    rowActions: (a) => `<button class="btn btn-secondary btn-sm" onclick="editAssignment(${a.id})" title="Edit" aria-label="Edit assignment"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('assignments',${a.id})" title="Delete" aria-label="Delete assignment"><i class="fas fa-trash"></i></button>`,
  });

  renderSchedulesTable();
}

const SCHEDULES_TABLE_COLUMNS = [
  { key: 'school_year', label: 'SY' },
  { key: 'day_of_week', label: 'Day Pattern', render: (s) => escapeHtml(formatDayPattern(s.day_of_week)) },
  { key: 'start_time', label: 'Time', render: (s) => `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}` },
  { key: 'course_code', label: 'Course', searchValue: (s) => `${s.course_code} ${s.course_title}`, render: (s) => `${escapeHtml(s.course_code)}<br><small>${escapeHtml(s.course_title)}</small>` },
  { key: 'component', label: 'Component', render: (s) => `<span class="badge ${s.component === 'laboratory' ? 'lab' : 'lec'}">${escapeHtml(s.component)}</span>` },
  { key: 'section_no', label: 'Section', searchValue: (s) => `${s.program_code} ${s.year_level} ${s.section_no}`, render: (s) => `${escapeHtml(s.program_code)} ${s.year_level} - ${escapeHtml(s.section_no)}` },
  { key: 'faculty_name', label: 'Faculty' },
  { key: 'set_type', label: 'Set' },
  { key: 'room_name', label: 'Room', render: (s) => escapeHtml(s.room_name || 'No room selected') },
];

/**
 * allRows=true renders every filtered/sorted schedule row instead of just
 * the current pagination page -- used right before printing so the
 * printed report is never silently cut down to whatever page happened to
 * be showing on screen (see renderDataTable's `opts.allRows`).
 */
function renderSchedulesTable(allRows = false) {
  renderDataTable('schedulesTable', SCHEDULES_TABLE_COLUMNS, filteredSchedules(), {
    emptyIcon: 'fa-calendar-xmark',
    emptyMessage: 'No schedules generated yet.',
    allRows,
    rowActions: (s) => `<button class="btn btn-secondary btn-sm" onclick="editSchedule(${s.id})" title="Edit" aria-label="Edit schedule"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('schedules',${s.id})" title="Delete" aria-label="Delete schedule"><i class="fas fa-trash"></i></button>`,
  });
}

const CASCADE_FIELD = { faculty: 'faculty_id', courses: 'course_id', sections: 'section_id' };

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

function cancelEdit(entity) {
  editing[entity] = null;
  const cfg = formConfig[entity];
  $(cfg.submitBtnId).innerHTML = cfg.addLabel;
  // formSubmit() disables this button while a save is in flight; if we
  // don't re-enable it here, a successful Add leaves it stuck disabled
  // the next time the modal is opened.
  $(cfg.submitBtnId).disabled = false;
  if (cfg.cancelBtnId) $(cfg.cancelBtnId).classList.add('hidden');
  $(cfg.formId).reset();
  clearFormDirty(cfg.formId);
  clearValidationState(cfg.formId);
  if (cfg.modalTitleId) $(cfg.modalTitleId).textContent = cfg.addTitle;
  if (entity === 'schedules') {
    $('scheduleSchoolYear').value = suggestedSchoolYear();
    scheduleCourseCombobox.syncDisplay();
    scheduleCourseCombobox.updateAvailability();
    COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); });
    updateSectionOptions();
    updateComponentBlocks();
    updateFacultyOptions();
  }
  if (entity === 'assignments') {
    assignCourseCombobox.syncDisplay();
    assignCourseCombobox.updateAvailability();
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
  startEdit('courses', id);
}
window.editCourse = editCourse;

function editSection(id) {
  const s = state.sections.find((x) => Number(x.id) === id);
  if (!s) return;
  $('sectionYear').value = s.year_level;
  $('sectionNo').value = s.section_no;
  $('studentCount').value = s.student_count;
  startEdit('sections', id);
}
window.editSection = editSection;

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
  $('roomCapacity').value = r.capacity;
  $('roomActive').checked = Number(r.is_active) !== 0;
  startEdit('rooms', id);
}
window.editRoom = editRoom;

function editAssignment(id) {
  const a = state.assignments.find((x) => Number(x.id) === id);
  if (!a) return;
  $('assignFaculty').value = a.faculty_id;
  const course = state.courses.find((c) => Number(c.id) === Number(a.course_id));
  $('assignYearLevel').value = course ? course.year_level : '';
  assignCourseCombobox.updateAvailability();
  $('assignCourse').value = a.course_id;
  assignCourseCombobox.syncDisplay();
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

/** Resets one component's field block to its blank/default state -- used whenever the Course/Section/School Year selection changes, since a component that needs to be freshly created starts from scratch every time. */
function resetComponentFields(component) {
  $('setType_' + component).value = 'set_0';
  setDayPatternUI(component, 'MWF');
  $('scheduleDuration_' + component).value = component === 'laboratory' ? '180' : '60';
  $('notes_' + component).value = '';
  $('startTime_' + component).value = '';
  updateEndTimeFromDuration(component);
  updateRoomRequirement(component);
  $('conflictPreview_' + component).innerHTML = '';
  componentHasConflict[component] = false;
  $('weeklyHoursSummary_' + component).innerHTML = '';
  $('weeklyHoursSummary_' + component).className = 'weekly-hours-summary';
  componentHoursInvalid[component] = false;
}

/** Fills one component's field block with an already-saved schedule row's values, for when the scheduler clicks Edit on it. */
function prefillComponentFields(component, schedule) {
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

/** Unlocks an already-saved component's fields for editing (the "Edit" button on a locked/summary component block). */
function unlockComponentBlock(component) {
  componentUnlocked[component] = true;
  const course = getSelectedCourse();
  const sectionId = $('scheduleSection').value;
  const schoolYear = $('scheduleSchoolYear').value;
  const existing = course ? findExistingComponentSchedule(course.id, sectionId, schoolYear, component) : null;

  updateComponentBlocks();
  updateFacultyOptions();

  if (existing) {
    prefillComponentFields(component, existing);
    if (!$('scheduleFaculty').disabled) {
      const stillQualified = [...$('scheduleFaculty').options].some((o) => o.value === String(existing.faculty_id));
      if (stillQualified) $('scheduleFaculty').value = String(existing.faculty_id);
    }
    updateRoomOptions(component);
    $('scheduleRoom_' + component).value = existing.room_id || '';
    updateRoomRequirement(component);
    // autoCorrect stays false: this is an already-saved (possibly legacy)
    // schedule being opened for editing, so its Day Pattern/Duration must
    // never be silently changed just from viewing it -- only the summary
    // and conflict check refresh.
    refreshWeeklyHoursUI(component);
  }
  markFormDirty('scheduleForm');
  startEdit('schedules', editing.schedules || (existing ? existing.id : true));
}
window.unlockComponentBlock = unlockComponentBlock;

/**
 * Loads a whole subject offering (Course + Section + School Year) into the
 * Plot Schedule form for editing, unlocking the one component the scheduler
 * clicked Edit on from the Schedules table. Any sibling component keeps
 * showing as its locked, read-only summary unless it's separately unlocked.
 */
function editSchedule(id) {
  const s = state.schedules.find((x) => Number(x.id) === id);
  if (!s) return;
  editing.schedules = id; // UI flag only (Cancel button + "Update" label) -- the actual save always goes through the batched subject-offering endpoint
  $('scheduleSchoolYear').value = s.school_year;
  const course = state.courses.find((c) => Number(c.id) === Number(s.course_id));
  $('scheduleYearLevel').value = course ? course.year_level : '';
  scheduleCourseCombobox.updateAvailability();
  $('scheduleCourse').value = s.course_id;
  scheduleCourseCombobox.syncDisplay();
  updateSectionOptions();
  $('scheduleSection').value = s.section_id;
  COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); updateSetTypeOptions(c); });
  updateComponentBlocks();
  updateFacultyOptions();
  unlockComponentBlock(s.component);
  activateView('plotting');
  startEdit('schedules', id);
}
window.editSchedule = editSchedule;

/* =====================================================
   HASH-BASED ROUTING & STATE PRESERVATION
   The current view -- and, for Schedules, the active filters -- is
   mirrored into the URL hash (#schedules?sy=2026-2027&section=3) so a
   page refresh returns the user to where they were instead of resetting
   to the Dashboard, and Back/Forward moves between views as expected.
   ===================================================== */

function currentFiltersQueryString() {
  const params = new URLSearchParams();
  if (scheduleFilters.schoolYear) params.set('sy', scheduleFilters.schoolYear);
  if (scheduleFilters.year) params.set('year', scheduleFilters.year);
  if (scheduleFilters.semester) params.set('sem', scheduleFilters.semester);
  if (scheduleFilters.section) params.set('section', scheduleFilters.section);
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
  scheduleFilters.section = params.get('section') || '';
  scheduleFilters.faculty = params.get('faculty') || '';
  $('filterSchoolYear').value = scheduleFilters.schoolYear;
  $('filterYear').value = scheduleFilters.year;
  $('filterSemester').value = scheduleFilters.semester;
  $('filterFaculty').value = scheduleFilters.faculty;
  // Section's option list depends on Year Level -- refresh it against the
  // just-restored Year Level before selecting the restored Section.
  renderFilterOptions();
  $('filterSection').value = scheduleFilters.section;
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

document.querySelectorAll('[data-quick-open-modal]').forEach((btn) => btn.addEventListener('click', () => {
  const modalId = btn.dataset.quickOpenModal;
  const entity = Object.keys(formConfig).find((k) => formConfig[k].modalId === modalId);
  if (entity) openEntityModal(entity);
}));

/* Close modals via backdrop click or Escape key (guarded: confirms first
   if the form inside has unsaved edits) */
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (overlay.id === 'confirmOverlay') { closeConfirm(false); return; }
    if (overlay.id === 'modalInstructorConflict') { closeInstructorConflictModal(); return; }
    const entity = Object.keys(formConfig).find((k) => formConfig[k].modalId === overlay.id);
    if (entity) requestCloseEntityModal(entity);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('confirmOverlay').classList.contains('hidden')) { closeConfirm(false); return; }
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

  sectionYear: { required: true, numeric: true, min: 1, max: 4, label: 'Year level' },
  sectionNo: { required: true, label: 'Section number' },
  studentCount: { required: true, numeric: true, min: 1, max: 30, label: 'Student count', message: 'Student count must be between 1 and 30.' },

  facultyName: { required: true, minLength: 2, label: 'Faculty name' },
  maxPreparations: { required: true, numeric: true, min: 1, max: 20, label: 'Max preparations', message: 'Max preparations must be between 1 and 20.' },

  roomName: { required: true, label: 'Room name' },
  roomCapacity: { required: true, numeric: true, min: 1, label: 'Capacity', message: 'Room capacity must be a positive number.' },

  assignFaculty: { required: true, label: 'Faculty' },
  assignYearLevel: { required: true, label: 'Year level' },
  assignCourse: { required: true, label: 'Course' },

  scheduleSchoolYear: { required: true, pattern: /^\d{4}-\d{4}$/, label: 'School year', message: 'School year must be in the format YYYY-YYYY (e.g. 2026-2027).' },
  scheduleYearLevel: { required: true, label: 'Year level' },
  scheduleCourse: { required: true, label: 'Course' },
  scheduleSection: { required: true, label: 'Section' },
  scheduleFaculty: { required: true, label: 'Faculty' },
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
  courseForm: ['courseCode', 'courseTitle', 'courseYear', 'lecUnits', 'labUnits'],
  sectionForm: ['sectionYear', 'sectionNo', 'studentCount'],
  facultyForm: ['facultyName', 'maxPreparations'],
  roomForm: ['roomName', 'roomCapacity'],
  facultyCourseForm: ['assignFaculty', 'assignYearLevel', 'assignCourse'],
  scheduleForm: ['scheduleSchoolYear', 'scheduleYearLevel', 'scheduleCourse', 'scheduleSection', 'scheduleFaculty', 'startTime_lecture', 'endTime_lecture', 'startTime_laboratory', 'endTime_laboratory'],
};

function shakeEl(el) {
  el.classList.remove('shake');
  void el.offsetWidth; // restart the animation
  el.classList.add('shake');
}

/** Fields whose validation "source of truth" element (value + validationRules key) differs from the element the user actually sees/interacts with. Currently just the Course combobox: the value lives on the hidden <select id="scheduleCourse">, but the visible valid/invalid border, shake animation, and focus target belong on #scheduleCourseSearch instead. */
const FIELD_VISUAL_MIRROR = { scheduleCourse: 'scheduleCourseSearch', assignCourse: 'assignCourseSearch' };

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

  const mirrorEl = FIELD_VISUAL_MIRROR[id] ? $(FIELD_VISUAL_MIRROR[id]) : null;
  const shakeTarget = mirrorEl || el;
  const icon = document.getElementById(id + 'StatusIcon');
  const hint = document.getElementById(id + 'ValidationHint');
  const value = el.value;

  const setState = (state, message) => {
    el.classList.toggle('field-valid', state === 'valid');
    el.classList.toggle('field-invalid', state === 'invalid');
    if (mirrorEl) {
      mirrorEl.classList.toggle('field-valid', state === 'valid');
      mirrorEl.classList.toggle('field-invalid', state === 'invalid');
    }
    if (icon) {
      icon.classList.toggle('show', state !== 'neutral');
      icon.classList.toggle('valid', state === 'valid');
      icon.classList.toggle('invalid', state === 'invalid');
      icon.innerHTML = state === 'valid' ? ICON_VALID : state === 'invalid' ? ICON_INVALID : '';
    }
    if (hint) {
      // Only show the hint text for errors. A "Looks good!" message under
      // every filled field reads as noisy/unprofessional -- the green
      // checkmark icon already communicates success on its own.
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
      if (!opts.silent) shakeEl(shakeTarget);
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
  if (!ok && !opts.silent) shakeEl(shakeTarget);
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
    const mirrorEl = FIELD_VISUAL_MIRROR[id] ? $(FIELD_VISUAL_MIRROR[id]) : null;
    if (mirrorEl) mirrorEl.classList.remove('field-valid', 'field-invalid', 'shake');
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
    ids.forEach((id) => {
      const mirrorEl = FIELD_VISUAL_MIRROR[id] ? $(FIELD_VISUAL_MIRROR[id]) : null;
      const target = mirrorEl || $(id);
      if (target && target.classList.contains('field-invalid')) shakeEl(target);
    });
    if (firstInvalid) {
      const focusTarget = FIELD_VISUAL_MIRROR[firstInvalid] || firstInvalid;
      $(focusTarget).focus();
    }
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
      // cancelEdit()/closeEntityModal() already restore the button's label and
      // (for the schedule form) its conflict-aware disabled state on success.
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
 * Editing a course's units/year-level/semester after schedules already exist
 * for it doesn't retroactively re-check those schedules on the backend.
 * Per UX review, this now warns and asks for confirmation BEFORE saving
 * (not as a heads-up toast after the fact), so the institute head can back
 * out of the change instead of discovering the impact only afterward.
 */
async function confirmCourseEditImpact(editId, payload) {
  if (!editId) return true;
  const before = state.courses.find((c) => Number(c.id) === Number(editId));
  if (!before) return true;
  const changed = ['year_level', 'semester_type', 'lec_units', 'lab_units'].some((k) => String(before[k]) !== String(payload[k]));
  if (!changed) return true;
  const affected = state.schedules.filter((s) => Number(s.course_id) === Number(editId));
  if (!affected.length) return true;
  const message = `This course is already used in <strong>${affected.length}</strong> existing schedule${affected.length === 1 ? '' : 's'}. Changing units, year level, or semester will <strong>not</strong> automatically update those schedules -- you'll need to re-check them yourself afterward in the Schedules tab.`;
  return showConfirm(message, 'This Change Affects Existing Schedules', { confirmLabel: 'Update Anyway', confirmIcon: 'fa-check', danger: false });
}

/* =====================================================
   BULK CSV IMPORT (Courses / Sections)
   One shared modal + hidden <input type=file>, reused for both entities.
   Parsing and validation happen server-side (api/import.php) so quoted
   fields / embedded commas are handled correctly and the same business
   rules as the single-record forms apply per row.
   ===================================================== */

const IMPORT_CONFIG = {
  courses:  { title: 'Import Courses',  intro: 'Upload a CSV of courses. Required columns: course_code, course_title, year_level, semester_type. lec_units/lab_units are each optional individually, but at least one of the two must be greater than 0. Optional: category.', stateKey: 'courses' },
  sections: { title: 'Import Sections', intro: 'Upload a CSV of sections. Required columns: year_level, section_no. Optional: program_code (default BSCS), student_count (default 30).', stateKey: 'sections' },
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

formSubmit('courseForm', () => ({ course_code: $('courseCode').value, course_title: $('courseTitle').value, year_level: $('courseYear').value, semester_type: $('courseSemester').value, lec_units: $('lecUnits').value, lab_units: $('labUnits').value, category: $('category').value }), 'courses.php', 'courses', null, confirmCourseEditImpact);
formSubmit('sectionForm', () => ({ year_level: $('sectionYear').value, section_no: $('sectionNo').value, student_count: $('studentCount').value }), 'sections.php', 'sections');
formSubmit('facultyForm', () => ({ faculty_name: $('facultyName').value, max_preparations: $('maxPreparations').value, is_active: $('facultyActive').checked ? 1 : 0 }), 'faculty.php', 'faculty');
formSubmit('roomForm', () => ({ room_name: $('roomName').value, room_type: $('roomType').value, capacity: $('roomCapacity').value, is_active: $('roomActive').checked ? 1 : 0 }), 'rooms.php', 'rooms');
formSubmit('facultyCourseForm', () => ({ faculty_id: $('assignFaculty').value, course_id: $('assignCourse').value }), 'faculty_courses.php', 'assignments');
/**
 * Custom submit handler for the Subject Offering form (not the generic
 * formSubmit() helper, since one submit here can create/update up to two
 * schedule rows -- Lecture and Laboratory -- atomically in one request. Only
 * components that are currently unlocked/editable are included: an
 * already-saved, still-locked sibling component is left untouched
 * server-side and still counts toward the completeness check there.
 */
$('scheduleForm').addEventListener('submit', async (e) => {
  e.preventDefault();
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
    showToast('Nothing to save -- click Edit on a component above to change it.', 'warning');
    return;
  }

  const body = {
    school_year: $('scheduleSchoolYear').value,
    course_id: $('scheduleCourse').value,
    section_id: $('scheduleSection').value,
    faculty_id: $('scheduleFaculty').value,
    components: componentsPayload,
  };

  const submitBtn = $('scheduleSubmitBtn');
  const originalLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

  try {
    await request('schedules.php?mode=offering', { method: 'POST', body: JSON.stringify(body) });
    showToast('Subject offering saved successfully', 'success');
    cancelEdit('schedules');
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
});

function onCourseChange() {
  updateSectionOptions();
  onOfferingContextChange();
}

function onOfferingContextChange() {
  COMPONENT_TYPES.forEach((c) => { componentUnlocked[c] = false; resetComponentFields(c); updateSetTypeOptions(c); });
  updateComponentBlocks();
  updateFacultyOptions();
  // Fresh selections (new course/section/school year) -- safe to auto-pick
  // a valid Day Pattern/Duration default if the reset ones don't fit.
  COMPONENT_TYPES.forEach((c) => refreshWeeklyHoursUI(c, { autoCorrect: true }));
}

$('scheduleCourse').addEventListener('change', onCourseChange);
$('scheduleSection').addEventListener('change', onOfferingContextChange);
$('scheduleSchoolYear').addEventListener('change', onOfferingContextChange);
$('scheduleYearLevel').addEventListener('change', onYearLevelChange);
$('assignYearLevel').addEventListener('change', () => assignCourseCombobox.onYearLevelChanged());
// scheduleCourseCombobox / assignCourseCombobox already wired their own
// search-input focus/input/blur/keydown listeners when created above.

COMPONENT_TYPES.forEach((c) => {
  $('scheduleDuration_' + c).addEventListener('change', () => { updateEndTimeFromDuration(c); refreshWeeklyHoursUI(c); });
  $('startTime_' + c).addEventListener('change', () => { updateEndTimeFromDuration(c); refreshWeeklyHoursUI(c); });
  $('endTime_' + c).addEventListener('change', () => refreshWeeklyHoursUI(c));
  $('setType_' + c).addEventListener('change', () => { updateRoomRequirement(c); checkLiveConflict(c); });
  $('scheduleRoom_' + c).addEventListener('change', () => checkLiveConflict(c));
  $('dayOfWeek_' + c).addEventListener('change', () => {
    $('customDaysRow_' + c).classList.toggle('hidden', $('dayOfWeek_' + c).value !== 'Custom');
    // Day Pattern changed by the user directly -- re-filter Duration
    // against it, but never auto-correct Day Pattern itself here.
    applyDurationFiltering(c);
    const durationSelect = $('scheduleDuration_' + c);
    if (durationSelect.options[durationSelect.selectedIndex]?.disabled) {
      const firstValid = [...durationSelect.options].find((o) => !o.disabled);
      if (firstValid) { durationSelect.value = firstValid.value; updateEndTimeFromDuration(c); }
    }
    renderWeeklyHoursSummary(c);
    refreshSubmitButtonState();
    checkLiveConflict(c);
  });
  $('customDaysRow_' + c).querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => refreshWeeklyHoursUI(c));
  });
  updateRoomRequirement(c);
});

['filterSchoolYear', 'filterYear', 'filterSemester', 'filterSection', 'filterFaculty'].forEach((id) => {
  $(id).addEventListener('change', () => {
    if (id === 'filterYear') {
      // Section's own option list depends on Year Level -- refresh it (and
      // drop a now-invalid prior Section pick) before reading its value.
      renderFilterOptions();
    }
    scheduleFilters.schoolYear = $('filterSchoolYear').value;
    scheduleFilters.year = $('filterYear').value;
    scheduleFilters.semester = $('filterSemester').value;
    scheduleFilters.section = $('filterSection').value;
    scheduleFilters.faculty = $('filterFaculty').value;
    getTableState('schedulesTable').page = 1;
    renderTables();
    syncScheduleFiltersToHash();
  });
});

$('clearFiltersBtn').addEventListener('click', () => {
  $('filterSchoolYear').value = ''; $('filterYear').value = ''; $('filterSemester').value = ''; $('filterFaculty').value = '';
  renderFilterOptions(); // Year Level is now blank -- widen Section back to "All Sections"
  $('filterSection').value = '';
  scheduleFilters.schoolYear = ''; scheduleFilters.year = ''; scheduleFilters.semester = ''; scheduleFilters.section = ''; scheduleFilters.faculty = '';
  getTableState('schedulesTable').page = 1;
  renderTables();
  syncScheduleFiltersToHash();
});

/* Free-text search boxes for every table */
[
  ['coursesSearch', 'coursesTable'],
  ['sectionsSearch', 'sectionsTable'],
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
  Object.assign(state, { courses: [], sections: [], faculty: [], rooms: [], schedules: [], assignments: [] });
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
