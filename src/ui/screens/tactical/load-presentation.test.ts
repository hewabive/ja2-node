import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tacticalOf } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { ViewFrame } from '../../../protocol/view.ts';
import { restoreSession, snapshotSession } from '../../../server/session-snapshot.ts';
import { handleSoldierDeath } from '../../../sim/tactical/combat/death.ts';
import { markStatChange } from '../../../sim/tactical/combat/experience.ts';
import { soldierTakeDamage } from '../../../sim/tactical/combat/hit.ts';
import { DamageReason } from '../../../sim/tactical/combat/types.ts';
import type { Soldier } from '../../../sim/tactical/soldier.ts';
import { MouseButton } from '../../input/events.ts';
import { FontName } from '../../text/fonts.ts';
import { glyphRun } from '../../text/print.ts';

const BEFORE_THE_HIT_TICKS = 400;
const HIT = 17;
const DAMAGE_NUMBER_TICKS = 400;
const PANEL_FRAME_MS = 160;
const SKULL_ANIMATION_FRAMES = 13;
const DEAD_FACE_FRAME = 5;
const KILLED = 2;
const MARKSMANSHIP = 'smStat6';
const AGILITY = 'smStat0';
const CLOSE_PANEL = 'interface/p_close.sti';
const DEAD_PANEL = 'interface/p_dead.sti';

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function soldier(f: TacticalUiTest, id: number): Soldier {
  const s = tacticalOf(f.session).state.soldiers.find((v) => v?.id === id);
  if (!s) throw new Error(`no soldier ${id}`);
  return s;
}

function save(f: TacticalUiTest): string {
  return JSON.stringify(snapshotSession(f.session.sim));
}

async function load(f: TacticalUiTest, saved: string): Promise<void> {
  const sim = await restoreSession(JSON.parse(saved), kit.read, (p) => kit.worlds.exists(p));
  f.session.replace(sim, { name: 'QuickSave', digest: 'load-presentation' });
  f.client.refresh();
  f.screen.stateReplaced();
  f.t.frame();
}

function damageNumbersShown(f: TacticalUiTest, amount: number): number {
  const wanted = glyphRun(f.t.runtime.fonts.get(FontName.TINYFONT1), `-${amount}`, 0, 0)
    .glyphs.map((g) => g.index)
    .join();
  return f.draw().items.filter((i) => i.kind === 'glyphs' && i.glyphs.map((g) => g.index).join() === wanted).length;
}

function faceImages(f: TacticalUiTest, asset: string, id: number): number[] {
  const face = f.widget(`teamFace${f.screen.teamSlots.indexOf(id)}`).rect;
  return f.draw().items.flatMap((i) => (i.kind === 'image' && i.asset === asset && i.x === face.x && i.y === face.y ? [i.frame] : []));
}

function kill(f: TacticalUiTest, id: number): void {
  const s = soldier(f, id);
  s.life = 0;
  handleSoldierDeath(tacticalOf(f.session).state, s);
  f.session.advance({ ticks: 1 });
  f.deliver();
}

function playSkullAnimation(f: TacticalUiTest): void {
  for (let i = 0; i < SKULL_ANIMATION_FRAMES; i++) f.t.frame(PANEL_FRAME_MS);
}

function colour(f: TacticalUiTest, id: string): number | null {
  const { rect } = f.widget(id);
  const run = f
    .draw()
    .items.find(
      (i) =>
        i.kind === 'glyphs' &&
        (i.glyphs[0]?.x ?? -1) >= rect.x &&
        (i.glyphs[0]?.x ?? -1) < rect.x + rect.width &&
        (i.glyphs[0]?.y ?? -1) >= rect.y - 2 &&
        (i.glyphs[0]?.y ?? -1) < rect.y + rect.height,
    );
  return run?.kind === 'glyphs' ? run.foreground : null;
}

describe('the tactical screen across a load in place (LoadSaveSoldierType.cc: what the soldier keeps)', () => {
  it('draws the damage number from the soldier in the view: gone 2 s after the hit, none after a load from before it, and one floating at the save goes on floating (sDamage, bDisplayDamageCount)', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    f.advance(BEFORE_THE_HIT_TICKS);
    const beforeTheHit = save(f);
    const merc = f.screen.selected ?? -1;
    soldierTakeDamage(tacticalOf(f.session).state, soldier(f, merc), HIT, 0, DamageReason.GUNFIRE, null);
    f.advance(1);
    expect(f.client.view.soldiers.find((s) => s.id === merc)?.damage).toEqual({ amount: HIT, steps: 1 });
    expect(damageNumbersShown(f, HIT)).toBe(1);
    const floating = save(f);
    f.advance(DAMAGE_NUMBER_TICKS);
    expect(damageNumbersShown(f, HIT)).toBe(0);
    await load(f, floating);
    expect(damageNumbersShown(f, HIT)).toBe(1);
    await load(f, beforeTheHit);
    expect(damageNumbersShown(f, HIT)).toBe(0);
  });

  it('colours a stat by the change time the soldier keeps: none after a load from before the change, the change after a load from after it (uiChange*Time)', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    f.advance(1);
    const beforeTheChange = save(f);
    markStatChange(tacticalOf(f.session).state, soldier(f, 0), 'marksmanship', true);
    f.advance(1);
    const changed = save(f);
    await f.click('teamFaceRegion0', MouseButton.RIGHT);
    await f.settle();
    expect(colour(f, MARKSMANSHIP)).not.toBe(colour(f, AGILITY));
    await load(f, beforeTheChange);
    expect(colour(f, MARKSMANSHIP)).toBe(colour(f, AGILITY));
    await load(f, changed);
    expect(colour(f, MARKSMANSHIP)).not.toBe(colour(f, AGILITY));
  });

  it('plays the close and skull frames again for a merc a load brought back to life and who is killed again', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    f.advance(1);
    const alive = save(f);
    kill(f, KILLED);
    f.t.frame(PANEL_FRAME_MS);
    expect(faceImages(f, CLOSE_PANEL, KILLED)).toHaveLength(1);
    playSkullAnimation(f);
    expect(faceImages(f, DEAD_PANEL, KILLED)).toEqual([DEAD_FACE_FRAME]);
    await load(f, alive);
    expect(f.client.view.soldiers.find((s) => s.id === KILLED)?.life).toBeGreaterThan(0);
    kill(f, KILLED);
    f.t.frame(PANEL_FRAME_MS);
    expect(faceImages(f, CLOSE_PANEL, KILLED)).toHaveLength(1);
  });

  it('shows the skull at once for a merc already dead in the loaded state and plays no close or skull frames as his death ends, where the original goes on with the frames it saved (deviation "Panel death animation across a load")', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    f.advance(1);
    soldier(f, KILLED).life = 0;
    f.advance(1);
    const dying = save(f);
    await load(f, dying);
    expect([faceImages(f, CLOSE_PANEL, KILLED), faceImages(f, DEAD_PANEL, KILLED)]).toEqual([[], [DEAD_FACE_FRAME]]);
    const tick = f.client.view.tick;
    const died: ViewFrame = {
      tick,
      changed: [],
      removed: [],
      events: [{ tick, type: 'soldierDied', soldier: KILLED, killer: null, gridNo: 0 }],
    };
    f.frames([died]);
    f.t.frame(PANEL_FRAME_MS);
    expect([faceImages(f, CLOSE_PANEL, KILLED), faceImages(f, DEAD_PANEL, KILLED)]).toEqual([[], [DEAD_FACE_FRAME]]);
  });

  it('drops the feedback box a frame after the save put up', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    f.advance(1);
    const saved = save(f);
    const tick = f.client.view.tick;
    f.frames([
      { tick, changed: [], removed: [], events: [], messages: [{ tick, kind: 'uiFeedback', colour: 0, args: [{ text: 'Stop!' }] }] },
    ]);
    expect(f.screen.feedbackText).toBe('Stop!');
    await load(f, saved);
    expect(f.screen.feedbackText).toBeNull();
  });
});
