from .database import SessionLocal
from . import models
import json
from datetime import datetime


class RiskEngine:
    def __init__(self):
        self._kill_switches = {}  # user_id -> bool

    def set_kill_switch(self, uid, active: bool):
        self._kill_switches[str(uid)] = active

    def is_kill_switched(self, uid) -> bool:
        if self._kill_switches.get(str(uid), False):
            return True

        d = SessionLocal()
        try:
            s = d.query(models.Settings).filter_by(user_id=uid).first()
            if not s:
                return False
            data = json.loads(s.data or "{}")
            return bool(data.get("killSwitch") or data.get("kill_switch"))
        except Exception:
            return True
        finally:
            d.close()

    def can_trade(self, uid, payload: dict) -> bool:
        d = SessionLocal()
        try:
            s = d.query(models.Settings).filter_by(user_id=uid).first()
            if not s:
                return True

            data = json.loads(s.data or "{}")

            # Evaluate Max Exposure / Trade
            max_exp = float(data.get("riskMaxExposure") or data.get("max_exposure") or 0)
            if max_exp > 0:
                price = float(payload.get("limitPrice") or payload.get("price") or 0)
                qty = int(payload.get("qty") or 0)
                if price * qty > max_exp:
                    return False

            # Evaluate Max Daily Trades Limit
            max_trades = int(data.get("riskMaxTrades") or data.get("max_trades") or 0)
            if max_trades > 0:
                today = datetime.utcnow().date()
                count = d.query(models.Order).filter(
                    models.Order.user_id == uid, 
                    models.Order.created_at >= today
                ).count()
                
                if count >= max_trades:
                    return False

            return True
        except Exception:
            return False
        finally:
            d.close()
