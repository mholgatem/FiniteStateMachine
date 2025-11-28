const state = {
  name: 'Untitled Machine',
  type: 'moore',
  numStates: 4,
  inputs: [],
  outputs: [],
  states: [],
  transitions: [],
  showBinary: true,
};

let currentArrow = null;
let selectedArrowId = null;
let arrowDialogTarget = null;
let previewPath = null;
let deletedTransitions = [];
let viewState = { scale: 1, panX: 0, panY: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0 };

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

function closeDialog(id) {
  document.getElementById(id).classList.add('hidden');
}

function openDialog(id) {
  document.getElementById(id).classList.remove('hidden');
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
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(`${state.name || 'fsm'}-save.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadState(data) {
  const savedShowBinary = data.showBinary;
  Object.assign(state, data);
  state.inputs = normalizeNames(state.inputs || []);
  state.outputs = normalizeNames(state.outputs || []);
  state.showBinary = savedShowBinary !== undefined ? savedShowBinary : true;
  viewState = { scale: 1, panX: 0, panY: 0 };
  applyViewTransform();
  updateControls();
  renderTable();
  renderPalette();
  renderDiagram();
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

  const isLight = document.body.classList.contains('light');
  if (isLight) {
    tempStyle(element, { background: '#ffffff', backgroundImage: 'none' });
  }

  tempStyle(element, { overflow: 'visible', maxHeight: 'none', height: 'auto' });
  const scrollableChild = element.querySelector('.table-wrapper');
  if (scrollableChild) {
    tempStyle(scrollableChild, { overflow: 'visible', maxHeight: 'none', height: 'auto' });
  }

  const width = element.scrollWidth || element.clientWidth || 0;
  const height = element.scrollHeight || element.clientHeight || 0;
  const maxDimension = 2500;
  const scale = Math.min(1, maxDimension / Math.max(width, height, 1));

  html2canvas(element, {
    backgroundColor: isLight ? '#ffffff' : null,
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

function attachEvents() {
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeDialog(btn.dataset.close));
  });

  document.getElementById('newMachineBtn').addEventListener('click', () => openDialog('newMachineDialog'));
  document.getElementById('quickRef').addEventListener('click', () => openDialog('quickRefDialog'));

  document.getElementById('createMachine').addEventListener('click', () => {
    state.name = document.getElementById('machineName').value || 'Untitled Machine';
    state.type = document.getElementById('machineType').value;
    state.numStates = Math.min(32, Math.max(1, parseInt(document.getElementById('stateCount').value, 10) || 1));
    state.inputs = parseList(document.getElementById('inputVars').value);
    state.outputs = parseList(document.getElementById('outputVars').value);
    viewState = { scale: 1, panX: 0, panY: 0 };
    applyViewTransform();
    initStates();
    updateControls();
    renderTable();
    renderPalette();
    renderDiagram();
    closeDialog('newMachineDialog');
    landing.classList.add('hidden');
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

  document.getElementById('saveButton').addEventListener('click', saveState);
  document.getElementById('saveImageTable').addEventListener('click', () => captureImage(tablePanel, `${state.name}-table.png`));
  document.getElementById('saveImageDiagram').addEventListener('click', () => captureImage(document.querySelector('.playmat'), `${state.name}-diagram.png`));

  toggleTableBtn.addEventListener('click', () => {
    tablePanel.classList.toggle('collapsed');
    toggleTableBtn.textContent = tablePanel.classList.contains('collapsed') ? '▾' : '▴';
  });

  toggleIoModeBtn.addEventListener('click', () => {
    state.showBinary = !state.showBinary;
    toggleIoModeBtn.textContent = `Show: ${state.showBinary ? 'Binary' : 'Vars'}`;
    renderPalette();
    renderDiagram();
  });

  document.getElementById('toggleTheme').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    document.body.classList.toggle('light');
  });

  document.getElementById('nameControl').addEventListener('input', (e) => {
    state.name = e.target.value;
    toolbarTitle.textContent = state.name;
  });

  document.getElementById('inputsControl').addEventListener('change', (e) => {
    state.inputs = parseList(e.target.value);
    state.transitions.forEach((t) => {
      t.inputValues = (t.inputValues || []).slice(0, state.inputs.length);
      while (t.inputValues.length < state.inputs.length) t.inputValues.push('X');
      t.inputs = selectionLabel(state.inputs, t.inputValues);
    });
    renderDiagram();
  });

  document.getElementById('outputsControl').addEventListener('change', (e) => {
    state.outputs = parseList(e.target.value);
    state.states.forEach((s) => (s.outputs = state.outputs.map(() => '0')));
    state.transitions.forEach((t) => {
      t.outputValues = (t.outputValues || []).slice(0, state.outputs.length);
      while (t.outputValues.length < state.outputs.length) t.outputValues.push('X');
      t.outputs = selectionLabel(state.outputs, t.outputValues);
    });
    renderTable();
    renderPalette();
    renderDiagram();
  });

  document.getElementById('typeControl').addEventListener('change', (e) => {
    state.type = e.target.value;
    updateControls();
    renderTable();
    renderDiagram();
    renderPalette();
  });

  document.getElementById('stateControl').addEventListener('change', (e) => {
    const newCount = Math.min(32, Math.max(1, parseInt(e.target.value, 10) || 1));
    if (newCount !== state.numStates) {
      state.numStates = newCount;
      initStates();
      renderTable();
      renderPalette();
      renderDiagram();
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
    if (targetPath) {
      selectedArrowId = parseInt(targetPath.dataset.id, 10);
      renderDiagram();
    }
    if (targetLabelHandle) {
      const id = parseInt(targetLabelHandle.dataset.id, 10);
      selectedArrowId = id;
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
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      return;
    }
    if (targetHandle) {
      selectedArrowId = parseInt(targetHandle.dataset.id, 10);
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
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
      return;
    }
    if (targetState) {
      const id = parseInt(targetState.parentNode.dataset.id, 10);
      const st = state.states.find((s) => s.id === id);
      if (!st) return;
      const start = getSVGPoint(e.clientX, e.clientY);
      const offsetX = st.x - start.x;
      const offsetY = st.y - start.y;
      const isResize = e.ctrlKey;
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
        renderDiagram();
      };
      const upHandler = (ev) => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        const paletteRect = palettePane.getBoundingClientRect();
        if (ev.clientX < paletteRect.right) {
          st.placed = false;
          renderPalette();
          renderDiagram();
        }
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
  });

  document.addEventListener('keydown', (e) => {
    const isFormElement = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!isFormElement && (e.key === 'Backspace' || e.key === 'Delete') && selectedArrowId) {
      const idx = state.transitions.findIndex((t) => t.id === selectedArrowId);
      if (idx !== -1) {
        const [removed] = state.transitions.splice(idx, 1);
        if (removed) deletedTransitions.push(removed);
      }
      selectedArrowId = null;
      renderDiagram();
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      const restored = deletedTransitions.pop();
      if (restored) {
        state.transitions.push(restored);
        selectedArrowId = restored.id;
        renderDiagram();
      }
    }
  });

  document.addEventListener('click', (e) => {
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
  attachEvents();
  updateControls();
  initStates();
  renderTable();
  renderPalette();
  applyViewTransform();
  renderDiagram();
});
