# Security Policy

## Supported Versions

Market Research Terminal does not yet have a stable tagged public release. Security fixes target the current development state on `main`.

| Version | Supported |
| --- | --- |
| Current `main` | Yes |
| Older or unmaintained snapshots | No |

## Reporting a Vulnerability

Please use GitHub Private Vulnerability Reporting for security issues:

**Security → Advisories → Report a vulnerability**

Do not open a public GitHub issue containing exploit details, credentials, tokens, or sensitive account information. Include enough detail in the private report to explain the affected component, impact, reproduction conditions, and any suggested mitigation.

## What to Report

Relevant reports include:

- Authentication or session bypasses.
- Exposure of FYERS tokens, credentials, or encryption material.
- Token-encryption, rotation, or storage flaws.
- Ways to bypass the application's read-only protections.
- Any path that could reach broker or exchange mutation functionality.
- Unauthorized access to locally stored information.
- Command or code execution vulnerabilities.
- Bypasses of the AI worker's credential and execution trust boundaries.
- Dependency or supply-chain issues with meaningful security impact.
- Secret leakage through logs, API responses, frontend bundles, or repository files.

## Out of Scope

The following are not security vulnerabilities by themselves:

- Market prediction accuracy, AI signal quality, or trading profitability.
- Expected market-data provider downtime.
- Unsupported Python versions.
- Performance issues without security impact.
- Feature requests and ordinary UI bugs.

## Sensitive Information

Never include FYERS tokens or secrets, API keys, `APP_SESSION_SECRET`, `FYERS_TOKEN_ENCRYPTION_KEY`, OpenRouter or other provider keys, account credentials, or personal financial/account information in public issues, screenshots, logs, or pull requests.

## Disclosure Expectations

The maintainer will review good-faith reports as availability permits and will coordinate disclosure when appropriate. This project does not promise response or remediation deadlines, bounty payments, guaranteed fixes, or CVE assignment.
