"""Start the real daemon or control server against the fake Slack.

Used only by the end-to-end tests. The caller sets ``SG_LOCAL_CONFIG_DIR`` and
``SG_LOCAL_STATE_DIR`` to a temporary folder before starting this script, so
nothing touches the real user's configuration.

    python tests/e2e/launch.py web    --api-base URL --ws-url URL --port 8799
    python tests/e2e/launch.py daemon --api-base URL --ws-url URL

The Slack endpoints are swapped by patching module attributes in this test
process only; the product code has no switch for it.

With ``--listen-fd N`` the control page serves on a socket the test harness
already bound and passed in, instead of binding the port again. The port is
then never free between the harness choosing it and the server using it, so
nothing else can take it.
"""

from __future__ import annotations

import argparse
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sg_local import daemon, slack, web  # noqa: E402


def adopt_listener(fd: int) -> None:
    """Make web.make_server use the inherited listening socket ``fd``."""
    sock = socket.socket(fileno=fd)

    def make_server(host: str, port: int) -> web.ControlServer:
        server_class = web.ControlServer6 if sock.family == socket.AF_INET6 else web.ControlServer
        server = server_class(sock.getsockname()[:2], web.Handler, bind_and_activate=False)
        server.socket.close()
        server.socket = sock
        server.server_address = sock.getsockname()
        return server

    web.make_server = make_server


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
    parser.add_argument("--listen-fd", type=int)
    args = parser.parse_args()
    if args.listen_fd is not None:
        adopt_listener(args.listen_fd)

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
