/**
 * Finite State Machine Designer
 * A client-side application for creating and editing finite state machines
 */

(function() {
    'use strict';

    // Constants
    const STATE_RADIUS = 35;
    const ARROW_OFFSET = 8;

    // Application State
    let states = [];
    let transitions = [];
    let selectedStateId = null;
    let shiftSelectedStateId = null;
    let stateIdCounter = 0;
    let transitionIdCounter = 0;
    let draggedState = null;
    let dragOffset = { x: 0, y: 0 };

    // DOM Elements
    const canvas = document.getElementById('canvas');
    const statesLayer = document.getElementById('states-layer');
    const transitionsLayer = document.getElementById('transitions-layer');
    const canvasWrapper = document.querySelector('.canvas-wrapper');
    const addStateBtn = document.getElementById('addStateBtn');
    const saveBtn = document.getElementById('saveBtn');
    const loadBtn = document.getElementById('loadBtn');
    const fileInput = document.getElementById('fileInput');
    const clearBtn = document.getElementById('clearBtn');
    const editModal = document.getElementById('editModal');
    const modalTitle = document.getElementById('modalTitle');
    const editInput = document.getElementById('editInput');
    const modalSave = document.getElementById('modalSave');
    const modalCancel = document.getElementById('modalCancel');
    const componentItems = document.querySelectorAll('.component-item');

    // Current edit context
    let editContext = null;

    // Initialize the application
    function init() {
        setupEventListeners();
        setupDragAndDrop();
    }

    // Setup event listeners
    function setupEventListeners() {
        addStateBtn.addEventListener('click', () => addStateAtCenter('state'));
        saveBtn.addEventListener('click', saveToFile);
        loadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', loadFromFile);
        clearBtn.addEventListener('click', clearAll);

        canvas.addEventListener('mousedown', handleCanvasMouseDown);
        canvas.addEventListener('mousemove', handleCanvasMouseMove);
        canvas.addEventListener('mouseup', handleCanvasMouseUp);
        canvas.addEventListener('mouseleave', handleCanvasMouseUp);
        canvas.addEventListener('dblclick', handleCanvasDoubleClick);
        canvas.addEventListener('contextmenu', handleContextMenu);

        modalSave.addEventListener('click', handleModalSave);
        modalCancel.addEventListener('click', hideModal);
        editInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleModalSave();
        });

        // Click outside modal to close
        editModal.addEventListener('click', (e) => {
            if (e.target === editModal) hideModal();
        });
    }

    // Setup drag and drop from palette
    function setupDragAndDrop() {
        componentItems.forEach(item => {
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragend', handleDragEnd);
        });

        canvasWrapper.addEventListener('dragover', handleDragOver);
        canvasWrapper.addEventListener('dragleave', handleDragLeave);
        canvasWrapper.addEventListener('drop', handleDrop);
    }

    // Drag and drop handlers
    function handleDragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.closest('.component-item').dataset.type);
        e.dataTransfer.effectAllowed = 'copy';
    }

    function handleDragEnd(e) {
        canvasWrapper.classList.remove('drag-over');
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        canvasWrapper.classList.add('drag-over');
    }

    function handleDragLeave(e) {
        canvasWrapper.classList.remove('drag-over');
    }

    function handleDrop(e) {
        e.preventDefault();
        canvasWrapper.classList.remove('drag-over');
        
        const type = e.dataTransfer.getData('text/plain');
        const rect = canvasWrapper.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        addState(type, x, y);
    }

    // State management
    function addState(type, x, y) {
        const id = `state_${stateIdCounter++}`;
        const state = {
            id,
            type,
            name: type === 'start-state' ? 'Start' : (type === 'end-state' ? 'End' : `S${stateIdCounter - 1}`),
            x: Math.max(STATE_RADIUS, Math.min(x, canvasWrapper.clientWidth - STATE_RADIUS)),
            y: Math.max(STATE_RADIUS, Math.min(y, canvasWrapper.clientHeight - STATE_RADIUS))
        };
        states.push(state);
        renderState(state);
        return state;
    }

    function addStateAtCenter(type) {
        const rect = canvasWrapper.getBoundingClientRect();
        const x = rect.width / 2 + (Math.random() - 0.5) * 100;
        const y = rect.height / 2 + (Math.random() - 0.5) * 100;
        addState(type, x, y);
    }

    function renderState(state) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'state-group');
        group.setAttribute('data-id', state.id);
        group.setAttribute('transform', `translate(${state.x}, ${state.y})`);

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('class', `state-circle ${state.type}`);
        circle.setAttribute('r', STATE_RADIUS);
        circle.setAttribute('cx', 0);
        circle.setAttribute('cy', 0);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'state-label');
        text.textContent = state.name;

        group.appendChild(circle);
        group.appendChild(text);
        statesLayer.appendChild(group);
    }

    function updateStatePosition(state) {
        const group = statesLayer.querySelector(`[data-id="${state.id}"]`);
        if (group) {
            group.setAttribute('transform', `translate(${state.x}, ${state.y})`);
        }
        // Update connected transitions
        updateTransitionsForState(state.id);
    }

    function updateStateName(stateId, name) {
        const state = states.find(s => s.id === stateId);
        if (state) {
            state.name = name;
            const group = statesLayer.querySelector(`[data-id="${stateId}"]`);
            if (group) {
                const text = group.querySelector('.state-label');
                if (text) text.textContent = name;
            }
        }
    }

    function deleteState(stateId) {
        // Remove associated transitions
        transitions = transitions.filter(t => {
            if (t.from === stateId || t.to === stateId) {
                const transitionEl = transitionsLayer.querySelector(`[data-id="${t.id}"]`);
                if (transitionEl) transitionEl.remove();
                return false;
            }
            return true;
        });

        // Remove state
        states = states.filter(s => s.id !== stateId);
        const stateEl = statesLayer.querySelector(`[data-id="${stateId}"]`);
        if (stateEl) stateEl.remove();

        // Clear selection if deleted
        if (selectedStateId === stateId) selectedStateId = null;
        if (shiftSelectedStateId === stateId) shiftSelectedStateId = null;
    }

    // Transition management
    function addTransition(fromId, toId, label = '') {
        // Check if transition already exists
        const existing = transitions.find(t => t.from === fromId && t.to === toId);
        if (existing) return;

        const id = `transition_${transitionIdCounter++}`;
        const transition = { id, from: fromId, to: toId, label: label || 'ε' };
        transitions.push(transition);
        renderTransition(transition);
        return transition;
    }

    function renderTransition(transition) {
        const fromState = states.find(s => s.id === transition.from);
        const toState = states.find(s => s.id === transition.to);
        if (!fromState || !toState) return;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'transition-group');
        group.setAttribute('data-id', transition.id);

        if (fromState.id === toState.id) {
            // Self-loop
            renderSelfLoop(group, fromState, transition);
        } else {
            renderArrow(group, fromState, toState, transition);
        }

        transitionsLayer.appendChild(group);
    }

    function renderArrow(group, fromState, toState, transition) {
        const dx = toState.x - fromState.x;
        const dy = toState.y - fromState.y;
        const angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check for bidirectional transition
        const reverse = transitions.find(t => t.from === transition.to && t.to === transition.from);
        const offset = reverse ? 10 : 0;

        const perpX = -Math.sin(angle) * offset;
        const perpY = Math.cos(angle) * offset;

        const startX = fromState.x + Math.cos(angle) * STATE_RADIUS + perpX;
        const startY = fromState.y + Math.sin(angle) * STATE_RADIUS + perpY;
        const endX = toState.x - Math.cos(angle) * (STATE_RADIUS + ARROW_OFFSET) + perpX;
        const endY = toState.y - Math.sin(angle) * (STATE_RADIUS + ARROW_OFFSET) + perpY;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'transition-line');
        path.setAttribute('d', `M ${startX} ${startY} L ${endX} ${endY}`);

        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;

        // Label background
        const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        labelBg.setAttribute('class', 'transition-label-bg');
        
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'transition-label');
        label.setAttribute('x', midX);
        label.setAttribute('y', midY - 10);
        label.textContent = transition.label;

        group.appendChild(path);
        group.appendChild(labelBg);
        group.appendChild(label);

        // Position label background after text is rendered
        requestAnimationFrame(() => {
            const bbox = label.getBBox();
            labelBg.setAttribute('x', bbox.x - 3);
            labelBg.setAttribute('y', bbox.y - 2);
            labelBg.setAttribute('width', bbox.width + 6);
            labelBg.setAttribute('height', bbox.height + 4);
            labelBg.setAttribute('rx', 2);
        });
    }

    function renderSelfLoop(group, state, transition) {
        const loopRadius = 25;
        const startAngle = -Math.PI / 4;
        const endAngle = -3 * Math.PI / 4;

        const cx = state.x;
        const cy = state.y - STATE_RADIUS - loopRadius;

        const startX = cx + loopRadius * Math.cos(startAngle);
        const startY = cy + loopRadius * Math.sin(startAngle);
        const endX = cx + loopRadius * Math.cos(endAngle);
        const endY = cy + loopRadius * Math.sin(endAngle);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'transition-line self-transition');
        path.setAttribute('d', `M ${state.x + STATE_RADIUS * Math.cos(-Math.PI/4)} ${state.y + STATE_RADIUS * Math.sin(-Math.PI/4)} 
                               A ${loopRadius} ${loopRadius} 0 1 0 
                               ${state.x + STATE_RADIUS * Math.cos(-3*Math.PI/4)} ${state.y + STATE_RADIUS * Math.sin(-3*Math.PI/4)}`);

        const labelX = cx;
        const labelY = cy - loopRadius - 5;

        const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        labelBg.setAttribute('class', 'transition-label-bg');

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('class', 'transition-label');
        label.setAttribute('x', labelX);
        label.setAttribute('y', labelY);
        label.textContent = transition.label;

        group.appendChild(path);
        group.appendChild(labelBg);
        group.appendChild(label);

        requestAnimationFrame(() => {
            const bbox = label.getBBox();
            labelBg.setAttribute('x', bbox.x - 3);
            labelBg.setAttribute('y', bbox.y - 2);
            labelBg.setAttribute('width', bbox.width + 6);
            labelBg.setAttribute('height', bbox.height + 4);
            labelBg.setAttribute('rx', 2);
        });
    }

    function updateTransitionsForState(stateId) {
        transitions.forEach(t => {
            if (t.from === stateId || t.to === stateId) {
                const el = transitionsLayer.querySelector(`[data-id="${t.id}"]`);
                if (el) el.remove();
                renderTransition(t);
            }
        });
    }

    function updateTransitionLabel(transitionId, label) {
        const transition = transitions.find(t => t.id === transitionId);
        if (transition) {
            transition.label = label || 'ε';
            const el = transitionsLayer.querySelector(`[data-id="${transitionId}"]`);
            if (el) el.remove();
            renderTransition(transition);
        }
    }

    function deleteTransition(transitionId) {
        transitions = transitions.filter(t => t.id !== transitionId);
        const el = transitionsLayer.querySelector(`[data-id="${transitionId}"]`);
        if (el) el.remove();
    }

    // Canvas event handlers
    function handleCanvasMouseDown(e) {
        const stateGroup = e.target.closest('.state-group');
        
        if (stateGroup) {
            const stateId = stateGroup.dataset.id;
            
            if (e.shiftKey) {
                // Shift-click for creating transitions
                if (shiftSelectedStateId && shiftSelectedStateId !== stateId) {
                    // Create transition
                    addTransition(shiftSelectedStateId, stateId);
                    clearShiftSelection();
                } else {
                    // First shift-click
                    setShiftSelection(stateId);
                }
            } else {
                // Normal click - start drag
                clearShiftSelection();
                setSelection(stateId);
                
                const state = states.find(s => s.id === stateId);
                if (state) {
                    draggedState = state;
                    const rect = canvasWrapper.getBoundingClientRect();
                    dragOffset = {
                        x: e.clientX - rect.left - state.x,
                        y: e.clientY - rect.top - state.y
                    };
                }
            }
        } else {
            // Click on empty space
            clearSelection();
            clearShiftSelection();
        }
    }

    function handleCanvasMouseMove(e) {
        if (draggedState) {
            const rect = canvasWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left - dragOffset.x;
            const y = e.clientY - rect.top - dragOffset.y;
            
            draggedState.x = Math.max(STATE_RADIUS, Math.min(x, rect.width - STATE_RADIUS));
            draggedState.y = Math.max(STATE_RADIUS, Math.min(y, rect.height - STATE_RADIUS));
            
            updateStatePosition(draggedState);
        }
    }

    function handleCanvasMouseUp(e) {
        draggedState = null;
    }

    function handleCanvasDoubleClick(e) {
        const stateGroup = e.target.closest('.state-group');
        const transitionGroup = e.target.closest('.transition-group');
        
        if (stateGroup) {
            const stateId = stateGroup.dataset.id;
            const state = states.find(s => s.id === stateId);
            if (state) {
                showModal('Edit State Name', state.name, (value) => {
                    updateStateName(stateId, value);
                });
            }
        } else if (transitionGroup) {
            const transitionId = transitionGroup.dataset.id;
            const transition = transitions.find(t => t.id === transitionId);
            if (transition) {
                showModal('Edit Transition Label', transition.label, (value) => {
                    updateTransitionLabel(transitionId, value);
                });
            }
        }
    }

    function handleContextMenu(e) {
        e.preventDefault();
        
        const stateGroup = e.target.closest('.state-group');
        const transitionGroup = e.target.closest('.transition-group');
        
        if (stateGroup) {
            const stateId = stateGroup.dataset.id;
            if (confirm('Delete this state?')) {
                deleteState(stateId);
            }
        } else if (transitionGroup) {
            const transitionId = transitionGroup.dataset.id;
            if (confirm('Delete this transition?')) {
                deleteTransition(transitionId);
            }
        }
    }

    // Selection management
    function setSelection(stateId) {
        clearSelection();
        selectedStateId = stateId;
        const group = statesLayer.querySelector(`[data-id="${stateId}"]`);
        if (group) group.classList.add('selected');
    }

    function clearSelection() {
        if (selectedStateId) {
            const group = statesLayer.querySelector(`[data-id="${selectedStateId}"]`);
            if (group) group.classList.remove('selected');
            selectedStateId = null;
        }
    }

    function setShiftSelection(stateId) {
        clearShiftSelection();
        shiftSelectedStateId = stateId;
        const group = statesLayer.querySelector(`[data-id="${stateId}"]`);
        if (group) group.classList.add('shift-selected');
    }

    function clearShiftSelection() {
        if (shiftSelectedStateId) {
            const group = statesLayer.querySelector(`[data-id="${shiftSelectedStateId}"]`);
            if (group) group.classList.remove('shift-selected');
            shiftSelectedStateId = null;
        }
    }

    // Modal management
    function showModal(title, value, callback) {
        modalTitle.textContent = title;
        editInput.value = value;
        editContext = callback;
        editModal.classList.remove('hidden');
        editInput.focus();
        editInput.select();
    }

    function hideModal() {
        editModal.classList.add('hidden');
        editContext = null;
        editInput.value = '';
    }

    function handleModalSave() {
        if (editContext) {
            editContext(editInput.value);
        }
        hideModal();
    }

    // Save/Load functionality
    function saveToFile() {
        const data = {
            version: '1.0',
            states: states,
            transitions: transitions,
            counters: {
                state: stateIdCounter,
                transition: transitionIdCounter
            }
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fsm-design.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function loadFromFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                loadData(data);
            } catch (err) {
                alert('Error loading file: Invalid JSON format');
            }
        };
        reader.readAsText(file);
        
        // Reset file input
        fileInput.value = '';
    }

    function loadData(data) {
        // Clear current state
        clearAll(false);

        // Validate and load data
        if (data.version && data.states && data.transitions) {
            // Restore counters
            if (data.counters) {
                stateIdCounter = data.counters.state || 0;
                transitionIdCounter = data.counters.transition || 0;
            }

            // Restore states
            data.states.forEach(state => {
                states.push(state);
                renderState(state);
            });

            // Restore transitions
            data.transitions.forEach(transition => {
                transitions.push(transition);
                renderTransition(transition);
            });
        } else {
            alert('Error loading file: Invalid FSM data format');
        }
    }

    function clearAll(confirm_clear = true) {
        if (confirm_clear && !confirm('Are you sure you want to clear all states and transitions?')) {
            return;
        }

        // Clear arrays
        states = [];
        transitions = [];
        selectedStateId = null;
        shiftSelectedStateId = null;
        stateIdCounter = 0;
        transitionIdCounter = 0;

        // Clear SVG
        statesLayer.innerHTML = '';
        transitionsLayer.innerHTML = '';
    }

    // Initialize when DOM is ready
    init();
})();
