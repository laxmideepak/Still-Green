"""Start the real daemon or control server against the fake Slack.

Used only by the end-to-end tests. The caller sets ``SG_LOCAL_CONFIG_DIR`` and
``SG_LOCAL_STATE_DIR`` to a temporary folder before starting this script, so
nothing touches the real user's configuration.

    python tests/e2e/launch.py web    --api-base URL --ws-url URL --port 8799
    python tests/e2e/launch.py daemon --api-base URL --ws-url URL

The Slack endpoints are swapped by patching module attributes in this test
process only; the product code has no switch for it.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sg_local import daemon, slack, web  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["web", "daemon"])
    parser.add_argument("--api-base", required=True)
    parser.add_argument("--ws-url", required=True)
    parser.add_argument("--port", type=int, default=0)
    # The control server only counts a PID as the daemon when its command line
    # contains "sg_local.daemon" (see state.DAEMON_MARKER), so the tests pass
    # "--label sg_local.daemon" for the daemon process.
    parser.add_argument("--label", default="")
    args = parser.parse_args()

    slack.API_BASE = args.api_base
    slack.WS_URL = args.ws_url
    # Short timers so the tests see state changes in seconds, not minutes.
    slack.PresenceSession.PRESENCE_INTERVAL = 1.0
    slack.PresenceSession.RECONNECT_MIN = 0.5
    daemon.RECONCILE_INTERVAL = 0.5
    daemon.STATE_WRITE_INTERVAL = 0.0

    if args.mode == "web":
        web.serve("127.0.0.1", args.port)
        return 0
    return daemon.main()


if __name__ == "__main__":
    raise SystemExit(main())
