from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from .account import FyersAccountMixin
from .account_activity import FyersAccountActivityMixin
from .auth import FyersAuthMixin
from .feed import FyersFeedMixin
from .market_data import FyersMarketDataMixin

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


class FyersClient(
    FyersAuthMixin,
    FyersMarketDataMixin,
    FyersAccountActivityMixin,
    FyersAccountMixin,
    FyersFeedMixin,
):
    def __init__(self) -> None:
        import os

        self.app_id: str | None = os.getenv("FYERS_APP_ID")
        self.secret: str | None = os.getenv("FYERS_SECRET")
        self.redirect_uri: str = os.getenv("FYERS_REDIRECT_URI", "http://localhost:5173/")

        self.token: str | None = None
        self.ready: bool = False
        self.http: httpx.AsyncClient = httpx.AsyncClient(timeout=20)
        self._ticks: dict[str, dict[str, Any]] = {}
        self._feed: Any | None = None
        self._mgr: Any | None = None
        self._symbols_subscribed: set[str] = set()
        self._loop: Any | None = None
