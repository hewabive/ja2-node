import { sectorShortString } from '../content/strategic/sector-ids.ts';
import type { PlacementButtonName, PlacementMercView, PlacementSide, TacticalPlacementPromptView } from '../protocol/view.ts';
import type { CampaignSim } from '../sim/campaign/campaign-sim.ts';
import { everyonePlaced, PLACEMENT_CHOICES } from '../sim/campaign/tactical-placement.ts';
import { PlacementButton, type PlacementPiece } from '../sim/strategic/forces/battle-state.ts';
import { InsertionCode } from '../sim/strategic/forces/constants.ts';
import { edgepointList } from '../sim/tactical/edgepoints.ts';

const SIDES: readonly (readonly [number, PlacementSide])[] = [
  [InsertionCode.NORTH, 'north'],
  [InsertionCode.EAST, 'east'],
  [InsertionCode.SOUTH, 'south'],
  [InsertionCode.WEST, 'west'],
];

const BUTTONS: Readonly<Record<number, PlacementButtonName>> = {
  [PlacementButton.DONE]: 'done',
  [PlacementButton.SPREAD]: 'spread',
  [PlacementButton.GROUP]: 'group',
  [PlacementButton.CLEAR]: 'clear',
};

function sideName(code: number): PlacementSide | null {
  return SIDES.find(([c]) => c === code)?.[1] ?? null;
}

function mercView(campaign: CampaignSim, piece: PlacementPiece): PlacementMercView {
  const m = campaign.battle?.roster.get(piece.soldier);
  const gridNo = piece.placed ? m?.soldier.gridNo : undefined;
  return {
    soldier: piece.soldier,
    side: sideName(piece.side),
    group: m?.groupId ?? 0,
    placed: piece.placed,
    ...(gridNo !== undefined ? { gridNo } : {}),
  };
}

function edgepointsOfTheSides(campaign: CampaignSim, pieces: readonly PlacementPiece[]): TacticalPlacementPromptView['edgepoints'] {
  const t = campaign.tactical?.state;
  if (!t) return {};
  const shown = new Set(pieces.map((p) => p.side));
  return Object.fromEntries(
    SIDES.filter(([code]) => shown.has(code)).map(([code, name]) => [name, [...(edgepointList(t, code, true) ?? [])]]),
  );
}

export function tacticalPlacementView(campaign: CampaignSim, id: string, pieces: readonly PlacementPiece[]): TacticalPlacementPromptView {
  const world = campaign.state.worldSector;
  return {
    id,
    kind: 'tacticalPlacement',
    sector: world ? sectorShortString(world) : '',
    button: BUTTONS[campaign.state.battle.placementButton] ?? 'clear',
    mercs: pieces.map((p) => mercView(campaign, p)),
    edgepoints: edgepointsOfTheSides(campaign, pieces),
    everyonePlaced: everyonePlaced(pieces),
    choices: PLACEMENT_CHOICES,
  };
}
