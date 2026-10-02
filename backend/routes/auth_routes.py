import asyncio
import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Annotated, Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from .. import models
from ..database import SessionLocal
from ..security import issue_session_token, revoke_session_token
from ..state import db, fyers, mgr
from ..token_security import TokenCipher, TokenEncryptionError

router = APIRouter()
log = logging.getLogger("fno-auth")
DbSession = Annotated[Session, Depends(db)]
_OAUTH_TTL_SECONDS = 300
_HANDOFF_TTL_SECONDS = 60
_OAUTH_STATES: dict[str, float] = {}
_LOGIN_HANDOFFS: dict[str, tuple[float, dict[str, Any]]] = {}
_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def _cleanup_ephemeral() -> None:
    now = time.time()
    for state, expiry in list(_OAUTH_STATES.items()):
        if expiry <= now:
            _OAUTH_STATES.pop(state, None)
    for handoff, (expiry, _) in list(_LOGIN_HANDOFFS.items()):
        if expiry <= now:
            _LOGIN_HANDOFFS.pop(handoff, None)


async def _init_feed() -> None:
    try:
        await fyers.stop_feed()
    except Exception:
        pass
    try:
        await fyers.start_feed(mgr)
        await fyers.subscribe([
            "NSE:HDFCBANK-EQ", "NSE:RELIANCE-EQ", "NSE:TCS-EQ", "NSE:INFY-EQ",
            "NSE:SBIN-EQ", "NSE:ICICIBANK-EQ", "NSE:LT-EQ", "NSE:AXISBANK-EQ",
            "NSE:KOTAKBANK-EQ", "NSE:ITC-EQ", "NSE:BHARTIARTL-EQ", "NSE:MARUTI-EQ",
            "NSE:HCLTECH-EQ", "NSE:BHEL-EQ",
        ])
    except Exception:
        log.error("Fyers feed init failed")


async def _exchange_and_persist(code: str, d: Session) -> dict[str, Any]:
    try:
        token_cipher = TokenCipher.from_environment()
    except TokenEncryptionError as error:
        log.error("Fyers token encryption is not configured")
        raise HTTPException(503, "Server token encryption is not configured.") from error

    try:
        token, profile = await fyers.exchange_code(code)
    except Exception as error:
        log.error("Fyers auth exchange failed")
        raise HTTPException(400, "FYERS authentication failed. Start a new login and try again.") from error

    fy_id = str(profile.get("fy_id") or "").strip()
    if not fy_id:
        raise HTTPException(502, "FYERS profile response did not identify the account.")

    user = d.query(models.User).filter_by(fy_id=fy_id).first()
    if not user:
        user = models.User(fy_id=fy_id, name=profile.get("name"), email=profile.get("email_id"))
        d.add(user)
        d.flush()

    account = d.query(models.BrokerAccount).filter_by(user_id=user.id, broker="fyers").first()
    encrypted_token = token_cipher.encrypt(token)
    if not account:
        d.add(models.BrokerAccount(user_id=user.id, broker="fyers", access_token=encrypted_token))
    else:
        account.access_token = encrypted_token
    d.commit()
    d.refresh(user)
    asyncio.create_task(_init_feed())
    return {
        "session_token": issue_session_token(str(user.id)),
        "user": {"id": user.fy_id, "fy_id": user.fy_id, "name": user.name, "email": user.email or ""},
    }


@router.get("/fyers/callback")
async def fyers_callback(
    d: DbSession,
    auth_code: str | None = None,
    code: str | None = None,
    state: str | None = None,
) -> RedirectResponse:
    _cleanup_ephemeral()
    real_code = auth_code or code
    if not real_code or not state or _OAUTH_STATES.pop(state, None) is None:
        raise HTTPException(400, "Invalid or expired OAuth callback.")
    payload = await _exchange_and_persist(real_code, d)
    handoff = secrets.token_urlsafe(32)
    _LOGIN_HANDOFFS[handoff] = (time.time() + _HANDOFF_TTL_SECONDS, payload)
    return RedirectResponse(url=f"{_FRONTEND_URL}/login?{urlencode({'handoff': handoff})}", status_code=303)


@router.get("/api/health")
def health() -> dict[str, Any]:
    db_ok = False
    d = SessionLocal()
    try:
        d.execute(models.User.__table__.select().limit(1))
        db_ok = True
    except Exception:
        pass
    finally:
        d.close()
    return {
        "ok": True,
        "fyers": fyers.ready,
        "redis": False,
        "db": db_ok,
        "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
    }


@router.get("/api/auth/login-url")
def login_url() -> dict[str, str]:
    _cleanup_ephemeral()
    state = secrets.token_urlsafe(24)
    _OAUTH_STATES[state] = time.time() + _OAUTH_TTL_SECONDS
    return {"url": fyers.login_url(state)}


@router.post("/api/auth/complete")
def complete_login(payload: dict[str, Any]) -> dict[str, Any]:
    _cleanup_ephemeral()
    handoff = str(payload.get("handoff") or "").strip()
    record = _LOGIN_HANDOFFS.pop(handoff, None) if handoff else None
    if not record or record[0] <= time.time():
        raise HTTPException(400, "Login handoff is invalid or expired. Start a new FYERS login.")
    return record[1]


@router.post("/api/auth/exchange", status_code=410)
def reject_browser_code_exchange() -> None:
    raise HTTPException(410, "Authorization codes are exchanged only by the server callback. Start a new FYERS login.")


@router.post("/api/auth/logout")
def logout(request: Request) -> dict[str, bool]:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        revoke_session_token(auth.split(" ", 1)[1].strip())
    return {"ok": True}