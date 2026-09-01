import json
from datetime import datetime, timezone
from typing import Annotated, Any, cast

from fastapi import Depends
from sqlalchemy.orm import Session

from .. import models
from ..state import db, get_user

DbSession = Annotated[Session, Depends(db)]
CurrentUser = Annotated[models.User, Depends(get_user)]
JsonRecord = dict[str, Any]


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def json_list(value: Any) -> list[Any]:
    try:
        parsed: object = json.loads(str(value or "[]"))
        return cast(list[Any], parsed) if isinstance(parsed, list) else []
    except Exception:
        return []


def json_records(value: object) -> list[JsonRecord]:
    if not isinstance(value, list):
        return []
    rows = cast(list[object], value)
    return [cast(JsonRecord, row) for row in rows if isinstance(row, dict)]


def json_record(value: str) -> JsonRecord:
    parsed: object = json.loads(value)
    return cast(JsonRecord, parsed) if isinstance(parsed, dict) else {}


def float_value(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0
