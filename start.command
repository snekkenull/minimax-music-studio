#!/usr/bin/env bash
# macOS double-click entry point. Finder launches .command files via
# Terminal.app with cwd set to the bundle's parent; we cd into the
# script's own directory and exec start.sh.

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1
exec ./start.sh "$@"
