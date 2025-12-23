"""Finite State Machine grading script.

This script scores saved FSM JSON files for completeness. It mirrors the
validation logic implemented in ``app.js`` and uses configurable weights so you
can tune how much each check is worth. The grader iterates over all ``.json``
files in the provided directory, evaluates each one, and writes a consolidated
``grading_results.txt`` report to the same directory.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, MutableMapping, Optional, Tuple

# ---------------------------------------------------------------------------
# Grading metrics (adjust to tune rubric)
# ---------------------------------------------------------------------------
# State definition table checks
STATE_DESCRIPTION_WEIGHT = 4.0
STATE_LABEL_WEIGHT = 4.0
STATE_BINARY_WEIGHT = 6.0
INPUT_MINIMUM_WEIGHT = 4.0
OUTPUT_MINIMUM_WEIGHT = 4.0

# Diagram checks
PLACED_STATES_WEIGHT = 10.0
OUTPUT_VALUE_WEIGHT = 8.0
ARROW_COVERAGE_WEIGHT = 14.0

# Transition table checks
TABLE_STRUCTURE_WEIGHT = 12.0
TABLE_MATCH_WEIGHT = 16.0

# Karnaugh map checks (placeholders, wired into totals for future use)
KMAP_COMPLETENESS_WEIGHT = 2.0
KMAP_EXPRESSION_WEIGHT = 2.0


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

    total_weight = TABLE_STRUCTURE_WEIGHT + TABLE_MATCH_WEIGHT + KMAP_COMPLETENESS_WEIGHT + KMAP_EXPRESSION_WEIGHT
    total_score = structure_score + match_score

    total_score += KMAP_COMPLETENESS_WEIGHT * 0
    total_score += KMAP_EXPRESSION_WEIGHT * 0

    return SectionResult(score=total_score, weight=total_weight, notes=notes)


def check_kmaps_filled(machine: Mapping[str, object]) -> None:
    """Placeholder for K-map cell completion checks."""

    return None


def check_kmap_expressions(machine: Mapping[str, object]) -> None:
    """Placeholder for K-map expression correctness checks."""

    return None


def grade_file(
    path: Path, min_states: int, min_inputs: int, min_outputs: int, verbose: bool = False
) -> GradeResult:
    """Grade a single save file and optionally emit verbose deductions."""

    machine = load_save(path)
    sections = {
        "State definitions": check_state_definitions(machine, min_inputs, min_outputs),
        "Transition diagram": check_transition_diagram(machine, min_states, min_inputs, min_outputs),
        "Transition table vs diagram": check_transition_table(machine, min_states, min_inputs, min_outputs),
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
