import json
import uuid
from typing import Any, Protocol, cast

from fastapi import APIRouter
from sqlalchemy.orm import Session

from .. import models
from ..state import risk
from .common import CurrentUser, DbSession, JsonRecord, json_record

router = APIRouter()

OPTION_INDEX_LABELS = ("NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX")
OPTION_SIZING_MODES = ("fixed", "risk", "smaller")
BOT_EXECUTION_MODES = ("dry_run", "paper_auto")
BOT_CANDLE_CONFIRMATION_MODES = ("off", "log", "block_opposite")
MARKET_REGIMES = ("TREND_UP", "TREND_DOWN", "RANGE", "VOLATILE", "LOW_VOLUME")
DEFAULT_GUARDED_REGIMES = ("RANGE", "LOW_VOLUME")


class RiskSwitch(Protocol):
    def set_kill_switch(self, uid: str, active: bool) -> None:
        ...


typed_risk = cast(RiskSwitch, risk)


def _clamp_number(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return max(minimum, min(parsed, maximum))


def _clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    return int(_clamp_number(value, default, minimum, maximum))


def _sanitize_option_index_risk(value: Any) -> dict[str, dict[str, Any]]:
    source: JsonRecord = cast(JsonRecord, value) if isinstance(value, dict) else {}
    cleaned: dict[str, dict[str, Any]] = {}
    for label in OPTION_INDEX_LABELS:
        raw_row = source.get(label)
        row: JsonRecord = cast(JsonRecord, raw_row) if isinstance(raw_row, dict) else {}
        requested_lots = _clamp_int(row.get("requestedLots"), 1, 1, 50)
        max_lots = _clamp_int(row.get("maxLots"), max(requested_lots, 1), 1, 50)
        cleaned[label] = {
            "enabled": bool(row.get("enabled", True)),
            "requestedLots": requested_lots,
            "maxLots": max(requested_lots, max_lots),
        }
    return cleaned


def _sanitize_guarded_regimes(value: Any) -> list[str]:
    if not isinstance(value, list):
        return list(DEFAULT_GUARDED_REGIMES)
    regimes = [str(item) for item in value if str(item) in MARKET_REGIMES]
    return list(dict.fromkeys(regimes)) or list(DEFAULT_GUARDED_REGIMES)


def _sanitize_bot_settings(payload: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    source = {**(current or {}), **(payload or {})}
    cleaned: dict[str, Any] = {}

    for key in ("strategy", "universe", "timeframe"):
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            cleaned[key] = value.strip()

    if "minConfidence" in source:
        cleaned["minConfidence"] = _clamp_int(source.get("minConfidence"), 65, 0, 95)
    if "riskPerTrade" in source:
        cleaned["riskPerTrade"] = _clamp_int(source.get("riskPerTrade"), 1000, 100, 1000000)
    if "maxTradesPerDay" in source:
        cleaned["maxTradesPerDay"] = _clamp_int(source.get("maxTradesPerDay"), 5, 1, 50)
    if "minT1RewardRisk" in source:
        cleaned["minT1RewardRisk"] = _clamp_number(source.get("minT1RewardRisk"), 1.2, 0.5, 10)
    if "minT2RewardRisk" in source:
        cleaned["minT2RewardRisk"] = _clamp_number(source.get("minT2RewardRisk"), 2, 0.5, 10)
    if "t1ExitPercent" in source:
        cleaned["t1ExitPercent"] = _clamp_int(source.get("t1ExitPercent"), 50, 10, 100)
    if "minCandleScore" in source:
        cleaned["minCandleScore"] = _clamp_int(source.get("minCandleScore"), 72, 0, 100)
    if "regimeGuardMinCandleScore" in source:
        cleaned["regimeGuardMinCandleScore"] = _clamp_int(source.get("regimeGuardMinCandleScore"), 85, 0, 100)
    if "maxPatternConfidenceAdjustment" in source:
        cleaned["maxPatternConfidenceAdjustment"] = _clamp_int(source.get("maxPatternConfidenceAdjustment"), 5, 0, 15)

    for key in ("autoExitEnabled", "trailingSlEnabled", "optionIndexWatchEnabled", "requireCandleVolume", "regimeGuardEnabled", "adaptivePatternConfidenceEnabled"):
        if key in source:
            cleaned[key] = bool(source.get(key))

    sizing_mode = source.get("optionSizingMode")
    if sizing_mode in OPTION_SIZING_MODES:
        cleaned["optionSizingMode"] = sizing_mode

    execution_mode = source.get("executionMode")
    if execution_mode in BOT_EXECUTION_MODES:
        cleaned["executionMode"] = execution_mode

    candle_confirmation_mode = source.get("candleConfirmationMode")
    if candle_confirmation_mode in BOT_CANDLE_CONFIRMATION_MODES:
        cleaned["candleConfirmationMode"] = candle_confirmation_mode

    if "optionIndexRisk" in source:
        cleaned["optionIndexRisk"] = _sanitize_option_index_risk(source.get("optionIndexRisk"))
    if "guardedRegimes" in source:
        cleaned["guardedRegimes"] = _sanitize_guarded_regimes(source.get("guardedRegimes"))

    return cleaned


def _read_settings_row(d: Session, user_id: uuid.UUID) -> tuple[models.Settings, dict[str, Any]]:
    row = d.query(models.Settings).filter_by(user_id=user_id).first()
    data: dict[str, Any] = {}
    if row:
        try:
            data = json_record(row.data or "{}")
        except Exception:
            data = {}
    else:
        row = models.Settings(user_id=user_id, data="{}")
        d.add(row)
    return row, data


@router.get("/api/settings")
def get_settings(d: DbSession, u: CurrentUser) -> dict[str, Any]:
    settings = d.query(models.Settings).filter_by(user_id=u.id).first()
    if not settings:
        return {}
    return json_record(settings.data or "{}")


@router.put("/api/settings")
def save_settings(payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, bool]:
    settings, data = _read_settings_row(d, u.id)
    data.update(payload or {})
    settings.data = json.dumps(data)
    if "killSwitch" in payload:
        typed_risk.set_kill_switch(str(u.id), bool(payload.get("killSwitch")))
    d.commit()
    return {"ok": True}


@router.get("/api/bot-settings")
def get_bot_settings(d: DbSession, u: CurrentUser) -> dict[str, Any]:
    _, data = _read_settings_row(d, u.id)
    raw_bot_settings: object = data.get("autoBot")
    bot_settings: JsonRecord = cast(JsonRecord, raw_bot_settings) if isinstance(raw_bot_settings, dict) else {}
    return _sanitize_bot_settings(bot_settings)


@router.put("/api/bot-settings")
def save_bot_settings(payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, Any]:
    settings, data = _read_settings_row(d, u.id)
    raw_current: object = data.get("autoBot")
    current: JsonRecord = cast(JsonRecord, raw_current) if isinstance(raw_current, dict) else {}
    cleaned = _sanitize_bot_settings(payload or {}, current)
    data["autoBot"] = cleaned
    settings.data = json.dumps(data)
    d.commit()
    return {"ok": True, "autoBot": cleaned}


@router.post("/api/risk/kill-switch")
def kill_switch(payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, bool]:
    active = bool(payload.get("on", False))
    typed_risk.set_kill_switch(str(u.id), active)
    settings, data = _read_settings_row(d, u.id)
    data["killSwitch"] = active
    settings.data = json.dumps(data)
    d.commit()
    return {"ok": True}
