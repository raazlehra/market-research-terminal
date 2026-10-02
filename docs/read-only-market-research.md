# Read-only market research architecture

## Baseline and preserved work

This is a React/Vite research terminal backed by FastAPI, SQLAlchemy, FYERS OAuth/REST/WebSocket market data, deterministic local indicators, Binance public crypto data, and separate local paper/backtesting modules. The phase began on branch `codex/fno-backtesting-calibration-phase2` at commit `2016ecb741bea7d21300021bd7afd6e424dfc7a6`. Pre-existing backtesting changes are intentionally outside this phase and remain uncommitted.

## Permanent read-only boundary

The active application router uses `ViewerLayout` and exposes Dashboard, Stocks, F&O, Crypto, Watchlist, Charts, and Settings. It exposes no order, position-management, paper-ticket, or auto-bot screen. Reachable charts, watchlists, and option-chain cells contain no ticket or execution action.

`FyersReadOnlyMarketDataProvider` exposes only stock, option, and futures snapshots. The concrete FYERS client has no place/modify/cancel/exit/square-off methods. Legacy live-mutation routes remain HTTP 403 traps for old callers, and `/api/analysis/execute` always returns 403. Analysis models validate `execution_enabled: false` and `signal_type: analysis_only`; the AI adapter rejects model output that changes either property or contains executable instructions.

TradingAgents receives only a bounded JSON-compatible snapshot. It receives no broker object, credential, market-data tool, wallet, private key, FYERS mutation method, Binance authenticated endpoint, or arbitrary URL tool.

## FYERS interfaces

| Capability | Endpoint/interface | Classification | Status |
| --- | --- | --- | --- |
| OAuth/profile validation | FYERS v3 account HTTPS | Authentication/read | Server-side only |
| Quotes | FYERS `/data/quotes` | Market read | Retained |
| Historical candles | FYERS `/data/history` | Market read | Retained |
| Depth | FYERS `GET /data/depth` | Market read | Retained |
| Option chain/expiries | FYERS `/data/options-chain-v3` | Market read | Retained |
| Futures symbol discovery | `https://public.fyers.in/sym_details/NSE_FO_sym_master.json` | Public market metadata | Added, cached six hours |
| WebSocket ticks | FYERS data socket | Market read | Retained |
| Place/modify/cancel/exit/square-off | FYERS order APIs | Write | Not present in the concrete client |
| Basket/multi-leg execution | Not implemented | Write | Unavailable |

Quotes are batched per futures snapshot. The symbol master is cached for six hours and fetched with three bounded attempts and backoff. Option-chain responses retain a five-second cache. Provider failures are sanitized; raw provider bodies and credentials are not logged.

## Futures

`FyersFuturesMarketDataAdapter` discovers non-expired NSE futures from the FYERS public symbol master rather than hard-coding a contract. `optType=XX` identifies futures; the adapter accepts index/equity aliases, sorts by expiry, and selects the nearest active contract unless the user chooses another discovered contract.

A normalized futures snapshot contains underlying, exchange, contract symbol, expiry, lot size, future and spot price, basis and percentage basis, premium/discount, OHLC, volume, open interest, previous OI, change in OI, days to expiry, 15-minute candles, local indicators, timestamp, freshness, sources, and interpretation limits. Missing provider fields remain `null`/Unavailable.

Deterministic F&O analysis can compare the verified future trend with the underlying, basis, expiry distance, and OI change. Conventional price/OI labels are explicitly described as interpretations and never treated as evidence of participant identity or intent. Conflicting inputs can return `NO CLEAR SETUP`.

## Actual TradingAgents integration

The optional dependency is pinned immutably to TradingAgents `v0.5.2`, commit `5eb50854dad299381861632aa34014448b4260fc`, rather than floating `main`. Upstream requires Python 3.11+, uses LangGraph 1.2+, supports parallel analysts, provider abstraction, structured output, retry/token limits, and checkpoint packages, and is Apache-2.0 licensed.

The application uses actual upstream code from:

- `tradingagents.llm_clients.factory.create_llm_client`
- `tradingagents.llm_clients.factory.build_llm_kwargs`
- `tradingagents.agents.structured.bind_structured`
- `tradingagents.agents.structured.invoke_structured`

It deliberately does not instantiate the upstream trading graph, trader, portfolio manager, memories, data vendors, checkpoint workflow, or execution nodes. Our `TradingAgentsAdapter` orchestrates Technical, Bull, Bear, Risk, and Final roles over our prepared snapshot. Quick mode uses Technical + Risk + Final, Standard uses all five roles, and Deep adds bounded counter-analysis rounds. The default is Standard.

All outputs pass strict Pydantic validation. Evidence references must resolve to the flattened snapshot, sources must be a subset of supplied sources, numeric claims must exist in the snapshot, and execution language is rejected. Timeout, malformed output, provider failure, or validation failure fails closed to local deterministic analysis.

`AI_ANALYSIS_ENABLED=false` by default. No LLM call occurs on startup, navigation, quote refresh, chart refresh, or WebSocket ticks. Only the explicit `Run AI Analysis` request sets `ai_requested=true`. Results are cached for five minutes by asset, instrument, horizon, depth, snapshot hash, and AI configuration fingerprint.

## Asset inputs

- Stocks: FYERS quote/history plus local SMA, EMA, RSI, MACD, Bollinger Bands, ATR, support/resistance, trend, and volume condition. Fundamentals/news/sentiment are Unavailable.
- F&O: underlying/option-chain statistics, PCR, OI concentration, supplied IV, strikes/expiry, and the verified futures snapshot. Missing Greeks are not fabricated.
- Crypto: Binance public 24-hour ticker and OHLCV klines plus local indicators. Corporate fundamentals, market cap, and circulating supply are Unavailable.

## Token encryption and migration

FYERS access/refresh tokens are encrypted at rest with Fernet authenticated encryption from `cryptography`. The encryption key is supplied only through `FYERS_TOKEN_ENCRYPTION_KEY`, or `FYERS_TOKEN_ENCRYPTION_KEYS=new,old` during rotation. It is not stored in the database. Runtime authentication rejects plaintext, unknown-key, or tampered ciphertext.

Migration workflow:

```powershell
python -m backend.migrate_tokens --dry-run
python -m backend.migrate_tokens --initialize-local-secrets
python -m backend.migrate_tokens
```

For SQLite, the command creates a timestamped `.bak` before mutation. It is idempotent and prints counts only, never token values. To rotate, configure `FYERS_TOKEN_ENCRYPTION_KEYS` with the new primary key first and old key second, run `python -m backend.migrate_tokens --rotate`, verify, then retire the old key. Backups contain the pre-migration database and must be protected/deleted under the user's retention policy.

## Session security and deployment scope

FYERS authorization codes are validated with a one-use OAuth state and exchanged only by the backend callback. The browser redirect carries a random 60-second one-use handoff, which is removed from browser history before it is consumed. The browser receives a signed, expiring application session containing user ID, purpose, timestamps, and a random `jti`; it never receives the FYERS access token or authorization code. Signature comparison is constant-time. Tampering and expiry are rejected. Logout revokes the `jti` for the life of that process.

The FYERS client and revocation set are process-local singletons, appropriate only for this current single-user local deployment. A multi-user or multi-worker deployment requires request/user-scoped FYERS clients, a user-scoped token resolver, and a shared revocation store such as a database/Redis. That refactor is intentionally deferred because it would be invasive and is not required for the local terminal.

## Provider and cost audit

| Component | Provider / endpoint | Authentication | Rate-limit handling | Cost / subscription status |
| --- | --- | --- | --- | --- |
| Indian stock/index/options data | FYERS v3 quote/history/depth/options APIs | Existing FYERS OAuth | Low polling, option cache, batching; Standard limits currently published as 10 req/s, 200 req/min, 100,000/day | No new paid data subscription; FYERS account/brokerage terms still apply |
| Futures metadata | FYERS public NSE FO symbol master | None | Six-hour cache, three bounded retries | Public/free endpoint; no card added |
| Futures quotes/history | FYERS v3 | Existing FYERS OAuth | Batched quotes; user-driven/60-second UI refresh | No new paid data subscription |
| Crypto | Binance public `/api/v3/ticker/24hr` and `/api/v3/klines` via market-data host | None | 60-second cache; reacts to 429/Retry-After via provider errors; no private endpoints | Public market-data endpoint; no key/card/subscription |
| Indicators/scoring/basis/PCR | Local Python | None | Local computation | Free/local |
| TradingAgents framework | Open-source package at pinned commit | None | Loaded only for explicit AI requests | Free software; transitive provider clients are installed but not invoked automatically |
| Local LLM | Ollama/OpenAI-compatible local endpoint | Local endpoint only | Timeout, retry, max-token caps, snapshot cache | Local/free software; user hardware/electricity applies |
| Hosted LLM | User-selected supported provider | Server-side provider key | Timeout, retry, max-token caps, snapshot cache | **Provider-dependent and may charge; never enabled automatically** |
| News, fundamentals, sentiment | No provider configured | None | Not applicable | Unavailable; no paid fallback |
| Database | Local SQLite | Local filesystem | Not applicable | Free/local |

FYERS limit source: <https://support.fyers.in/portal/en/kb/articles/is-fyers-prime-mandatory-to-trade-on-fyers>. Binance publishes route weights and IP-limit behavior at <https://developers.binance.com/en/docs/products/spot/rest-api>. Limits and pricing can change; re-check provider documentation before deployment.

## Remaining limitations

A fresh interactive FYERS OAuth login is required whenever the stored daily/session token expires; automated tests cannot replace live schema acceptance. The local environment has no configured LLM provider/model, so actual upstream imports and adapter behavior can be tested without incurring model cost, but real model inference requires the user to configure a local Ollama model or explicitly approved hosted provider. No paid data/research service is used.