"""Tests for the Slack presence session, with no network access."""

from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest import mock

from sg_local.slack import (
    PresenceSession,
    SlackAPIError,
    presence_kind,
    redact,
)
from websockets.exceptions import InvalidStatus


async def until(check, timeout: float = 5.0) -> None:
    """Wait until check() is true. A fixed short sleep failed on busy CI
    runners, where the session had not got that far yet."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not check():
        if loop.time() > deadline:
            raise AssertionError("the session did not get there in time")
        await asyncio.sleep(0.01)


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed = False
        self._stop = asyncio.Event()

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))

    async def close(self) -> None:
        self.closed = True
        self._stop.set()

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        yield json.dumps({"type": "hello"})
        await self._stop.wait()
        yield json.dumps({"type": "goodbye"})


def workspace() -> dict:
    return {
        "name": "Test",
        "team_id": "T123",
        "user_id": "U123",
        "xoxc": "xoxc-secret-token",
        "xoxd": "xoxd-secret-cookie",
    }


class RedactionTests(unittest.TestCase):
    def test_redacts_known_and_shaped_tokens(self) -> None:
        text = "xoxc-abc123 xoxd-def456 xoxp-other and secret"
        cleaned = redact(text, "secret")
        self.assertNotIn("xoxc-", cleaned)
        self.assertNotIn("xoxd-", cleaned)
        self.assertNotIn("xoxp-", cleaned)
        self.assertNotIn("secret", cleaned)


class PresenceKindTests(unittest.TestCase):
    def test_kinds(self) -> None:
        self.assertEqual(presence_kind({"ok": True, "presence": "active"}), "active")
        self.assertEqual(presence_kind({"ok": True, "presence": "away"}), "away")
        self.assertEqual(
            presence_kind({"ok": True, "presence": "away", "auto_away": True}),
            "auto_away",
        )
        self.assertEqual(
            presence_kind({"ok": True, "presence": "away", "manual_away": True}),
            "manual_away",
        )
        self.assertEqual(presence_kind({"ok": False, "error": "x"}), "unknown")
        self.assertEqual(presence_kind(None), "unknown")


class PresenceSessionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.originals = {
            name: getattr(PresenceSession, name)
            for name in ("PING_INTERVAL", "TICKLE_INTERVAL", "PRESENCE_INTERVAL", "LOOP_INTERVAL")
        }
        PresenceSession.PING_INTERVAL = 0.01
        PresenceSession.TICKLE_INTERVAL = 0.02
        PresenceSession.PRESENCE_INTERVAL = 0.01
        PresenceSession.LOOP_INTERVAL = 0.005
        self.fake = FakeWebSocket()

    def tearDown(self) -> None:
        for name, value in self.originals.items():
            setattr(PresenceSession, name, value)

    async def _run_session(self, seconds: float = 0.12) -> PresenceSession:
        session = PresenceSession(workspace())
        task = asyncio.create_task(session.run())
        await asyncio.sleep(seconds)
        await session.stop()
        await asyncio.wait_for(task, timeout=3)
        return session

    async def test_ping_tickle_and_presence(self) -> None:
        session = PresenceSession(workspace())
        session.client.get_presence = lambda user_id="": {  # type: ignore[method-assign]
            "ok": True,
            "presence": "active",
        }
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await until(lambda: session.ping_count >= 1 and session.tickle_count >= 1 and session.presence_checks >= 1)
            await session.stop()
            await asyncio.wait_for(task, timeout=3)

        kinds = [message.get("type") for message in self.fake.sent]
        self.assertIn("ping", kinds)
        self.assertIn("tickle", kinds)
        self.assertGreaterEqual(session.ping_count, 1)
        self.assertGreaterEqual(session.tickle_count, 1)
        self.assertGreaterEqual(session.presence_checks, 1)
        self.assertEqual(session.status, "stopped")
        self.assertFalse(session.invalid_token)
        self.assertTrue(self.fake.closed)

    async def test_manual_away_is_not_overridden(self) -> None:
        session = PresenceSession(workspace())
        session.client.get_presence = lambda user_id="": {  # type: ignore[method-assign]
            "ok": True,
            "presence": "away",
            "manual_away": True,
        }
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await until(lambda: session.status == "manual_away")
            self.assertEqual(session.status, "manual_away")
            self.assertEqual(session.connections, 1)
            await session.stop()
            await asyncio.wait_for(task, timeout=3)

    async def test_away_reconnects(self) -> None:
        session = PresenceSession(workspace())
        session.client.get_presence = lambda user_id="": {  # type: ignore[method-assign]
            "ok": True,
            "presence": "away",
        }
        session._drop_ws = mock.AsyncMock()  # type: ignore[method-assign]
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await until(lambda: session._drop_ws.await_count >= 1)  # type: ignore[attr-defined]
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        session._drop_ws.assert_awaited()  # type: ignore[attr-defined]

    async def test_invalid_token_stops_session(self) -> None:
        session = PresenceSession(workspace())

        def rejected(user_id: str = "") -> dict:
            raise SlackAPIError("invalid_auth", token_invalid=True)

        session.client.get_presence = rejected  # type: ignore[method-assign]
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await asyncio.wait_for(task, timeout=3)
        self.assertTrue(session.invalid_token)
        self.assertEqual(session.status, "invalid_token")
        self.assertIn("rejected", session.last_error or "")

    async def test_401_handshake_marks_invalid(self) -> None:
        session = PresenceSession(workspace())
        response = SimpleNamespace(status_code=401, reason_phrase="Unauthorized", headers={})
        with mock.patch(
            "sg_local.slack.websockets.connect",
            mock.AsyncMock(side_effect=InvalidStatus(response)),
        ), mock.patch.object(
            session.client,
            "auth_test",
            side_effect=SlackAPIError("invalid_auth", token_invalid=True),
        ):
            task = asyncio.create_task(session.run())
            await asyncio.wait_for(task, timeout=3)
        self.assertTrue(session.invalid_token)
        self.assertEqual(session.status, "invalid_token")

    async def test_4xx_handshake_with_valid_tokens_keeps_retrying(self) -> None:
        # A proxy or captive portal can answer 403; auth.test says the tokens
        # are fine, so the session must not give up on them.
        session = PresenceSession(workspace())
        session._reconnect_delay = 0.01
        response = SimpleNamespace(status_code=403, reason_phrase="Forbidden", headers={})
        connect = mock.AsyncMock(side_effect=InvalidStatus(response))
        with mock.patch("sg_local.slack.websockets.connect", connect), mock.patch.object(
            session.client, "auth_test", return_value={"ok": True}
        ):
            task = asyncio.create_task(session.run())
            await until(lambda: connect.await_count >= 2)
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        self.assertFalse(session.invalid_token)

    async def test_failed_connection_retries(self) -> None:
        session = PresenceSession(workspace())
        session._reconnect_delay = 0.01
        calls = 0

        async def fail(*args, **kwargs):
            nonlocal calls
            calls += 1
            raise OSError("network down")

        with mock.patch("sg_local.slack.websockets.connect", side_effect=fail):
            task = asyncio.create_task(session.run())
            await until(lambda: calls >= 2)
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        self.assertGreaterEqual(calls, 2)
        self.assertGreaterEqual(session.reconnects, 0)

    async def test_active_presence_is_verified_and_reported(self) -> None:
        session = PresenceSession(workspace())
        session.client.get_presence = lambda user_id="": {"ok": True, "presence": "active"}  # type: ignore[method-assign]
        self.assertIsNone(session.snapshot()["presence_verified_at"])
        self.assertEqual(session.snapshot()["auth"], "unknown")
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await until(lambda: session.snapshot()["presence_verified_at"] is not None)
            live = session.snapshot()
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        self.assertEqual(live["auth"], "ok")
        self.assertEqual(live["presence"], "active")
        self.assertIsNotNone(live["presence_verified_at"])
        self.assertIsNotNone(session.slack_ok_at)
        # After the connection closes the current presence is unknown, but the
        # last confirmation is kept.
        after = session.snapshot()
        self.assertEqual(after["presence"], "unknown")
        self.assertEqual(after["presence_verified_at"], live["presence_verified_at"])

    async def test_away_is_not_verified(self) -> None:
        session = PresenceSession(workspace())
        session.client.get_presence = lambda user_id="": {"ok": True, "presence": "away", "manual_away": True}  # type: ignore[method-assign]
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await until(lambda: session.snapshot()["presence"] == "manual_away")
            live = session.snapshot()
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        self.assertEqual(live["presence"], "manual_away")
        self.assertIsNone(live["presence_verified_at"])

    async def test_errors_are_stored_with_a_catalogue_code(self) -> None:
        session = PresenceSession(workspace())
        session._reconnect_delay = 0.01

        async def refused(*args, **kwargs):
            raise ConnectionRefusedError(111, "Connection refused xoxc-secret-token")

        with mock.patch("sg_local.slack.websockets.connect", side_effect=refused):
            task = asyncio.create_task(session.run())
            await until(lambda: session.snapshot()["last_error_code"] == "network_unreachable")
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        snap = session.snapshot()
        self.assertEqual(snap["last_error_code"], "network_unreachable")
        self.assertNotIn("xoxc-secret-token", snap["last_error"])
        self.assertIsNotNone(session.slack_fail_at)
        self.assertEqual(session.slack_fail_code, "network_unreachable")

    async def test_rejected_tokens_set_auth_and_code(self) -> None:
        session = PresenceSession(workspace())

        def rejected(user_id: str = "") -> dict:
            raise SlackAPIError("invalid_auth", token_invalid=True)

        session.client.get_presence = rejected  # type: ignore[method-assign]
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            await asyncio.wait_for(asyncio.create_task(session.run()), timeout=3)
        snap = session.snapshot()
        self.assertEqual(snap["auth"], "rejected")
        self.assertEqual(snap["last_error_code"], "slack_auth_rejected")

    async def test_a_good_answer_clears_an_old_problem(self) -> None:
        session = PresenceSession(workspace())
        answers = iter([SlackAPIError("Network timeout contacting Slack", cause=TimeoutError())])

        def presence(user_id: str = "") -> dict:
            for answer in answers:
                raise answer
            return {"ok": True, "presence": "active"}

        session.client.get_presence = presence  # type: ignore[method-assign]
        with mock.patch("sg_local.slack.websockets.connect", mock.AsyncMock(return_value=self.fake)):
            task = asyncio.create_task(session.run())
            await until(lambda: session.presence_verified_at is not None and session.last_error is None)
            await session.stop()
            await asyncio.wait_for(task, timeout=3)
        self.assertIsNone(session.last_error)
        self.assertIsNone(session.snapshot()["last_error_code"])
        self.assertIsNotNone(session.presence_verified_at)


if __name__ == "__main__":
    unittest.main()
