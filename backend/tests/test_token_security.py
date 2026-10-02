import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base
from backend.models import BrokerAccount, User
from backend.token_security import PlaintextTokenError, TokenCipher, TokenEncryptionError


class TokenSecurityTests(unittest.TestCase):
    def test_encrypts_and_decrypts_without_exposing_plaintext(self) -> None:
        key = Fernet.generate_key().decode()
        with patch.dict(os.environ, {"FYERS_TOKEN_ENCRYPTION_KEY": key}, clear=False):
            cipher = TokenCipher.from_environment()
            encrypted = cipher.encrypt("sensitive-broker-token")
            self.assertTrue(encrypted.startswith("enc:v1:"))
            self.assertNotIn("sensitive-broker-token", encrypted)
            self.assertEqual(cipher.decrypt(encrypted), "sensitive-broker-token")
            self.assertEqual(cipher.encrypt(encrypted), encrypted, "migration must be idempotent")

    def test_plaintext_tampering_and_invalid_key_fail_closed(self) -> None:
        key = Fernet.generate_key().decode()
        cipher = TokenCipher([key])
        encrypted = cipher.encrypt("secret")
        with self.assertRaises(PlaintextTokenError):
            cipher.decrypt("legacy-plaintext")
        with self.assertRaises(TokenEncryptionError):
            cipher.decrypt(encrypted[:-1] + ("A" if encrypted[-1] != "A" else "B"))
        with self.assertRaises(TokenEncryptionError):
            TokenCipher(["not-a-fernet-key"])

    def test_key_rotation_reads_old_ciphertext_and_writes_with_new_primary(self) -> None:
        old_key = Fernet.generate_key().decode()
        new_key = Fernet.generate_key().decode()
        old_ciphertext = TokenCipher([old_key]).encrypt("secret")
        rotating = TokenCipher([new_key, old_key])
        rotated = rotating.rotate(old_ciphertext)
        self.assertEqual(rotating.decrypt(rotated), "secret")
        with self.assertRaises(TokenEncryptionError):
            TokenCipher([old_key]).decrypt(rotated)

    def test_migration_cli_backs_up_encrypts_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database_path = root / "migration.db"
            database_url = f"sqlite:///{database_path.as_posix()}"
            engine = create_engine(database_url)
            Base.metadata.create_all(engine)
            Session = sessionmaker(bind=engine)
            db = Session()
            user = User(fy_id="migration-user", name="Migration")
            db.add(user)
            db.flush()
            db.add(BrokerAccount(user_id=user.id, broker="fyers", access_token="legacy-sensitive-token"))
            db.commit()
            db.close()
            engine.dispose()

            env_file = root / ".env"
            env_file.write_text("", encoding="utf-8")
            environment = os.environ.copy()
            environment.update({
                "DATABASE_URL": database_url,
                "FYERS_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(),
                "APP_SESSION_SECRET": "test-session-secret-that-is-long-enough-for-tests",
            })
            command = [sys.executable, "-m", "backend.migrate_tokens", "--env-file", str(env_file)]
            project_root = Path(__file__).resolve().parents[2]
            first = subprocess.run(command, cwd=project_root, env=environment, capture_output=True, text=True, check=True)
            self.assertIn("tokens_changed=1", first.stdout)
            self.assertEqual(len(list(root.glob("*.bak"))), 1)
            connection = sqlite3.connect(database_path)
            stored = connection.execute("select access_token from broker_accounts").fetchone()[0]
            connection.close()
            self.assertTrue(stored.startswith("enc:v1:"))
            self.assertNotIn("legacy-sensitive-token", stored)

            second = subprocess.run(command, cwd=project_root, env=environment, capture_output=True, text=True, check=True)
            self.assertIn("tokens_changed=0", second.stdout)

if __name__ == "__main__":
    unittest.main()
