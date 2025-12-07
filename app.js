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
let panStart = { x: 0, y: 0 };
let transitionTableValueColumns = [];
let transitionTableGroupSize = 0;

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
const saveImageMenu = document.getElementById('saveImageMenu');
const saveImageDropdown = document.getElementById('saveImageDropdown');
const transitionDrawerHandle = document.getElementById('transitionDrawerHandle');
const toolbarNewMachine = document.getElementById('toolbarNewMachine');
const kmapWindow = document.getElementById('kmapWindow');
const kmapWindowHeader = document.getElementById('kmapWindowHeader');
const kmapList = document.getElementById('kmapList');
const kmapEmptyState = document.getElementById('kmapEmptyState');
const confirmKmapCreate = document.getElementById('confirmKmapCreate');
const kmapLabelInput = document.getElementById('kmapLabel');
const kmapVariablesInput = document.getElementById('kmapVariables');
const kmapTypeInput = document.getElementById('kmapType');
const kmapDirectionInput = document.getElementById('kmapDirection');
const kmapResizeHandle = document.getElementById('kmapResizeHandle');

let kmapWindowState = { width: 840, height: 540, left: null, top: null };
const allowedStateCounts = [1, 2, 4, 8, 16, 32];

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

function clearVerificationStatus() {
  const verifyBtn = document.getElementById('verifyTransitionTable');
  if (verifyBtn) {
    verifyBtn.classList.remove('verified', 'failed');
    verifyBtn.removeAttribute('title');
  }
}

function setVerificationStatus(passed) {
  const verifyBtn = document.getElementById('verifyTransitionTable');
  if (!verifyBtn) return;
  verifyBtn.classList.remove('verified', 'failed');
  if (passed === true) {
    verifyBtn.classList.add('verified');
    verifyBtn.title = 'Your transition table matches your transition diagram';
    state.transitionTableVerified = true;
    return;
  }
  if (passed === false) {
    verifyBtn.classList.add('failed');
    verifyBtn.title = 'Your transition table DOES NOT match your transition diagram';
    state.transitionTableVerified = false;
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
  const hasErrors = diagramHasHighlightedStates();
  verifyBtn.disabled = hasErrors;
  if (hasErrors) setVerificationStatus(null);
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

function ensureTransitionTableStructure() {
  if (!state.transitionTable || typeof state.transitionTable !== 'object') {
    state.transitionTable = { cells: {} };
  }
  if (!state.transitionTable.cells) state.transitionTable.cells = {};

  const bitCount = stateBitCount();
  const stateBitCols = [];
  for (let i = bitCount - 1; i >= 0; i -= 1) {
    stateBitCols.push({ key: `q_${i}`, label: `Q_${i}`, type: 'value' });
  }

  const nextStateBitCols = [];
  for (let i = bitCount - 1; i >= 0; i -= 1) {
    nextStateBitCols.push({ key: `next_q_${i}`, label: `Q_${i}^+`, type: 'value' });
  }

  const inputCols = state.inputs.map((name, idx) => ({
    key: `in_${idx}`,
    label: name || `Input ${idx + 1}`,
    type: 'value',
  }));
  const outputCols = state.outputs.map((name, idx) => ({
    key: `out_${idx}`,
    label: name || `Output ${idx + 1}`,
    type: 'value',
  }));

  const columns = [
    { key: 'row_index', label: '#', type: 'rowIndex' },
    { key: 'spacer_0', label: '', type: 'spacer' },
    ...stateBitCols,
    { key: 'spacer_state_inputs', label: '', type: 'spacer' },
    ...inputCols,
    { key: 'spacer_1', label: '', type: 'spacer' },
    ...nextStateBitCols,
    { key: 'spacer_2', label: '', type: 'spacer' },
    ...outputCols,
  ];

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

  state.transitionTable.columns = columns;
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

function renderTransitionTable() {
  ensureTransitionTableStructure();
  transitionTableHead.innerHTML = '';
  transitionTableBody.innerHTML = '';

  const headerRow = document.createElement('tr');
  const valueIndexMap = new Map(
    transitionTableValueColumns.map((col, idx) => [col.key, idx]),
  );
  state.transitionTable.columns.forEach((col) => {
    const th = document.createElement('th');
    th.innerHTML = formatScriptedText(col.label);
    if (col.type === 'spacer') th.classList.add('col-spacer');
    if (col.type === 'rowIndex') th.classList.add('row-index-cell');
    headerRow.appendChild(th);
  });
  transitionTableHead.appendChild(headerRow);

  state.transitionTable.rows.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = rowIdx;

    state.transitionTable.columns.forEach((col) => {
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
      spacerCell.colSpan = state.transitionTable.columns.length;
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

function stateIsUsed(stateId) {
  const st = state.states.find((s) => s.id === stateId);
  if (!st) return false;
  const participatesInTransition = state.transitions.some(
    (tr) => tr.from === stateId || tr.to === stateId,
  );
  return st.placed || participatesInTransition;
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

  const currentStateCols = transitionTableValueColumns.filter((col) => col.key.startsWith('q_'));
  const inputCols = transitionTableValueColumns.filter((col) => col.key.startsWith('in_'));
  const nextStateCols = transitionTableValueColumns.filter((col) => col.key.startsWith('next_q_'));
  const outputCols = transitionTableValueColumns.filter((col) => col.key.startsWith('out_'));
  const bitCount = currentStateCols.length;

  let matches = !conflict;

  state.transitionTable.rows.forEach((row) => {
    if (!matches) return;
    if (transitionTableRowIsBlank(row)) return;
    const actual = readTransitionTableRowValues(row, currentStateCols, inputCols, nextStateCols, outputCols);
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
    const expected = expectations.get(`${currentStateBits}|${inputBits || 'none'}`);
    if (!expected) {
      matches = false;
      return;
    }
    if (!arraysCompatible(expected.nextStateBits, actual.nextStateBits)) {
      matches = false;
      return;
    }
    if (!arraysCompatible(expected.outputs, actual.outputs)) {
      matches = false;
    }
  });

  if (matches) {
    setVerificationStatus(true);
    if (recordStatus) unsavedChanges = true;
  } else {
    if (!silent) {
      window.alert('Your state transition table does not match your state transition diagram');
    }
    setVerificationStatus(false);
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
  const to = { x: currentArrow.toPoint.x, y: currentArrow.toPoint.y, radius: 0 };
  const pathInfo = quadraticPath(from, to, currentArrow.arcOffset || 0);
  if (!previewPath) {
    previewPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    previewPath.classList.add('arrow-path');
    previewPath.setAttribute('stroke-dasharray', '6 4');
  }
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
  return vars.join(', ') || '—';
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
  let rowVars = kmap.direction === 'vertical' ? moreSig : lessSig;
  let colVars = kmap.direction === 'vertical' ? lessSig : moreSig;
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

function buildKmapCornerLabel(layout) {
  const corner = document.createElement('div');
  corner.className = 'kmap-corner-label';
  const diagonal = document.createElement('div');
  diagonal.className = 'kmap-diagonal';
  corner.appendChild(diagonal);

  const rowVars = document.createElement('div');
  rowVars.className = 'kmap-variable-block kmap-vars-row';
  rowVars.textContent = formatVariableList(layout.rowVars);
  corner.appendChild(rowVars);

  const colVars = document.createElement('div');
  colVars.className = 'kmap-variable-block kmap-vars-col';
  colVars.textContent = formatVariableList(layout.colVars);
  corner.appendChild(colVars);
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
    th.textContent = code || '0';
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  layout.rowCodes.forEach((rowCode, rIdx) => {
    const tr = document.createElement('tr');
    const rowHeader = document.createElement('th');
    rowHeader.textContent = rowCode || '0';
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
    const layout = buildKmapLayout(kmap);
    card.dataset.totalRows = layout.totalRows;
    card.dataset.totalCols = layout.totalCols;

    const heading = document.createElement('h4');
    heading.textContent = kmap.label || 'K-map';
    card.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'kmap-meta';
    meta.innerHTML = `
      <span><strong>Type:</strong> ${kmap.type?.toUpperCase() || 'SOP'}</span>
      <span><strong>Direction:</strong> ${kmap.direction === 'vertical' ? 'Vertical' : 'Horizontal'}</span>
      <span><strong>Variables:</strong> ${formatVariableList(kmap.variables || [])}</span>
    `;
    card.appendChild(meta);

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
      label.textContent = sub.label || ' ';
      submap.appendChild(label);
      submap.appendChild(buildKmapTable(kmap, layout, sub));
      gridCollection.appendChild(submap);
    });

    card.appendChild(gridCollection);

    const expressionRow = document.createElement('div');
    expressionRow.className = 'kmap-expression';
    const symbol = kmap.type === 'pos' ? 'Π' : 'Σ';
    const label = document.createElement('span');
    label.textContent = `${kmap.label || 'K-map'} ${symbol} =`;
    expressionRow.appendChild(label);

    const exprInput = document.createElement('input');
    exprInput.type = 'text';
    exprInput.value = kmap.expression || '';
    exprInput.dataset.kmapId = kmap.id;
    exprInput.classList.add('kmap-expression-input');
    expressionRow.appendChild(exprInput);

    const verifyBtn = document.createElement('button');
    verifyBtn.textContent = 'Verify';
    verifyBtn.type = 'button';
    verifyBtn.disabled = true;
    expressionRow.appendChild(verifyBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove K-map';
    removeBtn.dataset.removeKmap = kmap.id;
    expressionRow.appendChild(removeBtn);

    card.appendChild(expressionRow);
    kmapList.appendChild(card);
  });
}

function openKmapWindow() {
  if (!kmapWindow) return;
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

function closeKmapWindow() {
  if (kmapWindow) kmapWindow.classList.add('hidden');
}

function resetKmapDialog() {
  kmapLabelInput.value = '';
  kmapVariablesInput.value = '';
  kmapTypeInput.value = 'sop';
  kmapDirectionInput.value = 'horizontal';
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
  openDialog('kmapCreateDialog');
}

function createKmapFromDialog() {
  const variables = parseKmapVariables(kmapVariablesInput.value);
  const label = kmapLabelInput.value.trim() || 'K-map';
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
  openKmapWindow();
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

  document.getElementById('newMachineBtn').addEventListener('click', () =>
    promptToSaveIfDirty(() => openDialog('newMachineDialog'))
  );
  toolbarNewMachine.addEventListener('click', () => promptToSaveIfDirty(() => openDialog('newMachineDialog')));
  document.getElementById('quickRef').addEventListener('click', () => openDialog('quickRefDialog'));
  document.getElementById('kmapToggle').addEventListener('click', () => {
    if (kmapWindow.classList.contains('hidden')) openKmapWindow();
    else closeKmapWindow();
  });
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
  });

  window.addEventListener('beforeunload', (e) => {
    if (!unsavedChanges) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.getElementById('saveButton').addEventListener('click', saveState);
  saveImageDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    saveImageMenu.classList.toggle('hidden');
  });
  document.getElementById('saveImageTable').addEventListener('click', () => {
    saveImageMenu.classList.add('hidden');
    captureImage(tablePanel, `${state.name}-state-definition-table.png`);
  });
  document.getElementById('saveImageDiagram').addEventListener('click', () => {
    saveImageMenu.classList.add('hidden');
    captureImage(document.querySelector('.playmat'), `${state.name}-state-diagram.png`);
  });
  document.getElementById('saveImageTransitionTable').addEventListener('click', () => {
    saveImageMenu.classList.add('hidden');
    captureTransitionDrawerImage();
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
  });

  document.getElementById('toggleTheme').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    document.body.classList.toggle('light');
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
    if (target.classList.contains('kmap-expression-input')) {
      const kmap = state.kmaps.find((m) => m.id.toString() === target.dataset.kmapId);
      if (!kmap) return;
      kmap.expression = target.value;
      markDirty();
    }
  });

  kmapList.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('kmap-cell-input')) {
      e.target.select();
    }
  });

  kmapList.addEventListener('keydown', (e) => {
    const target = e.target;
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
    if (e.button === 1) {
      isPanning = true;
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
      let moved = false;
      if (e.button === 2) {
        currentArrow = { from: id, toPoint: getSVGPoint(e.clientX, e.clientY), arcOffset: 0 };
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
    if (currentArrow && e.button === 2) {
      const targetState = e.target.closest('circle.state-node');
      if (targetState) {
        const toId = parseInt(targetState.parentNode.dataset.id, 10);
        const newId = Date.now();
        const isSelfLoop = toId === currentArrow.from;
        state.transitions.push({
          id: newId,
          from: currentArrow.from,
          to: toId,
          inputs: '',
          outputs: '',
          arcOffset: isSelfLoop ? 30 : 0,
          loopAngle: isSelfLoop ? -Math.PI / 2 : undefined,
          inputValues: defaultSelections(state.inputs.length),
          outputValues: defaultSelections(state.outputs.length),
          labelT: 0.12,
        });
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
    if (!saveImageMenu.contains(e.target) && e.target !== saveImageDropdown) {
      saveImageMenu.classList.add('hidden');
    }
    if (e.target.classList.contains('dialog-backdrop')) {
      e.target.classList.add('hidden');
    }
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
      currentArrow.toPoint = getSVGPoint(e.clientX, e.clientY);
      renderDiagram();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 1 && isPanning) {
      isPanning = false;
      return;
    }
    if (e.button === 2 && currentArrow) {
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
