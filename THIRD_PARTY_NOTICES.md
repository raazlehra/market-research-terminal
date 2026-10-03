# Third-Party Notices

This file records third-party software attribution. The original Market Research Terminal project code is licensed separately under the root [Apache License 2.0](LICENSE).

Copyright 2026 Rajendra Kumar

## TradingAgents

- Project: TradingAgents
- Repository: <https://github.com/TauricResearch/TradingAgents>
- Version: `0.5.2`
- Pinned commit: `5eb50854dad299381861632aa34014448b4260fc`
- License: Apache License 2.0
- License text: <https://github.com/TauricResearch/TradingAgents/blob/5eb50854dad299381861632aa34014448b4260fc/LICENSE>

TradingAgents is an external dependency and is not authored by this project's maintainer. It is installed from the immutable Git revision declared in `backend/requirements-ai.txt`; its source tree and model weights are not vendored into this repository.

This application imports selected upstream LLM-client and structured-output helpers. It does not claim authorship of the TradingAgents framework.

## Direct application dependencies

The application also depends on packages installed through `backend/requirements.txt`, `backend/requirements-ai.txt`, and `package-lock.json`. Major direct dependencies include:

| Dependency | Role | Declared license |
| --- | --- | --- |
| FastAPI | Backend web framework | MIT |
| HTTPX | HTTP client | BSD-3-Clause |
| Pydantic | Validation and structured models | MIT |
| SQLAlchemy | Database toolkit | MIT |
| Uvicorn | ASGI server | BSD-3-Clause |
| cryptography | Fernet token encryption | Apache-2.0 OR BSD-3-Clause |
| tzdata | IANA timezone data | Apache-2.0 |
| fyers-apiv3 | Optional FYERS WebSocket/runtime SDK on supported Python versions | MIT |
| React / React DOM | Frontend framework | MIT |
| React Router | Frontend routing | MIT |
| TanStack Query | Frontend data fetching/cache | MIT |
| Recharts | Charts | MIT |
| Zustand | Frontend state management | MIT |
| Lucide React | Icons | ISC |
| Tailwind CSS | Styling toolchain | MIT |
| TypeScript | Type checking/compiler | Apache-2.0 |
| Vite | Frontend build tool | MIT |

Each dependency and its transitive dependencies remain governed by their own license terms. Package metadata and upstream license files are authoritative; this summary is provided for attribution and release review, not as legal advice.
