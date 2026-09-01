import asyncio
import logging
from datetime import datetime, timezone
from typing import Annotated, Any
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from ..database import SessionLocal
from .. import models
from ..state import db, fyers, mgr

router = APIRouter()
log = logging.getLogger("fno-auth")
DbSession = Annotated[Session, Depends(db)]


@router.get("/fyers/callback")
async def fyers_callback(auth_code: str | None = None, code: str | None = None) -> RedirectResponse:
    real_code = auth_code or code
    if not real_code:
        raise HTTPException(400, "missing auth code")

    return RedirectResponse(url=f"http://localhost:5173/login?auth_code={real_code}")


@router.get("/api/health")
def health() -> dict[str, Any]:
    db_ok = False
    try:
        d = SessionLocal()
        d.execute(models.User.__table__.select().limit(1))
        d.close()
        db_ok = True
    except Exception:
        pass

    return {
        "ok": True,
        "fyers": fyers.ready,
        "redis": False,
        "db": db_ok,
        "ts": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    }


@router.get("/api/auth/login-url")
def login_url() -> dict[str, str]:
    return {"url": fyers.login_url()}


@router.post("/api/auth/exchange")
async def exchange(payload: dict[str, Any], d: DbSession) -> dict[str, Any]:
    raw_code = payload.get("code") or payload.get("auth_code")
    code = str(raw_code).strip() if raw_code else ""
    if not code:
        raise HTTPException(400, "missing auth code")

    log.info("Fyers auth exchange requested")

    try:
        token, profile = await fyers.exchange_code(code)

        log.info("Fyers token received")

        fyers.set_token(token)

    except Exception as e:
        log.error("Fyers auth exchange failed")

        raise HTTPException(
            400,
            f"Auth exchange failed: {str(e)}"
        )

    user = d.query(models.User).filter_by(fy_id=profile.get("fy_id")).first()

    if not user:
        user = models.User(
            fy_id=profile.get("fy_id"),
            name=profile.get("name"),
            email=profile.get("email_id")
        )
        d.add(user)
        d.commit()
        d.refresh(user)

    ba = d.query(models.BrokerAccount).filter_by(user_id=user.id, broker="fyers").first()

    if not ba:
        ba = models.BrokerAccount(user_id=user.id, broker="fyers", access_token=token)
        d.add(ba)
    else:
        ba.access_token = token

    d.commit()

    async def init_feed() -> None:
        try:
            await fyers.stop_feed()
        except Exception:
            pass

        try:
            await fyers.start_feed(mgr)

            await fyers.subscribe([
                "NSE:HDFCBANK-EQ",
                "NSE:RELIANCE-EQ",
                "NSE:TCS-EQ",
                "NSE:INFY-EQ",
                "NSE:SBIN-EQ",
                "NSE:ICICIBANK-EQ",
                "NSE:LT-EQ",
                "NSE:AXISBANK-EQ",
                "NSE:KOTAKBANK-EQ",
                "NSE:ITC-EQ",
                "NSE:BHARTIARTL-EQ",
                "NSE:MARUTI-EQ",
                "NSE:HCLTECH-EQ",
                "NSE:BHEL-EQ"
            ])
        except Exception:
            log.error("Fyers feed init failed")

    asyncio.create_task(init_feed())

    return {
        "access_token": token,
        "user": {
            "id": user.fy_id,
            "fy_id": user.fy_id,
            "name": user.name,
            "email": user.email or ""
        }
    }


@router.post("/api/auth/logout")
def logout() -> dict[str, bool]:
    return {"ok": True}
