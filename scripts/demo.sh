#!/usr/bin/env bash
# Demo launcher: build, start the server with a host key, and print the links.
#   scripts/demo.sh            local only (this Mac, and your tailnet if `tailscale serve` points at it)
#   scripts/demo.sh --public   also opens the public Tailscale Funnel link on port 8443
#   scripts/demo.sh --stop     stop the server and close the public link
# Only a device that opened the host link once can start events. Anyone with a room's QR or link can join it.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${GMS_PORT:-8790}"
TS="${TAILSCALE_BIN:-/Applications/Tailscale.app/Contents/MacOS/Tailscale}"
KEYFILE=".demo-host-key" # gitignored; a throwaway passphrase, not a login for anything
LOG="${TMPDIR:-/tmp}/gms-demo.log"

stop_server() {
  if lsof -ti "tcp:$PORT" >/dev/null 2>&1; then lsof -ti "tcp:$PORT" | xargs kill; sleep 0.5; fi
}

if [ "${1:-}" = "--stop" ]; then
  "$TS" funnel --https=8443 off >/dev/null 2>&1 || true
  stop_server
  echo "Stopped. The public link is closed."
  exit 0
fi

if [ ! -s "$KEYFILE" ]; then (umask 077; openssl rand -base64 18 | tr '+/' '-_' | tr -d '=\n' > "$KEYFILE"); fi
KEY="$(cat "$KEYFILE")"

npm run build >/dev/null
stop_server
BUILD="$(git rev-parse --short HEAD 2>/dev/null || date +%s)" # new build id means testers see the test mission again
GMS_BUILD="$BUILD" NODE_ENV=production GMS_PORT="$PORT" GMS_HOST_KEY="$KEY" nohup node server/index.ts >"$LOG" 2>&1 &
sleep 1.5
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "Server did not start. See $LOG"; exit 1; }

DNS="$("$TS" status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' || true)"
echo "Server is up on port $PORT (log: $LOG)"
echo "Host link on this Mac:   http://127.0.0.1:$PORT/?host=$KEY"

if [ "${1:-}" = "--public" ]; then
  [ -n "$DNS" ] || { echo "Tailscale is not running, cannot open the public link."; exit 1; }
  "$TS" funnel --bg --https=8443 "http://localhost:$PORT"
  echo "Public link:             https://$DNS:8443/"
  echo "Host link for your phone: https://$DNS:8443/?host=$KEY"
elif [ -n "$DNS" ]; then
  echo "Tailnet-only link:       https://$DNS:8443/  (run with --public to open it to everyone)"
fi
