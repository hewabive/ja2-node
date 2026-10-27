import type { PresentationTimeline } from '../../content/anim/timelines.ts';
import { revealedRooms } from '../tactical/perception/fov.ts';
import { Team } from '../tactical/soldier.ts';
import type { TacticalSim } from '../tactical/tactical-sim.ts';
import { type BulletView, bulletViews, corpseViews, smokeViews, tileChangeViews } from '../tactical/world-view.ts';

const NO_PRESENTATION: PresentationTimeline = { frames: new Int16Array(0), sounds: new Uint16Array(0) };

export function shownToPlayer(s: { readonly team: number; readonly visible: number }): boolean {
  return s.team === Team.OUR || s.visible >= 0;
}

export function bulletsShownToPlayer(sim: TacticalSim): BulletView[] {
  return bulletViews(sim.state, shownToPlayer);
}

export function tacticalViewParts(sim: TacticalSim, presentation: PresentationTimeline = NO_PRESENTATION) {
  return {
    mapPath: sim.mapPath,
    soldiers: sim.snapshot(presentation, shownToPlayer),
    openDoors: sim.openDoors(),
    doors: sim.doors(),
    combat: sim.combatView(),
    revealedRooms: revealedRooms(sim.state),
    items: sim.visibleItems(),
    light: sim.lightView(),
    corpses: corpseViews(sim.state),
    smoke: smokeViews(sim.state),
    tileChanges: tileChangeViews(sim.state),
  };
}

export function knowledgeViewOf(sim: TacticalSim) {
  return { tick: sim.tick, ...tacticalViewParts(sim) };
}
