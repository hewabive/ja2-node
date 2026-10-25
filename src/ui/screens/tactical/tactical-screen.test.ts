import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tacticalOf } from '../../../../tests/support/save-scenarios.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { ViewFrame } from '../../../protocol/view.ts';
import { handleSoldierDeath } from '../../../sim/tactical/combat/death.ts';
import type { DrawItem } from '../../draw-list.ts';
import { MouseButton } from '../../input/events.ts';

const SLOW_MS = 120_000;
const HAND = 5;
const BIG_POCKET = 7;
const NEXT_BIG_POCKET = 8;
const SMALL_POCKET = 11;
const STAT_FLASH_MS = 60_000;
const FRAME_MS = 16;
const PANEL_FRAME_MS = 160;
const SKULL_ANIMATION_FRAMES = 13;
const DEAD_FACE_FRAME = 5;
const FONT_RED = 162;
const FONT_MCOLOR_LTYELLOW = 144;
const MARKSMANSHIP = 'smStat6';
const AGILITY = 'smStat0';

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}${item.shade ? ' shaded' : ''}${item.effect ? ` ${item.effect.kind}` : ''}`;
    case 'glyphs': {
      const first = item.glyphs[0];
      return `glyphs ${item.font} ${first ? `${first.x},${first.y}` : '-'} n=${item.glyphs.length} fg=${item.foreground} sh=${item.shadow} bg=${item.background}`;
    }
    case 'fill':
      return `fill ${item.x},${item.y} ${item.width}x${item.height} ${hex(item.color)}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height} ${item.factor}`;
    case 'hatch':
      return `hatch ${item.pattern} ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'line':
    case 'rectangle':
      return `${item.kind} ${item.x1},${item.y1} ${item.x2},${item.y2} ${hex(item.color)}`;
    case 'clipPush':
      return `clip ${item.x},${item.y} ${item.width}x${item.height}`;
    default:
      return item.kind;
  }
}

function snapshot(f: TacticalUiTest): string {
  return `${f.draw().items.map(line).join('\n')}\n`;
}

function images(f: TacticalUiTest, asset: string): DrawItem[] {
  return f.draw().items.filter((i) => i.kind === 'image' && i.asset === asset);
}

function statColour(f: TacticalUiTest, id: string): number | null {
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

function frame(tick: number, events: NonNullable<ViewFrame['events']>, messages: NonNullable<ViewFrame['messages']> = []): ViewFrame {
  return { tick, changed: [], removed: [], events, messages };
}

async function smPanelOf(f: TacticalUiTest, slot: number): Promise<void> {
  await f.click(`teamFaceRegion${slot}`, MouseButton.RIGHT);
  await f.settle();
}

function kill(f: TacticalUiTest, ...ids: number[]): ViewFrame[] {
  const t = tacticalOf(f.session).state;
  for (const id of ids) {
    const s = t.soldiers.find((v) => v?.id === id);
    if (!s) throw new Error(`no soldier ${id}`);
    s.life = 0;
    handleSoldierDeath(t, s);
  }
  f.session.advance({ ticks: 1 });
  f.client.refresh();
  const frames = f.client.takeFrames();
  f.frames(frames);
  return frames;
}

function playSkullAnimation(f: TacticalUiTest): void {
  for (let i = 0; i < SKULL_ANIMATION_FRAMES; i++) f.t.frame(PANEL_FRAME_MS);
}

function inventory(f: TacticalUiTest, soldier: number) {
  return f.client.view.soldiers.find((s) => s.id === soldier)?.inventory ?? [];
}

describe('the tactical screen over a stub sandbox session', () => {
  it(
    'fills the team panel with the squad, selects through the faces and opens the single merc panel',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      expect(f.screen.teamSlots.filter((s) => s !== null)).toHaveLength(4);
      expect(f.screen.selected).toBe(0);
      expect(f.widget('teamName1').text).toBe('Merc 2');
      await f.click('teamFaceRegion1');
      expect(f.screen.selected).toBe(1);
      expect(f.attention).toEqual([1]);
      await f.click('teamFaceRegion1');
      expect(f.attention).toEqual([1]);
      expect(f.world.located.length).toBeGreaterThan(0);
      await smPanelOf(f, 1);
      expect(f.screen.panel).toBe('sm');
      expect(f.screen.smMerc).toBe(1);
      expect(f.widget('smName').text).toBe('Merc 2');
      expect(f.widget('smStat0').text).toBe(' 80');
      f.key('`');
      await f.settle();
      expect(f.screen.panel).toBe('team');
    },
    SLOW_MS,
  );

  it(
    'takes one magazine with a click and the stack with Shift, and moves it with one moveItem',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      await smPanelOf(f, 0);
      await f.click(`slot${BIG_POCKET}`);
      expect(f.screen.inventory.cursor).toMatchObject({ item: 'CLIP9_15' });
      await f.click(`slot${NEXT_BIG_POCKET}`);
      expect(f.client.commands.at(-1)?.cmd).toMatchObject({
        type: 'moveItem',
        soldier: 0,
        from: BIG_POCKET,
        to: NEXT_BIG_POCKET,
        count: 1,
      });
      expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
      expect(f.screen.inventory.cursor).toBeNull();
      expect(inventory(f, 0).find((i) => i.slot === NEXT_BIG_POCKET)).toMatchObject({ item: 'CLIP9_15', count: 1 });
      await f.click(`slot${NEXT_BIG_POCKET}`, MouseButton.LEFT, 1);
      expect(f.screen.inventory.cursor).toMatchObject({ item: 'CLIP9_15' });
      await f.click(`slot${BIG_POCKET}`);
      expect(inventory(f, 0).find((i) => i.slot === BIG_POCKET)).toMatchObject({ item: 'CLIP9_15', count: 2 });
    },
    SLOW_MS,
  );

  it(
    'attaches the silencer through the description box and shows it there',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      await smPanelOf(f, 0);
      await f.click(`slot${SMALL_POCKET}`);
      expect(f.screen.inventory.cursor).toMatchObject({ item: 'SILENCER' });
      await f.click(`slot${HAND}`, MouseButton.RIGHT);
      expect(f.screen.description.item).toBe('GLOCK_17');
      await f.click('itemDescriptionAttachment0');
      expect(f.client.commands.at(-1)?.cmd).toMatchObject({ type: 'attach', soldier: 0, item: SMALL_POCKET, to: HAND });
      expect(
        inventory(f, 0)
          .find((i) => i.slot === HAND)
          ?.attachments?.map((a) => a.item),
      ).toEqual(['SILENCER']);
      await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/description-box.txt');
      f.key('Escape');
      expect(f.screen.description.open).toBe(false);
    },
    SLOW_MS,
  );

  it(
    'opens the pickup menu on a tile with two items and sends one pickUp with both',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      const dropper = f.client.view.soldiers.find((s) => s.id === 3);
      if (!dropper) throw new Error('no merc 3');
      const tile = dropper.gridNo + 4;
      expect((await f.client.command({ type: 'move', soldier: 3, to: tile })).ok).toBe(true);
      f.advance(400);
      expect(f.client.view.soldiers.find((s) => s.id === 3)?.gridNo).toBe(tile);
      expect((await f.client.command({ type: 'drop', soldier: 3, slot: HAND })).ok).toBe(true);
      f.advance(200);
      expect((await f.client.command({ type: 'drop', soldier: 3, slot: BIG_POCKET })).ok).toBe(true);
      f.advance(200);
      expect((await f.client.command({ type: 'move', soldier: 3, to: tile + 4 })).ok).toBe(true);
      f.advance(400);
      expect(f.client.view.items?.filter((i) => i.gridNo === tile)).toHaveLength(2);
      const at = f.world.pickPoint(tile);
      f.screen.controls.toggleHandCursor();
      f.t.frame();
      await f.clickAt(at.x, at.y);
      expect(f.screen.pickup.open).toBe(true);
      await f.click('pickupAll');
      await f.click('pickupOk');
      expect(f.client.commands.at(-1)?.cmd).toMatchObject({ type: 'pickUp', soldier: 0, gridNo: tile });
      expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
      expect(f.screen.pickup.open).toBe(false);
      f.advance(2000);
      expect(inventory(f, 0).filter((i) => i.item === 'GLOCK_17')).toHaveLength(2);
    },
    SLOW_MS,
  );

  it(
    'shows the message log, the feedback box, stat flashes and the death animation of a face',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      f.frames([
        frame(
          1,
          [{ tick: 1, type: 'statChanged', soldier: 0, stat: 'marksmanship', change: 1 }],
          [
            { tick: 1, kind: 'interface', colour: FONT_RED, args: [{ text: 'Hello' }, { text: 'there' }] },
            { tick: 1, kind: 'uiFeedback', colour: FONT_MCOLOR_LTYELLOW, args: [{ text: 'Stop!' }] },
            { tick: 1, kind: 'dialog', colour: 0, textKey: { file: 'x', row: 0 } as never },
          ],
        ),
      ]);
      await f.settle(20);
      expect(f.screen.messageLines).toEqual(['Stop!', 'Hello there']);
      expect(f.screen.feedbackText).toBe('Stop!');
      await smPanelOf(f, 0);
      expect(f.widget(MARKSMANSHIP).text).toBe(' 80');
      expect(statColour(f, MARKSMANSHIP)).not.toBe(statColour(f, AGILITY));
      f.t.frame(STAT_FLASH_MS + FRAME_MS);
      expect(statColour(f, MARKSMANSHIP)).toBe(statColour(f, AGILITY));
      f.key('`');
      await f.settle();
      f.frames([frame(2, [{ tick: 2, type: 'soldierDied', soldier: 2, killer: null, gridNo: 0 }])]);
      const close = f.screen.teamSlots.indexOf(2);
      expect(close).toBeGreaterThanOrEqual(0);
      f.t.frame(PANEL_FRAME_MS);
      expect(images(f, 'interface/p_close.sti').length).toBeGreaterThan(0);
      for (let i = 0; i < 8; i++) f.t.frame(PANEL_FRAME_MS);
      expect(images(f, 'interface/p_dead.sti').length).toBeGreaterThan(0);
    },
    SLOW_MS,
  );

  it(
    'keeps the skull of a merc who died off the view in his slot until the panel is rebuilt',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      const frames = kill(f, 2);
      expect(frames.flatMap((fr) => fr.events ?? []).some((e) => e.type === 'soldierDied' && e.soldier === 2)).toBe(true);
      expect(f.client.view.soldiers.some((s) => s.id === 2)).toBe(false);
      const slot = f.screen.teamSlots.indexOf(2);
      expect(slot).toBeGreaterThanOrEqual(0);
      f.t.frame(PANEL_FRAME_MS);
      expect(images(f, 'interface/p_close.sti').length).toBeGreaterThan(0);
      playSkullAnimation(f);
      expect(f.screen.teamSlots[slot]).toBe(2);
      const face = f.widget(`teamFace${slot}`).rect;
      const skull = images(f, 'interface/p_dead.sti').filter((i) => i.kind === 'image' && i.x === face.x && i.y === face.y);
      expect(skull.map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([DEAD_FACE_FRAME]);
      expect(f.widget(`teamName${slot}`).text).toBe('Merc 3');
      expect(f.screen.selected).toBe(0);
      f.screen.exit();
      f.screen.enter();
      f.t.frame();
      expect(f.screen.teamSlots).not.toContain(2);
    },
    SLOW_MS,
  );

  it(
    'darkens the face, then plays the close and skull frames, and only then shows the skull of a merc whose life ran out before his death',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      const t = tacticalOf(f.session).state;
      const s = t.soldiers.find((v) => v?.id === 2);
      if (!s) throw new Error('no soldier 2');
      s.life = 0;
      f.session.advance({ ticks: 1 });
      f.client.refresh();
      f.frames(f.client.takeFrames());
      const slot = f.screen.teamSlots.indexOf(2);
      const face = f.widget(`teamFace${slot}`).rect;
      const skullAt = () => images(f, 'interface/p_dead.sti').filter((i) => i.kind === 'image' && i.x === face.x && i.y === face.y);
      f.t.frame();
      expect(images(f, 'interface/p_close.sti').filter((i) => i.kind === 'image' && i.x === face.x && i.y === face.y)).toHaveLength(1);
      expect(skullAt()).toHaveLength(0);
      playSkullAnimation(f);
      expect(skullAt().map((i) => (i.kind === 'image' ? i.frame : -1))).toEqual([DEAD_FACE_FRAME]);
    },
    SLOW_MS,
  );

  it(
    'selects the next able merc of the squad after the skull of the selected merc, and nobody once the squad is gone',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      expect(f.screen.selected).toBe(0);
      kill(f, 0);
      expect(f.screen.selected).toBe(0);
      playSkullAnimation(f);
      expect(f.screen.selected).toBe(1);
      expect(f.screen.teamSlots).toContain(0);
      kill(f, 1, 2, 3);
      playSkullAnimation(f);
      expect(f.screen.selected).toBeNull();
      expect(f.screen.teamSlots.filter((s) => s !== null)).toEqual([0, 1, 2, 3]);
      await f.settle();
      expect(f.screen.selected).toBeNull();
    },
    SLOW_MS,
  );

  it(
    'blinks the faces from the client random and the face record',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      const eyes = new Set<number>();
      for (let i = 0; i < 600; i++) {
        f.t.frame(FRAME_MS);
        eyes.add(f.screen.faceOf(0)?.eyeFrame ?? 0);
      }
      expect([...eyes].some((e) => e > 0)).toBe(true);
    },
    SLOW_MS,
  );

  it(
    'draws the team panel and the single merc panel',
    async () => {
      const f = await tacticalUiTest(kit, ui);
      await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/team-panel.txt');
      await smPanelOf(f, 0);
      await expect(snapshot(f)).toMatchFileSnapshot('__snapshots__/sm-panel.txt');
    },
    SLOW_MS,
  );
});
