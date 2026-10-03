import asyncio
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any
from .database import SessionLocal
from . import models
import httpx

log = logging.getLogger("alerts")


class AlertsEngine:
    def __init__(self, mgr: Any) -> None:
        self.mgr = mgr
        self._stop = threading.Event()
        self._th: threading.Thread | None = None
        self.fyers: Any = None
        self.engine: Any = None

    def start(self, fyers: Any, engine: Any) -> None:
        self.fyers = fyers
        self.engine = engine
        self._th = threading.Thread(target=self._loop, daemon=True)
        self._th.start()

    def stop(self) -> None:
        if self._th:
            self._stop.set()
            self._th.join(timeout=2)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                d = SessionLocal()
                armed = d.query(models.Alert).filter_by(triggered=False).all()
                for a in armed:
                    symbol = str(a.symbol or "")
                    trigger_value = float(a.value or 0)
                    if not symbol:
                        continue

                    tick = self.fyers.get_tick(symbol)
                    if not tick:
                        continue

                    fired = False
                    ltp = float(tick.get("ltp") or 0)
                    if a.type == "PRICE_ABOVE" and ltp >= trigger_value:
                        fired = True
                    if a.type == "PRICE_BELOW" and ltp <= trigger_value:
                        fired = True
                    if a.type == "OI_SPIKE":
                        prev = tick.get("prev_oi") or tick.get("oi")
                        if prev and (tick.get("oi") or 0) > prev * (1 + trigger_value / 100):
                            fired = True

                    if fired:
                        a.triggered = True
                        a.last_fired_at = datetime.now(timezone.utc).replace(tzinfo=None)
                        d.commit()

                        try:
                            asyncio.run(self.mgr.broadcast({
                                "type": "alert", 
                                "payload": {
                                    "id": str(a.id), 
                                    "symbol": a.symbol, 
                                    "type": a.type, 
                                    "value": a.value
                                }
                            }))
                        except Exception as e:
                            log.warning(f"Alert broadcast exception: {e}")

                        if a.webhook:
                            try:
                                httpx.post(
                                    a.webhook, 
                                    json={"symbol": a.symbol, "type": a.type, "value": a.value}, 
                                    timeout=5
                                )
                            except Exception as e:
                                log.warning(f"webhook failed: {e}")
                d.close()
            except Exception as e:
                log.error(f"alerts loop: {e}")
            time.sleep(2)
