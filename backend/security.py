import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any


_SESSION_SECRET = os.getenv("APP_SESSION_SECRET") or secrets.token_urlsafe(48)
_SESSION_TTL_SECONDS = int(os.getenv("APP_SESSION_TTL_SECONDS", "43200"))
_REVOKED_SESSION_IDS: dict[str, int] = {}


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_session_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": int(time.time()) + _SESSION_TTL_SECONDS,
        "purpose": "market-viewer",
        "jti": secrets.token_urlsafe(18),
    }
    encoded = _encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _encode(hmac.new(_SESSION_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def verify_session_token(token: str) -> dict[str, Any] | None:
    try:
        encoded, signature = token.split(".", 1)
        expected = _encode(hmac.new(_SESSION_SECRET.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
        if not secrets.compare_digest(signature, expected):
            return None
        payload = json.loads(_decode(encoded))
        now = int(time.time())
        for jti, expiry in list(_REVOKED_SESSION_IDS.items()):
            if expiry <= now:
                _REVOKED_SESSION_IDS.pop(jti, None)
        if payload.get("purpose") != "market-viewer" or int(payload.get("exp", 0)) <= now:
            return None
        jti = str(payload.get("jti") or "")
        if not jti or jti in _REVOKED_SESSION_IDS:
            return None
        return payload
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def revoke_session_token(token: str) -> bool:
    claims = verify_session_token(token)
    if not claims:
        return False
    _REVOKED_SESSION_IDS[str(claims["jti"])] = int(claims["exp"])
    return True
