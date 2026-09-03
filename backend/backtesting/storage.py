from __future__ import annotations

import json
from pathlib import Path

from .schemas import BacktestResult, to_jsonable


def write_result_json(result: BacktestResult, output_path: str | Path) -> Path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(result), indent=2, sort_keys=True), encoding="utf-8")
    return path
