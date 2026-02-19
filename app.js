/**
 * Grid Journal — app.js
 *
 * Data model in localStorage:
 * {
 *   pinnedTopics: [ { id, name } ],   // global column definitions (ordered)
 *   entries: {
 *     "YYYY-MM-DD": {
 *       pinned: { topicId: "text", ... },
 *       free:   [ { id, name, text }, ... ]
 *     }
 *   }
 * }
 */

// ─── State ───────────────────────────────────────────────────────────────────

let currentYear, currentMonth; // 0-based month
let data = { pinnedTopics: [], entries: {} };

// UI state
let expandedColumns = new Set(); // topic ids whose columns are "expanded"
let activeCell = null;           // { type:'pinned'|'free', dateKey, topicId|freeCellId, el }

// ─── Persistence ─────────────────────────────────────────────────────────────

function loadData() {
  try {
    const raw = localStorage.getItem('gridjournal');
    if (raw) data = JSON.parse(raw);
  } catch (e) { data = { pinnedTopics: [], entries: {} }; }
  if (!data.pinnedTopics) data.pinnedTopics = [];
  if (!data.entries) data.entries = {};
}

function saveData() {
  localStorage.setItem('gridjournal', JSON.stringify(data));
}

function getEntry(dateKey) {
  if (!data.entries[dateKey]) data.entries[dateKey] = { pinned: {}, free: [] };
  return data.entries[dateKey];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function dayName(year, month, day) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(year, month, day).getDay()];
}

function isWeekend(year, month, day) {
  const d = new Date(year, month, day).getDay();
  return d === 0 || d === 6;
}

function isToday(year, month, day) {
  const t = new Date();
  return t.getFullYear() === year && t.getMonth() === month && t.getDate() === day;
}

function allTopicNames() {
  // All globally pinned names
  return data.pinnedTopics.map(t => t.name.toLowerCase());
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let modalResolve = null;

function openRenameModal(initialValue = '', existingNames = []) {
  return new Promise(resolve => {
    modalResolve = resolve;
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    const error = document.getElementById('rename-error');
    const saveBtn = document.getElementById('rename-save');
    const overlay = document.getElementById('overlay');

    input.value = initialValue;
    input.classList.remove('invalid');
    error.classList.add('hidden');
    saveBtn.disabled = false;

    modal.classList.remove('hidden');
    overlay.classList.remove('hidden');
    input.focus();
    input.select();

    function validate() {
      const val = input.value.trim();
      const dup = existingNames.includes(val.toLowerCase()) && val.toLowerCase() !== initialValue.toLowerCase();
      input.classList.toggle('invalid', dup || !val);
      error.classList.toggle('hidden', !dup);
      saveBtn.disabled = dup || !val;
    }

    input.oninput = validate;

    saveBtn.onclick = () => {
      const val = input.value.trim();
      if (!val) return;
      const dup = existingNames.includes(val.toLowerCase()) && val.toLowerCase() !== initialValue.toLowerCase();
      if (dup) return;
      closeModal(val);
    };

    input.onkeydown = e => {
      if (e.key === 'Enter') saveBtn.onclick();
      if (e.key === 'Escape') closeModal(null);
    };

    document.getElementById('rename-cancel').onclick = () => closeModal(null);
    overlay.onclick = () => closeModal(null);
  });
}

function closeModal(result) {
  document.getElementById('rename-modal').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
  if (modalResolve) { modalResolve(result); modalResolve = null; }
}

// ─── Build column headers ─────────────────────────────────────────────────────

function buildHeaders() {
  const container = document.getElementById('column-headers');
  // Remove old topic headers (keep date-header-cell and header-spacer)
  container.querySelectorAll('.topic-header').forEach(el => el.remove());

  const spacer = document.getElementById('header-spacer');

  data.pinnedTopics.forEach(topic => {
    const el = makeTopicHeader(topic);
    container.insertBefore(el, spacer);
  });
}

function makeTopicHeader(topic) {
  const el = document.createElement('div');
  el.className = 'header-cell topic-header';
  el.dataset.topicId = topic.id;
  if (expandedColumns.has(topic.id)) el.classList.add('expanded');

  el.innerHTML = `
    <span class="header-label">${escHtml(topic.name)}</span>
    <span class="expand-indicator">${expandedColumns.has(topic.id) ? '▴' : '▾'}</span>
    <button class="unpin-btn" title="Unpin column (convert to free cells)">📌</button>
    <button class="del-col-btn" title="Delete column and all its data">✕</button>
  `;

  el.querySelector('.del-col-btn').addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete column "${topic.name}" and all its data?`)) return;
    data.pinnedTopics = data.pinnedTopics.filter(t => t.id !== topic.id);
    for (const dk in data.entries) {
      if (data.entries[dk].pinned) delete data.entries[dk].pinned[topic.id];
    }
    expandedColumns.delete(topic.id);
    saveData();
    render();
  });

  el.querySelector('.unpin-btn').addEventListener('click', e => {
    e.stopPropagation();
    // Convert all entries with content into free cells; skip empty ones
    for (const dk in data.entries) {
      const entry = data.entries[dk];
      const text = entry.pinned && entry.pinned[topic.id];
      if (text) {
        if (!entry.free) entry.free = [];
        entry.free.push({ id: uid(), name: topic.name, text });
      }
      if (entry.pinned) delete entry.pinned[topic.id];
    }
    data.pinnedTopics = data.pinnedTopics.filter(t => t.id !== topic.id);
    expandedColumns.delete(topic.id);
    saveData();
    render();
  });

  el.addEventListener('click', e => {
    if (e.target.classList.contains('del-col-btn') || e.target.classList.contains('unpin-btn')) return;
    if (expandedColumns.has(topic.id)) {
      expandedColumns.delete(topic.id);
    } else {
      expandedColumns.add(topic.id);
    }
    // Update header
    el.classList.toggle('expanded', expandedColumns.has(topic.id));
    el.querySelector('.expand-indicator').textContent = expandedColumns.has(topic.id) ? '▴' : '▾';
    // Update all cells in this column
    document.querySelectorAll(`.topic-cell[data-topic-id="${topic.id}"]`).forEach(cell => {
      cell.classList.toggle('col-expanded', expandedColumns.has(topic.id));
    });
  });

  // Double-click to rename
  el.querySelector('.header-label').addEventListener('dblclick', async e => {
    e.stopPropagation();
    const others = data.pinnedTopics.filter(t => t.id !== topic.id).map(t => t.name.toLowerCase());
    const newName = await openRenameModal(topic.name, others);
    if (!newName || newName === topic.name) return;
    topic.name = newName;
    saveData();
    buildHeaders();
    document.querySelectorAll(`.topic-cell[data-topic-id="${topic.id}"] .free-cell-header .free-cell-name`).forEach(el => el.textContent = newName);
  });

  return el;
}

// ─── Build rows ───────────────────────────────────────────────────────────────

function buildRows() {
  const container = document.getElementById('rows-container');
  container.innerHTML = '';
  const days = daysInMonth(currentYear, currentMonth);
  for (let d = 1; d <= days; d++) {
    container.appendChild(makeRow(d));
  }
}

function makeRow(day) {
  const dk = dateKey(currentYear, currentMonth, day);
  const entry = getEntry(dk);

  const row = document.createElement('div');
  row.className = 'day-row';
  row.dataset.dateKey = dk;
  if (isToday(currentYear, currentMonth, day)) row.classList.add('today');
  if (isWeekend(currentYear, currentMonth, day)) row.classList.add('weekend');

  // Date cell
  const dateCell = document.createElement('div');
  dateCell.className = 'date-cell';
  dateCell.innerHTML = `
    <span class="day-num">${day}</span>
    <span class="day-name">${dayName(currentYear, currentMonth, day)}</span>
  `;
  row.appendChild(dateCell);

  // Pinned topic cells
  data.pinnedTopics.forEach(topic => {
    row.appendChild(makePinnedCell(dk, topic, entry.pinned[topic.id] || ''));
  });

  // Free cells area
  const freeArea = document.createElement('div');
  freeArea.className = 'free-cells-area';
  freeArea.dataset.dateKey = dk;

  (entry.free || []).forEach(fc => {
    freeArea.appendChild(makeFreeCell(dk, fc));
  });

  // Add-free-cell button
  const addBtn = document.createElement('button');
  addBtn.className = 'add-free-cell-btn';
  addBtn.title = 'Add a topic cell to this day';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => addFreeCellToRow(dk, freeArea, addBtn));
  freeArea.appendChild(addBtn);

  row.appendChild(freeArea);
  return row;
}

// ─── Pinned cell ──────────────────────────────────────────────────────────────

function makePinnedCell(dk, topic, text) {
  const cell = document.createElement('div');
  cell.className = 'topic-cell';
  cell.dataset.topicId = topic.id;
  cell.dataset.dateKey = dk;
  if (expandedColumns.has(topic.id)) cell.classList.add('col-expanded');

  // Preview: rendered markdown
  const preview = document.createElement('div');
  preview.className = text ? 'cell-preview' : 'cell-preview empty-hint';
  if (text) preview.innerHTML = renderMd(text);
  else preview.textContent = '…';

  // Editor: seamless textarea, no buttons
  const editorWrap = document.createElement('div');
  editorWrap.className = 'cell-editor-wrap';
  const textarea = document.createElement('textarea');
  textarea.className = 'cell-textarea';
  textarea.value = text;
  textarea.placeholder = `Notes for ${topic.name}…`;
  editorWrap.appendChild(textarea);

  cell.appendChild(preview);
  cell.appendChild(editorWrap);

  function openCell(e) {
    if (cell.classList.contains('active')) return;
    closeActiveCell();
    cell.classList.add('active');
    activeCell = { el: cell };
    textarea.focus();
    // place cursor at click position if possible
    if (e) {
      try {
        const range = document.caretRangeFromPoint
          ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
        if (range) {
          const pos = range.startOffset;
          textarea.setSelectionRange(pos, pos);
        }
      } catch(_) {}
    }
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function saveCell() {
    const val = textarea.value;
    getEntry(dk).pinned[topic.id] = val;
    saveData();
    if (val) {
      preview.innerHTML = renderMd(val);
      preview.className = 'cell-preview';
    } else {
      preview.textContent = '…';
      preview.className = 'cell-preview empty-hint';
    }
    cell.classList.remove('active');
    activeCell = null;
  }

  cell.addEventListener('click', openCell);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // revert and close
      textarea.value = getEntry(dk).pinned[topic.id] || '';
      cell.classList.remove('active');
      activeCell = null;
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCell(); }
  });
  // expose saveCell so closeActiveCell can call it
  cell._saveCell = saveCell;

  return cell;
}

// ─── Free cell ────────────────────────────────────────────────────────────────

function makeFreeCell(dk, fc) {
  const cell = document.createElement('div');
  cell.className = 'free-cell';
  cell.dataset.freeCellId = fc.id;
  cell.dataset.dateKey = dk;

  // header
  const header = document.createElement('div');
  header.className = 'free-cell-header';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'free-cell-name';
  nameSpan.textContent = fc.name;
  nameSpan.title = fc.name;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'free-cell-actions';

  const pinBtn = document.createElement('button');
  pinBtn.className = 'pin-btn';
  pinBtn.title = 'Pin as global column';
  pinBtn.textContent = '📌';

  const renameBtn = document.createElement('button');
  renameBtn.title = 'Rename';
  renameBtn.textContent = '✎';

  const delBtn = document.createElement('button');
  delBtn.title = 'Delete';
  delBtn.textContent = '✕';

  actionsDiv.appendChild(pinBtn);
  actionsDiv.appendChild(renameBtn);
  actionsDiv.appendChild(delBtn);
  header.appendChild(nameSpan);
  header.appendChild(actionsDiv);

  // preview / editor
  const preview = document.createElement('div');
  preview.className = fc.text ? 'cell-preview' : 'cell-preview empty-hint';
  if (fc.text) preview.innerHTML = renderMd(fc.text);
  else preview.textContent = '…';

  const editorWrap = document.createElement('div');
  editorWrap.className = 'cell-editor-wrap';
  const textarea = document.createElement('textarea');
  textarea.className = 'cell-textarea';
  textarea.value = fc.text || '';
  textarea.placeholder = `Notes for ${fc.name}…`;
  editorWrap.appendChild(textarea);

  cell.appendChild(header);
  cell.appendChild(preview);
  cell.appendChild(editorWrap);

  // open/close
  function openCell() {
    if (cell.classList.contains('active')) return;
    closeActiveCell();
    cell.classList.add('active');
    activeCell = { el: cell };
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function saveCell() {
    const entry = getEntry(dk);
    const freeItem = (entry.free || []).find(f => f.id === fc.id);
    if (freeItem) { freeItem.text = textarea.value; fc.text = freeItem.text; }
    saveData();
    if (fc.text) {
      preview.innerHTML = renderMd(fc.text);
      preview.className = 'cell-preview';
    } else {
      preview.textContent = '…';
      preview.className = 'cell-preview empty-hint';
    }
    cell.classList.remove('active');
    activeCell = null;
  }

  preview.addEventListener('click', openCell);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      textarea.value = fc.text || '';
      cell.classList.remove('active');
      activeCell = null;
    }
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveCell(); }
  });
  cell._saveCell = saveCell;

  // Pin button
  pinBtn.addEventListener('click', async e => {
    e.stopPropagation();
    // Check name collision with existing pinned topics
    const existingNames = data.pinnedTopics.map(t => t.name.toLowerCase());
    let name = fc.name;
    if (existingNames.includes(name.toLowerCase())) {
      const newName = await openRenameModal(name, existingNames);
      if (!newName) return;
      name = newName;
    }
    // Create pinned topic
    const newTopic = { id: uid(), name };
    data.pinnedTopics.push(newTopic);
    // Collect ALL free cells across ALL days with the same name into this column
    for (const entryKey in data.entries) {
      const entry = data.entries[entryKey];
      const match = (entry.free || []).find(f => f.name.toLowerCase() === newTopic.name.toLowerCase());
      if (match) {
        if (!entry.pinned) entry.pinned = {};
        entry.pinned[newTopic.id] = match.text || '';
        entry.free = entry.free.filter(f => f.id !== match.id);
      }
    }
    saveData();
    render();
  });

  // Rename
  renameBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const existingNames = [
      ...data.pinnedTopics.map(t => t.name.toLowerCase()),
      // other free cells on same day
      ...(getEntry(dk).free || []).filter(f => f.id !== fc.id).map(f => f.name.toLowerCase())
    ];
    const newName = await openRenameModal(fc.name, existingNames);
    if (!newName || newName === fc.name) return;
    fc.name = newName;
    const freeItem = (getEntry(dk).free || []).find(f => f.id === fc.id);
    if (freeItem) freeItem.name = newName;
    saveData();
    nameSpan.textContent = newName;
    nameSpan.title = newName;
  });

  // Delete
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!confirm(`Delete "${fc.name}" for this day?`)) return;
    getEntry(dk).free = (getEntry(dk).free || []).filter(f => f.id !== fc.id);
    saveData();
    cell.remove();
  });

  return cell;
}

// ─── Add free cell ────────────────────────────────────────────────────────────

async function addFreeCellToRow(dk, freeArea, addBtn) {
  const entry = getEntry(dk);
  // Existing names: pinned + free cells for this day
  const existingNames = [
    ...data.pinnedTopics.map(t => t.name.toLowerCase()),
    ...(entry.free || []).map(f => f.name.toLowerCase())
  ];
  const name = await openRenameModal('', existingNames);
  if (!name) return;
  const fc = { id: uid(), name, text: '' };
  if (!entry.free) entry.free = [];
  entry.free.push(fc);
  saveData();
  const cellEl = makeFreeCell(dk, fc);
  freeArea.insertBefore(cellEl, addBtn);
}

// ─── Add global topic (via top bar button) ────────────────────────────────────

async function addGlobalTopic() {
  const existingNames = data.pinnedTopics.map(t => t.name.toLowerCase());
  const name = await openRenameModal('', existingNames);
  if (!name) return;
  const topic = { id: uid(), name };
  data.pinnedTopics.push(topic);
  saveData();
  render();
}

// ─── Close active cell ────────────────────────────────────────────────────────

function closeActiveCell() {
  if (activeCell && activeCell.el) {
    // save on blur (click outside)
    if (typeof activeCell.el._saveCell === 'function') {
      activeCell.el._saveCell();
    } else {
      activeCell.el.classList.remove('active');
      activeCell = null;
    }
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  buildHeaders();
  buildRows();
  updateMonthLabel();
}

function updateMonthLabel() {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('month-label').textContent = `${months[currentMonth]} ${currentYear}`;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  render();
});
document.getElementById('next-month').addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  render();
});

// Close active cell when clicking outside
document.addEventListener('click', e => {
  if (!activeCell) return;
  if (!activeCell.el.contains(e.target)) {
    closeActiveCell();
  }
});

// ─── Escape key closes modal ─────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal(null);
});

// ─── Add topic button ─────────────────────────────────────────────────────────

document.getElementById('add-column-btn').addEventListener('click', addGlobalTopic);

// ─── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMd(text) {
  if (!text) return '';
  // marked is loaded from CDN
  return marked.parse(text, { breaks: true, gfm: true });
}

// ─── Init ────────────────────────────────────────────────────────────────────

function init() {
  loadData();
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  render();

  // Scroll to today
  requestAnimationFrame(() => {
    const today = document.querySelector('.day-row.today');
    if (today) today.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

init();
