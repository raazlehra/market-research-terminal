# Contributing to Market Research Terminal

Thank you for helping improve Market Research Terminal. Keep contributions focused, testable, and consistent with the project's published read-only scope.

## Project Principles

Contributions must preserve:

- The local-first architecture.
- The read-only market-research model and absence of live order placement.
- No broker or exchange mutation path.
- Explicit user initiation for optional AI analysis.
- Deterministic analysis that remains usable without AI.
- Separation between broker credentials and the AI worker.
- Simulation-only execution in paper and historical backtesting features.

A pull request that adds live trading or order execution will not be accepted unless the maintainer intentionally changes the project's published scope in a future decision. Under the current scope, do not introduce place-order, modify-order, cancel-order, square-off, or exit-position APIs; Binance account, wallet, or trading credentials; or automatic AI-triggered trade execution.

## Development Setup

See the [README](README.md) for complete setup and runtime instructions. Contributors should use:

- Python 3.11, the validated Windows runtime.
- A Node.js version supported by the current Vite requirements (`20.19+` or `22.12+`).
- `backend/requirements-dev.txt` for normal backend development, linting, and tests.
- `backend/requirements-ai.txt` only in a separate optional AI-worker environment.

Never combine the main backend and AI dependency environments. FYERS 3.1.18 requires `requests==2.31.0`, while the pinned TradingAgents dependency requires `requests>=2.32.4`.

## Branch and Pull Request Workflow

The `main` branch is protected. For each contribution:

1. Create a focused feature or fix branch from current `main`.
2. Make the smallest coherent change.
3. Run the relevant local validation.
4. Push the branch without force-pushing `main`.
5. Open a pull request targeting `main`.
6. Wait for CI and address genuine failures without weakening validation.
7. Merge only after the required checks pass.

The required GitHub Actions checks are `backend`, `ai-environment`, and `frontend`. Contributors cannot assume branch-protection bypass access.

## Local Validation

Run the checks relevant to the change from the repository root.

Backend environment:

```bash
python -m pip check
python -m compileall -q backend
python -m ruff check backend
python -m pytest backend/tests -q
```

Frontend:

```bash
npm ci
npm audit --audit-level=low
npx tsc --noEmit
npm run build
```

Separate AI environment:

```bash
python -m pip check
```

Ordinary contribution validation should not require a paid hosted model. Do not run expensive local Ollama inference unless a change genuinely requires it, and never put real credentials into tests.

## Testing Expectations

- Add regression coverage for behavioral fixes where practical.
- Keep existing tests green; do not weaken tests merely to make CI pass.
- Do not add broad skips or `xfail` markers without a clear justification.
- Prefer deterministic, offline fixtures for external providers.
- Never perform live broker mutation during tests.
- Never use real FYERS, Binance, LLM-provider, or other service secrets in tests.

## Security and Secrets

Never commit `.env` files, API keys, tokens, database files, account data, model binaries, generated datasets or caches, `node_modules`, virtual environments, build output, or private logs.

Report vulnerabilities according to [SECURITY.md](SECURITY.md), using GitHub Private Vulnerability Reporting rather than a public issue containing technical exploit details.

## Dependencies

Avoid unnecessary dependencies. For any new dependency:

- Explain why it is required.
- Verify license compatibility with the project.
- Prefer an actively maintained dependency.
- Preserve the intentional separation between the backend and AI Python environments.

For TradingAgents-related changes, preserve the existing immutable revision strategy unless a deliberate dependency upgrade is under review.

## Pull Request Quality

Pull requests should be focused, clearly described, tested, and free of unrelated formatting or refactoring noise. When relevant, explain the security and read-only implications of the change.
