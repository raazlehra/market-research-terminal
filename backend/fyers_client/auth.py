from urllib.parse import urlencode
from typing import Any

from .common import ACCOUNT_API



class FyersAuthMixin:
    app_id: str | None
    secret: str | None
    redirect_uri: str
    token: str | None
    ready: bool

    def set_token(self, token: str) -> None:
        self.token = token
        self.ready = bool(token)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"{self.app_id}:{self.token}",
            "Content-Type": "application/json"
        }

    def login_url(self, state: str) -> str:
        if not state:
            raise ValueError("OAuth state is required")
        params = {
            "client_id": self.app_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "state": state,
        }

        return (
            "https://api-t1.fyers.in/api/v3/generate-authcode?"
            + urlencode(params)
        )

    async def exchange_code(self, code: str) -> tuple[str, dict[str, Any]]:
        if not self.app_id or not self.secret:
            raise RuntimeError("FYERS_APP_ID or FYERS_SECRET missing")
        response = await self.http.post(
            f"{ACCOUNT_API}/validate-authcode",
            json={
                "grant_type": "authorization_code",
                "appIdHash": self._app_hash(),
                "code": code,
            },
        )
        payload = response.json()
        access_token = payload.get("access_token") if isinstance(payload, dict) else None

        if response.status_code != 200 or not access_token:
            raise RuntimeError("FYERS authorization failed")

        self.set_token(access_token)

        profile_response = await self.http.get(
            f"{ACCOUNT_API}/profile",
            headers=self._headers(),
        )
        if profile_response.status_code != 200:
            raise RuntimeError("FYERS profile validation failed")
        profile_payload = profile_response.json()
        profile = profile_payload.get("data", {}) if isinstance(profile_payload, dict) else {}
        return access_token, profile

    def _app_hash(self) -> str:
        import hashlib

        if not self.app_id:
            raise RuntimeError("FYERS_APP_ID missing")

        if not self.secret:
            raise RuntimeError("FYERS_SECRET missing")

        app = self.app_id.strip()
        secret = self.secret.strip()

        return hashlib.sha256(
                f"{app}:{secret}".encode("utf-8")
        ).hexdigest()
    
    # ---------- Market data ----------

