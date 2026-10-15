#!/usr/bin/env bash
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$ORACLE_DIR/../.." && pwd)"
SOURCE_DIR="$REPO_DIR/reference/stracciatella"
WORK_DIR="${JA2_ORACLE_DIR:-$HOME/ja2-oracle}"
TREE_DIR="$WORK_DIR/src"
STAGE_DIR="$WORK_DIR/stage"
BUILD_DIR="$WORK_DIR/build"
BUILD_TYPE="${JA2_ORACLE_BUILD_TYPE:-RelWithDebInfo}"
JOBS="${JA2_ORACLE_JOBS:-$(nproc)}"

fail() {
  echo "oracle build: $*" >&2
  exit 1
}

require_tool() {
  command -v "$1" >/dev/null 2>&1 || fail "missing '$1'. On Ubuntu: sudo apt-get install build-essential cmake ninja-build pkg-config libsdl3-dev cargo rustc rsync patch"
}

for tool in cmake cargo rustc c++ pkg-config rsync patch; do require_tool "$tool"; done
pkg-config --exists sdl3 || fail "SDL3 development files not found (sudo apt-get install libsdl3-dev)"
[ -f "$SOURCE_DIR/CMakeLists.txt" ] || fail "Stracciatella sources not found at $SOURCE_DIR"
case "$WORK_DIR" in
  "$REPO_DIR"|"$REPO_DIR"/*) fail "JA2_ORACLE_DIR must be outside the repository ($WORK_DIR)" ;;
esac

REFERENCE_COMMIT="$(git -C "$SOURCE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "oracle build: Stracciatella $REFERENCE_COMMIT -> $WORK_DIR"

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR" "$TREE_DIR"
rsync -a --exclude=.git "$SOURCE_DIR/" "$STAGE_DIR/"
cp "$ORACLE_DIR/src/Oracle.h" "$ORACLE_DIR/src/Oracle.cc" "$STAGE_DIR/src/game/"
for patch_file in "$ORACLE_DIR"/patches/*.patch; do
  echo "oracle build: applying $(basename "$patch_file")"
  patch -d "$STAGE_DIR" -p1 --batch --forward --no-backup-if-mismatch --quiet < "$patch_file"
done
rsync -rlpc --delete "$STAGE_DIR/" "$TREE_DIR/"
rm -rf "$STAGE_DIR"

GENERATOR=()
if command -v ninja >/dev/null 2>&1; then GENERATOR=(-G Ninja); fi
if [ -f "$BUILD_DIR/CMakeCache.txt" ]; then GENERATOR=(); fi

cmake -S "$TREE_DIR" -B "$BUILD_DIR" "${GENERATOR[@]}" \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DVERSION_TAG="oracle.$REFERENCE_COMMIT" \
  -DBUILD_LAUNCHER=OFF \
  -DWITH_UNITTESTS=OFF \
  -DWITH_RUST_BINARIES=OFF \
  -DUSE_SCCACHE=OFF
cmake --build "$BUILD_DIR" --parallel "$JOBS"

echo "oracle build: done, binary at $BUILD_DIR/ja2"
