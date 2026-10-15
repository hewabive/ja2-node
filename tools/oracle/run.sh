#!/usr/bin/env bash
set -euo pipefail

WORK_DIR="${JA2_ORACLE_DIR:-$HOME/ja2-oracle}"
BINARY="$WORK_DIR/build/ja2"
ORACLE_HOME="$WORK_DIR/home"
LOG_FILE="$WORK_DIR/oracle.log"

fail() {
  echo "oracle run: $*" >&2
  exit 2
}

[ $# -ge 1 ] && [ $# -le 2 ] || fail "usage: tools/oracle/run.sh <probe-script> [output.jsonl]"
[ -x "$BINARY" ] || fail "no oracle binary at $BINARY, run tools/oracle/build.sh first"
[ -f "$1" ] || fail "probe script not found: $1"
SCRIPT="$(realpath "$1")"
OUTPUT=""
if [ $# -eq 2 ]; then OUTPUT="$(realpath -m "$2")"; fi

if [ -n "${JA2_GAME_DIR:-}" ]; then
  GAME_DIR="$JA2_GAME_DIR"
elif [ -n "${JA2_DATA_DIR:-}" ]; then
  GAME_DIR="$JA2_DATA_DIR"
  case "${GAME_DIR%/}" in
    */[Dd][Aa][Tt][Aa]) GAME_DIR="$(dirname "${GAME_DIR%/}")" ;;
  esac
else
  fail "set JA2_GAME_DIR (game root) or JA2_DATA_DIR (game root or its Data folder)"
fi
[ -d "$GAME_DIR" ] || fail "game directory not found: $GAME_DIR"
SAVES_DIR="${JA2_SAVES_DIR:-$GAME_DIR/SavedGames}"

mkdir -p "$ORACLE_HOME/.ja2/SavedGames" "$WORK_DIR/tmp"
if [ -d "$SAVES_DIR" ]; then
  find "$SAVES_DIR" -maxdepth 1 -iname '*.sav' -exec cp -pu {} "$ORACLE_HOME/.ja2/SavedGames/" \;
fi

cd "$WORK_DIR/build"
set +e
HOME="$ORACLE_HOME" \
TMPDIR="$WORK_DIR/tmp" \
SDL_VIDEO_DRIVER=dummy \
SDL_AUDIO_DRIVER=dummy \
JA2_ORACLE="$SCRIPT" \
JA2_ORACLE_OUT="$OUTPUT" \
  "$BINARY" -gamedir "$GAME_DIR" -nosound -resversion "${JA2_RESVERSION:-ENGLISH}" 2>"$LOG_FILE"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then echo "oracle run: exit status $STATUS, engine log in $LOG_FILE" >&2; fi
exit "$STATUS"
