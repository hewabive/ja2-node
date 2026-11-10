#!/usr/bin/env bash
set -euo pipefail

ORACLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$ORACLE_DIR/../.." && pwd)"
O="${JA2_ORACLE_DIR:-$HOME/ja2-oracle}"
: "${JA2_DATA_DIR:?JA2_DATA_DIR is required}"

PROBES=(
  a9-costs.jsonl a9-paths.jsonl a9-los.jsonl save-probes/all-saves-draws.jsonl strategic.jsonl
  ar/d13.jsonl ar/capture.jsonl ar/stress.jsonl ar/smoke.jsonl economy.jsonl sai/newgame.jsonl sai/saves.jsonl
  sectors.jsonl battle/battle.jsonl creatures/creatures.jsonl creatures/battles.jsonl creatures/placement.jsonl
  morale/morale.jsonl merchants/merchants.jsonl contracts/contracts.jsonl creatures/creature-ai.jsonl
  laptop/laptop.jsonl doors/doors.jsonl heli/heli.jsonl talk/talk.jsonl facts/facts.jsonl actions/actions.jsonl
  schedules/schedules.jsonl give/give.jsonl recruit/recruit.jsonl civ/civ.jsonl meanwhile/meanwhile.jsonl
  boxing/boxing.jsonl drugs/drugs.jsonl bombs/bombs.jsonl vehicles/vehicles.jsonl absent/absent.jsonl
  autobandage/autobandage-draws.jsonl knife-ai/knife-ai.jsonl helidrop/helidrop.jsonl helidrop/load-draws.jsonl
  save-effects/setup.jsonl save-effects/effects.jsonl save-sectors/entries.jsonl save-bombs/setup.jsonl
  save-bombs/loads.jsonl save-flight/setup.jsonl save-flight/loads.jsonl meanwhile-scenes/scenes.jsonl
  map-entry/map-entry.jsonl
)
OPTIONAL_PROBES=(attach/attach.jsonl florist/florist.jsonl)
for probe in "${OPTIONAL_PROBES[@]}"; do
  if [ -f "$O/$probe" ]; then
    PROBES+=("$probe")
  else
    echo "compare-all: $O/$probe not generated yet (tools/oracle/run.sh tools/oracle/probes/${probe%%/*}.txt $O/$probe), skipped" >&2
  fi
done

cd "$REPO_DIR"
node tools/oracle/compare.ts "${PROBES[@]/#/$O/}"
