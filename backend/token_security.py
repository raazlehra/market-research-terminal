"""Authenticated encryption for persisted broker tokens.

The encryption key is supplied separately through environment configuration.
Ciphertexts are versioned so plaintext rows and future formats cannot be
silently confused.
"""

from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken, MultiFernet


TOKEN_PREFIX = "enc:v1:"


class TokenEncryptionError(RuntimeError):
    """Raised when token encryption configuration or ciphertext is invalid."""


class PlaintextTokenError(TokenEncryptionError):
    """Raised when a legacy plaintext token is encountered at runtime."""


class TokenCipher:
    def __init__(self, keys: list[str]) -> None:
        cleaned = [key.strip() for key in keys if key and key.strip()]
        if not cleaned:
            raise TokenEncryptionError("FYERS token encryption key is not configured")
        try:
            self._fernet = MultiFernet([Fernet(key.encode("ascii")) for key in cleaned])
        except (ValueError, TypeError) as exc:
            raise TokenEncryptionError("FYERS token encryption key is invalid") from exc

    @classmethod
    def from_environment(cls) -> "TokenCipher":
        rotation_keys = os.getenv("FYERS_TOKEN_ENCRYPTION_KEYS", "")
        primary = os.getenv("FYERS_TOKEN_ENCRYPTION_KEY", "")
        keys = rotation_keys.split(",") if rotation_keys.strip() else [primary]
        return cls(keys)

    def encrypt(self, value: str) -> str:
        if not value:
            raise TokenEncryptionError("Cannot encrypt an empty broker token")
        if value.startswith(TOKEN_PREFIX):
            self.decrypt(value)
            return value
        ciphertext = self._fernet.encrypt(value.encode("utf-8")).decode("ascii")
        return f"{TOKEN_PREFIX}{ciphertext}"

    def decrypt(self, value: str) -> str:
        if not value.startswith(TOKEN_PREFIX):
            raise PlaintextTokenError("Legacy plaintext broker token requires migration")
        try:
            return self._fernet.decrypt(value[len(TOKEN_PREFIX):].encode("ascii")).decode("utf-8")
        except (InvalidToken, UnicodeDecodeError, ValueError) as exc:
            raise TokenEncryptionError("Stored broker token cannot be decrypted") from exc

    def rotate(self, value: str) -> str:
        if not value.startswith(TOKEN_PREFIX):
            return self.encrypt(value)
        try:
            rotated = self._fernet.rotate(value[len(TOKEN_PREFIX):].encode("ascii")).decode("ascii")
        except (InvalidToken, ValueError) as exc:
            raise TokenEncryptionError("Stored broker token cannot be rotated") from exc
        return f"{TOKEN_PREFIX}{rotated}"
