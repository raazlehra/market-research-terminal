import asyncio
import hashlib

from backend.fyers_client.auth import FyersAuthMixin
from backend.fyers_client.market_data import FyersMarketDataMixin


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


class FakeHttp:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict]] = []

    async def post(self, url: str, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.responses.pop(0)

    async def get(self, url: str, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.responses.pop(0)


class AuthClient(FyersAuthMixin):
    app_id = "client-100"
    secret = "server-secret"
    redirect_uri = "http://localhost/callback"
    token = None
    ready = False

    def __init__(self, http: FakeHttp) -> None:
        self.http = http


class OptionClient(FyersMarketDataMixin):
    app_id = "client-100"
    token = "broker-token"

    def __init__(self, http: FakeHttp) -> None:
        self.http = http

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"{self.app_id}:{self.token}"}


def test_auth_exchange_uses_direct_v3_http_and_keeps_secret_out_of_headers() -> None:
    http = FakeHttp([
        FakeResponse({"access_token": "broker-token"}),
        FakeResponse({"data": {"fy_id": "viewer"}}),
    ])
    client = AuthClient(http)

    token, profile = asyncio.run(client.exchange_code("one-time-code"))

    expected_hash = hashlib.sha256(b"client-100:server-secret").hexdigest()
    assert token == "broker-token"
    assert profile == {"fy_id": "viewer"}
    assert client.ready is True
    assert http.calls[0] == (
        "POST",
        "https://api-t1.fyers.in/api/v3/validate-authcode",
        {"json": {"grant_type": "authorization_code", "appIdHash": expected_hash, "code": "one-time-code"}},
    )
    assert http.calls[1][1] == "https://api-t1.fyers.in/api/v3/profile"
    assert "server-secret" not in str(http.calls)


def test_option_chain_uses_read_only_data_endpoint_without_sdk() -> None:
    http = FakeHttp([
        FakeResponse({
            "s": "ok",
            "data": {
                "spotPrice": 0,
                "optionsChain": [{"option_type": "CE", "strike_price": 500, "oi": 123, "ltp": 7.5}],
                "expiryData": [],
            },
        }),
    ])
    client = OptionClient(http)

    result = asyncio.run(client.option_chain("NSE:SBIN-EQ", ""))

    assert result["chain"][0]["ce"]["oi"] == 123
    assert result["chain"][0]["ce"]["iv"] is None
    assert http.calls[0][0] == "GET"
    assert http.calls[0][1] == "https://api-t1.fyers.in/data/options-chain-v3"
    assert http.calls[0][2]["params"]["strikecount"] == 20
def test_market_depth_uses_documented_get_endpoint_and_query_params() -> None:
    http = FakeHttp([FakeResponse({"s": "ok", "d": {"NSE:SBIN-EQ": {"ltp": 100}}})])
    client = OptionClient(http)

    result = asyncio.run(client.depth("NSE:SBIN-EQ"))

    assert result["s"] == "ok"
    assert http.calls[0][0] == "GET"
    assert http.calls[0][1] == "https://api-t1.fyers.in/data/depth"
    assert http.calls[0][2]["params"] == {"symbol": "NSE:SBIN-EQ", "ohlcv_flag": 1}
