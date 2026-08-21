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
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fas ${icons[type] || icons.info} toast-icon"></i><div class="toast-msg">${escapeHtml(message)}</div><button class="toast-close" type="button" aria-label="Dismiss"><i class="fas fa-xmark"></i></button>`;
  const remove = () => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  container.appendChild(toast);
  setTimeout(remove, 4500);
}

/* Kept for internal fallback use; toasts are the primary feedback mechanism now. */
function alertBox(message, type = 'success') {
  showToast(message, type === 'error' ? 'error' : 'success');
}

/* =====================================================
   CONFIRM DIALOG (replaces window.confirm)
   ===================================================== */

let confirmResolver = null;

function showConfirm(message, title = 'Confirm Deletion') {
  $('confirmTitle').textContent = title;
  $('confirmMessage').innerHTML = message;
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
  fillSelect('scheduleSection', state.sections, (s) => `${s.program_code} ${s.year_level} - Section ${s.section_no} (${s.student_count})`);
  fillSelect('assignFaculty', state.faculty, (f) => f.faculty_name);
  updateComponentOptions();
  updateFacultyOptions();
  updateRoomOptions();
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

  if (!course) {
    componentSelect.innerHTML = '<option value="">Select course first</option>';
    componentSelect.disabled = true;
    componentSelect.title = 'Select a course first.';
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
}

function updateFacultyOptions() {
  const course = getSelectedCourse();
  if (!course) {
    $('scheduleFaculty').innerHTML = '<option value="">Select course first</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Select a course first.';
    return;
  }

  const qualifiedFaculty = getQualifiedFacultyForCourse(course.id);
  if (!qualifiedFaculty.length) {
    $('scheduleFaculty').innerHTML = '<option value="">No assigned faculty for this course</option>';
    $('scheduleFaculty').disabled = true;
    $('scheduleFaculty').title = 'Assign a faculty member to this course first (Faculty Course Assignments).';
    return;
  }

  fillSelect('scheduleFaculty', qualifiedFaculty, (f) => f.faculty_name + (Number(f.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'Select assigned faculty');
  $('scheduleFaculty').disabled = false;
  $('scheduleFaculty').title = '';
}

function updateRoomOptions() {
  const component = getSelectedComponent();
  const editingRoomId = editing.schedules ? Number((state.schedules.find((s) => Number(s.id) === Number(editing.schedules)) || {}).room_id) : null;
  let roomsList = state.rooms.filter((r) => Number(r.is_active) === 1 || Number(r.id) === editingRoomId);

  if (component === 'lecture') roomsList = roomsList.filter((r) => r.room_type === 'lecture');
  if (component === 'laboratory') roomsList = roomsList.filter((r) => r.room_type === 'laboratory');

  fillSelect('scheduleRoom', roomsList, (r) => `${r.room_name} - ${r.room_type} (${r.capacity})` + (Number(r.is_active) === 0 ? ' (Inactive)' : ''), 'id', 'No room / hybrid');
}

function updateRoomRequirement() {
  const isSet0 = $('setType').value === 'set_0';
  $('roomRequiredMark').classList.toggle('hidden', !isSet0);
  $('roomRequiredHint').classList.toggle('hidden', !isSet0);
  $('scheduleRoom').required = isSet0;
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

function suggestAlternativeTimes(dayPattern, durationMin, ctx, maxSuggestions = 2) {
  if (!dayPattern || !durationMin) return [];
  const suggestions = [];
  for (let mins = 7 * 60; mins + durationMin <= 19 * 60; mins += 30) {
    const startStr = minutesToTimeStr(mins);
    const endStr = minutesToTimeStr(mins + durationMin);
    const conflicts = findScheduleConflicts(dayPattern, startStr, endStr, ctx);
    if (!conflicts.length) {
      suggestions.push({ start: startStr, end: endStr });
      if (suggestions.length >= maxSuggestions) break;
    }
  }
  return suggestions;
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
  const suggestions = conflicts.length ? suggestAlternativeTimes(dayPattern, getDurationMinutes(), ctx) : [];
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
    rowActions: (c) => `<button class="btn btn-secondary btn-sm" onclick="editCourse(${c.id})" title="Edit"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('courses',${c.id})" title="Delete"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('sectionsTable', [
    { key: 'program_code', label: 'Program' },
    { key: 'year_level', label: 'Year' },
    { key: 'section_no', label: 'Section' },
    { key: 'student_count', label: 'Students' },
  ], state.sections, {
    emptyIcon: 'fa-layer-group',
    emptyMessage: 'No sections have been created yet.',
    rowActions: (s) => `<button class="btn btn-secondary btn-sm" onclick="editSection(${s.id})" title="Edit"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('sections',${s.id})" title="Delete"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('facultyTable', [
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'max_preparations', label: 'Max Preparations' },
    { key: 'is_active', label: 'Status', sortValue: (f) => Number(f.is_active), render: (f) => Number(f.is_active) === 1 ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Unavailable</span>' },
  ], state.faculty, {
    emptyIcon: 'fa-chalkboard-user',
    emptyMessage: 'No faculty members have been added yet.',
    rowActions: (f) => `<button class="btn btn-secondary btn-sm" onclick="editFaculty(${f.id})" title="Edit"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('faculty',${f.id})" title="Delete"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('roomsTable', [
    { key: 'room_name', label: 'Room' },
    { key: 'room_type', label: 'Type' },
    { key: 'capacity', label: 'Capacity' },
    { key: 'is_active', label: 'Status', sortValue: (r) => Number(r.is_active), render: (r) => Number(r.is_active) === 1 ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Unavailable</span>' },
  ], state.rooms, {
    emptyIcon: 'fa-door-open',
    emptyMessage: 'No rooms have been added yet.',
    rowActions: (r) => `<button class="btn btn-secondary btn-sm" onclick="editRoom(${r.id})" title="Edit"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('rooms',${r.id})" title="Delete"><i class="fas fa-trash"></i></button>`,
  });

  renderDataTable('assignmentsTable', [
    { key: 'faculty_name', label: 'Faculty' },
    { key: 'course_code', label: 'Course Code' },
    { key: 'course_title', label: 'Course Title' },
  ], state.assignments, {
    emptyIcon: 'fa-user-tie',
    emptyMessage: 'No faculty-course assignments yet.',
    rowActions: (a) => `<button class="btn btn-secondary btn-sm" onclick="editAssignment(${a.id})" title="Edit"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('assignments',${a.id})" title="Delete"><i class="fas fa-trash"></i></button>`,
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
    rowActions: (s) => `<button class="btn btn-secondary btn-sm" onclick="editSchedule(${s.id})" title="Edit"><i class="fas fa-pen"></i></button> <button class="btn btn-danger btn-sm" onclick="del('schedules',${s.id})" title="Delete"><i class="fas fa-trash"></i></button>`,
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
  if (cfg.cancelBtnId) $(cfg.cancelBtnId).classList.add('hidden');
  $(cfg.formId).reset();
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
  $('scheduleSchoolYear').value = s.school_year;
  $('scheduleCourse').value = s.course_id;
  updateComponentOptions();
  updateFacultyOptions();
  $('scheduleComponent').value = s.component;
  updateRoomOptions();
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

document.querySelectorAll('.nav-item').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav-item,.view').forEach((el) => el.classList.remove('active'));
  btn.classList.add('active'); $(btn.dataset.view).classList.add('active');
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('show');
}));

document.querySelectorAll('[data-quick-nav]').forEach((btn) => btn.addEventListener('click', () => {
  const view = btn.dataset.quickNav;
  document.querySelectorAll('.nav-item,.view').forEach((el) => el.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');
  $(view).classList.add('active');
}));

document.querySelectorAll('[data-quick-open-modal]').forEach((btn) => btn.addEventListener('click', () => {
  const modalId = btn.dataset.quickOpenModal;
  const entity = Object.keys(formConfig).find((k) => formConfig[k].modalId === modalId);
  if (entity) openEntityModal(entity);
}));

/* Close modals via backdrop click or Escape key */
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (overlay.id === 'confirmOverlay') { closeConfirm(false); return; }
    const entity = Object.keys(formConfig).find((k) => formConfig[k].modalId === overlay.id);
    if (entity) closeEntityModal(entity);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('confirmOverlay').classList.contains('hidden')) { closeConfirm(false); return; }
  Object.keys(formConfig).forEach((entity) => {
    const cfg = formConfig[entity];
    if (cfg.modalId && !$(cfg.modalId).classList.contains('hidden')) closeEntityModal(entity);
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

function formSubmit(id, build, endpoint, entity, onSuccess) {
  $(id).addEventListener('submit', async (e) => {
    e.preventDefault();
    const cfg = formConfig[entity];
    const submitBtn = cfg ? $(cfg.submitBtnId) : e.target.querySelector('[type="submit"]');
    const originalLabel = submitBtn ? submitBtn.innerHTML : null;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    try {
      const payload = build();
      const editId = editing[entity];
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
 * for it doesn't retroactively re-check those schedules on the backend --
 * this gives the institute head a heads-up so they know to go re-check them.
 */
function warnAffectedSchedulesForCourseEdit(editId, payload) {
  if (!editId) return;
  const before = state.courses.find((c) => Number(c.id) === Number(editId));
  if (!before) return;
  const changed = ['year_level', 'semester_type', 'lec_units', 'lab_units'].some((k) => String(before[k]) !== String(payload[k]));
  if (!changed) return;
  const affected = state.schedules.filter((s) => Number(s.course_id) === Number(editId));
  if (!affected.length) return;
  setTimeout(() => showToast(`Heads up: ${affected.length} existing schedule(s) use this course. They were NOT auto-adjusted -- please re-check them in the Schedules tab against the updated units/year/semester.`, 'warning'), 300);
}

formSubmit('courseForm', () => ({ course_code: $('courseCode').value, course_title: $('courseTitle').value, year_level: $('courseYear').value, semester_type: $('courseSemester').value, lec_units: $('lecUnits').value, lab_units: $('labUnits').value, category: $('category').value }), 'courses.php', 'courses', warnAffectedSchedulesForCourseEdit);
formSubmit('sectionForm', () => ({ year_level: $('sectionYear').value, section_no: $('sectionNo').value, student_count: $('studentCount').value }), 'sections.php', 'sections');
formSubmit('facultyForm', () => ({ faculty_name: $('facultyName').value, max_preparations: $('maxPreparations').value, is_active: $('facultyActive').checked ? 1 : 0 }), 'faculty.php', 'faculty');
formSubmit('roomForm', () => ({ room_name: $('roomName').value, room_type: $('roomType').value, capacity: $('roomCapacity').value, is_active: $('roomActive').checked ? 1 : 0 }), 'rooms.php', 'rooms');
formSubmit('facultyCourseForm', () => ({ faculty_id: $('assignFaculty').value, course_id: $('assignCourse').value }), 'faculty_courses.php', 'assignments');
formSubmit('scheduleForm', () => ({ school_year: $('scheduleSchoolYear').value, course_id: $('scheduleCourse').value, component: $('scheduleComponent').value, section_id: $('scheduleSection').value, faculty_id: $('scheduleFaculty').value, room_id: $('scheduleRoom').value, set_type: $('setType').value, day_of_week: getEffectiveDayPattern(), start_time: $('startTime').value, end_time: $('endTime').value, notes: $('notes').value }), 'schedules.php', 'schedules');

$('scheduleCourse').addEventListener('change', () => {
  updateComponentOptions();
  updateFacultyOptions();
  updateRoomOptions();
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
  });
});

$('clearFiltersBtn').addEventListener('click', () => {
  $('filterSchoolYear').value = ''; $('filterYear').value = ''; $('filterSemester').value = ''; $('filterSection').value = ''; $('filterFaculty').value = '';
  scheduleFilters.schoolYear = ''; scheduleFilters.year = ''; scheduleFilters.semester = ''; scheduleFilters.section = ''; scheduleFilters.faculty = '';
  getTableState('schedulesTable').page = 1;
  renderTables();
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
  $('loginError').textContent = '';
  const btn = $('loginSubmitBtn');
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
  try {
    await request('auth.php', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value }) });
    $('loginForm').reset();
    showApp();
    loadAll().catch((err) => showToast(err.message, 'error'));
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
    } else {
      showLogin();
    }
  } catch (e) {
    showLogin();
  }
})();
