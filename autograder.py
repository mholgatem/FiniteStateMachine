#!/usr/bin/env python3
"""Offline auto-grader for FSM save files.

This script inspects finite state machine save JSON files exported by the
application and validates structural requirements without executing any UI
logic. It can process multiple files in a folder and reports pass/fail status
for each one along with detailed reasons for failures.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple


# ----------------------------- Generic helpers -----------------------------

def normalize_binary_value(val: object) -> str:
    if val is None:
        return ""
    normalized = str(val).strip().upper()
    if not normalized:
        return ""
    ch = normalized[0]
    return ch if ch in {"0", "1", "X"} else ""


def normalize_bit_array(values: Sequence[object], expected_length: int) -> List[str]:
    result = ["" for _ in range(expected_length)]
    for idx, val in enumerate(values or []):
        if idx < expected_length:
            result[idx] = normalize_binary_value(val)
    return result


def state_bit_count(num_states: int) -> int:
    return max(1, math.ceil(math.log2(max(num_states, 1))))


def combinations_from_values(values: Sequence[str]) -> List[str]:
    combos = [""]
    for val in values:
        normalized = val if val in {"0", "1"} else "X"
        next_combos = []
        for prefix in combos:
            if normalized == "X":
                next_combos.append(f"{prefix}0")
                next_combos.append(f"{prefix}1")
            else:
                next_combos.append(f"{prefix}{normalized}")
        combos = next_combos
    return combos


def generate_input_combos(count: int) -> List[str]:
    if count == 0:
        return [""]
    total = 2**count
    return [format(i, f"0{count}b") for i in range(total)]


def normalize_var_name(name: str) -> str:
    return (name or "").replace("\u0305", "").replace(" ", "").lower()


# -------------------------- Transition processing -------------------------

@dataclass
class Transition:
    raw: MutableMapping[str, object]
    inputs: int
    outputs: int

    def __post_init__(self) -> None:
        if "inputValues" not in self.raw:
            # Backwards compatibility with legacy field name
            fallback = self.raw.get("inputs") or []
            self.raw["inputValues"] = [str(v) for v in fallback]
        if "outputValues" not in self.raw:
            fallback = self.raw.get("outputs") or []
            self.raw["outputValues"] = [str(v) for v in fallback]
        self.raw["inputValues"] = normalize_bit_array(self.raw.get("inputValues", []), self.inputs)
        self.raw["outputValues"] = normalize_bit_array(self.raw.get("outputValues", []), self.outputs)
        if "arcOffset" not in self.raw or self.raw.get("arcOffset") is None:
            self.raw["arcOffset"] = 0
        if self.raw.get("from") == self.raw.get("to") and self.raw.get("loopAngle") is None:
            self.raw["loopAngle"] = -math.pi / 2

    @property
    def from_id(self) -> Optional[int]:
        return _coerce_int(self.raw.get("from"))

    @property
    def to_id(self) -> Optional[int]:
        return _coerce_int(self.raw.get("to"))

    @property
    def input_values(self) -> List[str]:
        return self.raw.get("inputValues", [])

    @property
    def output_values(self) -> List[str]:
        return self.raw.get("outputValues", [])


@dataclass
class FSMState:
    raw: Mapping[str, object]
    outputs: int

    @property
    def id(self) -> Optional[int]:
        return _coerce_int(self.raw.get("id"))

    @property
    def placed(self) -> bool:
        return bool(self.raw.get("placed"))

    @property
    def binary(self) -> str:
        value = str(self.raw.get("binary") or "").strip()
        return value

    @property
    def output_bits(self) -> List[str]:
        return normalize_bit_array(self.raw.get("outputs", []), self.outputs)


@dataclass
class DiagramExpectations:
    expectations: Dict[str, Dict[str, List[str]]]
    conflict: bool


@dataclass
class TransitionTableRowValues:
    current_state_bits: List[str]
    input_bits: List[str]
    next_state_bits: List[str]
    outputs: List[str]


def _coerce_int(val: object) -> Optional[int]:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def column_base_key(col: Mapping[str, object]) -> str:
    key = str(col.get("baseKey") or col.get("key") or "")
    return key.split("__", 1)[0]


def build_transition_column_templates(num_states: int, inputs: Sequence[str], outputs: Sequence[str]) -> List[Dict[str, object]]:
    bit_count = state_bit_count(num_states)
    templates: List[Dict[str, object]] = []
    for i in range(bit_count - 1, -1, -1):
        templates.append({"key": f"q_{i}", "baseKey": f"q_{i}", "label": f"Q_{i}", "type": "value"})
    for i in range(bit_count - 1, -1, -1):
        templates.append({
            "key": f"next_q_{i}",
            "baseKey": f"next_q_{i}",
            "label": f"Q_{i}^+",
            "type": "value",
        })
    templates.extend(
        {
            "key": f"in_{idx}",
            "baseKey": f"in_{idx}",
            "label": name or f"Input {idx + 1}",
            "type": "value",
        }
        for idx, name in enumerate(inputs)
    )
    templates.extend(
        {
            "key": f"out_{idx}",
            "baseKey": f"out_{idx}",
            "label": name or f"Output {idx + 1}",
            "type": "value",
        }
        for idx, name in enumerate(outputs)
    )
    templates.append({"key": "spacer", "baseKey": "spacer", "label": "", "type": "spacer", "allowMultiple": True})
    return templates


def ensure_transition_table_structure(state: Mapping[str, object]) -> Dict[str, object]:
    table = state.get("transitionTable")
    if not isinstance(table, dict):
        table = {}
    table.setdefault("cells", {})
    if not isinstance(table.get("columns"), list):
        table["columns"] = []

    templates = build_transition_column_templates(
        int(state.get("numStates") or 0), state.get("inputs", []) or [], state.get("outputs", []) or []
    )
    template_map = {tpl["key"]: tpl for tpl in templates}

    def create_column_instance(template: Mapping[str, object]) -> Dict[str, object]:
        base_key = column_base_key(template)
        return {**template, "key": f"{base_key}__generated", "baseKey": base_key}

    sanitized_columns: List[Dict[str, object]] = []
    for col in table["columns"]:
        base_key = column_base_key(col)
        template = template_map.get(base_key)
        if not template:
            continue
        key = col.get("key") or f"{base_key}__generated"
        sanitized_columns.append({**template, **col, "baseKey": base_key, "key": key})

    if not sanitized_columns:
        # Build a default layout mirroring the UI order
        current_states = [tpl for tpl in templates if tpl["key"].startswith("q_")]
        next_states = [tpl for tpl in templates if tpl["key"].startswith("next_q_")]
        inputs = [tpl for tpl in templates if tpl["key"].startswith("in_")]
        outputs = [tpl for tpl in templates if tpl["key"].startswith("out_")]
        sanitized_columns = (
            current_states
            + next_states
            + ([{"key": "spacer", "type": "spacer", "baseKey": "spacer"}] if inputs or outputs else [])
            + inputs
            + outputs
        )
    table["columns"] = sanitized_columns

    value_columns = [col for col in sanitized_columns if col.get("type") == "value"]
    table["valueColumns"] = value_columns

    combos = generate_input_combos(len(state.get("inputs", []) or []))
    rows = []
    for s in range(int(state.get("numStates") or 0)):
        for combo in combos:
            rows.append({"key": f"{s}|{combo or 'none'}", "stateId": s, "inputCombo": combo})
    table["rows"] = rows
    return table


def state_binary_code(state: FSMState, bit_count: int) -> Optional[str]:
    cleaned = (state.binary or format(state.id or 0, "b")).replace(" ", "")
    digits = "".join(ch for ch in cleaned if ch in "01")
    if len(digits) < bit_count:
        digits = digits.rjust(bit_count, "0")
    return digits[-bit_count:] if digits else None


def normalize_outputs_for_transition(tr: Transition, states: Dict[int, FSMState], fsm_type: str, output_count: int) -> List[str]:
    if fsm_type == "moore":
        src = states.get(tr.from_id or -1)
        return src.output_bits if src else ["" for _ in range(output_count)]
    return normalize_bit_array(tr.output_values, output_count)


def build_diagram_expectations(
    transitions: Sequence[Transition], states: Dict[int, FSMState], bit_count: int, fsm_type: str, output_count: int
) -> DiagramExpectations:
    expectations: Dict[str, Dict[str, List[str]]] = {}
    conflict = False

    for tr in transitions:
        source_bits = state_binary_code(states.get(tr.from_id or -1, FSMState({}, output_count)), bit_count) or ""
        if not source_bits or len(source_bits) != bit_count:
            conflict = True
            continue
        combos = combinations_from_values(tr.input_values)
        next_bits = state_binary_code(states.get(tr.to_id or -1, FSMState({}, output_count)), bit_count) or ""
        next_state_bits = normalize_bit_array(list(next_bits), bit_count)
        outputs = normalize_outputs_for_transition(tr, states, fsm_type, output_count)
        if not next_bits or any(v == "" for v in next_state_bits) or any(v == "" for v in outputs):
            conflict = True
            continue
        for combo in combos:
            key = f"{source_bits}|{combo or 'none'}"
            existing = expectations.get(key)
            record = {"nextStateBits": next_state_bits, "outputs": outputs, "stateBits": source_bits, "inputCombo": combo or "none"}
            if not existing:
                expectations[key] = record
                continue
            if existing.get("nextStateBits") != next_state_bits or existing.get("outputs") != outputs:
                conflict = True
    return DiagramExpectations(expectations, conflict)


def values_compatible(expected: str, actual: str) -> bool:
    if not expected or not actual:
        return False
    if expected == "X" or actual == "X":
        return True
    return expected == actual


def outputs_compatible(expected: List[str], actual: List[str], fsm_type: str) -> bool:
    if fsm_type == "mealy":
        if len(expected) != len(actual):
            return False
        for e, a in zip(expected, actual):
            e_norm = normalize_binary_value(e)
            a_norm = normalize_binary_value(a)
            if not e_norm or not a_norm:
                return False
            if e_norm == "X":
                if a_norm != "X":
                    return False
                continue
            if a_norm == "X":
                continue
            if e_norm != a_norm:
                return False
        return True
    if len(expected) != len(actual):
        return False
    return all(values_compatible(e, a) for e, a in zip(expected, actual))


def transition_table_row_is_blank(row_key: str, columns: Sequence[Mapping[str, object]], cells: Mapping[str, object]) -> bool:
    return all(not normalize_binary_value(cells.get(f"{row_key}::{col['key']}")) for col in columns)


def read_transition_table_row_values(
    row_key: str, columns: Sequence[Mapping[str, object]], cells: Mapping[str, object]
) -> TransitionTableRowValues:
    def read(col_key: str) -> str:
        return normalize_binary_value(cells.get(f"{row_key}::{col_key}"))

    current_state = [read(col["key"]) for col in columns if column_base_key(col).startswith("q_")]
    inputs = [read(col["key"]) for col in columns if column_base_key(col).startswith("in_")]
    next_state = [read(col["key"]) for col in columns if column_base_key(col).startswith("next_q_")]
    outputs = [read(col["key"]) for col in columns if column_base_key(col).startswith("out_")]
    return TransitionTableRowValues(current_state, inputs, next_state, outputs)


def verify_transition_table(table: Mapping[str, object], expectations: DiagramExpectations, bit_count: int, fsm_type: str, input_count: int, output_count: int) -> Tuple[bool, Optional[str]]:
    columns = table.get("valueColumns") or []
    rows = table.get("rows") or []
    cells = table.get("cells") or {}

    current_state_cols = [col for col in columns if column_base_key(col).startswith("q_")]
    next_state_cols = [col for col in columns if column_base_key(col).startswith("next_q_")]
    input_cols = [col for col in columns if column_base_key(col).startswith("in_")]
    output_cols = [col for col in columns if column_base_key(col).startswith("out_")]

    missing_headers = []
    if len(current_state_cols) != bit_count:
        missing_headers.append("current state bits")
    if len(next_state_cols) != bit_count:
        missing_headers.append("next state bits")
    if len(input_cols) != input_count:
        missing_headers.append("input columns")
    if len(output_cols) != output_count:
        missing_headers.append("output columns")
    if missing_headers:
        return False, f"Missing required column headers: {', '.join(missing_headers)}"

    unchecked = set(expectations.expectations.keys())
    matches = not expectations.conflict

    for row in rows:
        row_key = row.get("key") or ""
        if not matches:
            break
        if transition_table_row_is_blank(row_key, columns, cells):
            continue
        raw = read_transition_table_row_values(row_key, columns, cells)
        blank_to_zero = lambda arr: [v or "0" for v in arr]
        actual = TransitionTableRowValues(
            blank_to_zero(raw.current_state_bits),
            blank_to_zero(raw.input_bits),
            blank_to_zero(raw.next_state_bits),
            blank_to_zero(raw.outputs),
        )
        if any(v == "" for v in actual.current_state_bits) or any(v == "" for v in actual.input_bits):
            matches = False
            break
        current_bits = "".join(actual.current_state_bits)
        input_bits = "".join(actual.input_bits)
        if not current_bits or len(current_bits) != bit_count:
            matches = False
            break
        key = f"{current_bits}|{input_bits or 'none'}"
        expected = expectations.expectations.get(key)
        if not expected:
            matches = False
            break
        if not values_compatible_lists(expected.get("nextStateBits", []), actual.next_state_bits):
            matches = False
            break
        if not outputs_compatible(expected.get("outputs", []), actual.outputs, fsm_type):
            matches = False
            break
        unchecked.discard(key)

    if matches and unchecked:
        return False, "Transition table is missing transitions that exist in the diagram"
    return matches, None if matches else "Transition table and diagram do not match"


def values_compatible_lists(expected: Sequence[str], actual: Sequence[str]) -> bool:
    if len(expected) != len(actual):
        return False
    return all(values_compatible(e, a) for e, a in zip(expected, actual))


# ----------------------------- K-map handling ------------------------------


def gray_code(bits: int) -> List[str]:
    if bits <= 0:
        return [""]
    codes = ["0", "1"]
    for _ in range(1, bits):
        reflected = list(reversed(codes))
        codes = ["0" + c for c in codes] + ["1" + c for c in reflected]
    return codes


@dataclass
class KmapLayout:
    map_var_count: int
    map_vars: List[str]
    row_vars: List[str]
    col_vars: List[str]
    row_codes: List[str]
    col_codes: List[str]
    base_rows: int
    base_cols: int
    map_rows: int
    map_cols: int
    total_rows: int
    total_cols: int
    submaps: List[Dict[str, object]]


def build_kmap_layout(kmap: Mapping[str, object]) -> KmapLayout:
    variables = list(kmap.get("variables") or [])
    map_var_count = max(0, len(variables) - 4)
    map_vars = variables[:map_var_count]
    core_vars = variables[map_var_count:]
    more_sig_count = math.ceil(len(core_vars) / 2)
    more_sig = core_vars[:more_sig_count]
    less_sig = core_vars[more_sig_count:]
    if not less_sig and len(more_sig) > 1:
        less_sig = [more_sig.pop()]
    row_vars: List[str]
    col_vars: List[str]
    if kmap.get("direction") == "vertical":
        row_vars, col_vars = more_sig, less_sig
    else:
        row_vars, col_vars = less_sig, more_sig
    if not row_vars and col_vars:
        row_vars = [col_vars.pop(0)]
    row_codes = gray_code(len(row_vars))
    col_codes = gray_code(len(col_vars))
    base_rows = len(row_codes) or 1
    base_cols = len(col_codes) or 1
    map_rows = map_cols = 1
    map_row_codes = [""]
    map_col_codes = [""]
    if map_var_count == 1:
        map_cols = 2
        map_col_codes = gray_code(1)
    elif map_var_count >= 2:
        map_rows = 2
        map_cols = 2
        map_row_codes = gray_code(1)
        map_col_codes = gray_code(1)

    submaps = []
    for mr in range(map_rows):
        for mc in range(map_cols):
            map_code = f"{map_row_codes[mr] if mr < len(map_row_codes) else ''}{map_col_codes[mc] if mc < len(map_col_codes) else ''}"
            submaps.append(
                {
                    "mapRow": mr,
                    "mapCol": mc,
                    "mapCode": map_code,
                    "rowOffset": mr * base_rows,
                    "colOffset": mc * base_cols,
                }
            )

    return KmapLayout(
        map_var_count,
        map_vars,
        row_vars,
        col_vars,
        row_codes,
        col_codes,
        base_rows,
        base_cols,
        map_rows,
        map_cols,
        base_rows * map_rows,
        base_cols * map_cols,
        submaps,
    )


def kmap_cell_key(row: int, col: int) -> str:
    return f"{row}-{col}"


def build_kmap_truth_table(kmap: Mapping[str, object]) -> Tuple[Dict[str, str], List[str]]:
    layout = build_kmap_layout(kmap)
    variables = layout.map_vars + layout.col_vars + layout.row_vars
    table: Dict[str, str] = {}
    base_rows = layout.base_rows or 1
    base_cols = layout.base_cols or 1
    for r in range(layout.total_rows):
        for c in range(layout.total_cols):
            sub = next(
                (
                    s
                    for s in layout.submaps
                    if r >= s["rowOffset"]
                    and r < s["rowOffset"] + base_rows
                    and c >= s["colOffset"]
                    and c < s["colOffset"] + base_cols
                ),
                None,
            )
            map_bits = (sub or {}).get("mapCode", "").ljust(layout.map_var_count, "0")
            col_code = layout.col_codes[c - (sub.get("colOffset", 0) if sub else 0)] if layout.col_codes else ""
            row_code = layout.row_codes[r - (sub.get("rowOffset", 0) if sub else 0)] if layout.row_codes else ""
            bits = f"{map_bits}{col_code}{row_code}"
            key = "".join(bits[idx] if idx < len(bits) else "0" for idx in range(len(variables)))
            cell_val = (kmap.get("cells", {}) or {}).get(kmap_cell_key(r, c), "") or "X"
            table[key] = normalize_binary_value(cell_val) or "X"
    return table, variables


# --------------------------- Expression handling --------------------------

Token = Dict[str, object]


def tokenize_expression_input(raw: str) -> List[Token]:
    tokens: List[Token] = []
    src = (raw or "").replace("\u0305", "")
    i = 0
    while i < len(src):
        ch = src[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "+*":
            tokens.append({"type": "op", "value": ch})
            i += 1
            continue
        if ch == "~":
            tokens.append({"type": "not"})
            i += 1
            continue
        if ch == "'":
            tokens.append({"type": "not-post"})
            i += 1
            continue
        if ch in "()":
            tokens.append({"type": "paren", "value": ch})
            i += 1
            continue
        if ch.isalnum() or ch in "_^":
            start = i
            while i < len(src) and (src[i].isalnum() or src[i] in "_^"):
                i += 1
            tokens.append({"type": "var", "value": src[start:i]})
            continue
        i += 1
    return tokens


def normalize_expression_tokens(raw: str) -> List[Token]:
    tokens = tokenize_expression_input(raw)
    normalized: List[Token] = []
    i = 0
    while i < len(tokens):
        tk = tokens[i]
        if tk["type"] == "var":
            negated = False
            if i > 0 and tokens[i - 1]["type"] == "not":
                negated = True
            if i + 1 < len(tokens) and tokens[i + 1]["type"] == "not-post":
                negated = True
                i += 1
            normalized.append({"type": "var", "value": tk["value"], "negated": negated})
            i += 1
            continue
        if tk["type"] == "not":
            next_token = tokens[i + 1] if i + 1 < len(tokens) else None
            if not next_token or next_token["type"] != "var":
                normalized.append({"type": "not"})
        if tk["type"] in {"op", "paren"}:
            normalized.append(tk)
        i += 1
    return normalized


def tokens_to_canonical(tokens: Sequence[Token]) -> str:
    parts: List[str] = []
    prev_type: Optional[str] = None
    for tk in tokens:
        ttype = tk.get("type")
        if ttype == "var":
            base = f"~{tk['value']}" if tk.get("negated") else tk.get("value", "")
            if prev_type in {"var", "close"}:
                parts.append(" ")
            parts.append(base)
            prev_type = "var"
        elif ttype == "op":
            if tk.get("value") == "+":
                parts.append(" + ")
            else:
                parts.append(" ")
            prev_type = "op"
        elif ttype == "not":
            parts.append("~")
            prev_type = "not"
        elif ttype == "paren":
            if tk.get("value") == "(" and prev_type in {"var", "close"}:
                parts.append(" ")
            parts.append(str(tk.get("value")))
            prev_type = "open" if tk.get("value") == "(" else "close"
    return "".join(parts).strip()


def expression_string_to_tokens(raw: str) -> List[Token]:
    normalized = normalize_expression_tokens(raw or "")
    return [
        {"type": tk["type"], "value": tk.get("value"), "negated": bool(tk.get("negated"))}
        for tk in normalized
        if tk["type"] in {"var", "op", "paren"}
    ]


def build_implicit_and_tokens(tokens: Sequence[Token]) -> List[Token]:
    result: List[Token] = []
    for idx, tk in enumerate(tokens):
        result.append(tk)
        next_token = tokens[idx + 1] if idx + 1 < len(tokens) else None
        is_left = tk.get("type") == "var" or (tk.get("type") == "paren" and tk.get("value") == ")")
        is_right = next_token and (
            next_token.get("type") == "var" or next_token.get("type") == "not" or (next_token.get("type") == "paren" and next_token.get("value") == "(")
        )
        if is_left and is_right:
            result.append({"type": "op", "value": "*"})
    return result


def to_rpn(tokens: Sequence[Token]) -> List[Token]:
    output: List[Token] = []
    ops: List[str] = []
    prec = {"~": 3, "*": 2, "+": 1}
    assoc = {"~": "right", "*": "left", "+": "left"}
    for tk in tokens:
        ttype = tk.get("type")
        if ttype == "var":
            output.append(tk)
            continue
        if ttype in {"not", "not-post"}:
            op = "~"
            while ops and ops[-1] != "(" and prec[ops[-1]] >= prec[op]:
                output.append({"type": "op", "value": ops.pop()})
            ops.append(op)
            continue
        if ttype == "op":
            op = tk.get("value")
            if not op:
                continue
            while ops and ops[-1] != "(" and (prec[ops[-1]] > prec[op] or (prec[ops[-1]] == prec[op] and assoc[op] == "left")):
                output.append({"type": "op", "value": ops.pop()})
            ops.append(op)
            continue
        if ttype == "paren":
            if tk.get("value") == "(":
                ops.append("(")
            else:
                while ops and ops[-1] != "(":
                    output.append({"type": "op", "value": ops.pop()})
                if ops:
                    ops.pop()
    while ops:
        output.append({"type": "op", "value": ops.pop()})
    return output


def evaluate_rpn(rpn: Sequence[Token], getter) -> Optional[bool]:
    stack: List[bool] = []
    for tk in rpn:
        ttype = tk.get("type")
        if ttype == "var":
            name = tk.get("value")
            value = getter(name)
            if value is None:
                return None
            stack.append(bool(value))
            continue
        if ttype == "op":
            op = tk.get("value")
            if op == "~":
                if not stack:
                    return None
                stack.append(not stack.pop())
                continue
            if len(stack) < 2:
                return None
            b = stack.pop()
            a = stack.pop()
            if op == "*":
                stack.append(a and b)
            elif op == "+":
                stack.append(a or b)
    if len(stack) != 1:
        return None
    return stack.pop()


def build_expression_truth_table(expression: str, variables: Sequence[str]) -> Optional[Dict[str, str]]:
    clean_expr = (expression or "").replace("\u0305", "").strip()
    if not clean_expr:
        return None
    tokens = tokenize_expression_input(clean_expr)
    prepared = build_implicit_and_tokens(tokens)
    rpn = to_rpn(prepared)
    table: Dict[str, str] = {}
    normalized_vars = [(v, normalize_var_name(v)) for v in variables]
    total = 2 ** len(normalized_vars)
    for i in range(total):
        assignment = {}
        for idx, (raw, norm) in enumerate(normalized_vars):
            bit = (i >> (len(normalized_vars) - idx - 1)) & 1
            assignment[raw] = bit == 1
            assignment[norm] = bit == 1
        def getter(name: Optional[str]) -> Optional[bool]:
            if name is None:
                return None
            if name in assignment:
                return assignment[name]
            norm = normalize_var_name(name)
            return assignment.get(norm)
        value = evaluate_rpn(rpn, getter)
        if value is None:
            return None
        key = "".join("1" if assignment[raw] else "0" for raw, _ in normalized_vars)
        table[key] = "1" if value else "0"
    return table


def split_expression_sections(tokens: Sequence[Token]) -> List[List[Token]]:
    sections: List[List[Token]] = []
    depth = 0
    current: List[Token] = []

    def push_current():
        nonlocal current
        if any(tk.get("type") == "var" for tk in current):
            sections.append(current)
        current = []

    for tk in tokens:
        if tk.get("type") == "op" and tk.get("value") == "+" and depth == 0:
            push_current()
            continue
        current.append(tk)
        if tk.get("type") == "paren":
            if tk.get("value") == "(":
                depth += 1
            elif tk.get("value") == ")":
                depth = max(0, depth - 1)
    push_current()
    return sections


def term_literals(section: Sequence[Token]) -> Dict[str, bool]:
    literals: Dict[str, bool] = {}
    for tk in section:
        if tk.get("type") != "var":
            continue
        var_name = tk.get("value") or ""
        key = normalize_var_name(var_name)
        negated = bool(tk.get("negated"))
        if key in literals and literals[key] != (not negated):
            # Conflicting literal (e.g., A and ~A) makes the term invalid; mark as contradictory by using None
            return {}
        literals[key] = not negated
    return literals


def is_power_of_two(value: int) -> bool:
    return value > 0 and (value & (value - 1)) == 0


def prime_implicant_coverage(
    literals_map: Mapping[str, bool],
    variables: Sequence[str],
    table: Mapping[str, str],
    target_value: str,
    forbidden_value: str,
) -> Tuple[bool, str]:
    normalized_vars = [(v, normalize_var_name(v)) for v in variables]
    fixed = {}
    for _, norm in normalized_vars:
        if norm in literals_map:
            fixed[norm] = literals_map[norm]
    unspecified = [norm for _, norm in normalized_vars if norm not in fixed]
    coverage: List[str] = []
    for i in range(2 ** len(unspecified)):
        bits = []
        idx = 0
        for raw, norm in normalized_vars:
            if norm in fixed:
                bits.append("1" if fixed[norm] else "0")
            else:
                bit = (i >> (len(unspecified) - idx - 1)) & 1
                bits.append("1" if bit else "0")
                idx += 1
        key = "".join(bits)
        cell_val = table.get(key, "0")
        if cell_val == forbidden_value:
            return False, f"Term covers cell {key} with forbidden value {forbidden_value}"
        coverage.append(key)
    if not is_power_of_two(len(coverage)):
        return False, "Group size is not a power of two"
    if not any(table.get(key) == target_value for key in coverage):
        return False, f"Term must include at least one {target_value} cell"

    # Prime check: removing any literal must hit a forbidden cell
    for norm in list(fixed.keys()):
        expanded_literals = {k: v for k, v in fixed.items() if k != norm}
        expanded_unspecified = [n for _, n in normalized_vars if n not in expanded_literals]
        for i in range(2 ** len(expanded_unspecified)):
            bits = []
            idx = 0
            for raw, n in normalized_vars:
                if n in expanded_literals:
                    bits.append("1" if expanded_literals[n] else "0")
                else:
                    bit = (i >> (len(expanded_unspecified) - idx - 1)) & 1
                    bits.append("1" if bit else "0")
                    idx += 1
            key = "".join(bits)
            val = table.get(key, "0")
            if val == forbidden_value:
                break
        else:
            return False, "Term is not prime; it can be expanded without covering invalid cells"
    return True, ""


def verify_kmap(kmap: Mapping[str, object]) -> Tuple[bool, List[str]]:
    table, variables = build_kmap_truth_table(kmap)
    tokens = kmap.get("expressionTokens") or expression_string_to_tokens(kmap.get("expression") or "")
    canonical = tokens_to_canonical(tokens)
    expr_table = build_expression_truth_table(canonical, variables)
    errors: List[str] = []
    if expr_table is None:
        errors.append("Expression is invalid or empty")
        return False, errors
    for key, val in table.items():
        if val == "X":
            continue
        expr_val = expr_table.get(key)
        if expr_val is None or (expr_val == "1") != (val == "1"):
            errors.append("Expression output does not match K-map values")
            break

    target_value = "0" if (kmap.get("type") or "sop").lower() == "pos" else "1"
    forbidden_value = "1" if target_value == "0" else "0"

    sections = split_expression_sections(tokens)
    normalized_map = {normalize_var_name(v): v for v in variables}
    for idx, section in enumerate(sections):
        literal_map = term_literals(section)
        if not literal_map:
            errors.append(f"Expression term {idx + 1} is contradictory or empty")
            continue
        # Ensure variables are recognized
        for name in literal_map.keys():
            if name not in normalized_map:
                errors.append(f"Expression term {idx + 1} references unknown variable '{name}'")
                break
        else:
            ok, reason = prime_implicant_coverage(literal_map, variables, table, target_value, forbidden_value)
            if not ok:
                errors.append(f"Expression term {idx + 1} is not a valid prime implicant: {reason}")
    return not errors, errors


# ------------------------------ Main grading ------------------------------

@dataclass
class GradeResult:
    file: Path
    passed: bool
    issues: List[str] = field(default_factory=list)


def state_is_used(fsm_state: FSMState, transitions: Sequence[Transition]) -> bool:
    participates = any(tr.from_id == fsm_state.id or tr.to_id == fsm_state.id for tr in transitions)
    return fsm_state.placed or participates


def check_transition_coverage(state_id: int, transitions: Sequence[Transition], input_count: int) -> Tuple[bool, str]:
    expected = 2 ** input_count
    if expected == 0:
        return True, ""
    combo_counts: Dict[str, int] = {}
    for tr in transitions:
        if tr.from_id != state_id:
            continue
        for combo in combinations_from_values(tr.input_values):
            combo_counts[combo] = combo_counts.get(combo, 0) + 1
    unique = len(combo_counts)
    has_duplicates = any(count > 1 for count in combo_counts.values())
    missing = [combo for combo in generate_input_combos(input_count) if combo not in combo_counts]
    if missing:
        return False, f"State {state_id} is missing input combinations: {', '.join(missing)}"
    if has_duplicates or unique > expected:
        return False, f"State {state_id} has overlapping or extra input combinations"
    return True, ""


def grade_file(path: Path, min_states: int, min_inputs: int, min_outputs: int) -> GradeResult:
    issues: List[str] = []
    try:
        data = json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001
        return GradeResult(path, False, [f"Could not read JSON: {exc}"])

    inputs = data.get("inputs", []) or []
    outputs = data.get("outputs", []) or []
    num_states = int(data.get("numStates") or len(data.get("states", []) or []))
    fsm_type = (data.get("type") or "moore").lower()

    if len(inputs) < min_inputs:
        issues.append(f"Requires at least {min_inputs} inputs; found {len(inputs)}")
    if len(outputs) < min_outputs:
        issues.append(f"Requires at least {min_outputs} outputs; found {len(outputs)}")

    states = {st.get("id"): FSMState(st, len(outputs)) for st in data.get("states", []) or [] if st.get("id") is not None}
    transitions = [Transition(tr, len(inputs), len(outputs)) for tr in data.get("transitions", []) or []]

    used_states = [s for s in states.values() if state_is_used(s, transitions)]
    if len(used_states) < min_states:
        issues.append(f"Requires at least {min_states} used states in the diagram; found {len(used_states)}")

    for st in used_states:
        ok, reason = check_transition_coverage(st.id or 0, transitions, len(inputs))
        if not ok:
            issues.append(reason)

    bit_count = state_bit_count(num_states)
    expectations = build_diagram_expectations(transitions, states, bit_count, fsm_type, len(outputs))
    table = ensure_transition_table_structure(data)
    table_ok, table_reason = verify_transition_table(
        table, expectations, bit_count, fsm_type, len(inputs), len(outputs)
    )
    if not table_ok:
        issues.append(table_reason or "Transition table verification failed")

    for kmap in data.get("kmaps", []) or []:
        ok, km_errors = verify_kmap(kmap)
        if not ok:
            prefix = kmap.get("label") or kmap.get("id") or "kmap"
            for err in km_errors:
                issues.append(f"K-map {prefix}: {err}")

    return GradeResult(path, not issues, issues)


def find_json_files(folder: Path) -> List[Path]:
    return sorted(p for p in folder.glob("*.json") if p.is_file())


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Offline FSM auto-grader")
    parser.add_argument("--path", type=Path, default=Path("."), help="Folder containing .json save files")
    parser.add_argument("--min-states", type=int, default=0, help="Minimum number of used states required")
    parser.add_argument("--min-inputs", type=int, default=0, help="Minimum number of inputs required")
    parser.add_argument("--min-outputs", type=int, default=0, help="Minimum number of outputs required")
    args = parser.parse_args(argv)

    files = find_json_files(args.path)
    if not files:
        print(f"No .json files found in {args.path}")
        return 1

    overall_pass = True
    for file_path in files:
        result = grade_file(file_path, args.min_states, args.min_inputs, args.min_outputs)
        status = "PASS" if result.passed else "FAIL"
        print(f"[{status}] {file_path.name}")
        if result.issues:
            for issue in result.issues:
                print(f"  - {issue}")
        overall_pass = overall_pass and result.passed

    return 0 if overall_pass else 1


if __name__ == "__main__":
    sys.exit(main())
