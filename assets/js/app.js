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
  if (!json.success) throw new Error(json.message || 'Request failed');
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
  const pageRows = rows.slice((st.page - 1) * PAGE_SIZE, st.page * PAGE_SIZE);

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
    tbodyHtml = pageRows.map((row) => '<tr>' + columns.map((c) => `<td>${c.render ? c.render(row) : escapeHtml(row[c.key] ?? '')}</td>`).join('') + `<td><div class="table-actions">${opts.rowActions(row)}</div></td></tr>`).join('');
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

async function loadAll() {
  const [dashboard, courses, sections, faculty, rooms, schedules, assignments] = await Promise.all([
    request('dashboard.php'), request('courses.php'), request('sections.php'), request('faculty.php'), request('rooms.php'), request('schedules.php'), request('faculty_courses.php'),
  ]);
  Object.assign(state, { courses, sections, faculty, rooms, schedules, assignments });
  renderDashboard(dashboard);
  renderActivity();
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

function getSelectedCourse() {
  const courseId = Number($('scheduleCourse').value);
  return state.courses.find((c) => Number(c.id) === courseId) || null;
}

function getSelectedComponent() {
  return $('scheduleComponent').value;
}

function getQualifiedFacultyForCourse(courseId) {
  const assignedFacultyIds = state.assignments
    .filter((a) => Number(a.course_id) === Number(courseId))
    .map((a) => Number(a.faculty_id));
  const editingFacultyId = editing.schedules ? Number((state.schedules.find((s) => Number(s.id) === Number(editing.schedules)) || {}).faculty_id) : null;
  return state.faculty.filter((f) => assignedFacultyIds.includes(Number(f.id)) && (Number(f.is_active) === 1 || Number(f.id) === editingFacultyId));
}

function renderSelects() {
  fillCourseSelectGrouped('scheduleCourse', state.courses);
  fillCourseSelectGrouped('assignCourse', state.courses);
  fillSelect('assignFaculty', state.faculty, (f) => f.faculty_name);
  updateComponentOptions();
  updateFacultyOptions();
  updateRoomOptions();
  updateSectionOptions();
}

function renderFilterOptions() {
  const prevSection = $('filterSection').value;
  const prevFaculty = $('filterFaculty').value;
  const prevSchoolYear = $('filterSchoolYear').value;
  fillSelect('filterSection', state.sections, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no}`, 'id', 'All Sections');
  fillSelect('filterFaculty', state.faculty, (f) => f.faculty_name, 'id', 'All Faculty');
  const schoolYears = [...new Set(state.schedules.map((s) => s.school_year))].sort().reverse();
  $('filterSchoolYear').innerHTML = '<option value="">All School Years</option>' + schoolYears.map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  $('filterSection').value = prevSection;
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
  const prevSec = $('ttSection').value;
  const prevFac = $('ttFaculty').value;
  const schoolYears = [...new Set(state.schedules.map((s) => s.school_year))].sort().reverse();
  const fallbackYear = suggestedSchoolYear();
  $('ttSchoolYear').innerHTML = (schoolYears.length ? schoolYears : [fallbackYear]).map((sy) => `<option value="${escapeHtml(sy)}">${escapeHtml(sy)}</option>`).join('');
  if (schoolYears.includes(prevSY)) $('ttSchoolYear').value = prevSY;

  fillSelect('ttSection', state.sections, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no}`, 'id', 'Select a section');
  fillSelect('ttFaculty', state.faculty, (f) => f.faculty_name, 'id', 'Select a faculty');
  if (prevSec) $('ttSection').value = prevSec;
  if (prevFac) $('ttFaculty').value = prevFac;
}

function renderTimetable() {
  const schoolYear = $('ttSchoolYear').value;
  let filtered = state.schedules.filter((s) => s.school_year === schoolYear);
  let heading = '';

  if (ttMode === 'section') {
    const sectionId = $('ttSection').value;
    filtered = sectionId ? filtered.filter((s) => String(s.section_id) === sectionId) : [];
    const sec = state.sections.find((s) => String(s.id) === sectionId);
    heading = sec ? `${escapeHtml(sec.program_code)} ${sec.year_level} - Section ${escapeHtml(sec.section_no)} &nbsp;|&nbsp; SY ${escapeHtml(schoolYear)}` : 'Select a section above to view its timetable.';
    $('ttSummaryCard').classList.add('hidden');
  } else {
    const facultyId = $('ttFaculty').value;
    filtered = facultyId ? filtered.filter((s) => String(s.faculty_id) === facultyId) : [];
    const fac = state.faculty.find((f) => String(f.id) === facultyId);
    heading = fac ? `${escapeHtml(fac.faculty_name)} &nbsp;|&nbsp; SY ${escapeHtml(schoolYear)}` : 'Select a faculty above to view their load.';
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

['ttSchoolYear', 'ttSection', 'ttFaculty'].forEach((id) => {
  $(id).addEventListener('change', renderTimetable);
});

function updateComponentOptions() {
  const course = getSelectedCourse();
  const componentSelect = $('scheduleComponent');
  const hint = $('componentHint');

  if (!course) {
    componentSelect.innerHTML = '<option value="">Select course first</option>';
    componentSelect.disabled = true;
    componentSelect.title = 'Select a course first.';
    if (hint) hint.textContent = '🔒 Select a course first to see its lecture/laboratory components.';
    return;
  }

  const options = [];
  if (Number(course.lec_units) > 0) options.push('<option value="lecture">Lecture</option>');
  if (Number(course.lab_units) > 0) options.push('<option value="laboratory">Laboratory</option>');

  componentSelect.innerHTML = options.length
    ? options.join('')
    : '<option value="">No plottable component</option>';
  componentSelect.disabled = !options.length;
  componentSelect.title = options.length ? '' : 'This course has no lecture or laboratory units to plot.';
  if (hint) {
    hint.textContent = options.length
      ? `✓ ${options.length} component${options.length === 1 ? '' : 's'} available for this course.`
      : '⚠ This course has no lecture or laboratory units to plot.';
  }
}

function updateFacultyOptions() {
  const course = getSelectedCourse();
  const hint = $('facultyHint');
  if (!course) {
    $('scheduleFaculty').innerHTML = '<option value="">Select course first</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Select a course first.';
    if (hint) hint.textContent = '🔒 Select a course first to choose an eligible faculty.';
    return;
  }

  const qualifiedFaculty = getQualifiedFacultyForCourse(course.id);
  if (!qualifiedFaculty.length) {
    $('scheduleFaculty').innerHTML = '<option value="">No assigned faculty for this course</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Assign a faculty member to this course first (Faculty Course Assignments).';
    if (hint) hint.textContent = '⚠ No faculty assigned to this course yet -- add one in Faculty Course Assignments first.';
    return;
  }

  fillSelect('scheduleFaculty', qualifiedFaculty, (f) => f.faculty_name + (Number(f.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'Select assigned faculty');
  $('scheduleFaculty').disabled = false;
  $('scheduleFaculty').title = '';
  if (hint) hint.textContent = `✓ ${qualifiedFaculty.length} eligible faculty member${qualifiedFaculty.length === 1 ? '' : 's'} found.`;
}

function updateRoomOptions() {
  const component = getSelectedComponent();
  const editingRoomId = editing.schedules ? Number((state.schedules.find((s) => Number(s.id) === Number(editing.schedules)) || {}).room_id) : null;
  let roomsList = state.rooms.filter((r) => Number(r.is_active) === 1 || Number(r.id) === editingRoomId);

  if (component === 'lecture') roomsList = roomsList.filter((r) => r.room_type === 'lecture');
  if (component === 'laboratory') roomsList = roomsList.filter((r) => r.room_type === 'laboratory');

  fillSelect('scheduleRoom', roomsList, (r) => `${r.room_name} - ${r.room_type} (${r.capacity})` + (Number(r.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'No room / hybrid');
}

const SET_TYPE_HINTS = {
  set_0: 'Always face-to-face, every week -- a room is required.',
  set_1: 'Hybrid Rotation A. Alternates week-to-week with Rotation B labs of major courses (won\'t conflict with those), but still conflicts with any lecture or minor-course schedule, since those meet every week.',
  set_2: 'Hybrid Rotation B. Alternates week-to-week with Rotation A labs of major courses (won\'t conflict with those), but still conflicts with any lecture or minor-course schedule, since those meet every week.',
};

function updateRoomRequirement() {
  const isSet0 = $('setType').value === 'set_0';
  $('roomRequiredMark').classList.toggle('hidden', !isSet0);
  $('roomRequiredHint').classList.toggle('hidden', !isSet0);
  $('scheduleRoom').required = isSet0;
  $('setTypeHint').textContent = SET_TYPE_HINTS[$('setType').value] || '';
}

function updateSectionOptions() {
  const course = getSelectedCourse();
  const sectionSelect = $('scheduleSection');
  const editingSectionId = editing.schedules ? Number((state.schedules.find((s) => Number(s.id) === Number(editing.schedules)) || {}).section_id) : null;

  if (!course) {
    fillSelect('scheduleSection', state.sections, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no} (${s.student_count})`);
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
 * Mirrors is_minor_or_lecture() in api/schedules.php.
 */
function isMinorOrLecture(component, category) {
  return component === 'lecture' || category !== 'major';
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

function getDurationMinutes() {
  const val = $('scheduleDuration').value;
  if (val === 'custom') {
    const s = $('startTime').value;
    const e = $('endTime').value;
    if (!s || !e) return null;
    const diff = timeStrToMinutes(e) - timeStrToMinutes(s);
    return diff > 0 ? diff : null;
  }
  return Number(val);
}

function updateEndTimeFromDuration() {
  const durationVal = $('scheduleDuration').value;
  const endTimeSelect = $('endTime');
  const autoTag = $('endTimeAutoTag');
  $('customDurationHint').classList.toggle('hidden', durationVal !== 'custom');

  if (durationVal === 'custom') {
    endTimeSelect.disabled = false;
    autoTag.classList.add('hidden');
    return;
  }

  endTimeSelect.disabled = true;
  autoTag.classList.remove('hidden');
  const start = $('startTime').value;
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

function renderConflictPreview(conflicts, suggestions) {
  const el = $('conflictPreview');
  const submitBtn = $('scheduleSubmitBtn');

  if (conflicts === null) {
    el.innerHTML = '';
    submitBtn.disabled = false;
    return;
  }

  if (!conflicts.length) {
    el.innerHTML = '<div class="preview-status available"><i class="fas fa-circle-check"></i> Available - no conflicts detected</div>';
    submitBtn.disabled = false;
    return;
  }

  submitBtn.disabled = true;
  const listHtml = conflicts.map((c) => `<div class="preview-conflict-item"><i class="fas fa-circle-exclamation"></i> <strong>${escapeHtml(c.type)} conflict:</strong>&nbsp;${escapeHtml(c.name)} (${escapeHtml(c.timeLabel)})</div>`).join('');
  const suggestionsHtml = suggestions.length
    ? `<div class="preview-suggestions"><span class="suggestion-label">Suggested:</span> ${suggestions.map((s) => `<button type="button" class="suggestion-chip" onclick="applySuggestedTime('${s.start}','${s.end}')"><i class="fas fa-check"></i> ${s.start}-${s.end}</button>`).join(' ')}</div>`
    : '';

  el.innerHTML = `<div class="preview-status conflict"><i class="fas fa-circle-exclamation"></i> Conflict Detected</div><div class="preview-conflict-list">${listHtml}</div>${suggestionsHtml}`;
}

function getEffectiveDayPattern() {
  const preset = $('dayOfWeek').value;
  if (preset !== 'Custom') return preset;
  const checked = [...document.querySelectorAll('#customDaysRow input[type="checkbox"]:checked')].map((cb) => cb.value);
  return checked.join(',');
}

function checkLiveConflict() {
  const dayPattern = getEffectiveDayPattern();
  const start = $('startTime').value;
  const end = $('endTime').value;
  const ctx = {
    sectionId: $('scheduleSection').value,
    facultyId: $('scheduleFaculty').value,
    roomId: $('scheduleRoom').value,
    ignoreId: editing.schedules,
    setType: $('setType').value,
    component: $('scheduleComponent').value,
    category: (getSelectedCourse() || {}).category,
    schoolYear: $('scheduleSchoolYear').value,
    semesterType: (getSelectedCourse() || {}).semester_type,
  };

  if (!dayPattern || !start || !end) {
    renderConflictPreview(null);
    return;
  }

  const conflicts = findScheduleConflicts(dayPattern, start, end, ctx);
  const suggestions = conflicts.length ? suggestAlternativeTimes(dayPattern, getDurationMinutes(), ctx, 2, start) : [];
  renderConflictPreview(conflicts, suggestions);
}

function applySuggestedTime(start, end) {
  $('startTime').value = start;
  if ($('scheduleDuration').value === 'custom') {
    $('endTime').value = end;
  } else {
    updateEndTimeFromDuration();
  }
  checkLiveConflict();
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

  renderDataTable('schedulesTable', [
    { key: 'school_year', label: 'SY' },
    { key: 'day_of_week', label: 'Day Pattern', render: (s) => escapeHtml(formatDayPattern(s.day_of_week)) },
    { key: 'start_time', label: 'Time', render: (s) => `${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}` },
    { key: 'course_code', label: 'Course', searchValue: (s) => `${s.course_code} ${s.course_title}`, render: (s) => `${escapeHtml(s.course_code)}<br><small>${escapeHtml(s.course_title)}</small>` },
    { key: 'component', label: 'Component', render: (s) => `<span class="badge ${s.component === 'laboratory' ? 'lab' : 'lec'}">${escapeHtml(s.component)}</span>` },
    { key: 'section_no', label: 'Section', searchValue: (s) => `${s.program_code} ${s.year_level} ${s.section_no}`, render: (s) => `${escapeHtml(s.program_code)} ${s.year_level} - ${escapeHtml(s.section_no)}` },
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'set_type', label: 'Set' },
    { key: 'room_name', label: 'Room', render: (s) => escapeHtml(s.room_name || 'No room / Hybrid') },
  ], filteredSchedules(), {
    emptyIcon: 'fa-calendar-xmark',
    emptyMessage: 'No schedules generated yet.',
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
    $('scheduleDuration').value = '60';
    $('customDaysRow').classList.add('hidden');
    updateComponentOptions(); updateFacultyOptions(); updateRoomOptions();
    updateRoomRequirement();
    updateEndTimeFromDuration();
    checkLiveConflict();
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
  $('assignCourse').value = a.course_id;
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

function setDayPatternUI(dayOfWeek) {
  if (DAY_PRESET_VALUES.includes(dayOfWeek)) {
    $('dayOfWeek').value = dayOfWeek;
    $('customDaysRow').classList.add('hidden');
    document.querySelectorAll('#customDaysRow input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
    return;
  }
  $('dayOfWeek').value = 'Custom';
  $('customDaysRow').classList.remove('hidden');
  const days = scheduleDaysFor(dayOfWeek);
  document.querySelectorAll('#customDaysRow input[type="checkbox"]').forEach((cb) => {
    cb.checked = days.includes(cb.value);
  });
}

function editSchedule(id) {
  const s = state.schedules.find((x) => Number(x.id) === id);
  if (!s) return;
  editing.schedules = id; // set before updateSectionOptions() so it keeps this schedule's section selectable even if it no longer matches the course's year level
  $('scheduleSchoolYear').value = s.school_year;
  $('scheduleCourse').value = s.course_id;
  updateComponentOptions();
  updateFacultyOptions();
  $('scheduleComponent').value = s.component;
  updateRoomOptions();
  updateSectionOptions();
  $('scheduleSection').value = s.section_id;
  $('scheduleFaculty').value = s.faculty_id;
  $('scheduleRoom').value = s.room_id || '';
  $('setType').value = s.set_type;
  updateRoomRequirement();
  setDayPatternUI(s.day_of_week);
  $('scheduleDuration').value = 'custom';
  updateEndTimeFromDuration();
  const startVal = s.start_time.slice(0, 5);
  const endVal = s.end_time.slice(0, 5);
  ensureTimeOption('startTime', startVal);
  ensureTimeOption('endTime', endVal);
  $('startTime').value = startVal;
  $('endTime').value = endVal;
  $('notes').value = s.notes || '';
  checkLiveConflict();
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
  $('filterSection').value = scheduleFilters.section;
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
    const entity = Object.keys(formConfig).find((k) => formConfig[k].modalId === overlay.id);
    if (entity) requestCloseEntityModal(entity);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('confirmOverlay').classList.contains('hidden')) { closeConfirm(false); return; }
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
  assignCourse: { required: true, label: 'Course' },

  scheduleSchoolYear: { required: true, pattern: /^\d{4}-\d{4}$/, label: 'School year', message: 'School year must be in the format YYYY-YYYY (e.g. 2026-2027).' },
  scheduleCourse: { required: true, label: 'Course' },
  scheduleSection: { required: true, label: 'Section' },
  scheduleFaculty: { required: true, label: 'Faculty' },
  startTime: { required: true, label: 'Start time' },
  endTime: { required: true, label: 'End time' },
};

// Which fields belong to which <form>, for "validate everything and show
// the summary" on submit.
const formFieldMap = {
  loginForm: ['loginUsername', 'loginPassword'],
  courseForm: ['courseCode', 'courseTitle', 'courseYear', 'lecUnits', 'labUnits'],
  sectionForm: ['sectionYear', 'sectionNo', 'studentCount'],
  facultyForm: ['facultyName', 'maxPreparations'],
  roomForm: ['roomName', 'roomCapacity'],
  facultyCourseForm: ['assignFaculty', 'assignCourse'],
  scheduleForm: ['scheduleSchoolYear', 'scheduleCourse', 'scheduleSection', 'scheduleFaculty', 'startTime', 'endTime'],
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
      // cancelEdit()/closeEntityModal() already restore the button's label and
      // (for the schedule form) its conflict-aware disabled state on success.
    } catch (err) {
      showToast(err.message, 'error');
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
  courses:  { title: 'Import Courses',  intro: 'Upload a CSV of courses. Required columns: course_code, course_title, year_level, semester_type. Optional: lec_units, lab_units, category.', stateKey: 'courses' },
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
formSubmit('scheduleForm', () => ({ school_year: $('scheduleSchoolYear').value, course_id: $('scheduleCourse').value, component: $('scheduleComponent').value, section_id: $('scheduleSection').value, faculty_id: $('scheduleFaculty').value, room_id: $('scheduleRoom').value, set_type: $('setType').value, day_of_week: getEffectiveDayPattern(), start_time: $('startTime').value, end_time: $('endTime').value, notes: $('notes').value }), 'schedules.php', 'schedules');

$('scheduleCourse').addEventListener('change', () => {
  updateComponentOptions();
  updateFacultyOptions();
  updateRoomOptions();
  updateSectionOptions();
  checkLiveConflict();
});

$('scheduleComponent').addEventListener('change', () => {
  updateRoomOptions();
  checkLiveConflict();
});

$('scheduleDuration').addEventListener('change', () => {
  updateEndTimeFromDuration();
  checkLiveConflict();
});

$('startTime').addEventListener('change', () => {
  updateEndTimeFromDuration();
  checkLiveConflict();
});

$('endTime').addEventListener('change', checkLiveConflict);

$('setType').addEventListener('change', updateRoomRequirement);
updateRoomRequirement();

['scheduleSection', 'scheduleFaculty', 'scheduleRoom', 'dayOfWeek', 'setType', 'scheduleSchoolYear'].forEach((id) => {
  $(id).addEventListener('change', checkLiveConflict);
});

['filterSchoolYear', 'filterYear', 'filterSemester', 'filterSection', 'filterFaculty'].forEach((id) => {
  $(id).addEventListener('change', () => {
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
  $('filterSchoolYear').value = ''; $('filterYear').value = ''; $('filterSemester').value = ''; $('filterSection').value = ''; $('filterFaculty').value = '';
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
populateTimeSelect('startTime', { startHour: 6, endHour: 21 });
populateTimeSelect('endTime', { startHour: 6, endHour: 21 });

$('dayOfWeek').addEventListener('change', () => {
  $('customDaysRow').classList.toggle('hidden', $('dayOfWeek').value !== 'Custom');
});

document.querySelectorAll('#customDaysRow input[type="checkbox"]').forEach((cb) => {
  cb.addEventListener('change', checkLiveConflict);
});

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
