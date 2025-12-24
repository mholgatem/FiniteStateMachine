"""Finite State Machine grading script.

This script scores saved FSM JSON files for completeness. It mirrors the
validation logic implemented in ``app.js`` and uses configurable weights so you
can tune how much each check is worth. The grader iterates over all ``.json``
files in the provided directory, evaluates each one, and writes a consolidated
``grading_results.txt`` report to the same directory.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, MutableMapping, Optional, Tuple

# ---------------------------------------------------------------------------
# Grading metrics (adjust to tune rubric)
# ---------------------------------------------------------------------------
# State definition table checks
STATE_DESCRIPTION_WEIGHT = 2.0
STATE_LABEL_WEIGHT = 2.0
STATE_BINARY_WEIGHT = 2.0
INPUT_MINIMUM_WEIGHT = 2.0
OUTPUT_MINIMUM_WEIGHT = 2.0

# Diagram checks
PLACED_STATES_WEIGHT = 10.0
OUTPUT_VALUE_WEIGHT = 5.0
ARROW_COVERAGE_WEIGHT = 15.0

# Transition table checks
TABLE_STRUCTURE_WEIGHT = 10.0
TABLE_MATCH_WEIGHT = 20.0

# Karnaugh map checks (placeholders, wired into totals for future use)
KMAP_COMPLETENESS_WEIGHT = 15.0
KMAP_EXPRESSION_WEIGHT = 15.0


@dataclass
class SectionResult:
    """Container for a check's score and narrative message."""

    score: float
    weight: float
    notes: List[str] = field(default_factory=list)

    def as_line(self, label: str) -> str:
        """Return a formatted summary line for output files."""

        percent = (self.score / self.weight * 100) if self.weight else 0.0
        note_text = "; ".join(self.notes) if self.notes else "OK"
        return f"- {label}: {self.score:.2f}/{self.weight:.2f} ({percent:.1f}%) — {note_text}"


@dataclass
class GradeResult:
    """Aggregate grading result for a single save file."""

    file_path: Path
    sections: Mapping[str, SectionResult]

    @property
    def total_score(self) -> float:
        return sum(section.score for section in self.sections.values())

    @property
    def total_weight(self) -> float:
        return sum(section.weight for section in self.sections.values())

    def render(self) -> str:
        """Render a human-readable summary for the report file."""

        lines = [f"File: {self.file_path.name}"]
        lines.append(
            f"Total: {self.total_score:.2f}/{self.total_weight:.2f} ({(self.total_score / self.total_weight * 100):.1f}%)"
        )
        for label, section in self.sections.items():
            lines.append(section.as_line(label))
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Utility helpers translated from ``app.js``
# ---------------------------------------------------------------------------

def normalize_binary_value(val: Optional[str]) -> str:
    """Normalize binary characters, preserving ``X`` for don't-care."""

    if val is None:
        return ""
    normalized = str(val).upper().strip()
    for char in normalized:
        if char in {"0", "1", "X"}:
            return char
    return ""


def normalize_bit_array(values: Iterable[str], expected_length: int) -> List[str]:
    """Pad or trim a sequence of bits to a target length."""

    result = ["" for _ in range(expected_length)]
    for idx, val in enumerate(values):
        if idx < expected_length:
            result[idx] = normalize_binary_value(val)
    return result


def normalize_kmap_value(val: object) -> str:
    """Normalize K-map cell values to ``0``, ``1``, or ``X``."""

    if val is None:
        return "0"
    cleaned = str(val).strip().upper()
    if cleaned in {"1", "X"}:
        return cleaned
    return "0"


def state_bit_count(num_states: int) -> int:
    """Calculate how many bits are required to encode states."""

    return max(1, math.ceil(math.log2(max(num_states, 1))))


def generate_input_combos(count: int) -> List[str]:
    """Return all binary combinations for ``count`` inputs."""

    if count == 0:
        return [""]
    combos = []
    total = 2**count
    for i in range(total):
        combos.append(format(i, f"0{count}b"))
    return combos


def combinations_from_values(values: List[str]) -> List[str]:
    """Expand selections containing ``X`` into all concrete combos."""

    combos = [""]
    for val in values:
        normalized = normalize_binary_value(val) or "X"
        options = ["0", "1"] if normalized == "X" else [normalized]
        next_combos: List[str] = []
        for prefix in combos:
            for option in options:
                next_combos.append(f"{prefix}{option}")
        combos = next_combos
    return combos


def expand_input_combos_for_dictionary(bits: List[str]) -> List[str]:
    """Mirror ``expandInputCombosForDictionary`` from the UI."""

    combos = [""]
    for bit in bits:
        normalized = normalize_binary_value(bit)
        options = ["0", "1"] if normalized == "X" else [normalized or "-"]
        next_batch: List[str] = []
        for prefix in combos:
            for option in options:
                next_batch.append(f"{prefix}{option}")
        combos = next_batch
    return combos


def bit_to_int(val: str) -> int:
    """Translate bit characters to integers used by the UI dictionaries."""

    if val == "0":
        return 0
    if val == "1":
        return 1
    if val == "X":
        return 2
    return -1


def state_binary_code(st: Mapping[str, object], bit_count: int) -> Optional[str]:
    """Return the cleaned binary encoding for a state."""

    raw_binary = str(st.get("binary", st.get("id", "")))
    cleaned = "".join(ch for ch in raw_binary if ch in {"0", "1"})
    if not cleaned:
        return None
    return cleaned.zfill(bit_count)[-bit_count:]


def expected_outputs_for_transition(
    machine_type: str, transition: Mapping[str, object], source_state: Mapping[str, object], outputs: List[str]
) -> List[str]:
    """Choose outputs according to machine type."""

    expected_len = len(outputs)
    if machine_type == "moore":
        return normalize_bit_array(source_state.get("outputs", []), expected_len)
    output_values = transition.get("outputValues") or transition.get("outputs") or []
    return normalize_bit_array(output_values, expected_len)


def arrays_compatible(expected: List[str], actual: List[str]) -> bool:
    """Check whether two bit arrays are compatible (honoring don't-cares)."""

    if len(expected) != len(actual):
        return False
    for exp, act in zip(expected, actual):
        exp_n = normalize_binary_value(exp)
        act_n = normalize_binary_value(act)
        if not exp_n or not act_n:
            return False
        if exp_n == "X" or act_n == "X":
            continue
        if exp_n != act_n:
            return False
    return True


# ---------------------------------------------------------------------------
# Core grading logic
# ---------------------------------------------------------------------------

def load_save(path: Path) -> Mapping[str, object]:
    """Load a save file as JSON."""

    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def decompress_transition_table(table: Mapping[str, object], num_states: int, inputs: List[str]) -> MutableMapping[str, object]:
    """Rehydrate a compressed transition table from the save file."""

    if "cells" in table:
        expanded = dict(table)
    else:
        headers = table.get("headers", [])
        data = table.get("data", [])
        combos = generate_input_combos(len(inputs))
        rows = [{"key": f"{state_idx}|{combo or 'none'}"} for state_idx in range(num_states) for combo in combos]
        inverse_map = {0: "0", 1: "1", 2: "X", -1: ""}
        cells: Dict[str, str] = {}
        for row_idx, row in enumerate(rows):
            row_values = data[row_idx] if row_idx < len(data) else []
            for col_idx, col_key in enumerate(headers):
                mapped = inverse_map.get(row_values[col_idx], "") if col_idx < len(row_values) else ""
                cells[f"{row['key']}::{col_key}"] = mapped
        expanded = {**table, "cells": cells, "rows": rows}

    if "rows" not in expanded:
        row_keys = {key.split("::", maxsplit=1)[0] for key in expanded.get("cells", {}).keys()}
        expanded["rows"] = [{"key": row_key} for row_key in sorted(row_keys)]
    if "valueColumns" not in expanded:
        col_keys = {key.split("::", maxsplit=1)[1] for key in expanded.get("cells", {}).keys()}
        expanded["valueColumns"] = [
            {"key": col_key, "baseKey": col_key.split("__", maxsplit=1)[0], "type": "value"}
            for col_key in sorted(col_keys)
        ]
    return expanded


def gray_code(bits: int) -> List[str]:
    """Generate Gray code strings of length ``bits``."""

    if bits <= 0:
        return [""]
    codes = ["0", "1"]
    for _ in range(1, bits):
        reflected = list(reversed(codes))
        codes = [f"0{code}" for code in codes] + [f"1{code}" for code in reflected]
    return codes


def build_kmap_layout(kmap: Mapping[str, object]) -> Mapping[str, object]:
    """Mirror the K-map layout construction from the client UI."""

    variables = kmap.get("variables") or []
    map_var_count = max(0, len(variables) - 4)
    map_vars = variables[:map_var_count]
    core_vars = variables[map_var_count:]

    more_sig_count = math.ceil(len(core_vars) / 2)
    more_sig = list(core_vars[:more_sig_count])
    less_sig = list(core_vars[more_sig_count:])
    if len(less_sig) == 0 and len(more_sig) > 1:
        less_sig = [more_sig.pop()]

    if (kmap.get("direction") or "horizontal") == "vertical":
        row_vars = more_sig
        col_vars = less_sig
    else:
        row_vars = less_sig
        col_vars = more_sig

    if len(row_vars) == 0 and len(col_vars):
        row_vars = [col_vars.pop(0)]

    row_codes = gray_code(len(row_vars))
    col_codes = gray_code(len(col_vars))
    base_rows = len(row_codes) or 1
    base_cols = len(col_codes) or 1

    map_rows = 1
    map_cols = 1
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
    for map_row in range(map_rows):
        for map_col in range(map_cols):
            map_code = f"{map_row_codes[map_row] if map_row < len(map_row_codes) else ''}{map_col_codes[map_col] if map_col < len(map_col_codes) else ''}"
            submaps.append(
                {
                    "mapRow": map_row,
                    "mapCol": map_col,
                    "mapCode": map_code,
                    "rowOffset": map_row * base_rows,
                    "colOffset": map_col * base_cols,
                }
            )

    return {
        "mapVarCount": map_var_count,
        "mapVars": map_vars,
        "rowVars": row_vars,
        "colVars": col_vars,
        "rowCodes": row_codes,
        "colCodes": col_codes,
        "baseRows": base_rows,
        "baseCols": base_cols,
        "mapRows": map_rows,
        "mapCols": map_cols,
        "totalRows": base_rows * map_rows,
        "totalCols": base_cols * map_cols,
        "submaps": submaps,
    }


def kmap_variables_for_layout(layout: Mapping[str, object]) -> List[str]:
    """Return the ordered variable list for a K-map layout."""

    return [
        *(layout.get("mapVars") or []),
        *(layout.get("colVars") or []),
        *(layout.get("rowVars") or []),
    ]


def compute_kmap_cell_key(layout: Mapping[str, object], row: int, col: int) -> Tuple[str, Mapping[str, object]]:
    """Compute the assignment key for a K-map cell."""

    base_rows = layout.get("baseRows", 1)
    base_cols = layout.get("baseCols", 1)
    sub = next(
        (
            s
            for s in layout.get("submaps", [])
            if row >= s.get("rowOffset", 0)
            and row < s.get("rowOffset", 0) + base_rows
            and col >= s.get("colOffset", 0)
            and col < s.get("colOffset", 0) + base_cols
        ),
        None,
    )

    map_bits = (sub.get("mapCode", "") if sub else "").ljust(len(layout.get("mapVars") or []), "0")
    col_code = (layout.get("colCodes") or [""])[col - (sub.get("colOffset", 0) if sub else 0)] if layout.get("colCodes") else ""
    row_code = (layout.get("rowCodes") or [""])[row - (sub.get("rowOffset", 0) if sub else 0)] if layout.get("rowCodes") else ""
    bits = f"{map_bits}{col_code}{row_code}"
    variables = kmap_variables_for_layout(layout)

    assignment = {name: bits[idx] == "1" for idx, name in enumerate(variables)}
    key = "".join("1" if assignment[name] else "0" for name in variables)
    return key, sub or {}


def build_kmap_truth_table(kmap: Mapping[str, object]) -> Tuple[Dict[str, str], List[str]]:
    """Return a mapping of assignment keys to cell values plus the ordered variables."""

    layout = build_kmap_layout(kmap)
    variables = kmap_variables_for_layout(layout)
    table: Dict[str, str] = {}
    cells = kmap.get("cells") or {}

    for row in range(layout.get("totalRows", 0)):
        for col in range(layout.get("totalCols", 0)):
            key, _ = compute_kmap_cell_key(layout, row, col)
            cell_val = normalize_kmap_value(cells.get(f"{row}-{col}"))
            table[key] = cell_val

    return table, variables


def categorize_columns(
    value_columns: Iterable[Mapping[str, object]],
) -> Tuple[List[Mapping[str, object]], List[Mapping[str, object]], List[Mapping[str, object]], List[Mapping[str, object]]]:
    """Split transition table columns into the four column groups."""

    current_state_cols: List[Mapping[str, object]] = []
    input_cols: List[Mapping[str, object]] = []
    next_state_cols: List[Mapping[str, object]] = []
    output_cols: List[Mapping[str, object]] = []
    for col in value_columns:
        base_key = col.get("baseKey") or str(col.get("key", "")).split("__", maxsplit=1)[0]
        if not base_key or col.get("type") == "spacer":
            continue
        if base_key.startswith("q_"):
            current_state_cols.append({**col, "baseKey": base_key})
        elif base_key.startswith("next_q_"):
            next_state_cols.append({**col, "baseKey": base_key})
        elif base_key.startswith("in_"):
            input_cols.append({**col, "baseKey": base_key})
        elif base_key.startswith("out_"):
            output_cols.append({**col, "baseKey": base_key})
    current_state_cols.sort(key=lambda c: c["baseKey"], reverse=True)
    next_state_cols.sort(key=lambda c: c["baseKey"], reverse=True)
    input_cols.sort(key=lambda c: c["baseKey"])
    output_cols.sort(key=lambda c: c["baseKey"])
    return current_state_cols, input_cols, next_state_cols, output_cols


def read_table_row_values(
    row_key: str, table: Mapping[str, object], current_cols, input_cols, next_cols, output_cols
) -> Dict[str, List[str]]:
    """Extract transition table bits for a single row."""

    cells: Mapping[str, object] = table.get("cells", {})

    def read(col_key: str) -> str:
        return normalize_binary_value(cells.get(f"{row_key}::{col_key}", ""))

    return {
        "current": [read(col["key"]) for col in current_cols],
        "inputs": [read(col["key"]) for col in input_cols],
        "next": [read(col["key"]) for col in next_cols],
        "outputs": [read(col["key"]) for col in output_cols],
    }


def build_transition_diagram_dictionary(machine: Mapping[str, object], bit_count: int) -> Dict[str, List[int]]:
    """Recreate ``buildTransitionDiagramDictionary`` from the UI."""

    inputs = machine.get("inputs", [])
    outputs = machine.get("outputs", [])
    machine_type = machine.get("type", "moore")
    transitions = machine.get("transitions", [])
    states = machine.get("states", [])

    dictionary: Dict[str, List[int]] = {}
    default_value = [2] * (bit_count + len(outputs))

    for tr in transitions:
        source_state = next((s for s in states if s.get("id") == tr.get("from")), {})
        source_bits = state_binary_code(source_state, bit_count)
        target_state = next((s for s in states if s.get("id") == tr.get("to")), {})
        next_bits = state_binary_code(target_state, bit_count) or ""
        next_state_bits = normalize_bit_array(list(next_bits), bit_count)
        outputs_bits = expected_outputs_for_transition(machine_type, tr, source_state, outputs)
        combos = combinations_from_values(
            normalize_bit_array(tr.get("inputValues") or tr.get("inputs") or [], len(inputs))
        )
        value = [bit_to_int(bit) for bit in [*next_state_bits, *outputs_bits]]
        for combo in combos:
            dictionary[f"{source_bits}|{combo or 'none'}"] = value

    unused_states = [s for s in states if not state_is_used(s, transitions)]
    for st in unused_states:
        bits = state_binary_code(st, bit_count)
        for combo in generate_input_combos(len(inputs)):
            dictionary[f"{bits}|{combo or 'none'}"] = default_value.copy()

    return dictionary


def state_is_used(st: Mapping[str, object], transitions: Iterable[Mapping[str, object]]) -> bool:
    """Return True if a state appears in the diagram."""

    if st.get("placed"):
        return True
    state_id = st.get("id")
    return any(tr.get("from") == state_id or tr.get("to") == state_id for tr in transitions)


def normalize_var_name(name: str) -> str:
    """Normalize variable names for comparison (alphanumeric upper-case)."""

    return re.sub(r"\W+", "", str(name)).upper()


def var_numeric_suffix(name: str) -> int:
    """Extract a numeric suffix from a variable name, defaulting to 0."""

    match = re.search(r"(\d+)$", str(name))
    return int(match.group(1)) if match else 0


def build_transition_table_dictionary(table: Mapping[str, object], current_cols, input_cols, next_cols, output_cols) -> Dict[str, List[int]]:
    """Mirror ``buildTransitionTableDictionary`` for offline grading."""

    dictionary: Dict[str, List[int]] = {}
    rows = table.get("rows", [])
    for row in rows:
        row_key = row.get("key")
        if row_key is None:
            continue
        actual = read_table_row_values(row_key, table, current_cols, input_cols, next_cols, output_cols)
        state_bits = "".join((bit or "-") for bit in actual["current"])
        input_combos = expand_input_combos_for_dictionary(actual["inputs"])
        value = [bit_to_int(bit) for bit in [*actual["next"], *actual["outputs"]]]
        for combo in input_combos:
            dictionary[f"{state_bits}|{combo or 'none'}"] = value
    return dictionary


def compute_dictionary_match(diagram_dict: Mapping[str, List[int]], table_dict: Mapping[str, List[int]]) -> int:
    """Compute the percentage of matching dictionary entries."""

    all_keys = set(diagram_dict.keys()) | set(table_dict.keys())
    matches = 0
    for key in all_keys:
        expected = diagram_dict.get(key)
        actual = table_dict.get(key)
        if not expected or not actual:
            continue
        if expected == actual:
            matches += 1
    total = len(all_keys) or 1
    return round(matches / total * 100)


def table_value_to_bit(val: int) -> str:
    """Convert dictionary integer values back to bit characters."""

    if val == 1:
        return "1"
    if val == 2:
        return "X"
    return "0"


def bits_match(pattern: str, bits: str) -> bool:
    """Determine if a wildcard pattern (``-``) matches a bit string."""

    if len(pattern) != len(bits):
        return False
    for pat, bit in zip(pattern, bits):
        if pat in {"-", ""}:
            continue
        if pat != bit:
            return False
    return True


def lookup_transition_values(table_dict: Mapping[str, List[int]], state_bits: str, input_bits: str) -> Optional[List[int]]:
    """Find the transition row matching a state/input assignment, honoring don't-cares."""

    for key, value in table_dict.items():
        if "|" not in key:
            continue
        state_part, combo_part = key.split("|", maxsplit=1)
        combo = "" if combo_part == "none" else combo_part
        if bits_match(state_part, state_bits) and bits_match(combo, input_bits):
            return value
    return None


def assignment_from_key(key: str, variables: List[str]) -> Dict[str, int]:
    """Convert an assignment key string into a variable -> bit mapping."""

    return {var: int(bit) for var, bit in zip(variables, key)}


def resolve_kmap_target_from_label(
    label: str, next_cols: List[Mapping[str, object]], output_cols: List[Mapping[str, object]]
) -> Optional[Tuple[str, Optional[int]]]:
    """Infer whether a K-map targets a next-state bit or an output column via its label."""

    cleaned = re.sub(r"\s+", "", str(label)).upper()
    cleaned = cleaned.replace("^+", "").replace("+", "")
    match = re.search(r"(\d+)$", cleaned)
    if not match:
        return None
    idx = int(match.group(1))
    prefix = cleaned[: match.start(1)].rstrip("_")
    if prefix in {"Q", "NEXTQ", "Q"}:
        target_cols = next_cols
        kind = "next"
    elif prefix in {"OUT", "OUTPUT", "Y", "Z"}:
        target_cols = output_cols
        kind = "output"
    else:
        return None

    for col_idx, col in enumerate(target_cols):
        base_key = str(col.get("baseKey") or col.get("key") or "").lower()
        if base_key.endswith(f"_{idx}"):
            return kind, col_idx
    return kind, None


def resolve_kmap_target_from_token(
    token: Mapping[str, object], next_cols: List[Mapping[str, object]], output_cols: List[Mapping[str, object]]
) -> Optional[Tuple[str, Optional[int]]]:
    """Resolve the target column for a K-map using its function token."""

    if not token:
        return None

    base_key = str(token.get("baseKey") or token.get("key") or "")
    base_key = base_key.split("__", maxsplit=1)[0].lower()

    def find_index(columns: List[Mapping[str, object]]) -> Optional[int]:
        for idx, col in enumerate(columns):
            col_base = str(col.get("baseKey") or col.get("key") or "").split("__", maxsplit=1)[0].lower()
            if col_base == base_key:
                return idx
        return None

    if base_key.startswith("next_q_"):
        return "next", find_index(next_cols)
    if base_key.startswith("out_"):
        return "output", find_index(output_cols)
    return None


def state_and_input_bits(assignment: Mapping[str, int], state_vars: List[str], input_vars: List[str]) -> Tuple[str, str]:
    """Return state and input bit strings using a consistent ordering."""

    ordered_states = sorted(state_vars, key=lambda n: var_numeric_suffix(n), reverse=True)
    ordered_inputs = sorted(input_vars, key=lambda n: var_numeric_suffix(n), reverse=True)
    state_bits = "".join(str(assignment.get(var, 0)) for var in ordered_states)
    input_bits = "".join(str(assignment.get(var, 0)) for var in ordered_inputs)
    return state_bits, input_bits


def eval_sop(expr: str, assignment: Mapping[str, int]) -> int:
    """Evaluate a simple SOP expression using ``~`` for NOT and ``+`` for OR."""

    expr = expr.strip()
    if not expr:
        return 0

    terms = [t.strip() for t in expr.split("+")]
    for term in terms:
        if not term:
            continue
        lits = [tok for tok in term.split() if tok]
        term_val = 1
        for lit in lits:
            neg = lit.startswith("~")
            var_name = lit[1:] if neg else lit
            bit = assignment.get(var_name, 0)
            term_val &= (0 if bit else 1) if neg else bit
            if term_val == 0:
                break
        if term_val == 1:
            return 1
    return 0


def popcount(x: int) -> int:
    """Count set bits in an integer."""

    return x.bit_count()


def covers(implicant: Tuple[int, int], minterm: int) -> bool:
    """Return True if an implicant covers the provided minterm."""

    bits, mask = implicant
    return (minterm & ~mask) == (bits & ~mask)


def combine_implicants(first: Tuple[int, int], second: Tuple[int, int]) -> Optional[Tuple[int, int]]:
    """Combine two implicants if they differ by one unmasked bit."""

    bits1, mask1 = first
    bits2, mask2 = second
    if mask1 != mask2:
        return None
    diff = bits1 ^ bits2
    if diff == 0 or diff & mask1 or popcount(diff) != 1:
        return None
    return bits1 & ~diff, mask1 | diff


def qm_prime_implicants(minterms: List[int], dont_cares: List[int], nvars: int) -> List[Tuple[int, int]]:
    """Compute prime implicants via the Quine–McCluskey method."""

    current = [(m, 0) for m in sorted(set(minterms + dont_cares))]
    primes: set[Tuple[int, int]] = set()

    while True:
        groups: Dict[int, List[Tuple[int, int]]] = {}
        for imp in current:
            bits, mask = imp
            key = popcount(bits & ~mask)
            groups.setdefault(key, []).append(imp)

        used: set[Tuple[int, int]] = set()
        next_set: set[Tuple[int, int]] = set()

        for key in sorted(groups.keys()):
            for i in groups.get(key, []):
                for j in groups.get(key + 1, []):
                    combined = combine_implicants(i, j)
                    if combined is not None:
                        used.add(i)
                        used.add(j)
                        next_set.add(combined)

        for imp in current:
            if imp not in used:
                primes.add(imp)

        if not next_set:
            break
        current = sorted(next_set)

    return sorted(primes)


def implicant_cost(implicant: Tuple[int, int], nvars: int) -> int:
    """Return literal count for an implicant."""

    _, mask = implicant
    return nvars - popcount(mask)


def parse_expression_cost(expr: str) -> Tuple[int, int]:
    """Return (terms, literal_count) for a SOP expression."""

    terms = [t.strip() for t in expr.split("+") if t.strip()]
    literal_total = 0
    for term in terms:
        literal_total += len([tok for tok in term.split() if tok])
    return len(terms), literal_total


def assignment_to_int(assignment: Mapping[str, int], variables: List[str]) -> int:
    """Convert a variable assignment to an integer minterm index."""

    value = 0
    for var in variables:
        value = (value << 1) | (assignment.get(var, 0) & 1)
    return value


def compute_minimized_cost(required_ones: List[int], dont_cares: List[int], variables: List[str]) -> Tuple[int, int]:
    """Return the minimal (literal_count, term_count) cover cost."""

    nvars = len(variables)
    primes = qm_prime_implicants(required_ones, dont_cares, nvars)
    coverage = [set(m for m in required_ones if covers(pi, m)) for pi in primes]
    remaining = set(required_ones)
    chosen: set[int] = set()

    while True:
        counts: Dict[int, List[int]] = {m: [] for m in remaining}
        for idx, covered in enumerate(coverage):
            for m in remaining:
                if m in covered:
                    counts[m].append(idx)
        essentials = [vals[0] for vals in counts.values() if len(vals) == 1]
        essentials = list(dict.fromkeys(essentials))
        if not essentials:
            break
        for idx in essentials:
            chosen.add(idx)
            remaining -= coverage[idx]
        if not remaining:
            break

    if not remaining:
        selected = chosen
    else:
        candidates = [i for i in range(len(primes)) if i not in chosen and coverage[i]]
        candidates.sort(key=lambda i: len(coverage[i] & remaining), reverse=True)

        best_subset: Optional[set[int]] = None
        best_cost: Optional[Tuple[int, int]] = None

        def cost_for_subset(indices: set[int]) -> Tuple[int, int]:
            literals = sum(implicant_cost(primes[i], nvars) for i in indices)
            return literals, len(indices)

        def backtrack(idx: int, covered: set[int], picked: set[int]):
            nonlocal best_subset, best_cost

            if best_cost is not None and cost_for_subset(picked) > best_cost:
                return
            if covered >= remaining:
                full = picked | chosen
                cost = cost_for_subset(full)
                if best_cost is None or cost < best_cost:
                    best_cost = cost
                    best_subset = set(full)
                return
            if idx >= len(candidates):
                return

            optimistic = set(covered)
            for j in range(idx, len(candidates)):
                optimistic |= coverage[candidates[j]]
            if not optimistic >= remaining:
                return

            current_idx = candidates[idx]
            backtrack(idx + 1, covered | coverage[current_idx], picked | {current_idx})
            backtrack(idx + 1, covered, picked)

        backtrack(0, set(), set())
        selected = best_subset or chosen

    literal_cost = sum(implicant_cost(primes[i], len(variables)) for i in selected)
    return literal_cost, len(selected)


def grade_kmaps(
    machine: Mapping[str, object],
    table_dict: Mapping[str, List[int]],
    next_cols: List[Mapping[str, object]],
    output_cols: List[Mapping[str, object]],
) -> Tuple[float, float, List[str]]:
    """Grade K-map completeness and expressions against the transition table."""

    kmaps = machine.get("kmaps") or []
    if not kmaps:
        return 0.0, 0.0, ["No K-maps provided"]

    completeness_checked = 0
    completeness_matches = 0
    expression_weighted_score = 0.0
    expression_weight_total = 0
    notes: List[str] = []
    targeted_next: set[int] = set()
    targeted_outputs: set[int] = set()

    for kmap in kmaps:
        label = kmap.get("label") or "(unnamed)"
        function_token = kmap.get("functionToken") or {}
        target = resolve_kmap_target_from_token(function_token, next_cols, output_cols)
        if target is None:
            target = resolve_kmap_target_from_label(label, next_cols, output_cols)
        if target is None:
            notes.append(f"K-map {label}: unable to determine target column")
            continue
        target_kind, target_idx = target
        if target_idx is None:
            base_key = (function_token.get("baseKey") or function_token.get("key") or label or "").strip()
            notes.append(f"K-map {label}: target column {base_key or target_kind} not found in transition table")
            continue
        if target_kind == "next":
            targeted_next.add(target_idx)
        else:
            targeted_outputs.add(target_idx)
        variables_table, variables = build_kmap_truth_table(kmap)
        state_vars = [v for v in variables if normalize_var_name(v).startswith("Q")]
        input_vars = [v for v in variables if not normalize_var_name(v).startswith("Q")]

        for key, cell_val in variables_table.items():
            assignment = assignment_from_key(key, variables)
            state_bits, input_bits = state_and_input_bits(assignment, state_vars, input_vars)
            expected_values = lookup_transition_values(table_dict, state_bits, input_bits)
            if expected_values is None:
                continue
            if target_kind == "next":
                if target_idx >= len(next_cols):
                    notes.append(f"K-map {label}: missing next-state column for bit {target_idx}")
                    continue
                expected_bit = table_value_to_bit(expected_values[target_idx])
            else:
                offset = len(next_cols) + target_idx
                if offset >= len(expected_values):
                    notes.append(f"K-map {label}: missing output column for index {target_idx}")
                    continue
                expected_bit = table_value_to_bit(expected_values[offset])

            completeness_checked += 1
            if expected_bit == normalize_kmap_value(cell_val):
                completeness_matches += 1

        # Expression correctness and minimization
        expr = str(kmap.get("expression", "")).strip()
        non_x = sum(1 for v in variables_table.values() if v != "X") or 1
        mismatches = 0
        for key, val in variables_table.items():
            if val == "X":
                continue
            assignment = assignment_from_key(key, variables)
            evaluated = str(eval_sop(expr, assignment))
            if evaluated != normalize_kmap_value(val):
                mismatches += 1
        correctness_ratio = max(0.0, 1 - mismatches / non_x)
        if correctness_ratio < 1:
            notes.append(f"K-map {label}: expression mismatches on {mismatches}/{non_x} cells")

        required_ones = []
        dont_cares = []
        for key, val in variables_table.items():
            assignment = assignment_from_key(key, variables)
            minterm = assignment_to_int(assignment, variables)
            if val == "1":
                required_ones.append(minterm)
            elif val == "X":
                dont_cares.append(minterm)

        min_literals, min_terms = compute_minimized_cost(required_ones, dont_cares, variables)
        expr_terms, expr_literals = parse_expression_cost(expr)
        minimized = (expr_literals, expr_terms) == (min_literals, min_terms)
        if not minimized:
            notes.append(
                f"K-map {label}: expression not minimal (given {expr_literals} lits/{expr_terms} terms, min {min_literals} lits/{min_terms} terms)"
            )
        expr_score = correctness_ratio * (0.5 if not minimized else 1.0)
        expression_weighted_score += expr_score * non_x
        expression_weight_total += non_x

    for idx in range(len(next_cols)):
        if idx not in targeted_next:
            notes.append(f"Missing K-map for next-state bit column {next_cols[idx].get('baseKey', idx)}")
            completeness_checked += 1
    for idx in range(len(output_cols)):
        if idx not in targeted_outputs:
            notes.append(f"Missing K-map for output column {output_cols[idx].get('baseKey', idx)}")
            completeness_checked += 1

    completeness_ratio = completeness_matches / (completeness_checked or 1)
    expression_ratio = expression_weighted_score / (expression_weight_total or 1)
    completeness_score = KMAP_COMPLETENESS_WEIGHT * completeness_ratio
    expression_score = KMAP_EXPRESSION_WEIGHT * expression_ratio
    return completeness_score, expression_score, notes


# ---------------------------------------------------------------------------
# Individual check implementations
# ---------------------------------------------------------------------------

def check_state_definitions(machine: Mapping[str, object], min_inputs: int, min_outputs: int) -> SectionResult:
    """Grade the state definition table completeness."""

    inputs = machine.get("inputs", [])
    outputs = machine.get("outputs", [])
    transitions = machine.get("transitions", [])
    states = machine.get("states", [])

    used_states = [s for s in states if state_is_used(s, transitions)] or states
    note_parts: List[str] = []
    total_weight = (
        STATE_DESCRIPTION_WEIGHT + STATE_LABEL_WEIGHT + STATE_BINARY_WEIGHT + INPUT_MINIMUM_WEIGHT + OUTPUT_MINIMUM_WEIGHT
    )
    score = 0.0

    state_count = len(used_states) or 1
    desc_complete = sum(1 for s in used_states if str(s.get("description", "")).strip()) / state_count
    label_complete = sum(1 for s in used_states if str(s.get("label", "")).strip()) / state_count
    binaries = [state_binary_code(s, state_bit_count(machine.get("numStates", len(states)))) for s in used_states]
    unique_binaries = len(set(b for b in binaries if b)) == len(binaries)
    binary_complete = sum(1 for b in binaries if b) / state_count

    score += STATE_DESCRIPTION_WEIGHT * desc_complete
    score += STATE_LABEL_WEIGHT * label_complete
    score += STATE_BINARY_WEIGHT * (binary_complete if unique_binaries else binary_complete * 0.5)

    if desc_complete < 1:
        note_parts.append("Missing descriptions")
    if label_complete < 1:
        note_parts.append("Missing labels")
    if not unique_binaries:
        note_parts.append("Duplicate state encodings")

    input_ratio = len(inputs) / max(min_inputs, 1)
    output_ratio = len(outputs) / max(min_outputs, 1)
    score += INPUT_MINIMUM_WEIGHT * min(1.0, input_ratio)
    score += OUTPUT_MINIMUM_WEIGHT * min(1.0, output_ratio)

    if len(inputs) < min_inputs:
        note_parts.append(f"Only {len(inputs)} input(s); minimum is {min_inputs}")
    if len(outputs) < min_outputs:
        note_parts.append(f"Only {len(outputs)} output(s); minimum is {min_outputs}")

    return SectionResult(score=score, weight=total_weight, notes=note_parts)


def check_transition_diagram(machine: Mapping[str, object], min_states: int, min_inputs: int, min_outputs: int) -> SectionResult:
    """Grade the diagram for placement, outputs, and arrow coverage."""

    inputs = machine.get("inputs", [])
    outputs = machine.get("outputs", [])
    states = machine.get("states", [])
    transitions = machine.get("transitions", [])
    machine_type = machine.get("type", "moore")

    placed_states = [s for s in states if s.get("placed")]
    placed_count = len(placed_states)
    expected_inputs = max(len(inputs), min_inputs)
    expected_states = max(placed_count, min_states)
    expected_combos_per_state = 2**expected_inputs
    note_parts: List[str] = []

    placed_ratio = placed_count / expected_states if expected_states else 1.0
    placed_score = PLACED_STATES_WEIGHT * min(1.0, placed_ratio)
    if placed_ratio < 1:
        note_parts.append(f"Only {placed_count} placed states (min {min_states})")

    outputs_defined_ratio = 1.0
    if outputs:
        if machine_type == "moore":
            filled = sum(
                1
                for st in placed_states
                if len([val for val in st.get("outputs", []) if normalize_binary_value(val)]) == len(outputs)
            )
            outputs_defined_ratio = filled / (placed_count or 1)
        else:
            filled = sum(
                1
                for tr in transitions
                if len([val for val in (tr.get("outputValues") or []) if normalize_binary_value(val)]) == len(outputs)
            )
            outputs_defined_ratio = filled / (len(transitions) or 1)
        if outputs_defined_ratio < 1:
            note_parts.append("Some outputs are undefined")
    output_score = OUTPUT_VALUE_WEIGHT * outputs_defined_ratio

    issues = 0
    missing_states = max(min_states - placed_count, 0)
    issues += missing_states * expected_combos_per_state

    for st in placed_states:
        combos_for_state: Dict[str, int] = {}
        for tr in transitions:
            if tr.get("from") != st.get("id"):
                continue
            combo_values = normalize_bit_array(tr.get("inputValues") or [], expected_inputs)
            combos = combinations_from_values(combo_values)
            for combo in combos:
                combos_for_state[combo] = combos_for_state.get(combo, 0) + 1
        unique = len(combos_for_state)
        duplicates = sum(count - 1 for count in combos_for_state.values() if count > 1)
        missing = max(expected_combos_per_state - unique, 0)
        issues += missing + duplicates

    expected_total = max(expected_states, placed_count) * expected_combos_per_state or 1
    coverage_ratio = max(0.0, 1 - issues / expected_total)
    coverage_score = ARROW_COVERAGE_WEIGHT * coverage_ratio
    if coverage_ratio < 1:
        note_parts.append(f"Arrow coverage issues: {issues} gap(s)/duplicate(s) out of {expected_total} expected")

    total_weight = PLACED_STATES_WEIGHT + OUTPUT_VALUE_WEIGHT + ARROW_COVERAGE_WEIGHT
    total_score = placed_score + output_score + coverage_score
    return SectionResult(score=total_score, weight=total_weight, notes=note_parts)


def check_transition_table(machine: Mapping[str, object], min_states: int, min_inputs: int, min_outputs: int) -> SectionResult:
    """Grade the transition table against the diagram."""

    transitions = machine.get("transitions", [])
    states = machine.get("states", [])
    inputs = machine.get("inputs", [])
    outputs = machine.get("outputs", [])
    table = machine.get("transitionTable") or {"cells": {}, "rows": [], "valueColumns": []}

    num_states = max(machine.get("numStates", len(states)), len(states))
    bit_count = state_bit_count(num_states)

    expanded_table = decompress_transition_table(table, num_states, inputs)
    current_cols, input_cols, next_cols, output_cols = categorize_columns(expanded_table.get("valueColumns", []))

    expected_bit_cols = state_bit_count(max(num_states, min_states))
    expected_current = expected_bit_cols
    expected_next = expected_bit_cols
    expected_inputs = max(len(inputs), min_inputs)
    expected_outputs = max(len(outputs), min_outputs)
    expected_total_cols = expected_current + expected_next + expected_inputs + expected_outputs or 1

    present_total_cols = sum(
        [
            min(len(current_cols), expected_current),
            min(len(next_cols), expected_next),
            min(len(input_cols), expected_inputs),
            min(len(output_cols), expected_outputs),
        ]
    )
    structure_ratio = present_total_cols / expected_total_cols
    structure_score = TABLE_STRUCTURE_WEIGHT * structure_ratio
    notes: List[str] = []
    if structure_ratio < 1:
        notes.append(
            f"Transition table missing columns (have {present_total_cols}/{expected_total_cols} across state/input/output groups)"
        )

    diagram_dict = build_transition_diagram_dictionary(machine, bit_count)
    table_dict = build_transition_table_dictionary(expanded_table, current_cols, input_cols, next_cols, output_cols)
    match_percent = compute_dictionary_match(diagram_dict, table_dict)
    match_score = TABLE_MATCH_WEIGHT * (match_percent / 100)
    if match_percent < 100:
        notes.append(f"Table/diagram mismatch: {match_percent}% match")

    total_weight = TABLE_STRUCTURE_WEIGHT + TABLE_MATCH_WEIGHT
    total_score = structure_score + match_score

    return SectionResult(score=total_score, weight=total_weight, notes=notes)


def check_kmaps(machine: Mapping[str, object], min_states: int, min_inputs: int, min_outputs: int) -> SectionResult:
    """Grade Karnaugh maps separately from the transition table checks."""

    states = machine.get("states", [])
    inputs = machine.get("inputs", [])
    table = machine.get("transitionTable") or {"cells": {}, "rows": [], "valueColumns": []}

    num_states = max(machine.get("numStates", len(states)), len(states))

    expanded_table = decompress_transition_table(table, num_states, inputs)
    current_cols, input_cols, next_cols, output_cols = categorize_columns(expanded_table.get("valueColumns", []))

    table_dict = build_transition_table_dictionary(expanded_table, current_cols, input_cols, next_cols, output_cols)

    completeness_score, expression_score, notes = grade_kmaps(machine, table_dict, next_cols, output_cols)
    total_weight = KMAP_COMPLETENESS_WEIGHT + KMAP_EXPRESSION_WEIGHT
    total_score = completeness_score + expression_score

    return SectionResult(score=total_score, weight=total_weight, notes=notes)


def grade_file(
    path: Path, min_states: int, min_inputs: int, min_outputs: int, verbose: bool = False
) -> GradeResult:
    """Grade a single save file and optionally emit verbose deductions."""

    machine = load_save(path)
    sections = {
        "State definitions": check_state_definitions(machine, min_inputs, min_outputs),
        "Transition diagram": check_transition_diagram(machine, min_states, min_inputs, min_outputs),
        "Transition table vs diagram": check_transition_table(machine, min_states, min_inputs, min_outputs),
        "K-map grading": check_kmaps(machine, min_states, min_inputs, min_outputs),
    }
    result = GradeResult(file_path=path, sections=sections)

    if verbose:
        for label, section in result.sections.items():
            if section.score >= section.weight:
                continue
            header = f"[{result.file_path.name}] {label}: {section.score:.2f}/{section.weight:.2f}"
            if section.notes:
                for note in section.notes:
                    print(f"{header} — {note}")
            else:
                print(f"{header} — Points deducted (no details recorded)")

    return result


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the grader."""

    parser = argparse.ArgumentParser(description="Grade FSM save files for completeness.")
    parser.add_argument("--path", required=True, help="Directory containing .json save files.")
    parser.add_argument("--min-states", type=int, default=2, help="Minimum number of states required.")
    parser.add_argument("--min-inputs", type=int, default=0, help="Minimum number of inputs required.")
    parser.add_argument("--min-outputs", type=int, default=0, help="Minimum number of outputs required.")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print detailed deductions when points are lost.",
    )
    return parser.parse_args()


def main() -> None:
    """Entry point: grade all saves in the target directory and emit a report."""

    args = parse_args()
    target_dir = Path(args.path).expanduser().resolve()
    if not target_dir.is_dir():
        raise SystemExit(f"Path {target_dir} is not a directory")

    save_files = sorted(target_dir.glob("*.json"))
    if not save_files:
        report = "No .json save files found to grade."
        output_path = target_dir / "grading_results.txt"
        output_path.write_text(report, encoding="utf-8")
        print(report)
        return

    results: List[GradeResult] = []
    for save_file in save_files:
        try:
            results.append(
                grade_file(
                    save_file,
                    args.min_states,
                    args.min_inputs,
                    args.min_outputs,
                    verbose=args.verbose,
                )
            )
        except Exception as exc:  # noqa: BLE001 - keep grading other files
            placeholder = GradeResult(
                file_path=save_file,
                sections={
                    "State definitions": SectionResult(
                        0,
                        STATE_DESCRIPTION_WEIGHT + STATE_LABEL_WEIGHT + STATE_BINARY_WEIGHT + INPUT_MINIMUM_WEIGHT + OUTPUT_MINIMUM_WEIGHT,
                        [f"Failed to grade: {exc}"],
                    ),
                    "Transition diagram": SectionResult(
                        0,
                        PLACED_STATES_WEIGHT + OUTPUT_VALUE_WEIGHT + ARROW_COVERAGE_WEIGHT,
                        ["Skipped due to earlier failure"],
                    ),
                    "Transition table vs diagram": SectionResult(
                        0,
                        TABLE_STRUCTURE_WEIGHT + TABLE_MATCH_WEIGHT + KMAP_COMPLETENESS_WEIGHT + KMAP_EXPRESSION_WEIGHT,
                        ["Skipped due to earlier failure"],
                    ),
                },
            )
            results.append(placeholder)

    report_lines: List[str] = []
    for result in results:
        report_lines.append(result.render())
        report_lines.append("")
    report = "\n".join(report_lines).strip() + "\n"
    output_path = target_dir / "grading_results.txt"
    output_path.write_text(report, encoding="utf-8")
    print(f"Grading complete. Results written to {output_path}")


if __name__ == "__main__":
    main()
