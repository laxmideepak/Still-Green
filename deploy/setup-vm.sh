#!/bin/sh
# Set up Stillgreen on a fresh Debian or Ubuntu server (for example a free
# Google Cloud e2-micro or Oracle Cloud VM), with HTTPS from Let's Encrypt.
#
#   git clone https://github.com/laxmideepak/slack.git && cd slack
#   sudo sh deploy/setup-vm.sh                 # uses <ip>.sslip.io as the name
#   sudo sh deploy/setup-vm.sh my.domain.com   # or your own domain
#
# Ports 80 and 443 must be open to the internet (on Google Cloud, tick
# "Allow HTTP traffic" and "Allow HTTPS traffic" when creating the VM).
set -eu

if [ "$(id -u)" -ne 0 ]; then
    echo "Run this with sudo: sudo sh deploy/setup-vm.sh" >&2
    exit 1
fi

REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO_DIR"

DOMAIN=${1:-}
if [ -z "$DOMAIN" ]; then
    IP=$(curl -fsS --max-time 10 https://api.ipify.org || true)
    case "$IP" in
        *.*.*.*) DOMAIN="$(echo "$IP" | tr . -).sslip.io" ;;
        *) echo "Could not find this server's public IP; pass a domain: sudo sh deploy/setup-vm.sh my.domain.com" >&2
           exit 1 ;;
    esac
fi
case "$DOMAIN" in
    *[!A-Za-z0-9.-]*|"") echo "Not a valid domain: $DOMAIN" >&2; exit 1 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker (official script from get.docker.com)..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    rm -f /tmp/get-docker.sh
fi

# Keep the .env private: it names the domain and any extra settings.
umask 077
if [ -f .env ] && grep -q '^STILLGREEN_DOMAIN=' .env; then
    sed -i "s/^STILLGREEN_DOMAIN=.*/STILLGREEN_DOMAIN=$DOMAIN/" .env
else
    echo "STILLGREEN_DOMAIN=$DOMAIN" >> .env
fi

echo "Starting Stillgreen for https://$DOMAIN ..."
docker compose up -d --build

echo "Waiting for the daemon..."
i=0
until docker compose exec -T stillgreen python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3)" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then
        echo "The daemon did not start; see: docker compose logs stillgreen" >&2
        exit 1
    fi
    sleep 2
done

CODE=$(docker compose exec -T stillgreen sg-local web --show-code | tr -d '\r')
cat <<EOF

Stillgreen is running.

  Daemon URL:   https://$DOMAIN
  Access code:  $CODE

Use these two values in the dashboard (https://stillgreen.vercel.app/dashboard,
"Connect daemon") and in the browser extension. The HTTPS certificate can take
a minute to appear the first time.

Useful commands (run in $REPO_DIR):
  sudo docker compose logs -f stillgreen                  follow the log
  sudo docker compose exec stillgreen sg-local status     show status
  git pull && sudo docker compose up -d --build           update
EOF
