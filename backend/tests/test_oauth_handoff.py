import asyncio
import time
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from backend.routes import auth_routes


def setup_function() -> None:
    auth_routes._OAUTH_STATES.clear()
    auth_routes._LOGIN_HANDOFFS.clear()


def test_login_url_uses_unique_expiring_state() -> None:
    with patch.object(auth_routes.fyers, "login_url", return_value="https://api-t1.fyers.in/login") as login:
        result = auth_routes.login_url()
    assert result["url"].startswith("https://")
    state = login.call_args.args[0]
    assert state
    assert state in auth_routes._OAUTH_STATES
    assert auth_routes._OAUTH_STATES[state] > time.time()


def test_callback_exchanges_code_server_side_and_redirects_with_opaque_handoff() -> None:
    state = "state-marker"
    provider_code = "provider-code-marker"
    auth_routes._OAUTH_STATES[state] = time.time() + 30
    app_payload = {"session_token": "signed-app-session", "user": {"id": "viewer"}}
    with patch.object(auth_routes, "_exchange_and_persist", new=AsyncMock(return_value=app_payload)) as exchange:
        response = asyncio.run(auth_routes.fyers_callback(None, auth_code=provider_code, state=state))

    exchange.assert_awaited_once_with(provider_code, None)
    location = response.headers["location"]
    assert provider_code not in location
    assert "auth_code" not in location
    handoff = parse_qs(urlparse(location).query)["handoff"][0]
    assert handoff in auth_routes._LOGIN_HANDOFFS


def test_handoff_is_one_use_and_expired_values_are_rejected() -> None:
    auth_routes._LOGIN_HANDOFFS["once"] = (
        time.time() + 30,
        {"session_token": "signed-app-session", "user": {"id": "viewer"}},
    )
    assert auth_routes.complete_login({"handoff": "once"})["session_token"] == "signed-app-session"
    with pytest.raises(HTTPException) as reused:
        auth_routes.complete_login({"handoff": "once"})
    assert reused.value.status_code == 400

    auth_routes._LOGIN_HANDOFFS["expired"] = (time.time() - 1, {})
    with pytest.raises(HTTPException) as expired:
        auth_routes.complete_login({"handoff": "expired"})
    assert expired.value.status_code == 400