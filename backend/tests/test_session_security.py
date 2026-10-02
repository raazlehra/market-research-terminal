import unittest
import uuid
from unittest.mock import patch

from backend.security import issue_session_token, revoke_session_token, verify_session_token


class SessionSecurityTests(unittest.TestCase):
    def test_session_token_is_signed_and_contains_no_broker_token(self) -> None:
        user_id = str(uuid.uuid4())
        broker_token = "very-sensitive-fyers-access-token"
        session = issue_session_token(user_id)
        self.assertNotEqual(session, broker_token)
        self.assertNotIn(broker_token, session)
        claims = verify_session_token(session)
        self.assertIsNotNone(claims)
        self.assertEqual(claims["sub"], user_id)
        self.assertEqual(claims["purpose"], "market-viewer")

    def test_tampered_session_token_is_rejected(self) -> None:
        session = issue_session_token(str(uuid.uuid4()))
        encoded, signature = session.split(".", 1)
        replacement = "A" if signature[-1] != "A" else "B"
        self.assertIsNone(verify_session_token(f"{encoded}.{signature[:-1]}{replacement}"))

    def test_expired_session_token_is_rejected(self) -> None:
        with patch("backend.security._SESSION_TTL_SECONDS", -1):
            session = issue_session_token(str(uuid.uuid4()))
        self.assertIsNone(verify_session_token(session))

    def test_logout_revocation_invalidates_session(self) -> None:
        session = issue_session_token(str(uuid.uuid4()))
        self.assertIsNotNone(verify_session_token(session))
        self.assertTrue(revoke_session_token(session))
        self.assertIsNone(verify_session_token(session))
        self.assertFalse(revoke_session_token(session))


if __name__ == "__main__":
    unittest.main()