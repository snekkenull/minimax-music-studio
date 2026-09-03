#!/usr/bin/env bash
# POSIX launcher for macOS / Linux. Used by start.command on macOS, and
# runnable directly on any POSIX system. Verifies Node.js is available
# and starts the local proxy.
#
# Honors: PORT (default 8787), HOST (default 127.0.0.1)
#
# This script lives at the package root (the same directory as proxy.js).
# It is runnable in place — no path discovery needed.

set -euo pipefail

# ── Resolve script directory (handles symlinks) ──────────────────────
SCRIPT="$0"
while [ -L "$SCRIPT" ]; do
  TARGET=$(readlink "$SCRIPT")
  case "$TARGET" in
    /*) SCRIPT="$TARGET" ;;
    *)  SCRIPT="$(dirname "$SCRIPT")/$TARGET" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT")" && pwd)"
PACKAGE_ROOT="$SCRIPT_DIR"

if [ ! -f "$PACKAGE_ROOT/proxy.js" ]; then
  echo "Error: proxy.js not found in $PACKAGE_ROOT" >&2
  echo "This script must be run from the music-studio package root." >&2
  exit 1
fi

# ── UI helpers ────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD="\033[1m"; DIM="\033[2m"; RED="\033[31m"; YELLOW="\033[33m"
  GREEN="\033[32m"; CYAN="\033[36m"; RESET="\033[0m"
else
  BOLD=""; DIM=""; RED=""; YELLOW=""; GREEN=""; CYAN=""; RESET=""
fi
info()    { printf "${CYAN}▸${RESET} %s\n" "$*"; }
ok()      { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()    { printf "${YELLOW}!${RESET} %s\n" "$*"; }
err()     { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
heading() { printf "\n${BOLD}%s${RESET}\n" "$*"; }

# ── Node.js check ────────────────────────────────────────────────────
MIN_NODE_MAJOR=18

heading "minimax music studio"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed (need >= v${MIN_NODE_MAJOR})."
  echo
  echo "Pick the easiest install method for your platform:"
  echo
  if command -v brew >/dev/null 2>&1; then
    echo "  ${BOLD}Homebrew${RESET} (recommended on macOS):"
    echo "    ${CYAN}brew install node${RESET}"
  fi
  if command -v apt-get >/dev/null 2>&1; then
    echo "  ${BOLD}apt${RESET} (Debian/Ubuntu):"
    echo "    ${CYAN}sudo apt update && sudo apt install -y nodejs${RESET}"
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "  ${BOLD}dnf${RESET} (Fedora):"
    echo "    ${CYAN}sudo dnf install -y nodejs${RESET}"
  fi
  if command -v pacman >/dev/null 2>&1; then
    echo "  ${BOLD}pacman${RESET} (Arch):"
    echo "    ${CYAN}sudo pacman -S nodejs${RESET}"
  fi
  echo
  echo "Or download the official installer:"
  echo "  ${CYAN}https://nodejs.org/en/download${RESET}"
  echo
  echo "After installing Node.js, re-run this script."
  exit 1
fi

NODE_VERSION="$(node --version)"
NODE_MAJOR="$(echo "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  err "Node.js $NODE_VERSION is too old (need >= v${MIN_NODE_MAJOR})."
  echo "Update from https://nodejs.org/en/download or via your package manager."
  exit 1
fi
ok "Node.js $NODE_VERSION"

# ── Port handling ────────────────────────────────────────────────────
PORT="${PORT:-8787}"
HOST="${HOST:-127.0.0.1}"

is_port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -lnt "sport = :$1" | grep -q LISTEN
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk '{print $4}' | grep -E "[.:]$1$" >/dev/null
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

if is_port_busy "$PORT"; then
  warn "Port $PORT is already in use."
  if [ -t 0 ]; then
    printf "Enter a different port (or press Enter to abort): "
    read -r NEW_PORT
    if [ -z "${NEW_PORT:-}" ]; then
      err "Aborted."
      exit 1
    fi
    PORT="$NEW_PORT"
  else
    err "Re-run with PORT=<other> to use a different port."
    exit 1
  fi
fi

# ── Launch ───────────────────────────────────────────────────────────
heading "Starting local proxy"
info "URL:    ${BOLD}http://${HOST}:${PORT}/${RESET}"
info "Static: ${DIM}$PACKAGE_ROOT${RESET}"
info "Proxy:  /api/*  →  https://console.gmicloud.ai/api/*"
echo
info "Press ${BOLD}Ctrl+C${RESET} to stop."
echo

# Ensure Ctrl+C kills the proxy child process.
PROXY_PID=""
CLEANED_UP=0
cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then return; fi
  CLEANED_UP=1
  if [ -n "$PROXY_PID" ] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
  echo
  ok "Stopped."
}
# Use a single trap that fans out so we only print "Stopped." once even
# if both INT and EXIT fire (e.g. when `wait` returns normally).
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup' EXIT

# Best-effort: open the browser a moment after the proxy is up.
(
  sleep 1.2
  URL="http://${HOST}:${PORT}/music-generator.html"
  if command -v open >/dev/null 2>&1; then open "$URL" 2>/dev/null || true; fi
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" 2>/dev/null || true; fi
) &

cd "$PACKAGE_ROOT"
PORT="$PORT" HOST="$HOST" node proxy.js &
PROXY_PID=$!
wait "$PROXY_PID"
