const state = {
  name: 'Untitled Machine',
  type: 'moore',
  numStates: 4,
  inputs: [],
  outputs: [],
  states: [],
  transitions: [],
};

let currentArrow = null;
let selectedArrowId = null;
let arrowDialogTarget = null;
let previewPath = null;

const landing = document.getElementById('landing');
const newMachineDialog = document.getElementById('newMachineDialog');
const arrowDialog = document.getElementById('arrowDialog');
const quickRefDialog = document.getElementById('quickRefDialog');
const diagram = document.getElementById('diagram');
const paletteList = document.getElementById('paletteList');
const palettePane = document.querySelector('.state-palette');
const stateTableBody = document.querySelector('#stateTable tbody');
const toggleTableBtn = document.getElementById('toggleTable');
const tablePanel = document.getElementById('tablePanel');
const toolbarTitle = document.getElementById('toolbarTitle');
const mealyOutputRow = document.getElementById('mealyOutputRow');

function closeDialog(id) {
  document.getElementById(id).classList.add('hidden');
}

function openDialog(id) {
  document.getElementById(id).classList.remove('hidden');
}

function parseList(value) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
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
    node.querySelector('.state-extra').textContent = state.type === 'moore' ? st.outputs.join('') : '';
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
  diagram.innerHTML = '';
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" markerUnits="strokeWidth">
      <polygon points="0 0, 10 3.5, 0 7" fill="currentColor"></polygon>
    </marker>`;
  diagram.appendChild(defs);
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
  const expectedTransitions = state.inputs.length ? Math.pow(2, state.inputs.length) : 0;
  const actualTransitions = state.transitions.filter((t) => t.from === st.id).length;
  if (expectedTransitions && actualTransitions !== expectedTransitions) {
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
  textId.textContent = state.type === 'moore' ? st.outputs.join('') : `#${st.id}`;

  group.appendChild(circle);
  group.appendChild(textLabel);
  group.appendChild(textId);
  diagram.appendChild(group);
}

function endpointsForArc(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const start = {
    x: from.x + (dx / len) * from.radius,
    y: from.y + (dy / len) * from.radius,
  };
  const end = {
    x: to.x - (dx / len) * to.radius,
    y: to.y - (dy / len) * to.radius,
  };
  return { start, end, len, dx, dy };
}

function quadraticPath(from, to, arcOffset = 0) {
  const { start, end, len, dx, dy } = endpointsForArc(from, to);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = midX + nx * arcOffset;
  const cy = midY + ny * arcOffset;
  return { d: `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`, ctrl: { x: cx, y: cy } };
}

function drawTransition(tr) {
  const from = state.states.find((s) => s.id === tr.from);
  const to = state.states.find((s) => s.id === tr.to);
  if (!from || !to) return;
  const pathInfo = quadraticPath(from, to, tr.arcOffset || 0);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathInfo.d);
  path.classList.add('arrow-path');
  if (selectedArrowId === tr.id) path.classList.add('selected');
  path.dataset.id = tr.id;

  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  handle.classList.add('arc-handle');
  handle.setAttribute('r', 7);
  handle.setAttribute('cx', pathInfo.ctrl.x);
  handle.setAttribute('cy', pathInfo.ctrl.y);
  handle.dataset.id = tr.id;

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.classList.add('arrow-label');
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('x', pathInfo.ctrl.x);
  label.setAttribute('y', pathInfo.ctrl.y - 8);
  const labelText = [];
  if (tr.inputs) labelText.push(formatIO(tr.inputs));
  if (state.type === 'mealy' && tr.outputs) labelText.push(formatIO(tr.outputs));
  label.innerHTML = labelText.join(' | ');

  diagram.appendChild(path);
  diagram.appendChild(handle);
  diagram.appendChild(label);
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
  diagram.appendChild(previewPath);
}

function formatIO(text) {
  return text.replace(/_([A-Za-z0-9]+)/g, '<tspan baseline-shift="sub">$1</tspan>');
}

function openArrowDialog(targetId) {
  arrowDialogTarget = targetId;
  const tr = state.transitions.find((t) => t.id === targetId);
  document.getElementById('arrowInputs').value = tr?.inputs || '';
  document.getElementById('arrowOutputs').value = tr?.outputs || '';
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
  Object.assign(state, data);
  updateControls();
  renderTable();
  renderPalette();
  renderDiagram();
}

function captureImage(element, filename) {
  html2canvas(element).then((canvas) => {
    const url = canvas.toDataURL('image/png');
    download(filename, url);
  });
}

function withPrevent(fn) {
  return (e) => {
    e.preventDefault();
    fn(e);
  };
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
    renderDiagram();
  });

  document.getElementById('outputsControl').addEventListener('change', (e) => {
    state.outputs = parseList(e.target.value);
    state.states.forEach((s) => (s.outputs = state.outputs.map(() => '0')));
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

  diagram.addEventListener('mousedown', (e) => {
    const targetState = e.target.closest('circle.state-node');
    const targetHandle = e.target.closest('circle.arc-handle');
    const targetPath = e.target.closest('path.arrow-path');
    if (targetPath) {
      selectedArrowId = parseInt(targetPath.dataset.id, 10);
      renderDiagram();
    }
    if (targetHandle) {
      const tr = state.transitions.find((t) => t.id === parseInt(targetHandle.dataset.id, 10));
      if (!tr) return;
      const moveHandler = (ev) => {
        const from = state.states.find((s) => s.id === tr.from);
        const to = state.states.find((s) => s.id === tr.to);
        const pt = getSVGPoint(ev.clientX, ev.clientY);
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
    if (currentArrow && e.button === 0) {
      const targetState = e.target.closest('circle.state-node');
      if (targetState) {
        const toId = parseInt(targetState.parentNode.dataset.id, 10);
        const newId = Date.now();
        state.transitions.push({
          id: newId,
          from: currentArrow.from,
          to: toId,
          inputs: '',
          outputs: '',
          arcOffset: 0,
        });
        selectedArrowId = newId;
        renderDiagram();
      }
    }
    currentArrow = null;
    previewPath = null;
  });

  diagram.addEventListener('contextmenu', (e) => {
    const path = e.target.closest('path.arrow-path');
    if (path) {
      const id = parseInt(path.dataset.id, 10);
      openArrowDialog(id);
    }
  });

  document.getElementById('saveArrow').addEventListener('click', () => {
    const tr = state.transitions.find((t) => t.id === arrowDialogTarget);
    if (tr) {
      tr.inputs = document.getElementById('arrowInputs').value.trim();
      tr.outputs = document.getElementById('arrowOutputs').value.trim();
      renderDiagram();
    }
    closeDialog('arrowDialog');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedArrowId) {
      state.transitions = state.transitions.filter((t) => t.id !== selectedArrowId);
      selectedArrowId = null;
      renderDiagram();
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('dialog-backdrop')) {
      e.target.classList.add('hidden');
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (currentArrow) {
      currentArrow.toPoint = getSVGPoint(e.clientX, e.clientY);
      renderDiagram();
    }
  });
}

function getSVGPoint(clientX, clientY) {
  const pt = diagram.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const svgP = pt.matrixTransform(diagram.getScreenCTM().inverse());
  return svgP;
}

document.addEventListener('DOMContentLoaded', () => {
  attachEvents();
  updateControls();
  initStates();
  renderTable();
  renderPalette();
  renderDiagram();
});
