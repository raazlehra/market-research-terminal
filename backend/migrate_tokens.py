"""Safely migrate FYERS broker tokens to authenticated encryption.

Examples:
    python -m backend.migrate_tokens --dry-run
    python -m backend.migrate_tokens --initialize-local-secrets
    python -m backend.migrate_tokens --rotate

The command never prints key or token material. SQLite databases are copied to
an ignored ``.bak`` file before any mutation.
"""

from __future__ import annotations

import argparse
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv

from .token_security import TOKEN_PREFIX, TokenCipher


def _append_missing_local_secrets(env_path: Path) -> list[str]:
    env_path.parent.mkdir(parents=True, exist_ok=True)
    existing = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    names = {
        line.split("=", 1)[0].strip()
        for line in existing.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    additions: list[tuple[str, str]] = []
    if "FYERS_TOKEN_ENCRYPTION_KEY" not in names:
        additions.append(("FYERS_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode("ascii")))
    if "APP_SESSION_SECRET" not in names:
        additions.append(("APP_SESSION_SECRET", secrets.token_urlsafe(48)))
    if additions:
        separator = "" if not existing or existing.endswith("\n") else "\n"
        with env_path.open("a", encoding="utf-8") as handle:
            handle.write(separator)
            handle.write("\n# Local security material. Never commit or share.\n")
            for name, value in additions:
                handle.write(f"{name}={value}\n")
    return [name for name, _ in additions]


def _sqlite_path(database_url: str) -> Path | None:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return None
    return Path(database_url[len(prefix):]).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description="Encrypt or rotate stored FYERS tokens")
    parser.add_argument("--dry-run", action="store_true", help="Report counts without modifying data")
    parser.add_argument("--rotate", action="store_true", help="Re-encrypt encrypted rows using the primary key")
    parser.add_argument("--initialize-local-secrets", action="store_true", help="Create missing ignored local keys")
    parser.add_argument("--env-file", default="backend/.env", help="Ignored local environment file")
    args = parser.parse_args()

    env_path = Path(args.env_file).resolve()
    initialized: list[str] = []
    if args.initialize_local_secrets:
        initialized = _append_missing_local_secrets(env_path)
    load_dotenv(env_path, override=True)

    from . import models
    from .database import DATABASE_URL, SessionLocal

    db = SessionLocal()
    try:
        accounts = db.query(models.BrokerAccount).filter_by(broker="fyers").all()
        plaintext = sum(
            1
            for account in accounts
            for value in (account.access_token, account.refresh_token)
            if value and not value.startswith(TOKEN_PREFIX)
        )
        encrypted = sum(
            1
            for account in accounts
            for value in (account.access_token, account.refresh_token)
            if value and value.startswith(TOKEN_PREFIX)
        )
        print(f"accounts={len(accounts)} plaintext_tokens={plaintext} encrypted_tokens={encrypted}")
        if args.dry_run:
            return 0

        cipher = TokenCipher.from_environment()
        sqlite_path = _sqlite_path(DATABASE_URL)
        if sqlite_path and sqlite_path.exists() and (plaintext or (args.rotate and encrypted)):
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup = sqlite_path.with_name(f"{sqlite_path.name}.pre-token-encryption-{stamp}.bak")
            shutil.copy2(sqlite_path, backup)
            print(f"backup_created={backup.name}")

        changed = 0
        for account in accounts:
            for field in ("access_token", "refresh_token"):
                value = getattr(account, field)
                if not value:
                    continue
                replacement = cipher.rotate(value) if args.rotate else cipher.encrypt(value)
                if replacement != value:
                    setattr(account, field, replacement)
                    changed += 1
                else:
                    cipher.decrypt(value)
        db.commit()
        print(f"tokens_changed={changed} initialized_names={','.join(initialized) or 'none'}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
