import logging
import uuid
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .database import SessionLocal
from .fyers_client import FyersClient
from .security import verify_session_token
from .token_security import TokenCipher, TokenEncryptionError
from .paper_engine import PaperEngine
from .risk_engine import RiskEngine
from .alerts_engine import AlertsEngine
from .scanner_engine import ScannerEngine
from .ws_manager import ConnectionManager
from . import models

log = logging.getLogger("fno-backend-state")

mgr = ConnectionManager()
fyers = FyersClient()
paper = PaperEngine()
risk = RiskEngine()
alerts = AlertsEngine(mgr)
scanner = ScannerEngine(fyers)


def db():
    d = SessionLocal()
    try:
        yield d
    finally:
        d.close()


def get_user(request: Request, d: Session = Depends(db)) -> models.User:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    user = authenticate_bearer_token(token, d)
    if not user:
        raise HTTPException(401, "invalid token")
    return user


def get_market_user(request: Request, d: Session = Depends(db)) -> models.User:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        user = authenticate_bearer_token(auth.split(" ", 1)[1].strip(), d)
        if user:
            return user

    raise HTTPException(401, "Fyers login required")


def authenticate_bearer_token(token: str, d: Session) -> models.User | None:
    claims = verify_session_token(token)
    if not claims:
        return None
    try:
        user_id = uuid.UUID(str(claims.get("sub", "")))
    except (ValueError, TypeError):
        return None
    user = d.query(models.User).filter_by(id=user_id).first()
    if not user:
        return None
    account = (
        d.query(models.BrokerAccount)
        .filter_by(user_id=user.id, broker="fyers")
        .filter(models.BrokerAccount.access_token.isnot(None))
        .first()
    )
    if not account or not account.access_token:
        return None
    try:
        broker_token = TokenCipher.from_environment().decrypt(account.access_token)
    except TokenEncryptionError:
        log.error("Stored FYERS token is unavailable or requires migration")
        return None
    fyers.set_token(broker_token)
    return user
