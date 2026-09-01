from urllib.parse import urlencode
from typing import Any

from fyers_apiv3 import fyersModel


class FyersAuthMixin:
    app_id: str | None
    secret: str | None
    redirect_uri: str
    token: str | None
    ready: bool

    def set_token(self, token: str) -> None:
        self.token = token
        self.ready = bool(token)

        try:
            app_id = self.app_id or ""
            fy = fyersModel.FyersModel(
                client_id=app_id,
                token=self.token,
                log_path=""
            )

            profile = fy.get_profile()

            if profile.get("s") == "error":
                print("FYERS LOGIN REQUIRED")

        except Exception:
            print("FYERS LOGIN CHECK FAILED")
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"{self.app_id}:{self.token}",
            "Content-Type": "application/json"
        }

    def login_url(self) -> str:
        params = {
            "client_id": self.app_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "state": "fno",
        }

        return (
            "https://api-t1.fyers.in/api/v3/generate-authcode?"
            + urlencode(params)
        )

    async def exchange_code(self, code: str) -> tuple[str, dict[str, Any]]:
        if not self.app_id or not self.secret:
            raise RuntimeError("FYERS_APP_ID or FYERS_SECRET missing")
        app_id = self.app_id
        secret = self.secret

        session = fyersModel.SessionModel(
            client_id=app_id,
            secret_key=secret,
            redirect_uri=self.redirect_uri,
            response_type="code",
            grant_type="authorization_code"
        )

        session.set_token(code)

        response = session.generate_token()

        access_token = response.get("access_token")

        if not access_token:
            raise RuntimeError(str(response))

        self.set_token(access_token)

        fy = fyersModel.FyersModel(
            client_id=app_id,
            token=access_token,
            is_async=False,
            log_path=""
        )

        profile = fy.get_profile()

        return access_token, profile.get("data", {})
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

