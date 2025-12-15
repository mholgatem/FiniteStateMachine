const state = {
  name: 'Untitled Machine',
  type: 'moore',
  numStates: 4,
  inputs: [],
  outputs: [],
  states: [],
  transitions: [],
  showBinary: true,
  transitionTable: { cells: {} },
  transitionTableVerified: false,
  kmaps: [],
};

let currentArrow = null;
let selectedArrowId = null;
let selectedStateId = null;
let arrowDialogTarget = null;
let previewPath = null;
let undoStack = [];
let viewState = { scale: 1, panX: 0, panY: 0 };
let unsavedChanges = false;
let drawerWidth = 520;
let isPanning = false;
let panWithShift = false;
let panStart = { x: 0, y: 0 };
let transitionTableValueColumns = [];
let transitionTableGroupSize = 0;
let verifyButtonResetTimer = null;
let dialogBackdropMouseDownTarget = null;
let dialogBackdropCloseBlocked = false;

const landing = document.getElementById('landing');
const newMachineDialog = document.getElementById('newMachineDialog');
const arrowDialog = document.getElementById('arrowDialog');
const quickRefDialog = document.getElementById('quickRefDialog');
const diagram = document.getElementById('diagram');
const viewport = document.getElementById('viewport');
const paletteList = document.getElementById('paletteList');
const palettePane = document.querySelector('.state-palette');
const stateTableBody = document.querySelector('#stateTable tbody');
const toggleTableBtn = document.getElementById('toggleTable');
const toggleIoModeBtn = document.getElementById('toggleIoMode');
const tablePanel = document.getElementById('tablePanel');
const toolbarTitle = document.getElementById('toolbarTitle');
const mealyOutputRow = document.getElementById('mealyOutputRow');
const inputChoices = document.getElementById('inputChoices');
const outputChoices = document.getElementById('outputChoices');
const transitionDrawer = document.getElementById('transitionDrawer');
const transitionTableHead = document.getElementById('transitionTableHead');
const transitionTableBody = document.getElementById('transitionTableBody');
const transitionColumnTray = document.getElementById('transitionColumnTray');
const transitionColumnDropzone = document.getElementById('transitionColumnDropzone');
const saveImageMenu = document.getElementById('saveImageMenu');
const saveImageDropdown = document.getElementById('saveImageDropdown');
const fileMenu = document.getElementById('fileMenu');
const fileMenuButton = document.getElementById('fileMenuButton');
const settingsMenu = document.getElementById('settingsMenu');
const settingsMenuButton = document.getElementById('settingsMenuButton');
const transitionDrawerHandle = document.getElementById('transitionDrawerHandle');
const toolbarNewMachine = document.getElementById('toolbarNewMachine');
const kmapWindow = document.getElementById('kmapWindow');
const kmapWindowHeader = document.getElementById('kmapWindowHeader');
const kmapList = document.getElementById('kmapList');
const kmapEmptyState = document.getElementById('kmapEmptyState');
const kmapZipStatus = document.getElementById('kmapZipStatus');
const kmapCircleToggle = document.getElementById('toggleKmapCircles');
const kmapQuickRefBtn = document.getElementById('kmapQuickRef');
const kmapQuickRefDialog = document.getElementById('kmapQuickRefDialog');
const confirmKmapCreate = document.getElementById('confirmKmapCreate');
const kmapLabelInput = document.getElementById('kmapLabel');
const kmapVariablesInput = document.getElementById('kmapVariables');
const kmapTypeInput = document.getElementById('kmapType');
const kmapDirectionInput = document.getElementById('kmapDirection');
const kmapResizeHandle = document.getElementById('kmapResizeHandle');
const transitionColumnBuilder = document.getElementById('transitionColumnBuilder');
const toggleTransitionBuilderBtn = document.getElementById('toggleTransitionBuilder');

let kmapWindowState = { width: 840, height: 540, left: null, top: null };
let kmapFormMemory = { label: '', variables: '', type: 'sop', direction: 'horizontal' };
let kmapExpressionDragState = null;
let transitionColumnDragState = null;
let showKmapCircles = false;
let showKmapCirclesBeforeResize = false;
const allowedStateCounts = [1, 2, 4, 8, 16, 32];
const kmapCirclePalette = ['#2563eb', '#d946ef', '#22c55e', '#f97316', '#14b8a6', '#f59e0b'];

function coerceAllowedStateCount(value) {
  const num = parseInt(value, 10);
  if (allowedStateCounts.includes(num)) return num;
  return allowedStateCounts[0];
}

function populateStateCountSelectors() {
  const selectors = [document.getElementById('stateCount'), document.getElementById('stateControl')];
  selectors.forEach((sel) => {
    if (!sel || sel.dataset.populated) return;
    sel.innerHTML = '';
    allowedStateCounts.forEach((count) => {
      const opt = document.createElement('option');
      opt.value = count;
      opt.textContent = count;
      sel.appendChild(opt);
    });
    sel.dataset.populated = 'true';
  });
}

function closeDialog(id) {
  document.getElementById(id).classList.add('hidden');
}

function openDialog(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeAllDropdowns(options = {}) {
  const { keepFile = false } = options;
  saveImageMenu.classList.add('hidden');
  settingsMenu.classList.add('hidden');
  if (!keepFile) fileMenu.classList.add('hidden');
}

function columnBaseKey(col) {
  if (!col) return '';
  if (col.baseKey) return col.baseKey;
  const key = col.key || '';
  const [base] = key.split('__');
  return base || key;
}

function uniqueId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function clearVerificationStatus() {
  const verifyBtn = document.getElementById('verifyTransitionTable');
  if (verifyBtn) {
    if (verifyButtonResetTimer) {
      clearTimeout(verifyButtonResetTimer);
      verifyButtonResetTimer = null;
    }
    verifyBtn.classList.remove('verified', 'failed');
    verifyBtn.removeAttribute('title');
    if (verifyBtn.dataset.baseLabel) verifyBtn.textContent = verifyBtn.dataset.baseLabel;
  }
}

function setVerificationStatus(passed, message) {
  const verifyBtn = document.getElementById('verifyTransitionTable');
  if (!verifyBtn) return;
  const baseLabel = verifyBtn.dataset.baseLabel || verifyBtn.textContent || 'Verify Transition Table';
  verifyBtn.dataset.baseLabel = baseLabel;
  verifyBtn.textContent = baseLabel;
  verifyBtn.classList.remove('verified', 'failed');
  verifyBtn.removeAttribute('title');
  if (verifyButtonResetTimer) {
    clearTimeout(verifyButtonResetTimer);
    verifyButtonResetTimer = null;
  }

  if (passed === true) {
    verifyBtn.classList.add('verified');
    verifyBtn.textContent = 'Transition table verified';
    verifyBtn.title = 'Your transition table matches your transition diagram';
    state.transitionTableVerified = true;
    return;
  }
  if (passed === false) {
    verifyBtn.classList.add('failed');
    verifyBtn.textContent = "Table & diagram don't match";
    verifyBtn.title = message || 'Your transition table DOES NOT match your transition diagram';
    state.transitionTableVerified = false;
    verifyButtonResetTimer = setTimeout(() => {
      verifyBtn.classList.remove('failed');
      verifyBtn.textContent = baseLabel;
      verifyBtn.removeAttribute('title');
    }, 2000);
    return;
  }
  state.transitionTableVerified = false;
}

function diagramHasHighlightedStates() {
  return state.states.some((st) => {
    if (!st.placed) return false;
    const coverage = evaluateCoverage(st.id);
    return coverage.missing || coverage.overfull;
  });
}

function updateVerifyButtonState() {
  const verifyBtn = document.getElementById('verifyTransitionTable');
  if (!verifyBtn) return;
  verifyBtn.disabled = false;
}

function markDirty() {
  unsavedChanges = true;
  setVerificationStatus(null);
  updateVerifyButtonState();
}

function clearDirty() {
  unsavedChanges = false;
}

function promptToSaveIfDirty(next) {
  if (!unsavedChanges) {
    next();
    return;
  }
  const wantsSave = window.confirm('You have unsaved changes. Save before continuing?');
  if (wantsSave) {
    saveState();
    next();
    return;
  }
  const proceed = window.confirm('Continue without saving?');
  if (proceed) next();
}

function normalizeNames(list) {
  return list
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => (v ? v[0].toUpperCase() + v.slice(1) : v));
}

function parseList(value) {
  return normalizeNames(value.split(','));
}

function parseKmapVariables(value) {
  const vars = parseList(value || '');
  return vars.slice(0, 6);
}

function defaultSelections(count, fallbackText = '') {
  const base = Array(count).fill('X');
  if (!fallbackText) return base;
  const clean = fallbackText.replace(/\s+/g, '');
  for (let i = 0; i < Math.min(count, clean.length); i += 1) {
    if (['0', '1', 'X', '-'].includes(clean[i])) {
      base[i] = clean[i] === '-' ? 'X' : clean[i];
    }
  }
  return base;
}

function selectionLabel(names, values) {
  if (!names.length) return (values || []).join('');
  return names
    .map((name, idx) => {
      const val = (values && values[idx]) || 'X';
      return `${name}=${val}`;
    })
    .join(', ');
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

function formatScriptedText(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '_' || ch === '^') {
      const cls = ch === '_' ? 'subscript-text' : 'superscript-text';
      let start = i + 1;
      let end = start;
      while (end < text.length && /[A-Za-z0-9+]/.test(text[end])) end += 1;
      const segment = text.slice(start, end) || text[start] || '';
      if (segment) {
        result += `<span class="${cls}">${escapeHtml(segment)}</span>`;
      }
      i = end;
      continue;
    }
    result += escapeHtml(ch);
    i += 1;
  }
  return result;
}

function nameToSvg(name) {
  let result = '';
  let i = 0;
  while (i < name.length) {
    const idx = name.indexOf('_', i);
    if (idx === -1) {
      result += escapeHtml(name.slice(i));
      break;
    }
    result += escapeHtml(name.slice(i, idx));
    let j = idx + 1;
    while (j < name.length && /[A-Za-z0-9]/.test(name[j])) j += 1;
    const sub = name.slice(idx + 1, j);
    if (sub) {
      result += `<tspan class="subscript">${escapeHtml(sub)}</tspan>`;
    } else {
      result += '_';
    }
    i = j;
  }
  return result || escapeHtml(name);
}

function variableToken(name, val) {
  const parts = name.split('_');
  const base = escapeHtml(parts.shift() || name);
  const sub = parts.length ? `<tspan class="subscript">${escapeHtml(parts.join('_'))}</tspan>` : '';
  if (val === 'X') return 'X';
  if (val === '0') return `<tspan class="overline">${base}</tspan>${sub}`;
  return `${base}${sub}`;
}

function buildPlainIOText(names, values, mode = 'binary') {
  if (mode === 'binary' || !names.length) {
    return (values || []).map((v) => v || 'X').join('');
  }
  return names
    .map((name, idx) => {
      const val = (values && values[idx]) || 'X';
      if (val === 'X') return 'X';
      return `${name}${val === '0' ? "'" : ''}`;
    })
    .join('');
}

function buildIOText(names, values, mode = 'binary') {
  if (mode === 'binary' || !names.length) {
    return escapeHtml((values || []).map((v) => v || 'X').join(''));
  }
  return names
    .map((name, idx) => variableToken(name, (values && values[idx]) || 'X'))
    .join('');
}

function transitionLabel(tr) {
  const mode = state.showBinary ? 'binary' : 'vars';
  const inputPlain = buildPlainIOText(state.inputs, tr.inputValues, mode);
  const outputPlain =
    state.type === 'mealy' ? buildPlainIOText(state.outputs, tr.outputValues, mode) : '';
  const parts = [];
  const htmlParts = [];
  if (inputPlain) {
    parts.push(inputPlain);
    htmlParts.push(buildIOText(state.inputs, tr.inputValues, mode));
  }
  if (outputPlain) {
    parts.push(outputPlain);
    htmlParts.push(buildIOText(state.outputs, tr.outputValues, mode));
  }
  const labelPlain = parts.join(' | ');
  const labelHtml = htmlParts.join(' <tspan class="divider">|</tspan> ') || 'Set I/O';
  return { labelPlain, labelHtml };
}

function normalizeTransition(tr) {
  if (!Array.isArray(tr.inputValues)) {
    tr.inputValues = defaultSelections(state.inputs.length, tr.inputs || '');
  }
  tr.inputValues = (tr.inputValues || []).slice(0, state.inputs.length);
  while (tr.inputValues.length < state.inputs.length) tr.inputValues.push('X');
  if (state.type === 'mealy') {
    if (!Array.isArray(tr.outputValues)) {
      tr.outputValues = defaultSelections(state.outputs.length, tr.outputs || '');
    }
    tr.outputValues = (tr.outputValues || []).slice(0, state.outputs.length);
    while (tr.outputValues.length < state.outputs.length) tr.outputValues.push('X');
  }
  tr.labelT = tr.labelT === undefined ? 0.12 : tr.labelT;
  if (tr.arcOffset === undefined || Number.isNaN(tr.arcOffset)) tr.arcOffset = 0;
  if (tr.from === tr.to && tr.loopAngle === undefined) tr.loopAngle = -Math.PI / 2;
}

function initStates() {
  state.states = Array.from({ length: state.numStates }, (_, i) => ({
    id: i,
    label: `S${i}`,
    description: '',
    binary: i.toString(2).padStart(Math.ceil(Math.log2(state.numStates)), '0'),
    outputs: state.outputs.map(() => '0'),
    placed: false,
    x: 120 + i * 25,
    y: 120 + i * 20,
    radius: 38,
  }));
  state.transitions = [];
  state.transitionTable = { cells: {} };
  state.transitionTableVerified = false;
  undoStack = [];
  selectedArrowId = null;
  selectedStateId = null;
}

function updateControls() {
  document.getElementById('nameControl').value = state.name;
  document.getElementById('typeControl').value = state.type;
  document.getElementById('stateControl').value = state.numStates;
  document.getElementById('inputsControl').value = state.inputs.join(', ');
  document.getElementById('outputsControl').value = state.outputs.join(', ');
  toolbarTitle.textContent = state.name;
  document.getElementById('machineName').value = state.name;
  document.getElementById('machineType').value = state.type;
  document.getElementById('stateCount').value = state.numStates;
  document.getElementById('inputVars').value = state.inputs.join(', ');
  document.getElementById('outputVars').value = state.outputs.join(', ');
  mealyOutputRow.style.display = state.type === 'mealy' ? 'flex' : 'none';
  document.querySelectorAll('.moore-only').forEach((el) => {
    el.classList.toggle('hidden', state.type !== 'moore');
  });
  toggleTableBtn.textContent = tablePanel.classList.contains('collapsed') ? '▾' : '▴';
  toggleIoModeBtn.textContent = `Show: ${state.showBinary ? 'Binary' : 'Vars'}`;
}

function renderPalette() {
  paletteList.innerHTML = '';
  const template = document.getElementById('paletteItemTemplate');
  const unplaced = state.states.filter((s) => !s.placed).sort((a, b) => a.id - b.id);
  unplaced.forEach((st) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = st.id;
    node.querySelector('.state-circle').textContent = st.id;
    node.querySelector('.state-label').textContent = st.label;
    node.querySelector('.state-extra').innerHTML =
      state.type === 'moore'
        ? buildIOText(state.outputs, st.outputs, state.showBinary ? 'binary' : 'vars')
        : '';
    paletteList.appendChild(node);
  });
}

function renderTable() {
  stateTableBody.innerHTML = '';
  state.states.forEach((st) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${st.id}</td>
      <td><input data-field="description" data-id="${st.id}" value="${st.description}"></td>
      <td><input data-field="label" data-id="${st.id}" value="${st.label}"></td>
      <td><input data-field="binary" data-id="${st.id}" value="${st.binary}"></td>
      <td class="moore-only ${state.type !== 'moore' ? 'hidden' : ''}"><input data-field="outputs" data-id="${st.id}" value="${st.outputs.join(',')}"></td>
    `;
    stateTableBody.appendChild(tr);
  });
}

function stateBitCount() {
  return Math.max(1, Math.ceil(Math.log2(Math.max(state.numStates, 1))));
}

function generateInputCombos(count) {
  if (count === 0) return [''];
  const combos = [];
  const total = Math.pow(2, count);
  for (let i = 0; i < total; i += 1) {
    combos.push(i.toString(2).padStart(count, '0'));
  }
  return combos;
}

function buildTransitionColumnTemplates() {
  const bitCount = stateBitCount();
  const templates = [];
  for (let i = bitCount - 1; i >= 0; i -= 1) {
    templates.push({ key: `q_${i}`, baseKey: `q_${i}`, label: `Q_${i}`, type: 'value' });
  }
  const nextStateTemplates = [];
  for (let i = bitCount - 1; i >= 0; i -= 1) {
    nextStateTemplates.push({
      key: `next_q_${i}`,
      baseKey: `next_q_${i}`,
      label: `Q_${i}^+`,
      type: 'value',
    });
  }
  const inputTemplates = state.inputs.map((name, idx) => ({
    key: `in_${idx}`,
    baseKey: `in_${idx}`,
    label: name || `Input ${idx + 1}`,
    type: 'value',
  }));
  const outputTemplates = state.outputs.map((name, idx) => ({
    key: `out_${idx}`,
    baseKey: `out_${idx}`,
    label: name || `Output ${idx + 1}`,
    type: 'value',
  }));
  templates.push(...nextStateTemplates, ...inputTemplates, ...outputTemplates);
  templates.push({ key: 'spacer', baseKey: 'spacer', label: '', type: 'spacer', allowMultiple: true });
  return templates;
}

function createSpacerColumn() {
  return {
    key: `spacer_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    baseKey: 'spacer',
    label: '',
    type: 'spacer',
  };
}

function createColumnInstance(template) {
  const baseKey = columnBaseKey(template);
  const key = `${baseKey}__${uniqueId('col')}`;
  return { ...template, key, baseKey };
}

function buildDefaultTransitionColumns(templates) {
  const find = (predicate) => templates.filter(predicate);
  const columns = [];
  const currentStates = find((t) => t.key.startsWith('q_'));
  const nextStates = find((t) => t.key.startsWith('next_q_'));
  const inputs = find((t) => t.key.startsWith('in_'));
  const outputs = find((t) => t.key.startsWith('out_'));

  const addSpacer = () => columns.push(createSpacerColumn());
  addSpacer();
  currentStates.forEach((t) => columns.push(createColumnInstance(t)));
  addSpacer();
  nextStates.forEach((t) => columns.push(createColumnInstance(t)));
  if (inputs.length) addSpacer();
  inputs.forEach((t) => columns.push(createColumnInstance(t)));
  if (outputs.length) addSpacer();
  outputs.forEach((t) => columns.push(createColumnInstance(t)));
  return columns;
}

function ensureTransitionTableStructure() {
  if (!state.transitionTable || typeof state.transitionTable !== 'object') {
    state.transitionTable = { cells: {} };
  }
  if (!state.transitionTable.cells) state.transitionTable.cells = {};

  if (!Array.isArray(state.transitionTable.columns)) state.transitionTable.columns = [];

  const templates = buildTransitionColumnTemplates();
  state.transitionTable.availableColumns = templates;
  const templateMap = new Map(templates.map((tpl) => [tpl.key, tpl]));
  state.transitionTable.columns = state.transitionTable.columns
    .map((col) => {
      if (col.type === 'spacer') return col;
      const baseKey = columnBaseKey(col);
      const template = templateMap.get(baseKey);
      if (!template) return null;
      const key = (col.key && col.key.startsWith(baseKey)) ? col.key : `${baseKey}__${uniqueId('col')}`;
      return {
        ...template,
        ...col,
        baseKey,
        key,
        label: col.label || template.label,
        type: template.type,
      };
    })
    .filter(Boolean);

  const columns = [{ key: 'row_index', label: '#', type: 'rowIndex' }, ...state.transitionTable.columns];

  transitionTableValueColumns = columns.filter((col) => col.type === 'value');

  const combos = generateInputCombos(state.inputs.length);
  transitionTableGroupSize = combos.length || 1;
  const rows = [];
  for (let s = 0; s < state.numStates; s += 1) {
    combos.forEach((combo) => {
      rows.push({ key: `${s}|${combo || 'none'}`, stateId: s, inputCombo: combo });
    });
  }

  const validCells = new Set();
  rows.forEach((row) => {
    transitionTableValueColumns.forEach((col) => validCells.add(`${row.key}::${col.key}`));
  });

  Object.keys(state.transitionTable.cells).forEach((key) => {
    if (!validCells.has(key)) delete state.transitionTable.cells[key];
  });
  validCells.forEach((key) => {
    if (state.transitionTable.cells[key] === undefined) state.transitionTable.cells[key] = '';
  });

  state.transitionTable.rows = rows;
  state.transitionTable.valueColumns = transitionTableValueColumns;
  state.transitionTable.groupSize = transitionTableGroupSize;
}

function hasTransitionTableValues() {
  if (!state.transitionTable || !state.transitionTable.cells) return false;
  return Object.values(state.transitionTable.cells).some((val) => (val ?? '').toString().trim());
}

function confirmTransitionTableReset(kind) {
  if (!hasTransitionTableValues()) return true;
  return window.confirm(`Changing the number of ${kind} will reset your transition table, proceed?`);
}

function renderTransitionColumnTray() {
  if (!transitionColumnTray) return;
  transitionColumnTray.innerHTML = '';
  const templates = state.transitionTable?.availableColumns || buildTransitionColumnTemplates();
  templates.forEach((tpl) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kmap-token transition-token';
    btn.draggable = true;
    btn.dataset.tokenType = tpl.type;
    btn.dataset.tokenValue = tpl.key;
    if (tpl.type === 'spacer') btn.classList.add('transition-spacer');
    btn.innerHTML = tpl.label ? formatScriptedText(tpl.label) : '&nbsp;';
    transitionColumnTray.appendChild(btn);
  });
}

function renderTransitionColumnToken(col, index) {
  const el = document.createElement('div');
  el.className = 'kmap-expr-token transition-column-token';
  el.draggable = true;
  el.dataset.tokenType = col.type;
  el.dataset.tokenValue = col.key;
  el.dataset.index = index;
  const inner = document.createElement('span');
  inner.className = 'kmap-expr-token-inner';
  if (col.type === 'spacer') {
    el.classList.add('transition-spacer-token');
    inner.innerHTML = '&nbsp;';
  } else {
    inner.innerHTML = formatScriptedText(col.label || '');
  }
  el.appendChild(inner);
  return el;
}

function renderTransitionColumnSelection() {
  if (!transitionColumnDropzone) return;
  transitionColumnDropzone.innerHTML = '';
  const columns = state.transitionTable?.columns || [];
  if (!columns.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'kmap-expr-placeholder';
    placeholder.textContent = 'Drag columns here to build the table';
    transitionColumnDropzone.appendChild(placeholder);
    return;
  }
  columns.forEach((col, idx) => {
    transitionColumnDropzone.appendChild(renderTransitionColumnToken(col, idx));
  });
}

function renderTransitionTable() {
  ensureTransitionTableStructure();
  renderTransitionColumnTray();
  renderTransitionColumnSelection();
  transitionTableHead.innerHTML = '';
  transitionTableBody.innerHTML = '';

  const columns = [{ key: 'row_index', label: '#', type: 'rowIndex' }, ...(state.transitionTable.columns || [])];

  const headerRow = document.createElement('tr');
  const valueIndexMap = new Map(
    transitionTableValueColumns.map((col, idx) => [col.key, idx]),
  );
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.innerHTML = formatScriptedText(col.label || '');
    if (col.type === 'spacer') th.classList.add('col-spacer');
    if (col.type === 'rowIndex') th.classList.add('row-index-cell');
    headerRow.appendChild(th);
  });
  transitionTableHead.appendChild(headerRow);

  state.transitionTable.rows.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = rowIdx;

    columns.forEach((col) => {
      const td = document.createElement('td');
      if (col.type === 'spacer') {
        td.classList.add('col-spacer');
        tr.appendChild(td);
        return;
      }
      if (col.type === 'rowIndex') {
        td.textContent = rowIdx + 1;
        td.classList.add('row-index-cell');
        tr.appendChild(td);
        return;
      }
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.rowKey = row.key;
      input.dataset.colKey = col.key;
      input.dataset.rowIndex = rowIdx;
      input.dataset.valueColIndex = valueIndexMap.get(col.key);
      input.value = state.transitionTable.cells[`${row.key}::${col.key}`] || '';
      td.appendChild(input);
      tr.appendChild(td);
    });

      transitionTableBody.appendChild(tr);

      if (
        transitionTableGroupSize > 0 &&
        (rowIdx + 1) % transitionTableGroupSize === 0 &&
        rowIdx < state.transitionTable.rows.length - 1
      ) {
        const spacerRow = document.createElement('tr');
        spacerRow.classList.add('row-spacer');
        const spacerCell = document.createElement('td');
        spacerCell.colSpan = columns.length;
        spacerRow.appendChild(spacerCell);
        transitionTableBody.appendChild(spacerRow);
      }
    });

  updateVerifyButtonState();
}

function clearDiagram() {
  viewport.innerHTML = '';
  previewPath = null;
}

function renderDiagram() {
  clearDiagram();
  state.transitions.forEach((tr) => {
    drawTransition(tr);
  });
  state.states.filter((s) => s.placed).forEach((st) => {
    drawState(st);
  });
  drawPreview();
  updateVerifyButtonState();
}

function drawState(st) {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.classList.add('state-group');
  group.dataset.id = st.id;

  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', st.x);
  circle.setAttribute('cy', st.y);
  circle.setAttribute('r', st.radius);
  circle.classList.add('state-node');
  if (selectedStateId === st.id) {
    circle.classList.add('selected');
  }
  const coverage = evaluateCoverage(st.id);
  if (coverage.overfull) {
    circle.classList.add('overfull');
  } else if (coverage.missing) {
    circle.classList.add('missing');
  }

  const textLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textLabel.setAttribute('x', st.x);
  textLabel.setAttribute('y', st.y - 6);
  textLabel.setAttribute('text-anchor', 'middle');
  textLabel.classList.add('state-label-text');
  textLabel.textContent = st.label || `S${st.id}`;

  const textId = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textId.setAttribute('x', st.x);
  textId.setAttribute('y', st.y + 12);
  textId.setAttribute('text-anchor', 'middle');
  if (state.type === 'moore') {
    textId.innerHTML = buildIOText(state.outputs, st.outputs, state.showBinary ? 'binary' : 'vars');
  } else {
    textId.textContent = `#${st.id}`;
  }

  group.appendChild(circle);
  group.appendChild(textLabel);
  group.appendChild(textId);
  viewport.appendChild(group);
}

function combinationsFromValues(values) {
  let combos = [''];
  values.forEach((val) => {
    const next = [];
    const normalized = val === '0' || val === '1' ? val : 'X';
    combos.forEach((prefix) => {
      if (normalized === 'X') {
        next.push(`${prefix}0`, `${prefix}1`);
      } else {
        next.push(`${prefix}${normalized}`);
      }
    });
    combos = next;
  });
  return combos;
}

function evaluateCoverage(stateId) {
  const expected = Math.pow(2, state.inputs.length || 0);
  if (!expected) return { missing: false, overfull: false };

  const comboCounts = new Map();
  state.transitions
    .filter((t) => t.from === stateId)
    .forEach((tr) => {
      normalizeTransition(tr);
      combinationsFromValues(tr.inputValues).forEach((combo) => {
        comboCounts.set(combo, (comboCounts.get(combo) || 0) + 1);
      });
    });

  const uniqueCombos = comboCounts.size;
  const hasDuplicates = Array.from(comboCounts.values()).some((count) => count > 1);
  const missing = uniqueCombos < expected;
  const overfull = hasDuplicates || uniqueCombos > expected;
  return { missing, overfull };
}

function normalizeBinaryValue(val) {
  if (val === undefined || val === null) return '';
  const normalized = val.toString().toUpperCase().replace(/[^01X]/g, '');
  return normalized ? normalized[0] : '';
}

function normalizeBitArray(values, expectedLength) {
  const result = Array(expectedLength).fill('');
  (values || []).forEach((val, idx) => {
    if (idx < expectedLength) result[idx] = normalizeBinaryValue(val);
  });
  return result;
}

function stateBinaryCode(stateId, bitCount) {
  const st = state.states.find((s) => s.id === stateId);
  if (!st) return null;
  const cleaned = (st.binary || stateId.toString(2)).replace(/[^01]/g, '');
  return cleaned.padStart(bitCount, '0').slice(-bitCount);
}

function expectedOutputsForTransition(tr) {
  if (state.type === 'moore') {
    const source = state.states.find((s) => s.id === tr.from);
    return normalizeBitArray(source ? source.outputs : [], state.outputs.length);
  }
  normalizeTransition(tr);
  return normalizeBitArray(tr.outputValues, state.outputs.length);
}

function buildDiagramExpectations() {
  const bitCount = stateBitCount();
  const expectations = new Map();
  let conflict = false;

  state.transitions.forEach((tr) => {
    normalizeTransition(tr);
    const sourceBits = stateBinaryCode(tr.from, bitCount);
    if (!sourceBits || sourceBits.length !== bitCount) {
      conflict = true;
      return;
    }
    const combos = combinationsFromValues(tr.inputValues);
    const nextBitsStr = stateBinaryCode(tr.to, bitCount) || '';
    const nextStateBits = normalizeBitArray(nextBitsStr.split(''), bitCount);
    const outputs = expectedOutputsForTransition(tr);

    if (!nextBitsStr || nextStateBits.some((v) => !v) || outputs.some((v) => !v)) {
      conflict = true;
      return;
    }

    combos.forEach((combo) => {
      const key = `${sourceBits}|${combo || 'none'}`;
      const existing = expectations.get(key);
      if (!existing) {
        expectations.set(key, {
          nextStateBits,
          outputs,
          stateBits: sourceBits,
          inputCombo: combo || 'none',
        });
        return;
      }
      if (!arraysCompatible(existing.nextStateBits, nextStateBits)) conflict = true;
      if (!arraysCompatible(existing.outputs, outputs)) conflict = true;
      if (state.type === 'mealy') {
        if (existing.stateBits !== sourceBits || existing.inputCombo !== (combo || 'none')) {
          conflict = true;
        }
      }
    });
  });

  return { expectations, conflict };
}

function findStateByBits(bits) {
  const bitCount = bits.length;
  return state.states.find((s) => stateBinaryCode(s.id, bitCount) === bits);
}

function readTransitionTableRowValues(row, currentStateCols, inputCols, nextStateCols, outputCols) {
  const cells = state.transitionTable?.cells || {};
  const readVal = (colKey) => normalizeBinaryValue(cells[`${row.key}::${colKey}`]);
  return {
    currentStateBits: currentStateCols.map((col) => readVal(col.key)),
    inputBits: inputCols.map((col) => readVal(col.key)),
    nextStateBits: nextStateCols.map((col) => readVal(col.key)),
    outputs: outputCols.map((col) => readVal(col.key)),
  };
}

function valuesCompatible(diagramVal, tableVal) {
  const expected = normalizeBinaryValue(diagramVal);
  const actual = normalizeBinaryValue(tableVal);
  if (!expected || !actual) return false;
  if (expected === 'X' || actual === 'X') return true;
  return expected === actual;
}

function arraysCompatible(expectedArr, actualArr) {
  if (expectedArr.length !== actualArr.length) return false;
  return expectedArr.every((val, idx) => valuesCompatible(val, actualArr[idx]));
}

function outputsCompatible(expectedOutputs, actualOutputs) {
  if (state.type === 'mealy') {
    if (expectedOutputs.length !== actualOutputs.length) return false;
    return expectedOutputs.every((val, idx) => {
      const expected = normalizeBinaryValue(val);
      const actual = normalizeBinaryValue(actualOutputs[idx]);
      if (!expected || !actual) return false;
      if (expected === 'X') return actual === 'X';
      if (actual === 'X') return true;
      return expected === actual;
    });
  }
  return arraysCompatible(expectedOutputs, actualOutputs);
}

function stateIsUsed(stateId) {
  const st = state.states.find((s) => s.id === stateId);
  if (!st) return false;
  const participatesInTransition = state.transitions.some(
    (tr) => tr.from === stateId || tr.to === stateId,
  );
  return st.placed || participatesInTransition;
}

function clickTargetsSelection(target) {
  if (!target) return false;
  if (selectedArrowId) {
    const arrowHit = target.closest('#diagram .arrow-path, #diagram .arc-handle, #diagram .label-handle');
    if (arrowHit && parseInt(arrowHit.dataset.id, 10) === selectedArrowId) return true;
  }
  if (selectedStateId !== null) {
    const stateHit = target.closest('#diagram g.state-group');
    if (stateHit && parseInt(stateHit.dataset.id, 10) === selectedStateId) return true;
  }
  return false;
}

function transitionTableRowIsBlank(row) {
  const cells = state.transitionTable?.cells || {};
  return transitionTableValueColumns.every((col) => {
    const raw = cells[`${row.key}::${col.key}`];
    return !normalizeBinaryValue(raw);
  });
}

function verifyTransitionTableAgainstDiagram(options = {}) {
  const { silent = false, recordStatus = true } = options;
  ensureTransitionTableStructure();
  const { expectations, conflict } = buildDiagramExpectations();
  const uncheckedExpectations = new Set(expectations.keys());

  const currentStateCols = transitionTableValueColumns.filter((col) => columnBaseKey(col).startsWith('q_'));
  const inputCols = transitionTableValueColumns.filter((col) => columnBaseKey(col).startsWith('in_'));
  const nextStateCols = transitionTableValueColumns.filter((col) => columnBaseKey(col).startsWith('next_q_'));
  const outputCols = transitionTableValueColumns.filter((col) => columnBaseKey(col).startsWith('out_'));

  const bitCount = stateBitCount();

  const missingHeaders = [];
  if (currentStateCols.length !== bitCount) missingHeaders.push('current state bits');
  if (nextStateCols.length !== bitCount) missingHeaders.push('next state bits');
  if (inputCols.length !== state.inputs.length) missingHeaders.push('input columns');
  if (outputCols.length !== state.outputs.length) missingHeaders.push('output columns');

  if (missingHeaders.length) {
    const reason = `Missing required column headers: ${missingHeaders.join(', ')}`;
    setVerificationStatus(false, reason);
    if (recordStatus) unsavedChanges = true;
    return;
  }

  let matches = !conflict;

  state.transitionTable.rows.forEach((row) => {
    if (!matches) return;
    const rowIsBlank = transitionTableRowIsBlank(row);
    if (rowIsBlank) return;
    const actualRaw = readTransitionTableRowValues(
      row,
      currentStateCols,
      inputCols,
      nextStateCols,
      outputCols,
    );
    const blankToZero = (arr) => arr.map((val) => (val ? val : '0'));
    const actual = {
      currentStateBits: blankToZero(actualRaw.currentStateBits),
      inputBits: blankToZero(actualRaw.inputBits),
      nextStateBits: blankToZero(actualRaw.nextStateBits),
      outputs: blankToZero(actualRaw.outputs),
    };
    if (actual.currentStateBits.some((v) => !v) || actual.inputBits.some((v) => !v)) {
      matches = false;
      return;
    }
    const currentStateBits = actual.currentStateBits.join('');
    const inputBits = actual.inputBits.join('');
    if (!currentStateBits || currentStateBits.length !== bitCount) {
      matches = false;
      return;
    }
    const matchingState = findStateByBits(currentStateBits);
    if (matchingState && !stateIsUsed(matchingState.id)) return;
    const key = `${currentStateBits}|${inputBits || 'none'}`;
    const expected = expectations.get(key);
    if (!expected) {
      matches = false;
      return;
    }
    if (!arraysCompatible(expected.nextStateBits, actual.nextStateBits)) {
      matches = false;
      return;
    }
    if (!outputsCompatible(expected.outputs, actual.outputs)) {
      matches = false;
      return;
    }
    uncheckedExpectations.delete(key);
  });

  if (matches && uncheckedExpectations.size > 0) {
    matches = false;
  }

  if (matches) {
    setVerificationStatus(true);
    if (recordStatus) unsavedChanges = true;
  } else {
    const reason = uncheckedExpectations.size
      ? 'Transition table is missing transitions that exist in the diagram'
      : undefined;
    setVerificationStatus(false, reason);
    if (recordStatus) unsavedChanges = true;
  }
}

function endpointsForArc(from, to, arcOffset = 0) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const baseAngle = Math.atan2(dy, dx);
  const maxShift = (2 * Math.PI) / 3;
  const normalized = Math.max(-1, Math.min(1, arcOffset / (len / 2 || 1)));
  const angleShift = normalized * maxShift;

  const startAngle = baseAngle + angleShift;
  const endAngle = baseAngle + Math.PI - angleShift;

  const start = {
    x: from.x + Math.cos(startAngle) * from.radius,
    y: from.y + Math.sin(startAngle) * from.radius,
  };
  const end = {
    x: to.x + Math.cos(endAngle) * to.radius,
    y: to.y + Math.sin(endAngle) * to.radius,
  };
  const chordDx = end.x - start.x;
  const chordDy = end.y - start.y;
  const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy) || 1;
  return { start, end, len: chordLen, dx: chordDx, dy: chordDy };
}

function quadraticPath(from, to, arcOffset = 0) {
  const { start, end, len, dx, dy } = endpointsForArc(from, to, arcOffset);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = midX + nx * arcOffset;
  const cy = midY + ny * arcOffset;
  return { d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`, ctrl: { x: cx, y: cy } };
}

function findStateAtPoint(pt) {
  return state.states.find((st) => {
    if (!st.placed) return false;
    const dist = Math.hypot(pt.x - st.x, pt.y - st.y);
    return dist <= st.radius;
  });
}

function projectPointToStateBorder(st, pt) {
  const dx = pt.x - st.x;
  const dy = pt.y - st.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const scale = st.radius / len;
  return {
    x: st.x + dx * scale,
    y: st.y + dy * scale,
  };
}

function limitArrowPointOnTarget(fromState, targetState, cursorPoint) {
  const dir = { x: cursorPoint.x - fromState.x, y: cursorPoint.y - fromState.y };
  const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
  const centersDistance = Math.hypot(targetState.x - fromState.x, targetState.y - fromState.y);
  const maxLen = Math.max(0, centersDistance);
  const clampedLen = Math.min(dirLen, maxLen);
  let projected = {
    x: fromState.x + (dir.x / dirLen) * clampedLen,
    y: fromState.y + (dir.y / dirLen) * clampedLen,
  };
  const toTarget = { x: projected.x - targetState.x, y: projected.y - targetState.y };
  const toTargetLen = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y) || 1;
  if (toTargetLen < targetState.radius) {
    const scale = targetState.radius / toTargetLen;
    projected = {
      x: targetState.x + toTarget.x * scale,
      y: targetState.y + toTarget.y * scale,
    };
  }
  return { ...projected, radius: 0 };
}

function selfLoopPath(node, tr) {
  const angle = tr.loopAngle !== undefined ? tr.loopAngle : -Math.PI / 2;
  const sweep = Math.PI / 1.8;
  const startAngle = angle - sweep / 2;
  const endAngle = angle + sweep / 2;
  const loopDepth = Math.min(120, Math.max(30, (tr.arcOffset || 0) + 40));
  const ctrlRadius = loopDepth + 24;

  const start = {
    x: node.x + Math.cos(startAngle) * node.radius,
    y: node.y + Math.sin(startAngle) * node.radius,
  };
  const end = {
    x: node.x + Math.cos(endAngle) * node.radius,
    y: node.y + Math.sin(endAngle) * node.radius,
  };
  const ctrl = {
    x: node.x + Math.cos(angle) * (node.radius + ctrlRadius),
    y: node.y + Math.sin(angle) * (node.radius + ctrlRadius),
  };

  return { d: `M ${start.x} ${start.y} Q ${ctrl.x} ${ctrl.y} ${end.x} ${end.y}`, ctrl };
}

function drawTransition(tr) {
  normalizeTransition(tr);
  const from = state.states.find((s) => s.id === tr.from);
  const to = state.states.find((s) => s.id === tr.to);
  if (!from || !to) return;
  const isSelfLoop = from.id === to.id;
  const pathInfo = isSelfLoop ? selfLoopPath(from, tr) : quadraticPath(from, to, tr.arcOffset || 0);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathInfo.d);
  path.classList.add('arrow-path');
  if (isSelfLoop) path.classList.add('self-loop');
  if (selectedArrowId === tr.id) path.classList.add('selected');
  path.dataset.id = tr.id;

  viewport.appendChild(path);

  const totalLength = path.getTotalLength();
  const midPoint = path.getPointAtLength(totalLength / 2);
  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  handle.classList.add('arc-handle');
  handle.setAttribute('r', 7);
  handle.setAttribute('cx', midPoint.x);
  handle.setAttribute('cy', midPoint.y);
  handle.dataset.id = tr.id;

  const clampedT = Math.min(0.95, Math.max(0.05, tr.labelT || 0.5));
  tr.labelT = clampedT;
  const labelPoint = path.getPointAtLength(totalLength * clampedT);
  const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  labelGroup.classList.add('label-handle');
  labelGroup.dataset.id = tr.id;
  labelGroup.setAttribute('transform', `translate(${labelPoint.x} ${labelPoint.y})`);

  const { labelPlain, labelHtml } = transitionLabel(tr);
  const labelWidth = Math.max(46, (labelPlain.length || 4) * 7 + 12);

  const labelRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  labelRect.setAttribute('x', -labelWidth / 2);
  labelRect.setAttribute('y', -16);
  labelRect.setAttribute('width', labelWidth);
  labelRect.setAttribute('height', 24);

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('y', 2);
  label.innerHTML = labelHtml;

  labelGroup.appendChild(labelRect);
  labelGroup.appendChild(label);

  viewport.appendChild(handle);
  viewport.appendChild(labelGroup);
}

function drawPreview() {
  if (!currentArrow || !currentArrow.toPoint) return;
  const from = state.states.find((s) => s.id === currentArrow.from);
  if (!from) return;
  const isSelfPreview = currentArrow.targetId === from.id;
  const to = {
    x: currentArrow.toPoint.x,
    y: currentArrow.toPoint.y,
    radius: currentArrow.toPoint.radius || 0,
  };
  const pathInfo = isSelfPreview
    ? selfLoopPath(from, { loopAngle: currentArrow.loopAngle ?? -Math.PI / 2, arcOffset: 30 })
    : quadraticPath(from, to, currentArrow.arcOffset || 0);
  if (!previewPath) {
    previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.classList.add('arrow-path');
    previewPath.setAttribute('stroke-dasharray', '6 4');
  }
  previewPath.classList.toggle('self-loop', isSelfPreview);
  previewPath.setAttribute('d', pathInfo.d);
  viewport.appendChild(previewPath);
}

function buildChoiceRow(container, name, index, currentValue, prefix) {
  const row = document.createElement('div');
  row.className = 'io-row';
  const label = document.createElement('label');
  label.textContent = name || `Var ${index + 1}`;
  row.appendChild(label);

  const options = document.createElement('div');
  options.className = 'io-options';
  ['1', '0', 'X'].forEach((val) => {
    const span = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `${prefix}-${index}`;
    input.value = val;
    if (currentValue === val) input.checked = true;
    const optLabel = document.createElement('span');
    optLabel.textContent = val === 'X' ? "Don't care" : val;
    span.appendChild(input);
    span.appendChild(optLabel);
    options.appendChild(span);
  });
  row.appendChild(options);
  container.appendChild(row);
}

function populateChoices(container, names, values, prefix) {
  container.innerHTML = '';
  names.forEach((name, idx) => {
    buildChoiceRow(container, name, idx, values[idx] || 'X', prefix);
  });
}

function readChoices(container, names, prefix) {
  return names.map((_, idx) => {
    const checked = container.querySelector(`input[name="${prefix}-${idx}"]:checked`);
    return checked ? checked.value : 'X';
  });
}

function openArrowDialog(targetId) {
  arrowDialogTarget = targetId;
  const tr = state.transitions.find((t) => t.id === targetId);
  normalizeTransition(tr);
  populateChoices(inputChoices, state.inputs, tr.inputValues, 'input');
  populateChoices(outputChoices, state.outputs, tr.outputValues || defaultSelections(state.outputs.length), 'output');
  mealyOutputRow.style.display = state.type === 'mealy' ? 'flex' : 'none';
  openDialog('arrowDialog');
}

function download(filename, content) {
  const link = document.createElement('a');
  link.href = content;
  link.download = filename;
  link.click();
}

function sanitizeFilename(name, fallback = 'kmap') {
  const base = (name || fallback).toString().trim();
  const cleaned = base.replace(/[^a-z0-9_-]+/gi, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function saveState() {
  ensureTransitionTableStructure();
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(`${state.name || 'fsm'}-save.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  clearDirty();
}

function loadState(data) {
  const savedShowBinary = data.showBinary;
  Object.assign(state, data);
  state.numStates = coerceAllowedStateCount(state.numStates);
  state.inputs = normalizeNames(state.inputs || []);
  state.outputs = normalizeNames(state.outputs || []);
  state.showBinary = savedShowBinary !== undefined ? savedShowBinary : true;
  if (!state.transitionTable) state.transitionTable = { cells: {} };
  state.transitionTableVerified = !!data.transitionTableVerified;
  state.kmaps = Array.isArray(data.kmaps)
    ? data.kmaps.map((k) => ({
        ...k,
        id: k.id || Date.now() + Math.random(),
        variables: normalizeNames(k.variables || []),
        cells: k.cells || {},
        expression: k.expression || '',
      }))
    : [];
  undoStack = [];
  selectedArrowId = null;
  selectedStateId = null;
  viewState = { scale: 1, panX: 0, panY: 0 };
  applyViewTransform();
  tablePanel.classList.add('collapsed');
  updateControls();
  toggleTableBtn.textContent = '▾';
  renderTable();
  renderPalette();
  renderTransitionTable();
  renderDiagram();
  renderKmaps();
  verifyTransitionTableAgainstDiagram({ silent: true, recordStatus: false });
  clearDirty();
}

function grayCode(bits) {
  if (bits <= 0) return [''];
  let codes = ['0', '1'];
  for (let i = 1; i < bits; i += 1) {
    const reflected = [...codes].reverse();
    codes = codes.map((c) => `0${c}`).concat(reflected.map((c) => `1${c}`));
  }
  return codes;
}

function formatVariableList(vars) {
  return vars.map((v) => formatScriptedText(v)).join(', ') || '—';
}

const expressionAutocompleteState = new WeakMap();
const expressionEditorState = new WeakMap();

function stripOverlines(text) {
  return (text || '').replace(/\u0305/g, '');
}

function applyOverline(text) {
  return (text || '')
    .split('')
    .map((ch) => (ch.trim() ? `${ch}\u0305` : ch))
    .join('');
}

function tokenizeExpressionInput(raw) {
  const tokens = [];
  const src = stripOverlines(raw);
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '+') {
      tokens.push({ type: 'op', value: '+' });
      i += 1;
      continue;
    }
    if (ch === '*') {
      tokens.push({ type: 'op', value: '*' });
      i += 1;
      continue;
    }
    if (ch === '~') {
      tokens.push({ type: 'not' });
      i += 1;
      continue;
    }
    if (ch === "'") {
      tokens.push({ type: 'not-post' });
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9_^]/.test(ch)) {
      let start = i;
      while (i < src.length && /[A-Za-z0-9_^]/.test(src[i])) i += 1;
      tokens.push({ type: 'var', value: src.slice(start, i) });
      continue;
    }
    i += 1;
  }
  return tokens;
}

function normalizeExpressionTokens(raw) {
  const tokens = tokenizeExpressionInput(raw);
  const normalized = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tk = tokens[i];
    if (tk.type === 'var') {
      let negated = false;
      if (i > 0 && tokens[i - 1].type === 'not') {
        negated = true;
      }
      if (i + 1 < tokens.length && tokens[i + 1].type === 'not-post') {
        negated = true;
        i += 1;
      }
      normalized.push({ type: 'var', value: tk.value, negated });
      continue;
    }
    if (tk.type === 'not') {
      const next = tokens[i + 1];
      if (!next || next.type !== 'var') {
        normalized.push({ type: 'not' });
      }
      continue;
    }
    if (tk.type === 'op' || tk.type === 'paren') {
      normalized.push(tk);
    }
  }
  return normalized;
}

function tokensToCanonical(tokens) {
  const parts = [];
  let prevType = null;
  tokens.forEach((tk, idx) => {
    if (tk.type === 'var') {
      const name = tk.value;
      const base = tk.negated ? `~${name}` : name;
      if (prevType === 'var' || prevType === 'close') {
        parts.push(' ');
      }
      parts.push(base);
      prevType = 'var';
      return;
    }
    if (tk.type === 'op') {
      if (tk.value === '+') {
        parts.push(' + ');
      } else if (tk.value === '*') {
        parts.push(' ');
      }
      prevType = 'op';
      return;
    }
    if (tk.type === 'not') {
      parts.push('~');
      prevType = 'not';
      return;
    }
    if (tk.type === 'paren') {
      if (tk.value === '(' && (prevType === 'var' || prevType === 'close')) {
        parts.push(' ');
      }
      parts.push(tk.value);
      prevType = tk.value === '(' ? 'open' : 'close';
    }
    if (idx === tokens.length - 1) prevType = tk.type;
  });
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function expressionStringToTokens(raw) {
  const normalized = normalizeExpressionTokens(raw || '');
  return normalized
    .filter((tk) => tk.type === 'var' || tk.type === 'op' || tk.type === 'paren')
    .map((tk) => ({
      type: tk.type,
      value: tk.value,
      negated: tk.negated || false,
    }));
}

function buildTrayToken(token) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'kmap-token';
  btn.draggable = true;
  btn.dataset.tokenType = token.type;
  btn.dataset.tokenValue = token.value;
  if (token.type === 'op' || token.type === 'paren') {
    btn.classList.add('kmap-token-operator');
  }
  btn.innerHTML = formatScriptedText(token.value || '');
  return btn;
}

function renderExpressionToken(token, index, kmapId) {
  const el = document.createElement('div');
  el.className = 'kmap-expr-token';
  el.draggable = true;
  el.dataset.tokenType = token.type;
  el.dataset.tokenValue = token.value;
  el.dataset.index = index;
  el.dataset.kmapId = kmapId;
  const inner = document.createElement('span');
  inner.className = 'kmap-expr-token-inner';
  if (token.type === 'op' || token.type === 'paren') {
    el.classList.add('operator');
  }
  if (token.type === 'var') {
    inner.classList.toggle('negated', !!token.negated);
  }
  inner.innerHTML = formatScriptedText(token.value || '');
  el.appendChild(inner);
  return el;
}

function renderExpressionTray(tray, tokens, kmapId) {
  tray.innerHTML = '';
  if (!tokens.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'kmap-expr-placeholder';
    placeholder.textContent = 'Drag items here to build your expression';
    tray.appendChild(placeholder);
    return;
  }
  tokens.forEach((tk, idx) => {
    tray.appendChild(renderExpressionToken(tk, idx, kmapId));
  });
}

function ensureDropMarker(tray) {
  let marker = tray.querySelector('.kmap-drop-marker');
  if (!marker) {
    marker = document.createElement('div');
    marker.className = 'kmap-drop-marker';
  }
  return marker;
}

function clearDropMarker(tray) {
  const marker = tray.querySelector('.kmap-drop-marker');
  if (marker) marker.remove();
}

function updateKmapExpressionTokens(kmap, tokens, tray) {
  kmap.expressionTokens = tokens;
  kmap.expression = tokensToCanonical(tokens) || '';
  if (tray) renderExpressionTray(tray, tokens, kmap.id);
  scheduleKmapCircleRender();
}

function getKmapById(id) {
  return state.kmaps.find((m) => m.id.toString() === id.toString());
}

function tokensToDisplay(tokens) {
  const parts = [];
  let prevType = null;
  tokens.forEach((tk) => {
    if (tk.type === 'var') {
      const rendered = tk.negated ? applyOverline(tk.value) : tk.value;
      const withMarker = tk.negated ? `~${rendered}` : rendered;
      if (prevType === 'var' || prevType === 'close') {
        parts.push(' ');
      }
      parts.push(withMarker);
      prevType = 'var';
      return;
    }
    if (tk.type === 'op') {
      if (tk.value === '+') {
        parts.push('   +   ');
        prevType = 'op';
        return;
      }
      if (prevType && tk.value === '*') {
        parts.push(' ');
        prevType = 'op';
        return;
      }
    }
    if (tk.type === 'not') {
      parts.push('~');
      prevType = 'not';
      return;
    }
    if (tk.type === 'paren') {
      if (tk.value === '(' && (prevType === 'var' || prevType === 'close')) {
        parts.push(' ');
      }
      parts.push(tk.value);
      prevType = tk.value === '(' ? 'open' : 'close';
    }
  });
  return parts.join('').trim();
}

function formatExpressionDisplay(raw, variables) {
  const tokens = normalizeExpressionTokens(raw);
  const canonical = tokensToCanonical(tokens);
  const display = tokensToDisplay(tokens);
  const result = display || canonical || '';
  return result;
}

function normalizeVarName(name) {
  return stripOverlines(name || '').replace(/\s+/g, '').toLowerCase();
}

function getExpressionState(editor, kmap) {
  let state = expressionEditorState.get(editor);
  if (!state) {
    state = {
      raw: kmap?.expression || '',
      caret: (kmap?.expression || '').length,
      scriptMode: null,
      selectedTerm: null,
    };
    expressionEditorState.set(editor, state);
  }
  return state;
}

function buildAutocompleteMatches(prefix, variables) {
  const clean = normalizeVarName(prefix);
  if (!clean) return [];
  return (variables || []).filter((v) => normalizeVarName(v).startsWith(clean));
}

function renderExpressionTerm(name, negated, termIndex) {
  const scripted = formatScriptedText(name || '');
  const base = escapeHtml((name || '').split(/[_^]/)[0] || '');
  const decoration = negated ? 'text-decoration: overline;' : '';
  const baseSpan = `<span class="expr-term-base" style="${decoration}">${base || '&nbsp;'}</span>`;
  return `<span class="expr-term" data-term-index="${termIndex}">${baseSpan}${scripted.replace(
    base,
    '',
  )}</span>`;
}

function renderExpressionHtml(raw) {
  const tokens = normalizeExpressionTokens(raw || '');
  const parts = [];
  let termIndex = 0;
  let prevType = null;
  tokens.forEach((tk) => {
    if (tk.type === 'var') {
      if (prevType === 'var' || prevType === 'close') {
        parts.push('<span class="expr-gap and-gap"></span>');
      }
      parts.push(renderExpressionTerm(tk.value, tk.negated, termIndex));
      termIndex += 1;
      prevType = 'var';
      return;
    }
    if (tk.type === 'op') {
      if (tk.value === '+') {
        parts.push('<span class="expr-gap or-gap"></span>');
        prevType = 'op';
      } else if (tk.value === '*') {
        parts.push('<span class="expr-gap and-gap"></span>');
        prevType = 'op';
      }
      return;
    }
    if (tk.type === 'paren') {
      const cls = tk.value === '(' ? 'expr-paren open' : 'expr-paren close';
      if (tk.value === '(' && (prevType === 'var' || prevType === 'close')) {
        parts.push('<span class="expr-gap and-gap"></span>');
      }
      parts.push(`<span class="${cls}">${escapeHtml(tk.value)}</span>`);
      prevType = tk.value === '(' ? 'open' : 'close';
    }
  });
  return parts.join('') || '&nbsp;';
}

function syncExpressionInput(target, kmap, providedState = null) {
  const state = providedState || getExpressionState(target, kmap);
  const html = renderExpressionHtml(state.raw);
  target.innerHTML = html;
  if (state.selectionMode === 'select' && state.selectedTerm !== null) {
    const termEl = target.querySelector(`[data-term-index="${state.selectedTerm}"]`);
    if (termEl) termEl.classList.add('selected');
  }
  const tokens = normalizeExpressionTokens(state.raw);
  const canonical = tokensToCanonical(tokens);
  if (kmap) kmap.expression = canonical || state.raw.trim();
  if (kmap) scheduleKmapCircleRender();
}

function insertIntoExpression(state, insertText) {
  const left = state.raw.slice(0, state.caret);
  const right = state.raw.slice(state.caret);
  state.raw = `${left}${insertText}${right}`;
  state.caret += insertText.length;
}

function removeFromExpression(state, count) {
  if (state.caret === 0 || count <= 0) return;
  const left = state.raw.slice(0, Math.max(0, state.caret - count));
  const right = state.raw.slice(state.caret);
  state.raw = `${left}${right}`;
  state.caret = Math.max(0, state.caret - count);
}

function handleAutocomplete(state, variables) {
  const prefix = state.raw.slice(0, state.caret).match(/[A-Za-z0-9_^~']+$/)?.[0] || '';
  if (!prefix || state.caret !== state.raw.length) {
    expressionAutocompleteState.set(state, { matches: [], index: 0, start: 0, prefix: '' });
    return null;
  }
  const matches = buildAutocompleteMatches(prefix.replace(/^~/, ''), variables);
  if (!matches.length) return null;
  const entry = { matches, index: 0, start: state.caret - prefix.length, prefix };
  expressionAutocompleteState.set(state, entry);
  return entry;
}

function cycleAutocompleteState(editorState, direction) {
  const entry = expressionAutocompleteState.get(editorState);
  if (!entry || !(entry.matches || []).length) return null;
  const len = entry.matches.length;
  entry.index = (len + entry.index + direction) % len;
  expressionAutocompleteState.set(editorState, entry);
  return entry;
}

function applyAutocomplete(editorState) {
  const entry = expressionAutocompleteState.get(editorState);
  if (!entry || !(entry.matches || []).length) return false;
  const suggestion = entry.matches[entry.index];
  editorState.raw =
    editorState.raw.slice(0, entry.start) + suggestion + editorState.raw.slice(editorState.caret);
  editorState.caret = entry.start + suggestion.length;
  return true;
}

function updateTermSelection(state, direction) {
  const terms = normalizeExpressionTokens(state.raw || '').filter((tk) => tk.type === 'var');
  if (!terms.length) {
    state.selectedTerm = null;
    state.selectionMode = null;
    return;
  }
  if (state.selectedTerm === null) {
    state.selectedTerm = direction < 0 ? terms.length - 1 : 0;
    state.selectionMode = 'select';
    return;
  }
  if (state.selectionMode === 'select') {
    state.selectionMode = 'cursor';
    return;
  }
  const next = state.selectedTerm + direction;
  if (next < 0 || next >= terms.length) {
    state.selectedTerm = null;
    state.selectionMode = null;
    return;
  }
  state.selectedTerm = next;
  state.selectionMode = 'select';
}

function buildImplicitAndTokens(tokens) {
  const result = [];
  tokens.forEach((tk, idx) => {
    result.push(tk);
    const next = tokens[idx + 1];
    if (!next) return;
    const isLeft = tk.type === 'var' || (tk.type === 'paren' && tk.value === ')');
    const isRight =
      next.type === 'var' || next.type === 'not' || (next.type === 'paren' && next.value === '(');
    if (isLeft && isRight) {
      result.push({ type: 'op', value: '*' });
    }
  });
  return result;
}

function toRpn(tokens) {
  const output = [];
  const ops = [];
  const prec = { '~': 3, '*': 2, '+': 1 };
  const assoc = { '~': 'right', '*': 'left', '+': 'left' };
  tokens.forEach((tk) => {
    if (tk.type === 'var') {
      output.push(tk);
      return;
    }
    if (tk.type === 'not' || tk.type === 'not-post') {
      const op = '~';
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[op]) {
        output.push({ type: 'op', value: ops.pop() });
      }
      ops.push(op);
      return;
    }
    if (tk.type === 'op') {
      const op = tk.value;
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        (prec[ops[ops.length - 1]] > prec[op] ||
          (prec[ops[ops.length - 1]] === prec[op] && assoc[op] === 'left'))
      ) {
        output.push({ type: 'op', value: ops.pop() });
      }
      ops.push(op);
      return;
    }
    if (tk.type === 'paren') {
      if (tk.value === '(') {
        ops.push('(');
      } else {
        while (ops.length && ops[ops.length - 1] !== '(') {
          output.push({ type: 'op', value: ops.pop() });
        }
        ops.pop();
      }
    }
  });
  while (ops.length) {
    output.push({ type: 'op', value: ops.pop() });
  }
  return output;
}

function evaluateRpn(rpn, assignmentGetter) {
  const stack = [];
  for (let i = 0; i < rpn.length; i += 1) {
    const tk = rpn[i];
    if (tk.type === 'var') {
      const value = assignmentGetter(tk.value);
      if (value === undefined) return null;
      stack.push(Boolean(value));
      continue;
    }
    if (tk.type === 'op') {
      if (tk.value === '~') {
        const a = stack.pop();
        if (a === undefined) return null;
        stack.push(!a);
        continue;
      }
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return null;
      if (tk.value === '*') stack.push(a && b);
      else if (tk.value === '+') stack.push(a || b);
    }
  }
  const result = stack.pop();
  if (result === undefined || stack.length) return null;
  return result;
}

function buildExpressionTruthTable(expression, variables) {
  const cleanExpr = stripOverlines(expression || '').replace(/\s+/g, ' ').trim();
  if (!cleanExpr) return null;
  const tokens = tokenizeExpressionInput(cleanExpr);
  const prepared = buildImplicitAndTokens(tokens);
  const rpn = toRpn(prepared);
  const table = new Map();
  const normalizedVars = (variables || []).map((v) => ({ raw: v, norm: normalizeVarName(v) }));

  const total = Math.pow(2, normalizedVars.length);
  for (let i = 0; i < total; i += 1) {
    const assignment = {};
    normalizedVars.forEach((v, idx) => {
      const bit = (i >> (normalizedVars.length - idx - 1)) & 1;
      assignment[v.raw] = bit === 1;
      assignment[v.norm] = bit === 1;
    });
    const evalAssignment = (name) => assignment[name] ?? assignment[normalizeVarName(name)];
    const value = evaluateRpn(rpn, (name) => evalAssignment(name));
    if (value === null) return null;
    const key = normalizedVars
      .map((v) => (assignment[v.raw] ? '1' : '0'))
      .join('');
    table.set(key, value ? '1' : '0');
  }
  return table;
}

function buildKmapTruthTable(kmap) {
  const layout = buildKmapLayout(kmap);
  const variables = [...layout.mapVars, ...layout.colVars, ...layout.rowVars];
  const table = new Map();
  const baseRows = layout.baseRows || 1;
  const baseCols = layout.baseCols || 1;

  for (let r = 0; r < layout.totalRows; r += 1) {
    for (let c = 0; c < layout.totalCols; c += 1) {
      const sub = layout.submaps.find(
        (s) => r >= s.rowOffset && r < s.rowOffset + baseRows && c >= s.colOffset && c < s.colOffset + baseCols,
      );
      const mapBits = sub?.mapCode || ''.padEnd(layout.mapVars.length, '0');
      const colCode = layout.colCodes[c - (sub?.colOffset || 0)] || '';
      const rowCode = layout.rowCodes[r - (sub?.rowOffset || 0)] || '';
      const bits = `${mapBits}${colCode}${rowCode}`;
      const assignment = {};
      variables.forEach((name, idx) => {
        assignment[name] = bits[idx] === '1';
      });
      const key = variables.map((v) => (assignment[v] ? '1' : '0')).join('');
      const cellVal = (kmap.cells && kmap.cells[kmapCellKey(r, c)]) || '';
      table.set(key, cellVal || 'X');
    }
  }

  return { table, variables };
}

function verifyKmapExpression(kmap) {
  if (!kmap) return { passed: false, reason: 'No k-map selected' };
  const kmapTable = buildKmapTruthTable(kmap);
  const tokens = kmap.expressionTokens || expressionStringToTokens(kmap.expression || '');
  const canonical = tokensToCanonical(tokens);
  kmap.expression = canonical;
  kmap.expressionTokens = tokens;
  const exprTable = buildExpressionTruthTable(canonical, kmapTable.variables);
  if (!exprTable) return { passed: false, reason: 'Expression is invalid or empty' };
  for (const [key, value] of kmapTable.table.entries()) {
    if (value === 'X') continue;
    const expected = value === '1';
    const exprVal = exprTable.get(key);
    if (exprVal === undefined) return { passed: false, reason: 'Expression incomplete' };
    if ((exprVal === '1') !== expected) {
      return { passed: false, reason: 'Expression output does not match K-map' };
    }
  }
  return { passed: true };
}

function buildKmapLayout(kmap) {
  const variables = kmap.variables || [];
  const mapVarCount = Math.max(0, variables.length - 4);
  const mapVars = variables.slice(0, mapVarCount);
  const coreVars = variables.slice(mapVarCount);
  const moreSigCount = Math.ceil(coreVars.length / 2);
  let moreSig = coreVars.slice(0, moreSigCount);
  let lessSig = coreVars.slice(moreSigCount);
  if (lessSig.length === 0 && moreSig.length > 1) {
    lessSig = [moreSig.pop()];
  }
  let rowVars;
  let colVars;
  if (kmap.direction === 'vertical') {
    rowVars = moreSig;
    colVars = lessSig;
  } else {
    rowVars = lessSig;
    colVars = moreSig;
  }
  if (rowVars.length === 0 && colVars.length) {
    rowVars = [colVars.shift()];
  }
  const rowCodes = grayCode(rowVars.length);
  const colCodes = grayCode(colVars.length);
  const baseRows = rowCodes.length || 1;
  const baseCols = colCodes.length || 1;

  let mapRows = 1;
  let mapCols = 1;
  let mapRowCodes = [''];
  let mapColCodes = [''];

  if (mapVarCount === 1) {
    mapCols = 2;
    mapColCodes = grayCode(1);
  } else if (mapVarCount >= 2) {
    mapRows = 2;
    mapCols = 2;
    mapRowCodes = grayCode(1);
    mapColCodes = grayCode(1);
  }

  const submaps = [];
  for (let mr = 0; mr < mapRows; mr += 1) {
    for (let mc = 0; mc < mapCols; mc += 1) {
      const mapCode = `${mapRowCodes[mr] || ''}${mapColCodes[mc] || ''}`;
      const assignments = mapVars.map((name, idx) => `${name}=${mapCode[idx] || '0'}`);
      submaps.push({
        mapRow: mr,
        mapCol: mc,
        mapCode,
        label: assignments.join(', '),
        rowOffset: mr * baseRows,
        colOffset: mc * baseCols,
      });
    }
  }

  return {
    mapVarCount,
    mapVars,
    rowVars,
    colVars,
    rowCodes,
    colCodes,
    baseRows,
    baseCols,
    mapRows,
    mapCols,
    totalRows: baseRows * mapRows,
    totalCols: baseCols * mapCols,
    submaps,
  };
}

function kmapCellKey(row, col) {
  return `${row}-${col}`;
}

function kmapVariablesForLayout(layout) {
  return [...(layout.mapVars || []), ...(layout.colVars || []), ...(layout.rowVars || [])];
}

function kmapColorForId(kmapId) {
  const idx = state.kmaps.findIndex((m) => m.id === kmapId);
  return kmapCirclePalette[idx >= 0 ? idx % kmapCirclePalette.length : 0];
}

function computeCellKeyForLayout(layout, row, col) {
  const baseRows = layout.baseRows || 1;
  const baseCols = layout.baseCols || 1;
  const sub = (layout.submaps || []).find(
    (s) => row >= s.rowOffset && row < s.rowOffset + baseRows && col >= s.colOffset && col < s.colOffset + baseCols,
  );
  const mapBits = sub?.mapCode || ''.padEnd((layout.mapVars || []).length, '0');
  const colCode = layout.colCodes[col - (sub?.colOffset || 0)] || '';
  const rowCode = layout.rowCodes[row - (sub?.rowOffset || 0)] || '';
  const bits = `${mapBits}${colCode}${rowCode}`;
  const variables = kmapVariablesForLayout(layout);
  const assignment = {};
  variables.forEach((name, idx) => {
    assignment[name] = bits[idx] === '1';
  });
  const key = variables.map((v) => (assignment[v] ? '1' : '0')).join('');
  return { key, submap: sub };
}

function collectKmapCells(kmap, card, layout) {
  const cells = [];
  for (let r = 0; r < layout.totalRows; r += 1) {
    for (let c = 0; c < layout.totalCols; c += 1) {
      const input = card.querySelector(
        `.kmap-cell-input[data-row-index="${r}"][data-col-index="${c}"]`,
      );
      if (!input) continue;
      const { key, submap } = computeCellKeyForLayout(layout, r, c);
      cells.push({ row: r, col: c, key, element: input, submap });
    }
  }
  return cells;
}

function colorWithAlpha(hex, alpha) {
  if (!hex || typeof hex !== 'string') return hex;
  const safe = hex.replace('#', '');
  if (safe.length !== 6) return hex;
  const r = parseInt(safe.slice(0, 2), 16);
  const g = parseInt(safe.slice(2, 4), 16);
  const b = parseInt(safe.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rectDistance(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

function clusterRects(rects, threshold = 28) {
  const clusters = [];
  rects.forEach((rect) => {
    let cluster = clusters.find((c) => rectDistance(c, rect) <= threshold);
    if (!cluster) {
      cluster = { ...rect, boxes: [rect] };
      clusters.push(cluster);
    } else {
      cluster.minX = Math.min(cluster.minX, rect.minX);
      cluster.minY = Math.min(cluster.minY, rect.minY);
      cluster.maxX = Math.max(cluster.maxX, rect.maxX);
      cluster.maxY = Math.max(cluster.maxY, rect.maxY);
      cluster.boxes.push(rect);
    }
  });
  clusters.forEach((c) => {
    c.cx = (c.minX + c.maxX) / 2;
    c.cy = (c.minY + c.maxY) / 2;
  });
  return clusters;
}

function clusterCellsWithWrap(cells, layout, threshold = 28) {
  if (!cells?.length) return [];

  const baseRows = layout?.baseRows || 1;
  const baseCols = layout?.baseCols || 1;
  const clusters = [];
  const visited = new Set();
  const byPosition = new Map();

  cells.forEach((entry, idx) => {
    // Each entry is { rect, cell }; use the logical cell for adjacency checks
    const { cell } = entry;
    const key = `${cell.submap?.mapRow || 0}-${cell.submap?.mapCol || 0}-${cell.row}-${cell.col}`;
    byPosition.set(key, { idx, cell });
  });

  const findNeighbor = (sub, row, col) => {
    const key = `${sub?.mapRow || 0}-${sub?.mapCol || 0}-${row}-${col}`;
    return byPosition.get(key)?.idx;
  };

  const neighbors = (cell) => {
    const { submap, row, col } = cell;
    const localRow = row - (submap?.rowOffset || 0);
    const localCol = col - (submap?.colOffset || 0);
    const upRow = ((localRow - 1 + baseRows) % baseRows) + (submap?.rowOffset || 0);
    const downRow = ((localRow + 1) % baseRows) + (submap?.rowOffset || 0);
    const leftCol = ((localCol - 1 + baseCols) % baseCols) + (submap?.colOffset || 0);
    const rightCol = ((localCol + 1) % baseCols) + (submap?.colOffset || 0);
    return [
      findNeighbor(submap, upRow, col),
      findNeighbor(submap, downRow, col),
      findNeighbor(submap, row, leftCol),
      findNeighbor(submap, row, rightCol),
    ].filter((v) => v !== undefined);
  };

  const stack = [];
  const addCluster = (seedIdx) => {
    stack.length = 0;
    stack.push(seedIdx);
    const rects = [];
    visited.add(seedIdx);
    while (stack.length) {
      const idx = stack.pop();
      const { rect, cell } = cells[idx];
      rects.push(rect);
      neighbors(cell).forEach((nIdx) => {
        if (!visited.has(nIdx)) {
          visited.add(nIdx);
          stack.push(nIdx);
        }
      });
    }
    clusters.push(rects);
  };

  cells.forEach((entry, idx) => {
    if (!visited.has(idx)) addCluster(idx);
  });

  // Preserve the logical clusters, then group purely by spatial distance so wrapping
  // cells don't merge into a single bounding box unless they are actually adjacent.
  const flatRects = clusters.flat();

  return clusterRects(flatRects, threshold);
}

function splitExpressionSections(tokens = []) {
  const sections = [];
  let depth = 0;
  let current = [];

  const pushCurrent = () => {
    if (current.some((tk) => tk.type === 'var')) {
      sections.push(current);
    }
    current = [];
  };

  tokens.forEach((tk) => {
    if (tk.type === 'op' && tk.value === '+' && depth === 0) {
      pushCurrent();
      return;
    }
    current.push(tk);
    if (tk.type === 'paren') {
      if (tk.value === '(') depth += 1;
      else if (tk.value === ')') depth = Math.max(0, depth - 1);
    }
  });

  pushCurrent();
  return sections;
}

function renderKmapCircles(root = null) {
  const context = root || document;

  context.querySelectorAll('.kmap-circle-overlay').forEach((ov) => {
    ov.innerHTML = '';
    ov.classList.toggle('hidden', !showKmapCircles && !root);
  });
  if (!showKmapCircles && !root) return;

  let cards;
  if (root) {
    cards = root.classList.contains('kmap-card')
      ? [root]
      : Array.from(root.querySelectorAll('.kmap-card'));
  } else {
    cards = Array.from(kmapList?.querySelectorAll('.kmap-card') || []);
  }
  cards.forEach((card) => {
    const kmap = getKmapById(card.dataset.kmapId);
    if (!kmap || !kmap.expression) return;
    const layout = buildKmapLayout(kmap);
    const variables = kmapVariablesForLayout(layout);
    const tokens = kmap.expressionTokens || expressionStringToTokens(kmap.expression || '');
    const sections = splitExpressionSections(tokens);
    if (!sections.length) return;
    const cells = collectKmapCells(kmap, card, layout);
    const overlay = card.querySelector('.kmap-circle-overlay');
    if (!overlay) return;
    const overlayRect = overlay.getBoundingClientRect();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    overlay.appendChild(svg);

    const paletteOffset = state.kmaps.findIndex((m) => m.id === kmap.id) % kmapCirclePalette.length;

    sections.forEach((sectionTokens, sectionIdx) => {
      const canonical = tokensToCanonical(sectionTokens);
      const sectionTable = buildExpressionTruthTable(canonical, variables);
      if (!sectionTable) return;
      const padding = -4;
      const activeCells = cells
        .map((cell) => {
          if (sectionTable.get(cell.key) !== '1') return null;
          // Use the parent cell (td) dimensions so adjacent cells physically touch.
          // This ensures the gap is 0px, guaranteeing a merge.
          const target = cell.element.closest('td') || cell.element.parentElement;
          const rect = target.getBoundingClientRect();
          return {
            rect: {
              minX: rect.left - overlayRect.left - padding,
              minY: rect.top - overlayRect.top - padding,
              maxX: rect.right - overlayRect.left + padding,
              maxY: rect.bottom - overlayRect.top + padding,
            },
            cell,
          };
        })
        .filter(Boolean);

      if (!activeCells.length) return;

      const clusters = clusterCellsWithWrap(activeCells, layout, 32);
      const strokeColor = kmapCirclePalette[(paletteOffset + sectionIdx) % kmapCirclePalette.length];
      const fillColor = colorWithAlpha(strokeColor, 0.12);

      clusters.forEach((cl) => {
        const rectEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rectEl.setAttribute('x', cl.minX);
        rectEl.setAttribute('y', cl.minY);
        rectEl.setAttribute('width', cl.maxX - cl.minX);
        rectEl.setAttribute('height', cl.maxY - cl.minY);
        rectEl.setAttribute('rx', 14);
        rectEl.setAttribute('ry', 14);
        rectEl.setAttribute('fill', fillColor);
        rectEl.setAttribute('stroke', strokeColor);
        rectEl.setAttribute('stroke-width', '2');
        rectEl.setAttribute('class', 'kmap-circle-rect');
        svg.appendChild(rectEl);
      });

      const sorted = [...clusters].sort((a, b) => (a.minX === b.minX ? a.minY - b.minY : a.minX - b.minX));
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const start = sorted[i];
        const end = sorted[i + 1];
        const dx = end.cx - start.cx;
        const dy = end.cy - start.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const offset = Math.min(40, dist / 3);
        const cx = (start.cx + end.cx) / 2 - (dy / dist) * offset;
        const cy = (start.cy + end.cy) / 2 + (dx / dist) * offset;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${start.cx} ${start.cy} Q ${cx} ${cy} ${end.cx} ${end.cy}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '8 6');
        path.setAttribute('class', 'kmap-circle-link');
        svg.appendChild(path);
      }
    });
  });
}

function scheduleKmapCircleRender() {
  requestAnimationFrame(() => renderKmapCircles());
}

function setShowKmapCircles(value) {
  const next = !!value;
  if (showKmapCircles === next) return;
  showKmapCircles = next;
  syncKmapCircleToggleLabel();
  scheduleKmapCircleRender();
}

function toggleKmapCircles() {
  setShowKmapCircles(!showKmapCircles);
}

function syncKmapCircleToggleLabel() {
  if (!kmapCircleToggle) return;
  kmapCircleToggle.textContent = showKmapCircles ? 'Hide Circles' : 'Show Circles';
}

function buildKmapCornerLabel(layout) {
  const corner = document.createElement('div');
  corner.className = 'kmap-corner-label';
  const diagonal = document.createElement('div');
  diagonal.className = 'kmap-diagonal';
  corner.appendChild(diagonal);

  const buildBlock = (vars, blockClass) => {
    const block = document.createElement('div');
    block.className = `kmap-variable-block ${blockClass}`;
    const list = vars.length ? vars : ['—'];
    list.forEach((name, idx) => {
      const span = document.createElement('span');
      const positionClass = idx === 0 ? 'kmap-var-top' : idx === 1 ? 'kmap-var-bottom' : '';
      span.className = `kmap-var ${positionClass}`.trim();
      span.innerHTML = formatScriptedText(name);
      block.appendChild(span);
    });
    return block;
  };

  corner.appendChild(buildBlock(layout.rowVars, 'kmap-vars-row'));
  corner.appendChild(buildBlock(layout.colVars, 'kmap-vars-col'));
  return corner;
}

function buildKmapTable(kmap, layout, submap) {
  const table = document.createElement('table');
  table.className = 'kmap-table';

  const headerRow = document.createElement('tr');
  const cornerCell = document.createElement('th');
  cornerCell.rowSpan = 1;
  cornerCell.appendChild(buildKmapCornerLabel(layout));
  headerRow.appendChild(cornerCell);

  layout.colCodes.forEach((code) => {
    const th = document.createElement('th');
    const span = document.createElement('span');
    span.className = 'kmap-gray-code kmap-gray-col';
    span.textContent = code || '0';
    th.appendChild(span);
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  layout.rowCodes.forEach((rowCode, rIdx) => {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    const span = document.createElement('span');
    span.className = 'kmap-gray-code kmap-gray-row';
    span.textContent = rowCode || '0';
    rowHeader.appendChild(span);
    tr.appendChild(rowHeader);

    layout.colCodes.forEach((colCode, cIdx) => {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      const rowIndex = submap.rowOffset + rIdx;
      const colIndex = submap.colOffset + cIdx;
      input.dataset.kmapId = kmap.id;
      input.dataset.rowIndex = rowIndex;
      input.dataset.colIndex = colIndex;
      input.dataset.totalRows = layout.totalRows;
      input.dataset.totalCols = layout.totalCols;
      input.classList.add('kmap-cell-input');
      input.value = (kmap.cells && kmap.cells[kmapCellKey(rowIndex, colIndex)]) || '';
      td.appendChild(input);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  return table;
}

function renderKmaps() {
  if (!kmapList) return;
  kmapList.innerHTML = '';
  const hasKmaps = (state.kmaps || []).length > 0;
  kmapEmptyState.classList.toggle('hidden', hasKmaps);

  state.kmaps.forEach((kmap) => {
    const card = document.createElement('div');
    card.className = 'kmap-card';
    card.dataset.kmapId = kmap.id;
    const layout = buildKmapLayout(kmap);
    card.dataset.totalRows = layout.totalRows;
    card.dataset.totalCols = layout.totalCols;

    const heading = document.createElement('span');
    heading.className = 'kmap-title';
    heading.innerHTML = formatScriptedText(kmap.label || 'K-map');
    card.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'kmap-meta';
    meta.innerHTML = `
      <span><strong>Type:</strong> ${kmap.type?.toUpperCase() || 'SOP'}</span>
      <span><strong>Direction:</strong> ${kmap.direction === 'vertical' ? 'Vertical' : 'Horizontal'}</span>
      <span><strong>Variables:</strong> ${formatVariableList(kmap.variables || [])}</span>
    `;
    card.appendChild(meta);

    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'kmap-grid-wrapper';
    const gridCollection = document.createElement('div');
    gridCollection.className = 'kmap-grid-collection';
    gridCollection.style.gridTemplateColumns = `repeat(${layout.mapCols}, minmax(${layout.baseCols * 60 + 90}px, 1fr))`;

    layout.submaps.forEach((sub) => {
      const submap = document.createElement('div');
      submap.className = 'kmap-submap';
      submap.style.gridColumn = sub.mapCol + 1;
      submap.style.gridRow = sub.mapRow + 1;
      const label = document.createElement('div');
      label.className = 'kmap-submap-label';
      label.innerHTML = sub.label ? formatScriptedText(sub.label) : '&nbsp;';
      submap.appendChild(label);
      submap.appendChild(buildKmapTable(kmap, layout, sub));
      gridCollection.appendChild(submap);
    });

    const overlay = document.createElement('div');
    overlay.className = 'kmap-circle-overlay';

    gridWrapper.appendChild(gridCollection);
    gridWrapper.appendChild(overlay);
    card.appendChild(gridWrapper);

    const expressionRow = document.createElement('div');
    expressionRow.className = 'kmap-expression';
    const symbol = kmap.type === 'pos' ? 'Π' : 'Σ';

    const variableTray = document.createElement('div');
    variableTray.className = 'kmap-variable-tray';
    const trayLabel = document.createElement('span');
    trayLabel.className = 'kmap-tray-label';
    trayLabel.textContent = 'Variables';
    variableTray.appendChild(trayLabel);
    const trayItems = document.createElement('div');
    trayItems.className = 'kmap-variable-items';
    const tokens = kmap.variables?.length ? kmap.variables : ['—'];
    tokens.forEach((name) => {
      trayItems.appendChild(buildTrayToken({ type: 'var', value: name }));
    });
    ['+', '*', '(', ')'].forEach((op) => {
      trayItems.appendChild(buildTrayToken({ type: op === '(' || op === ')' ? 'paren' : 'op', value: op }));
    });
    variableTray.appendChild(trayItems);
    expressionRow.appendChild(variableTray);

    const label = document.createElement('span');
    label.className = 'kmap-expression-label';
    label.innerHTML = `${formatScriptedText(kmap.label || 'K-map')} ${symbol} =`;
    expressionRow.appendChild(label);

    const exprTrayWrapper = document.createElement('div');
    exprTrayWrapper.className = 'kmap-expression-tray-wrapper';
    const exprTray = document.createElement('div');
    exprTray.className = 'kmap-expression-tray';
    exprTray.tabIndex = 0;
    exprTray.dataset.kmapId = kmap.id;
    const parsedTokens = kmap.expressionTokens || expressionStringToTokens(kmap.expression || '');
    kmap.expressionTokens = parsedTokens;
    renderExpressionTray(exprTray, parsedTokens, kmap.id);
    exprTrayWrapper.appendChild(exprTray);

    const controls = document.createElement('div');
    controls.className = 'kmap-expression-actions';
    const verifyBtn = document.createElement('button');
    verifyBtn.textContent = 'Verify';
    verifyBtn.type = 'button';
    verifyBtn.dataset.verifyKmap = kmap.id;
    verifyBtn.hidden = true;
    controls.appendChild(verifyBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove K-map';
    removeBtn.dataset.removeKmap = kmap.id;
    controls.appendChild(removeBtn);

    exprTrayWrapper.appendChild(controls);
    expressionRow.appendChild(exprTrayWrapper);

    card.appendChild(expressionRow);
    kmapList.appendChild(card);
  });

  syncKmapCircleToggleLabel();
  scheduleKmapCircleRender();
}

function openKmapWindow() {
  if (!kmapWindow) return;
  renderKmaps();
  if (kmapWindowState.left === null || kmapWindowState.top === null) {
    const centeredLeft = Math.max(12, (window.innerWidth - kmapWindowState.width) / 2);
    const centeredTop = Math.max(12, (window.innerHeight - kmapWindowState.height) / 2);
    kmapWindowState.left = centeredLeft;
    kmapWindowState.top = centeredTop;
  }
  kmapWindow.style.width = `${kmapWindowState.width}px`;
  kmapWindow.style.height = `${kmapWindowState.height}px`;
  kmapWindow.style.left = `${kmapWindowState.left}px`;
  kmapWindow.style.top = `${kmapWindowState.top}px`;
  kmapWindow.style.transform = 'none';
  kmapWindow.classList.remove('hidden');
}

function showKmapWorkspace() {
  openTransitionDrawer();
  openKmapWindow();
}

function closeKmapWindow() {
  if (kmapWindow) kmapWindow.classList.add('hidden');
}

function resetKmapDialog() {
  kmapLabelInput.value = kmapFormMemory.label || '';
  kmapVariablesInput.value = kmapFormMemory.variables || '';
  kmapTypeInput.value = kmapFormMemory.type || 'sop';
  kmapDirectionInput.value = kmapFormMemory.direction || 'horizontal';
  confirmKmapCreate.disabled = true;
}

function validateKmapDialog() {
  const vars = parseKmapVariables(kmapVariablesInput.value);
  const label = kmapLabelInput.value.trim();
  const isValid = vars.length >= 2 && vars.length <= 6 && label.length > 0;
  confirmKmapCreate.disabled = !isValid;
}

function openKmapDialog() {
  resetKmapDialog();
  validateKmapDialog();
  openDialog('kmapCreateDialog');
}

function createKmapFromDialog() {
  const variables = parseKmapVariables(kmapVariablesInput.value);
  const label = kmapLabelInput.value.trim() || 'K-map';
  kmapFormMemory = {
    label,
    variables: kmapVariablesInput.value,
    type: kmapTypeInput.value,
    direction: kmapDirectionInput.value,
  };
  const newMap = {
    id: Date.now(),
    label,
    variables,
    type: kmapTypeInput.value,
    direction: kmapDirectionInput.value,
    cells: {},
    expression: '',
  };
  state.kmaps.push(newMap);
  renderKmaps();
  closeDialog('kmapCreateDialog');
  showKmapWorkspace();
  markDirty();
}

function captureImage(element, filename) {
  if (!element) return;

  const cleanups = [];
  const tempStyle = (el, styles) => {
    const prev = {};
    Object.entries(styles).forEach(([key, value]) => {
      prev[key] = el.style[key];
      el.style[key] = value;
    });
    cleanups.push(() => {
      Object.entries(prev).forEach(([key, value]) => {
        el.style[key] = value;
      });
    });
  };

  if (element.classList?.contains('collapsed')) {
    element.classList.remove('collapsed');
    cleanups.push(() => element.classList.add('collapsed'));
  }

  const themeBg =
    getComputedStyle(document.body).getPropertyValue('--bg').trim() ||
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const captureBg = document.body.classList.contains('dark') ? themeBg || '#0b1221' : '#ffffff';
  tempStyle(element, { background: captureBg, backgroundImage: 'none' });
  tempStyle(element, { boxShadow: 'none' });

  const shadowedNodes = Array.from(element.querySelectorAll('*')).filter((node) => {
    const shadow = getComputedStyle(node).boxShadow;
    return shadow && shadow !== 'none';
  });
  shadowedNodes.forEach((node) => tempStyle(node, { boxShadow: 'none' }));

  tempStyle(element, { overflow: 'visible', maxHeight: 'none', height: 'auto' });
  const scrollableChild = element.querySelector('.table-wrapper, .drawer-table-wrapper');
  if (scrollableChild) {
    tempStyle(scrollableChild, { overflow: 'visible', maxHeight: 'none', height: 'auto' });
    scrollableChild.scrollTop = 0;
    scrollableChild.scrollLeft = 0;
  }
  const tableEl = element.querySelector('#transitionTable');
  const tableWrapper = element.querySelector('.drawer-table-wrapper');
  const wrapperStyles = tableWrapper ? getComputedStyle(tableWrapper) : null;
  const paddingX = wrapperStyles
    ? parseFloat(wrapperStyles.paddingLeft || '0') + parseFloat(wrapperStyles.paddingRight || '0')
    : 0;
  const paddingY = wrapperStyles
    ? parseFloat(wrapperStyles.paddingTop || '0') + parseFloat(wrapperStyles.paddingBottom || '0')
    : 0;
  if (tableEl) {
    tempStyle(tableEl, { width: `${tableEl.scrollWidth}px`, height: 'auto' });
  }

  const width = Math.max(
    element.scrollWidth || element.clientWidth || 0,
    scrollableChild ? scrollableChild.scrollWidth || 0 : 0,
    tableEl ? tableEl.scrollWidth + paddingX : 0,
    element.offsetWidth || 0,
  );
  const height = Math.max(
    element.scrollHeight || element.clientHeight || 0,
    scrollableChild ? scrollableChild.scrollHeight || 0 : 0,
    tableEl ? tableEl.scrollHeight + paddingY : 0,
    element.offsetHeight || 0,
  );
  const maxDimension = 2500;
  const scale = Math.min(1, maxDimension / Math.max(width, height, 1));

  tempStyle(element, { width: `${width}px`, height: `${height}px` });
  if (scrollableChild) {
    tempStyle(scrollableChild, { width: `${width}px`, height: `${height}px` });
  }

  html2canvas(element, {
    backgroundColor: captureBg,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scale,
    scrollX: 0,
    scrollY: -window.scrollY,
  })
    .then((canvas) => {
      const url = canvas.toDataURL('image/png');
      download(filename, url);
    })
    .finally(() => {
      cleanups.reverse().forEach((fn) => fn());
    });
}

function openTransitionDrawer() {
  renderTransitionTable();
  transitionDrawer.classList.add('open');
  document.body.classList.add('drawer-open');
  document.documentElement.style.setProperty('--drawer-width', `${drawerWidth}px`);
}

function closeTransitionDrawer() {
  transitionDrawer.classList.remove('open');
  document.body.classList.remove('drawer-open');
}

function updateDrawerWidth(width) {
  const maxAllowed = Math.max(320, window.innerWidth - 260);
  const maxWidth = Math.min(window.innerWidth * 0.85, maxAllowed);
  drawerWidth = Math.max(320, Math.min(width, Math.floor(maxWidth)));
  document.documentElement.style.setProperty('--drawer-width', `${drawerWidth}px`);
}

function toggleTransitionDrawer() {
  if (transitionDrawer.classList.contains('open')) {
    closeTransitionDrawer();
  } else {
    openTransitionDrawer();
  }
}

async function captureTransitionDrawerImage() {
  const table = document.getElementById('transitionTable');
  if (!table) return;

  const wasOpen = transitionDrawer.classList.contains('open');
  if (!wasOpen) openTransitionDrawer();

  const clone = table.cloneNode(true);
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.opacity = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.zIndex = '9999';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  await new Promise(requestAnimationFrame);

  const width = clone.scrollWidth;
  const height = clone.scrollHeight;

  const canvas = await html2canvas(clone, {
    width,
    height,
    scale: window.devicePixelRatio || 1,
    useCORS: true,
    backgroundColor: '#fff',
  });

  const url = canvas.toDataURL('image/png');
  download(`${state.name}-transition-table.png`, url);

  document.body.removeChild(wrapper);
  if (!wasOpen) closeTransitionDrawer();
}

function buildKmapExportClone(card, kmap) {
  const clone = card.cloneNode(true);
  const kmapBody = kmapWindow?.querySelector('.kmap-window-body');
  const declaredWidth = kmapWindow ? parseFloat(kmapWindow.style.width || '0') || 0 : 0;
  const windowRect = kmapWindow?.getBoundingClientRect();
  const bodyRect = kmapBody?.getBoundingClientRect();
  const exportWidth = Math.max(
    windowRect?.width || 0,
    bodyRect?.width || 0,
    kmapWindow?.scrollWidth || 0,
    declaredWidth,
    kmapWindowState?.width || 0,
    card.scrollWidth || 0,
    card.getBoundingClientRect().width || 0,
    840,
  );

  clone.style.width = `${exportWidth}px`;
  clone.style.maxWidth = `${exportWidth}px`;
  clone.classList.add('exporting');

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '0';
  wrapper.style.top = '0';
  wrapper.style.width = `${exportWidth}px`;
  wrapper.style.opacity = '0';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.background = '#fff';
  wrapper.style.zIndex = '9999';
  wrapper.appendChild(clone);

  return { wrapper, clone };
}

function showKmapExportTest() {
  renderKmaps();
  const firstCard = kmapList?.querySelector('.kmap-card');
  if (!firstCard) {
    window.alert('No k-maps available to test.');
    return;
  }

  const kmap = getKmapById(firstCard.dataset.kmapId);
  if (!kmap) {
    window.alert('Unable to locate the first k-map.');
    return;
  }

  const { clone } = buildKmapExportClone(firstCard, kmap);
  const overlay = document.createElement('div');
  overlay.className = 'kmap-test-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const frame = document.createElement('div');
  frame.className = 'kmap-test-frame';

  const header = document.createElement('div');
  header.className = 'kmap-test-frame-header';
  const title = document.createElement('div');
  title.textContent = 'K-map export clone preview';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ghost';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.append(title, closeBtn);

  frame.append(header, clone);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);
}

async function captureKmapImagesZip() {
  if (!state.kmaps.length) return;
  if (typeof JSZip === 'undefined') {
    window.alert('Unable to export k-maps because the ZIP library is unavailable.');
    return;
  }

  const shouldRenderCircles = showKmapCircles;
  const wasWindowHidden = kmapWindow?.classList.contains('hidden');
  const previousVisibility = kmapWindow?.style.visibility;
  if (kmapWindow && wasWindowHidden) {
    kmapWindow.classList.remove('hidden');
    kmapWindow.style.visibility = 'hidden';
  }
  renderKmaps();
  if (shouldRenderCircles) {
    renderKmapCircles();
    await new Promise(requestAnimationFrame);
  }
  const cards = Array.from(kmapList.querySelectorAll('.kmap-card'));
  if (!cards.length) return;

  const zip = new JSZip();

  if (kmapZipStatus) {
    kmapZipStatus.classList.remove('hidden');
  }

  try {
    for (const card of cards) {
    const kmap = getKmapById(card.dataset.kmapId);
    if (!kmap) continue;

    const { wrapper, clone } = buildKmapExportClone(card, kmap);
    document.body.appendChild(wrapper);
    if (shouldRenderCircles) {
      renderKmapCircles(clone);
      await new Promise(requestAnimationFrame);
    }
    await new Promise(requestAnimationFrame);

      const width = clone.scrollWidth;
      const height = clone.scrollHeight;

      const canvas = await html2canvas(clone, {
        backgroundColor: '#fff',
        width,
        height,
        scale: window.devicePixelRatio || 1,
        useCORS: true,
      });

      const url = canvas.toDataURL('image/png');
      const base64 = url.split(',')[1];
      const filename = `${sanitizeFilename(kmap.label || 'kmap')}.png`;
      zip.file(filename, base64, { base64: true });

      document.body.removeChild(wrapper);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(blob);
    download(`${sanitizeFilename(state.name || 'fsm')}-kmaps.zip`, zipUrl);
    setTimeout(() => URL.revokeObjectURL(zipUrl), 1000);
  } finally {
    if (kmapZipStatus) {
      kmapZipStatus.classList.add('hidden');
    }
    if (shouldRenderCircles) {
      renderKmapCircles();
    }
    if (kmapWindow && wasWindowHidden) {
      kmapWindow.classList.add('hidden');
      kmapWindow.style.visibility = previousVisibility || '';
    }
  }
}

function applyViewTransform() {
  viewport.setAttribute(
    'transform',
    `translate(${viewState.panX} ${viewState.panY}) scale(${viewState.scale})`
  );
}

function withPrevent(fn) {
  return (e) => {
    e.preventDefault();
    fn(e);
  };
}

function nearestTOnPath(path, point) {
  const total = path.getTotalLength();
  let closestT = 0.5;
  let minDist = Infinity;
  const steps = 80;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const pt = path.getPointAtLength(total * t);
    const dist = Math.hypot(pt.x - point.x, pt.y - point.y);
    if (dist < minDist) {
      minDist = dist;
      closestT = t;
    }
  }
  return closestT;
}

function cloneTransition(tr) {
  return JSON.parse(JSON.stringify(tr));
}

function deleteStateById(stateId) {
  const st = state.states.find((s) => s.id === stateId);
  if (!st || !st.placed) return;
  const removedTransitions = [];
  state.transitions = state.transitions.filter((tr) => {
    const shouldRemove = tr.from === stateId || tr.to === stateId;
    if (shouldRemove) removedTransitions.push(cloneTransition(tr));
    return !shouldRemove;
  });
  undoStack.push({
    type: 'stateDeletion',
    stateId,
    prevState: { placed: st.placed, x: st.x, y: st.y, radius: st.radius },
    removedTransitions,
  });
  st.placed = false;
  selectedStateId = null;
  selectedArrowId = null;
  renderPalette();
  renderDiagram();
  markDirty();
}

function deleteTransitionById(transitionId) {
  const idx = state.transitions.findIndex((t) => t.id === transitionId);
  if (idx === -1) return;
  const [removed] = state.transitions.splice(idx, 1);
  if (removed) {
    undoStack.push({ type: 'transitionDeletion', transition: cloneTransition(removed) });
  }
  selectedArrowId = null;
  renderDiagram();
  markDirty();
}

function undoLastDelete() {
  const action = undoStack.pop();
  if (!action) return;
  if (action.type === 'transitionAddition') {
    const idx = state.transitions.findIndex((t) => t.id === action.transitionId);
    if (idx !== -1) state.transitions.splice(idx, 1);
    if (selectedArrowId === action.transitionId) selectedArrowId = null;
    renderDiagram();
    markDirty();
    return;
  }
  if (action.type === 'transitionDeletion') {
    state.transitions.push(action.transition);
    selectedArrowId = action.transition.id;
    renderDiagram();
    markDirty();
    return;
  }
  if (action.type === 'stateDeletion') {
    const st = state.states.find((s) => s.id === action.stateId);
    if (st) {
      st.placed = action.prevState.placed;
      st.x = action.prevState.x;
      st.y = action.prevState.y;
      st.radius = action.prevState.radius;
    }
    action.removedTransitions.forEach((tr) => state.transitions.push(tr));
    selectedStateId = action.stateId;
    selectedArrowId = null;
    renderPalette();
    renderDiagram();
    markDirty();
  }
}

function attachEvents() {
  updateDrawerWidth(Math.min(drawerWidth, Math.floor(window.innerWidth * 0.85)));

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeDialog(btn.dataset.close));
  });

  fileMenuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = fileMenu.classList.contains('hidden');
    closeAllDropdowns();
    if (willOpen) fileMenu.classList.remove('hidden');
  });

  settingsMenuButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = settingsMenu.classList.contains('hidden');
    closeAllDropdowns();
    if (willOpen) settingsMenu.classList.remove('hidden');
  });

  document.getElementById('newMachineBtn').addEventListener('click', () =>
    promptToSaveIfDirty(() => openDialog('newMachineDialog'))
  );
  toolbarNewMachine.addEventListener('click', () => {
    closeAllDropdowns();
    promptToSaveIfDirty(() => openDialog('newMachineDialog'));
  });
  document.getElementById('quickRef').addEventListener('click', () => openDialog('quickRefDialog'));
  if (toggleTransitionBuilderBtn && transitionColumnBuilder) {
    toggleTransitionBuilderBtn.addEventListener('click', () => {
      const collapsed = transitionColumnBuilder.classList.toggle('collapsed');
      toggleTransitionBuilderBtn.textContent = collapsed ? 'Show builder' : 'Hide builder';
      toggleTransitionBuilderBtn.setAttribute('aria-expanded', (!collapsed).toString());
    });
  }
  document.getElementById('kmapToggle').addEventListener('click', () => {
    if (kmapWindow.classList.contains('hidden')) showKmapWorkspace();
    else closeKmapWindow();
  });
  if (kmapCircleToggle) {
    kmapCircleToggle.addEventListener('click', toggleKmapCircles);
  }
  if (kmapQuickRefBtn && kmapQuickRefDialog) {
    kmapQuickRefBtn.addEventListener('click', () => {
      const isHidden = kmapQuickRefDialog.classList.contains('hidden');
      if (isHidden) openDialog('kmapQuickRefDialog');
      else closeDialog('kmapQuickRefDialog');
    });
  }
  document.getElementById('testKmapBtn').addEventListener('click', showKmapExportTest);
  document.getElementById('newKmapBtn').addEventListener('click', openKmapDialog);
  document.getElementById('closeKmapWindow').addEventListener('click', closeKmapWindow);
  confirmKmapCreate.addEventListener('click', createKmapFromDialog);
  kmapLabelInput.addEventListener('input', validateKmapDialog);
  kmapVariablesInput.addEventListener('input', validateKmapDialog);
  kmapWindowHeader.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    const rect = kmapWindow.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const moveHandler = (ev) => {
      const newLeft = Math.min(Math.max(0, ev.clientX - offsetX), window.innerWidth - rect.width + 12);
      const newTop = Math.min(Math.max(0, ev.clientY - offsetY), window.innerHeight - rect.height + 12);
      kmapWindowState.left = newLeft;
      kmapWindowState.top = newTop;
      kmapWindow.style.left = `${newLeft}px`;
      kmapWindow.style.top = `${newTop}px`;
      kmapWindow.style.transform = 'none';
    };
    const upHandler = () => {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  });

  kmapResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = kmapWindow.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = rect.width;
    const startHeight = rect.height;
    showKmapCirclesBeforeResize = showKmapCircles;
    if (showKmapCirclesBeforeResize) setShowKmapCircles(false);
    const resizeHandler = (ev) => {
      const newWidth = Math.max(520, Math.min(window.innerWidth - rect.left - 12, startWidth + (ev.clientX - startX)));
      const newHeight = Math.max(320, Math.min(window.innerHeight - rect.top - 12, startHeight + (ev.clientY - startY)));
      kmapWindowState.width = newWidth;
      kmapWindowState.height = newHeight;
      kmapWindow.style.width = `${newWidth}px`;
      kmapWindow.style.height = `${newHeight}px`;
    };
    const stopResize = () => {
      document.removeEventListener('mousemove', resizeHandler);
      document.removeEventListener('mouseup', stopResize);
      if (showKmapCirclesBeforeResize) {
        setShowKmapCircles(true);
        showKmapCirclesBeforeResize = false;
      }
    };
    document.addEventListener('mousemove', resizeHandler);
    document.addEventListener('mouseup', stopResize);
  });

  document.getElementById('createMachine').addEventListener('click', () => {
    state.name = document.getElementById('machineName').value || 'Untitled Machine';
    state.type = document.getElementById('machineType').value;
    state.numStates = coerceAllowedStateCount(document.getElementById('stateCount').value);
    state.inputs = parseList(document.getElementById('inputVars').value);
    state.outputs = parseList(document.getElementById('outputVars').value);
    viewState = { scale: 1, panX: 0, panY: 0 };
    applyViewTransform();
    initStates();
    updateControls();
    renderTable();
    renderPalette();
    renderTransitionTable();
    renderDiagram();
    state.kmaps = [];
    renderKmaps();
    closeDialog('newMachineDialog');
    landing.classList.add('hidden');
    setVerificationStatus(null);
    clearDirty();
  });

  document.getElementById('loadMachineInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = JSON.parse(reader.result);
      loadState(data);
      landing.classList.add('hidden');
    };
    reader.readAsText(file);
  });

  document.getElementById('loadButton').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = JSON.parse(reader.result);
      loadState(data);
    };
    reader.readAsText(file);
    closeAllDropdowns();
  });

  document.getElementById('toggleTransitionDrawer').addEventListener('click', toggleTransitionDrawer);
  document
    .getElementById('verifyTransitionTable')
    .addEventListener('click', verifyTransitionTableAgainstDiagram);
  document.getElementById('closeTransitionDrawer').addEventListener('click', closeTransitionDrawer);

  transitionDrawerHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;
    const moveHandler = (ev) => {
      const delta = startX - ev.clientX;
      updateDrawerWidth(startWidth + delta);
    };
    const upHandler = () => {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  });

  window.addEventListener('resize', () => {
    updateDrawerWidth(drawerWidth);
    scheduleKmapCircleRender();
  });

  window.addEventListener('beforeunload', (e) => {
    if (!unsavedChanges) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.getElementById('saveButton').addEventListener('click', () => {
    closeAllDropdowns();
    saveState();
  });
  saveImageDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = saveImageMenu.classList.contains('hidden');
    closeAllDropdowns({ keepFile: true });
    if (willOpen) saveImageMenu.classList.remove('hidden');
  });
  document.getElementById('saveImageTable').addEventListener('click', () => {
    closeAllDropdowns();
    captureImage(tablePanel, `${state.name}-state-definition-table.png`);
  });
  document.getElementById('saveImageDiagram').addEventListener('click', () => {
    closeAllDropdowns();
    captureImage(document.querySelector('.playmat'), `${state.name}-state-diagram.png`);
  });
  document.getElementById('saveImageTransitionTable').addEventListener('click', () => {
    closeAllDropdowns();
    captureTransitionDrawerImage();
  });
  document.getElementById('saveImageKmaps').addEventListener('click', () => {
    closeAllDropdowns();
    captureKmapImagesZip();
  });

  toggleTableBtn.addEventListener('click', () => {
    tablePanel.classList.toggle('collapsed');
    toggleTableBtn.textContent = tablePanel.classList.contains('collapsed') ? '▾' : '▴';
  });

  toggleIoModeBtn.addEventListener('click', () => {
    state.showBinary = !state.showBinary;
    toggleIoModeBtn.textContent = `Show: ${state.showBinary ? 'Binary' : 'Vars'}`;
    renderPalette();
    renderDiagram();
    markDirty();
    settingsMenu.classList.add('hidden');
  });

  document.getElementById('toggleTheme').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    document.body.classList.toggle('light');
    settingsMenu.classList.add('hidden');
  });

  document.getElementById('nameControl').addEventListener('input', (e) => {
    state.name = e.target.value;
    toolbarTitle.textContent = state.name;
    markDirty();
  });

  document.getElementById('inputsControl').addEventListener('change', (e) => {
    const newInputs = parseList(e.target.value);
    if (newInputs.join(',') === state.inputs.join(',')) {
      e.target.value = state.inputs.join(', ');
      return;
    }
    if (!confirmTransitionTableReset('inputs')) {
      e.target.value = state.inputs.join(', ');
      return;
    }
    state.transitionTable = { cells: {} };
    state.inputs = newInputs;
    e.target.value = state.inputs.join(', ');
    state.transitions.forEach((t) => {
      t.inputValues = (t.inputValues || []).slice(0, state.inputs.length);
      while (t.inputValues.length < state.inputs.length) t.inputValues.push('X');
      t.inputs = selectionLabel(state.inputs, t.inputValues);
    });
    renderDiagram();
    renderTransitionTable();
    markDirty();
  });

  document.getElementById('outputsControl').addEventListener('change', (e) => {
    const newOutputs = parseList(e.target.value);
    if (newOutputs.join(',') === state.outputs.join(',')) {
      e.target.value = state.outputs.join(', ');
      return;
    }
    if (!confirmTransitionTableReset('outputs')) {
      e.target.value = state.outputs.join(', ');
      return;
    }
    state.transitionTable = { cells: {} };
    state.outputs = newOutputs;
    e.target.value = state.outputs.join(', ');
    state.states.forEach((s) => (s.outputs = state.outputs.map(() => '0')));
    state.transitions.forEach((t) => {
      t.outputValues = (t.outputValues || []).slice(0, state.outputs.length);
      while (t.outputValues.length < state.outputs.length) t.outputValues.push('X');
      t.outputs = selectionLabel(state.outputs, t.outputValues);
    });
    renderTable();
    renderPalette();
    renderDiagram();
    renderTransitionTable();
    markDirty();
  });

  document.getElementById('typeControl').addEventListener('change', (e) => {
    state.type = e.target.value;
    updateControls();
    renderTable();
    renderDiagram();
    renderPalette();
    markDirty();
  });

  document.getElementById('stateControl').addEventListener('change', (e) => {
    const newCount = coerceAllowedStateCount(e.target.value);
    if (newCount !== state.numStates) {
      if (!confirmTransitionTableReset('states')) {
        e.target.value = state.numStates;
        return;
      }
      state.numStates = newCount;
      e.target.value = state.numStates;
      initStates();
      renderTable();
      renderPalette();
      renderDiagram();
      renderTransitionTable();
      markDirty();
    }
  });

  stateTableBody.addEventListener('input', (e) => {
    const target = e.target;
    const id = parseInt(target.dataset.id, 10);
    const field = target.dataset.field;
    const st = state.states.find((s) => s.id === id);
    if (!st) return;
    if (field === 'outputs') {
      st.outputs = parseList(target.value);
    } else {
      st[field] = target.value;
    }
    renderPalette();
    renderDiagram();
    markDirty();
  });

  transitionTableBody.addEventListener('input', (e) => {
    const target = e.target;
    if (target.tagName !== 'INPUT') return;
    const rowKey = target.dataset.rowKey;
    const colKey = target.dataset.colKey;
    if (!rowKey || !colKey) return;
    const isCurrentStateCol = colKey.startsWith('q_');
    const isInputCol = colKey.startsWith('in_');
    const sanitizePattern = isCurrentStateCol || isInputCol ? /[^01]/g : /[^01X]/gi;
    let val = (target.value || '').toUpperCase().replace(sanitizePattern, '');
    if (val.length > 1) val = val[0];
    target.value = val;
    if (!state.transitionTable || !state.transitionTable.cells) state.transitionTable = { cells: {} };
    state.transitionTable.cells[`${rowKey}::${colKey}`] = val;
    markDirty();
  });

  transitionTableBody.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT') {
      e.target.select();
    }
  });

  transitionTableBody.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target.tagName !== 'INPUT') return;
    const { key } = e;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    const rowIdx = parseInt(target.dataset.rowIndex, 10);
    const colIdx = parseInt(target.dataset.valueColIndex, 10);
    if (Number.isNaN(rowIdx) || Number.isNaN(colIdx)) return;
    const totalRows = (state.transitionTable?.rows || []).length;
    const totalCols = transitionTableValueColumns.length;
    if (!totalRows || !totalCols) return;

    let nextRow = rowIdx;
    let nextCol = colIdx;
    if (key === 'ArrowLeft') nextCol = Math.max(0, colIdx - 1);
    if (key === 'ArrowRight') nextCol = Math.min(totalCols - 1, colIdx + 1);
    if (key === 'ArrowUp') nextRow = Math.max(0, rowIdx - 1);
    if (key === 'ArrowDown') nextRow = Math.min(totalRows - 1, rowIdx + 1);

    const selector = `input[data-row-index="${nextRow}"][data-value-col-index="${nextCol}"]`;
    const nextInput = transitionTableBody.querySelector(selector);
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
      e.preventDefault();
    }
  });

  transitionDrawer.addEventListener('dragstart', (e) => {
    const token = e.target.closest('.transition-token, .transition-column-token');
    if (!token) return;
    const type = token.dataset.tokenType;
    const value = token.dataset.tokenValue;
    const fromIndex = token.classList.contains('transition-column-token')
      ? parseInt(token.dataset.index, 10)
      : null;
    transitionColumnDragState = {
      source: token.classList.contains('transition-column-token') ? 'selection' : 'tray',
      type,
      value,
      fromIndex,
    };
    e.dataTransfer.setData('text/plain', `${type}:${value}`);
  });

  transitionDrawer.addEventListener('dragover', (e) => {
    const tray = e.target.closest('#transitionColumnDropzone');
    if (!tray) return;
    e.preventDefault();
    const marker = ensureDropMarker(tray);
    const targetToken = e.target.closest('.transition-column-token');
    if (targetToken && targetToken.parentNode === tray) {
      const rect = targetToken.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      tray.insertBefore(marker, before ? targetToken : targetToken.nextSibling);
    } else if (!marker.parentNode) {
      tray.appendChild(marker);
    }
    const sequence = [...tray.querySelectorAll('.kmap-expr-token, .kmap-drop-marker')];
    const markerIndex = sequence.indexOf(marker);
    marker.dataset.index = markerIndex === -1 ? sequence.length : markerIndex;
  });

  transitionDrawer.addEventListener('dragleave', (e) => {
    const tray = e.target.closest('#transitionColumnDropzone');
    if (tray && !tray.contains(e.relatedTarget)) {
      clearDropMarker(tray);
    }
  });

  transitionDrawer.addEventListener('drop', (e) => {
    const tray = e.target.closest('#transitionColumnDropzone');
    if (!tray) return;
    e.preventDefault();
    const marker = tray.querySelector('.kmap-drop-marker');
    const payload = transitionColumnDragState;
    transitionColumnDragState = null;
    if (!payload || !payload.type) return;

    const sequence = [...tray.querySelectorAll('.kmap-expr-token, .kmap-drop-marker')];
    const markerIndex = marker ? sequence.indexOf(marker) : -1;
    let index = markerIndex === -1 ? sequence.filter((el) => el.classList.contains('kmap-expr-token')).length : markerIndex;
    clearDropMarker(tray);

    const columns = [...(state.transitionTable.columns || [])];
    const templates = state.transitionTable?.availableColumns || buildTransitionColumnTemplates();

    if (payload.source === 'selection' && !Number.isNaN(payload.fromIndex)) {
      if (payload.fromIndex >= 0 && payload.fromIndex < columns.length) {
        const [moved] = columns.splice(payload.fromIndex, 1);
        if (index > payload.fromIndex) index -= 1;
        columns.splice(Math.max(0, Math.min(columns.length, index)), 0, moved);
      }
    } else if (payload.source === 'tray') {
      const template =
        templates.find((tpl) => tpl.key === payload.value && tpl.type === payload.type) ||
        (payload.type === 'spacer' ? { key: 'spacer', label: '', type: 'spacer', allowMultiple: true } : null);
      if (!template) return;
      if (template.type === 'spacer') {
        columns.splice(Math.max(0, Math.min(columns.length, index)), 0, createSpacerColumn());
      } else {
        columns.splice(
          Math.max(0, Math.min(columns.length, index)),
          0,
          createColumnInstance(template),
        );
      }
    }

    state.transitionTable.columns = columns;
    renderTransitionTable();
    markDirty();
  });

  transitionDrawer.addEventListener('dragend', () => {
    document.querySelectorAll('.kmap-drop-marker').forEach((el) => el.remove());
    transitionColumnDragState = null;
  });

  if (transitionColumnDropzone) {
    transitionColumnDropzone.addEventListener('click', (e) => {
      transitionColumnDropzone.focus();
      const token = e.target.closest('.transition-column-token');
      transitionColumnDropzone
        .querySelectorAll('.transition-column-token.selected')
        .forEach((el) => el.classList.remove('selected'));
      if (token) token.classList.add('selected');
    });

    transitionColumnDropzone.addEventListener('keydown', (e) => {
      if (!['Backspace', 'Delete'].includes(e.key)) return;
      const selected = transitionColumnDropzone.querySelector('.transition-column-token.selected');
      if (!selected) return;
      const idx = parseInt(selected.dataset.index, 10);
      if (Number.isNaN(idx)) return;
      const columns = [...(state.transitionTable.columns || [])];
      columns.splice(idx, 1);
      state.transitionTable.columns = columns;
      renderTransitionTable();
      markDirty();
      e.preventDefault();
    });
  }

  kmapList.addEventListener('input', (e) => {
    const target = e.target;
    if (target.classList.contains('kmap-cell-input')) {
      let val = (target.value || '').toUpperCase().replace(/[^01X]/g, '');
      if (val.length > 1) val = val[0];
      target.value = val;
      const kmap = state.kmaps.find((m) => m.id.toString() === target.dataset.kmapId);
      if (!kmap) return;
      if (!kmap.cells) kmap.cells = {};
      kmap.cells[kmapCellKey(target.dataset.rowIndex, target.dataset.colIndex)] = val;
      markDirty();
    }
  });

  kmapList.addEventListener('dragstart', (e) => {
    const tokenEl = e.target.closest('.kmap-token, .kmap-expr-token');
    if (!tokenEl) return;
    const type = tokenEl.dataset.tokenType;
    const value = tokenEl.dataset.tokenValue;
    const fromIndex = tokenEl.classList.contains('kmap-expr-token')
      ? parseInt(tokenEl.dataset.index, 10)
      : null;
    const cardKmapId =
      tokenEl.closest('.kmap-card')?.querySelector('.kmap-expression-tray')?.dataset.kmapId;
    const kmapId = tokenEl.dataset.kmapId || cardKmapId;
    kmapExpressionDragState = {
      source: tokenEl.classList.contains('kmap-expr-token') ? 'expression' : 'tray',
      type,
      value,
      fromIndex,
      kmapId,
    };
    e.dataTransfer.setData('text/plain', `${type}:${value}`);
  });

  kmapList.addEventListener('dragover', (e) => {
    const tray = e.target.closest('.kmap-expression-tray');
    if (!tray) return;
    e.preventDefault();
    const tokens = [...(getKmapById(tray.dataset.kmapId)?.expressionTokens || [])];
    const targetToken = e.target.closest('.kmap-expr-token');
    const marker = ensureDropMarker(tray);
    if (targetToken && targetToken.parentNode === tray) {
      const rect = targetToken.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;
      tray.insertBefore(marker, before ? targetToken : targetToken.nextSibling);
    } else if (!marker.parentNode) {
      tray.appendChild(marker);
    }
    const sequence = [...tray.querySelectorAll('.kmap-expr-token, .kmap-drop-marker')];
    const markerIndex = sequence.indexOf(marker);
    const index = markerIndex === -1 ? tokens.length : markerIndex;
    marker.dataset.index = index;
  });

  kmapList.addEventListener('dragleave', (e) => {
    const tray = e.target.closest('.kmap-expression-tray');
    if (tray && !tray.contains(e.relatedTarget)) {
      clearDropMarker(tray);
    }
  });

  kmapList.addEventListener('drop', (e) => {
    const tray = e.target.closest('.kmap-expression-tray');
    if (!tray) return;
    e.preventDefault();
    const marker = tray.querySelector('.kmap-drop-marker');
    const kmap = getKmapById(tray.dataset.kmapId);
    if (!kmap) return;
    const tokens = [...(kmap.expressionTokens || [])];
    const payload = kmapExpressionDragState;
    kmapExpressionDragState = null;
    if (!payload || !payload.type) return;

    let index = tokens.length;
    if (marker && marker.parentNode === tray) {
      const sequence = [...tray.querySelectorAll('.kmap-expr-token, .kmap-drop-marker')];
      const markerIndex = sequence.indexOf(marker);
      index = markerIndex === -1 ? tokens.length : markerIndex;
    }
    clearDropMarker(tray);

    if (payload.source === 'expression' && payload.kmapId === kmap.id.toString()) {
      if (!Number.isNaN(payload.fromIndex)) {
        tokens.splice(payload.fromIndex, 1);
        if (index > payload.fromIndex) index -= 1;
      }
    }

    const token = { type: payload.type, value: payload.value };
    if (token.type === 'var') token.negated = false;
    tokens.splice(Math.max(0, Math.min(tokens.length, index)), 0, token);
    updateKmapExpressionTokens(kmap, tokens, tray);
    markDirty();
  });

  kmapList.addEventListener('dragend', () => {
    document.querySelectorAll('.kmap-drop-marker').forEach((el) => el.remove());
    kmapExpressionDragState = null;
  });

  kmapList.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('kmap-cell-input')) {
      e.target.select();
    }
  });

  kmapList.addEventListener('keydown', (e) => {
    const target = e.target;
    const exprTray = target.closest && target.closest('.kmap-expression-tray');
    if (exprTray) {
      const kmap = getKmapById(exprTray.dataset.kmapId);
      if (!kmap) return;
      const tokens = [...(kmap.expressionTokens || [])];
      const selected = exprTray.querySelector('.kmap-expr-token.selected');
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
        const idx = parseInt(selected.dataset.index, 10);
        if (!Number.isNaN(idx)) {
          tokens.splice(idx, 1);
          updateKmapExpressionTokens(kmap, tokens, exprTray);
          markDirty();
        }
        e.preventDefault();
      }
      return;
    }
    if (!target.classList.contains('kmap-cell-input')) return;
    const { key } = e;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    const card = target.closest('.kmap-card');
    if (!card) return;
    const totalRows = parseInt(card.dataset.totalRows || '0', 10);
    const totalCols = parseInt(card.dataset.totalCols || '0', 10);
    if (!totalRows || !totalCols) return;
    const rowIdx = parseInt(target.dataset.rowIndex, 10);
    const colIdx = parseInt(target.dataset.colIndex, 10);
    if (Number.isNaN(rowIdx) || Number.isNaN(colIdx)) return;
    let nextRow = rowIdx;
    let nextCol = colIdx;
    if (key === 'ArrowLeft') nextCol = Math.max(0, colIdx - 1);
    if (key === 'ArrowRight') nextCol = Math.min(totalCols - 1, colIdx + 1);
    if (key === 'ArrowUp') nextRow = Math.max(0, rowIdx - 1);
    if (key === 'ArrowDown') nextRow = Math.min(totalRows - 1, rowIdx + 1);

    const selector = `.kmap-cell-input[data-row-index="${nextRow}"][data-col-index="${nextCol}"]`;
    const nextInput = card.querySelector(selector);
    if (nextInput) {
      nextInput.focus();
      nextInput.select();
      e.preventDefault();
    }
  });

  kmapList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove-kmap]');
    if (removeBtn) {
      const id = removeBtn.dataset.removeKmap;
      state.kmaps = state.kmaps.filter((k) => k.id.toString() !== id);
      renderKmaps();
      markDirty();
      return;
    }

    const verifyBtn = e.target.closest('[data-verify-kmap]');
    if (verifyBtn) {
      const kmap = state.kmaps.find((m) => m.id.toString() === verifyBtn.dataset.verifyKmap);
      const result = verifyKmapExpression(kmap);
      verifyBtn.classList.toggle('verified', !!result.passed);
      verifyBtn.classList.toggle('failed', !result.passed);
      verifyBtn.title = result.passed
        ? 'Expression matches K-map'
        : result.reason || 'Expression verification failed';
      return;
    }

    const exprToken = e.target.closest('.kmap-expr-token');
    if (exprToken) {
      const tray = exprToken.closest('.kmap-expression-tray');
      const kmap = tray ? getKmapById(tray.dataset.kmapId) : null;
      if (!kmap) return;
      tray.focus();
      const idx = parseInt(exprToken.dataset.index, 10);
      if (Number.isNaN(idx)) return;
      const tokens = [...(kmap.expressionTokens || [])];
      const token = tokens[idx];
      if (!token) return;
      tray.querySelectorAll('.kmap-expr-token.selected').forEach((el) =>
        el.classList.remove('selected'),
      );
      if (token.type === 'var') {
        token.negated = !token.negated;
      }
      updateKmapExpressionTokens(kmap, tokens, tray);
      const newToken = tray.querySelector(`.kmap-expr-token[data-index="${idx}"]`);
      if (newToken) newToken.classList.add('selected');
      markDirty();
      return;
    }

    const tray = e.target.closest('.kmap-expression-tray');
    if (tray) {
      tray.focus();
      tray.querySelectorAll('.kmap-expr-token.selected').forEach((el) => el.classList.remove('selected'));
    }
  });

  paletteList.addEventListener('dragstart', (e) => {
    const id = e.target.closest('.palette-item')?.dataset.id;
    if (!id) return;
    e.dataTransfer.setData('text/plain', id);
  });

  diagram.addEventListener('dragover', (e) => e.preventDefault());
  diagram.addEventListener('drop', (e) => {
    const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const st = state.states.find((s) => s.id === id);
    if (!st) return;
    const pt = getSVGPoint(e.clientX, e.clientY);
    st.x = pt.x;
    st.y = pt.y;
    st.placed = true;
    renderPalette();
    renderDiagram();
    markDirty();
  });

  diagram.addEventListener('wheel', (e) => {
    e.preventDefault();
    const point = getSVGPoint(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(3, Math.max(0.4, viewState.scale * factor));
    const scaleFactor = newScale / viewState.scale;
    viewState.panX = point.x - (point.x - viewState.panX) * scaleFactor;
    viewState.panY = point.y - (point.y - viewState.panY) * scaleFactor;
    viewState.scale = newScale;
    applyViewTransform();
  });

  diagram.addEventListener('mousedown', (e) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isPanning = true;
      panWithShift = e.button === 0 && e.shiftKey;
      panStart = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    const targetLabelHandle = e.target.closest('.label-handle');
    const targetState = e.target.closest('circle.state-node');
    const targetHandle = e.target.closest('circle.arc-handle');
    const targetPath = e.target.closest('path.arrow-path');
    if (!targetLabelHandle && !targetState && !targetHandle && !targetPath) {
      selectedArrowId = null;
      selectedStateId = null;
      renderDiagram();
    }
    if (targetPath) {
      selectedArrowId = parseInt(targetPath.dataset.id, 10);
      selectedStateId = null;
      renderDiagram();
    }
    if (targetLabelHandle) {
      const id = parseInt(targetLabelHandle.dataset.id, 10);
      selectedArrowId = id;
      selectedStateId = null;
      renderDiagram();
      const tr = state.transitions.find((t) => t.id === id);
      if (!tr) return;
      const moveHandler = (ev) => {
        const pathEl = diagram.querySelector(`path.arrow-path[data-id="${id}"]`);
        if (!pathEl) return;
        const pt = getSVGPoint(ev.clientX, ev.clientY);
        tr.labelT = nearestTOnPath(pathEl, pt);
        renderDiagram();
      };
      const upHandler = () => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        markDirty();
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      return;
    }
    if (targetHandle) {
      selectedArrowId = parseInt(targetHandle.dataset.id, 10);
      selectedStateId = null;
      renderDiagram();
      const tr = state.transitions.find((t) => t.id === parseInt(targetHandle.dataset.id, 10));
      if (!tr) return;
      const moveHandler = (ev) => {
        const from = state.states.find((s) => s.id === tr.from);
        const to = state.states.find((s) => s.id === tr.to);
        const pt = getSVGPoint(ev.clientX, ev.clientY);
        if (from && to && from.id === to.id) {
          tr.loopAngle = Math.atan2(pt.y - from.y, pt.x - from.x);
          const radial = Math.max(0, Math.hypot(pt.x - from.x, pt.y - from.y) - from.radius);
          tr.arcOffset = radial;
          renderDiagram();
          return;
        }
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const proj = (pt.x - midX) * nx + (pt.y - midY) * ny;
        tr.arcOffset = proj;
        renderDiagram();
      };
      const upHandler = () => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        markDirty();
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      return;
    }
    if (targetState) {
      const id = parseInt(targetState.parentNode.dataset.id, 10);
      const st = state.states.find((s) => s.id === id);
      if (!st) return;
      selectedStateId = id;
      selectedArrowId = null;
      renderDiagram();
      const start = getSVGPoint(e.clientX, e.clientY);
      const offsetX = st.x - start.x;
      const offsetY = st.y - start.y;
      const isResize = e.ctrlKey;
      const startArrowWithAlt = e.button === 0 && e.altKey;
      let moved = false;
      if (e.button === 2 || startArrowWithAlt) {
        currentArrow = {
          from: id,
          toPoint: getSVGPoint(e.clientX, e.clientY),
          arcOffset: 0,
          startButton: e.button,
          startWithAlt: startArrowWithAlt,
        };
        renderDiagram();
        return;
      }
      const moveHandler = (ev) => {
        const pt = getSVGPoint(ev.clientX, ev.clientY);
        if (isResize) {
          const dx = pt.x - st.x;
          const dy = pt.y - st.y;
          st.radius = Math.max(20, Math.sqrt(dx * dx + dy * dy));
        } else {
          st.x = pt.x + offsetX;
          st.y = pt.y + offsetY;
        }
        st.placed = true;
        moved = true;
        renderDiagram();
      };
      const upHandler = (ev) => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        if (moved) markDirty();
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    }
  });

  diagram.addEventListener('mouseup', (e) => {
    if (currentArrow && (e.button === currentArrow.startButton || (currentArrow.startWithAlt && e.button === 0))) {
      const targetState = e.target.closest('circle.state-node');
      if (targetState) {
        const toId = parseInt(targetState.parentNode.dataset.id, 10);
        const newId = Date.now();
        const isSelfLoop = toId === currentArrow.from;
        const loopAngle = isSelfLoop
          ? currentArrow.loopAngle !== undefined
            ? currentArrow.loopAngle
            : -Math.PI / 2
          : undefined;
        const newTransition = {
          id: newId,
          from: currentArrow.from,
          to: toId,
          inputs: '',
          outputs: '',
          arcOffset: isSelfLoop ? 30 : 0,
          loopAngle,
          inputValues: defaultSelections(state.inputs.length),
          outputValues: defaultSelections(state.outputs.length),
          labelT: 0.12,
        };
        state.transitions.push(newTransition);
        undoStack.push({ type: 'transitionAddition', transitionId: newId });
        selectedArrowId = newId;
        renderDiagram();
        markDirty();
      }
    }
    if (previewPath && previewPath.parentNode) {
      previewPath.parentNode.removeChild(previewPath);
    }
    currentArrow = null;
    previewPath = null;
  });

  diagram.addEventListener('contextmenu', (e) => {
    const handle = e.target.closest('.arc-handle, .label-handle');
    const path = e.target.closest('path.arrow-path');
    const target = handle || path;
    if (target) {
      const id = parseInt(target.dataset.id || target.getAttribute('data-id'), 10);
      openArrowDialog(id);
    }
  });

  document.getElementById('saveArrow').addEventListener('click', () => {
    const tr = state.transitions.find((t) => t.id === arrowDialogTarget);
    if (tr) {
      tr.inputValues = readChoices(inputChoices, state.inputs, 'input');
      tr.outputValues = state.type === 'mealy' ? readChoices(outputChoices, state.outputs, 'output') : [];
      tr.inputs = selectionLabel(state.inputs, tr.inputValues);
      tr.outputs = state.type === 'mealy' ? selectionLabel(state.outputs, tr.outputValues) : '';
      renderDiagram();
    }
    closeDialog('arrowDialog');
    markDirty();
  });

  document.addEventListener('keydown', (e) => {
    const isFormElement = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!isFormElement && (e.key === 'Backspace' || e.key === 'Delete')) {
      if (selectedArrowId) {
        deleteTransitionById(selectedArrowId);
        return;
      }
      if (selectedStateId !== null) {
        deleteStateById(selectedStateId);
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      const activeEl = document.activeElement;
      const tablesHaveFocus =
        (tablePanel && tablePanel.contains(activeEl)) ||
        (transitionDrawer && transitionDrawer.contains(activeEl));
      if (tablesHaveFocus) return;
      undoLastDelete();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      closeAllDropdowns();
    }
    if ((selectedArrowId || selectedStateId !== null) && !clickTargetsSelection(e.target)) {
      selectedArrowId = null;
      selectedStateId = null;
      renderDiagram();
    }
  });

  document.addEventListener('mousedown', (e) => {
    const backdropHost = e.target.closest('.dialog-backdrop');
    if (backdropHost && !e.target.classList.contains('dialog-backdrop')) {
      dialogBackdropCloseBlocked = true;
      dialogBackdropMouseDownTarget = null;
      return;
    }
    if (e.target.classList && e.target.classList.contains('dialog-backdrop')) {
      dialogBackdropMouseDownTarget = e.target;
    } else {
      dialogBackdropMouseDownTarget = null;
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (dialogBackdropCloseBlocked) {
      dialogBackdropCloseBlocked = false;
      dialogBackdropMouseDownTarget = null;
      return;
    }
    if (
      dialogBackdropMouseDownTarget &&
      e.target === dialogBackdropMouseDownTarget &&
      e.target.classList.contains('dialog-backdrop')
    ) {
      e.target.classList.add('hidden');
    }
    dialogBackdropMouseDownTarget = null;
  });

  document.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const dx = (e.clientX - panStart.x) / viewState.scale;
      const dy = (e.clientY - panStart.y) / viewState.scale;
      viewState.panX += dx;
      viewState.panY += dy;
      panStart = { x: e.clientX, y: e.clientY };
      applyViewTransform();
      return;
    }
    if (currentArrow) {
      const cursorPoint = getSVGPoint(e.clientX, e.clientY);
      const hoveredState = findStateAtPoint(cursorPoint);
      const fromState = state.states.find((s) => s.id === currentArrow.from);
      currentArrow.targetId = null;
      currentArrow.loopAngle = undefined;
      if (hoveredState && fromState) {
        if (hoveredState.id === fromState.id) {
          currentArrow.loopAngle = Math.atan2(cursorPoint.y - hoveredState.y, cursorPoint.x - hoveredState.x);
          currentArrow.targetId = hoveredState.id;
          currentArrow.toPoint = { ...projectPointToStateBorder(hoveredState, cursorPoint), radius: hoveredState.radius };
        } else {
          currentArrow.targetId = hoveredState.id;
          currentArrow.toPoint = limitArrowPointOnTarget(fromState, hoveredState, cursorPoint);
        }
      } else {
        currentArrow.toPoint = cursorPoint;
      }
      renderDiagram();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (isPanning && (e.button === 1 || (panWithShift && e.button === 0))) {
      isPanning = false;
      panWithShift = false;
      return;
    }
    if (currentArrow && (e.button === 2 || (currentArrow.startWithAlt && e.button === 0))) {
      if (previewPath && previewPath.parentNode) {
        previewPath.parentNode.removeChild(previewPath);
      }
      currentArrow = null;
      previewPath = null;
      renderDiagram();
    }
  });
}

function getSVGPoint(clientX, clientY) {
  const pt = diagram.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const target = viewport || diagram;
  const svgP = pt.matrixTransform(target.getScreenCTM().inverse());
  return svgP;
}

document.addEventListener('DOMContentLoaded', () => {
  populateStateCountSelectors();
  attachEvents();
  updateControls();
  initStates();
  renderTable();
  renderTransitionTable();
  renderPalette();
  renderKmaps();
  applyViewTransform();
  renderDiagram();
});
