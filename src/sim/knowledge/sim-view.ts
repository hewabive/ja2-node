import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import { NO_CURRENT_SQUAD } from '../strategic/forces/constants.ts';
import { knownMineTiles } from '../tactical/bombs/mine-flags.ts';
import type { Bullet } from '../tactical/combat/bullets.ts';
import { revealedRooms } from '../tactical/perception/fov.ts';
import { slantRoofCeilingTiles } from '../tactical/perception/slant-roofs.ts';
import { currentSquad, selectedSoldier } from '../tactical/selection.ts';
import { shownToPlayer } from '../tactical/soldier.ts';
import type { TacticalState } from '../tactical/state.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { type BulletView, bloodViews, bulletViews, corpseViews, smokeViews, tileChangeViews } from '../tactical/world-view.ts';

const NO_PRESENTATION: PresentationTimeline = { frames: new Int16Array(0), sounds: new Uint16Array(0) };

export function bulletsShownToPlayer(t: TacticalState, since: (b: Bullet) => number): BulletView[] {
  return bulletViews(t, shownToPlayer, since);
}

function currentSquadView(t: TacticalState): number | null {
  const squad = currentSquad(t);
  return squad === NO_CURRENT_SQUAD ? null : squad;
}

export function tacticalViewParts(sim: TacticalSim, presentation: PresentationTimeline = NO_PRESENTATION) {
  return {
    mapPath: sim.mapPath,
    soldiers: sim.snapshot(presentation, shownToPlayer),
    openDoors: sim.openDoors(),
    openContainers: sim.openContainers(),
    doors: sim.doors(),
    combat: sim.combatView(),
    selected: selectedSoldier(sim.state)?.id ?? null,
    currentSquad: currentSquadView(sim.state),
    revealedRooms: revealedRooms(sim.state),
    slantRoofCeilings: slantRoofCeilingTiles(sim.state),
    knownMines: knownMineTiles(sim.state),
    items: sim.visibleItems(),
    light: sim.lightView(),
    corpses: corpseViews(sim.state),
    smoke: smokeViews(sim.state),
    tileChanges: tileChangeViews(sim.state),
    blood: bloodViews(sim.state),
    ...(sim.state.turn.lockItemLocators ? { itemLocatorsLocked: true } : {}),
  };
}

export function knowledgeViewOf(sim: TacticalSim) {
  return { tick: sim.tick, ...tacticalViewParts(sim) };
}
