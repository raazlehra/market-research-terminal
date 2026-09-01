import logging
import secrets
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from .database import SessionLocal
from .fyers_client import FyersClient
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
    if not token:
        return None

    accounts = (
        d.query(models.BrokerAccount)
        .filter(models.BrokerAccount.broker == "fyers")
        .filter(models.BrokerAccount.access_token.isnot(None))
        .all()
    )

    for account in accounts:
        stored_token = account.access_token or ""
        if secrets.compare_digest(stored_token, token):
            user = d.query(models.User).filter_by(id=account.user_id).first()
            if not user:
                return None
            fyers.set_token(stored_token)
            return user

    return None
