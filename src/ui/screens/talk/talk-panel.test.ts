import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_NPC, STUB_RPC } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import type { Session } from '../../../server/session.ts';
import type { DrawItem } from '../../draw-list.ts';
import { FINAL_TALKING_DELAY_MS, textDelay } from '../../speech.ts';
import { placeTalkPanel, popupOrientation, popupPosition } from './talk-panel.ts';

const SLOW_MS = 120_000;
const LINE_STEP_MS = 250;
const MAX_LINE_FRAMES = 400;
const COLS = 160;
const NEAR_STUB_RPC = 72 * COLS + 81;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

function line(item: DrawItem): string {
  switch (item.kind) {
    case 'image':
      return `image ${item.asset}#${item.frame} ${item.x},${item.y}`;
    case 'glyphs':
      return `glyphs ${item.font} ${item.glyphs[0]?.x ?? '-'},${item.glyphs[0]?.y ?? '-'} n=${item.glyphs.length} fg=${item.foreground}`;
    case 'shadow':
      return `shadow ${item.x},${item.y} ${item.width}x${item.height}`;
    case 'clipPush':
      return `clip ${item.x},${item.y} ${item.width}x${item.height}`;
    default:
      return item.kind;
  }
}

function talkSnapshot(f: TacticalUiTest): string {
  const items = f.draw().items;
  const start = items.findIndex((i) => i.kind === 'image' && i.asset === 'interface/talkbox1.sti');
  return `${items.slice(start).map(line).join('\n')}\n`;
}

function lastCommand(f: TacticalUiTest) {
  return f.client.commands.at(-1)?.cmd ?? null;
}

function playOut(f: TacticalUiTest): number {
  let frames = 0;
  while (f.screen.dialogue.presenter.busy && frames++ < MAX_LINE_FRAMES) f.t.frame(LINE_STEP_MS);
  return frames;
}

function runTheLines(f: TacticalUiTest, session: Session): void {
  session.advance({ idle: true });
  f.deliver();
}

async function talkToTheStubNpc(seed: number): Promise<{ f: TacticalUiTest; merc: number; session: Session }> {
  const a10 = await campaignInA10(kit, seed);
  const f = await tacticalUiTest(kit, ui, seed, a10.session);
  const merc = a10.mercs[0] ?? 0;
  const reply = await f.client.command({ type: 'talk', soldier: merc, target: { npc: STUB_NPC } });
  expect(reply.ok, reply.reason).toBe(true);
  runTheLines(f, a10.session);
  return { f, merc, session: a10.session };
}

describe('talk panel geometry', () => {
  const bounds = { screenWidth: 640, viewportTop: 0, viewportBottom: 360, inventoryTop: 340 };

  it('centres the panel on the tile and clamps it to the screen and the viewport', () => {
    expect(placeTalkPanel(300, 200, 200, 130, bounds)).toEqual({ x: 200, y: 135, width: 200, height: 130 });
    expect(placeTalkPanel(620, 10, 200, 130, bounds)).toEqual({ x: 440, y: 0, width: 200, height: 130 });
    expect(placeTalkPanel(-50, 350, 200, 130, bounds)).toEqual({ x: 0, y: 230, width: 200, height: 130 });
  });

  it('puts the subtitle below, then left, then above, then right of the panel', () => {
    const panel = { x: 300, y: 40, width: 200, height: 130 };
    expect(popupOrientation(panel, 180, 60, bounds)).toBe(2);
    expect(popupPosition(panel, 2, 180, 60)).toEqual({ x: 310, y: 170 });
    const low = { ...panel, y: 200 };
    expect(popupOrientation(low, 180, 60, bounds)).toBe(0);
    expect(popupPosition(low, 0, 180, 60)).toEqual({ x: 120, y: 235 });
    const leftEdge = { ...low, x: 0 };
    expect(popupOrientation(leftEdge, 180, 60, bounds)).toBe(1);
    const cramped = { ...leftEdge, y: 20 };
    expect(popupOrientation(cramped, 180, 260, bounds)).toBe(3);
    expect(popupPosition(cramped, 3, 180, 260)).toEqual({ x: 201, y: -45 });
  });
});

describe('the talk panel on the stub NPC', { timeout: SLOW_MS }, () => {
  it('opens on the conversation, says its lines with subtitles while busy, sends an approach and closes with Done', async () => {
    const { f, session } = await talkToTheStubNpc(5);
    const dialogue = f.screen.dialogue;
    expect(dialogue.talk.open).toBe(true);
    expect(dialogue.talk.profile).toBe(STUB_NPC);
    expect(dialogue.presenter.busy).toBe(true);
    expect(f.widget('talkDone').enabled).toBe(false);
    expect(f.widget('talkOption1').enabled).toBe(false);
    expect(f.find('talkSubtitle')?.text).toContain('Strangers');
    const first = dialogue.presenter.current;
    expect(first?.line.surface).toBe('panel');
    const shadowed = f.draw().items.some((i) => i.kind === 'shadow');
    expect(shadowed).toBe(true);
    await expect(talkSnapshot(f)).toMatchFileSnapshot('__snapshots__/talk-panel.txt');
    f.t.frame(textDelay(first?.line.chars ?? 0) + FINAL_TALKING_DELAY_MS + 1);
    expect(dialogue.presenter.current?.line.id).not.toBe(first?.line.id);
    playOut(f);
    expect(dialogue.presenter.busy).toBe(false);
    expect(f.widget('talkDone').enabled).toBe(true);
    expect(f.find('talkSubtitle')).toBeUndefined();
    expect(f.widget('talkOptionText1').text).toBe('Friendly');

    await f.click('talkOption2');
    expect(lastCommand(f)).toEqual({ type: 'approach', kind: 'direct' });
    expect(f.client.commands.at(-1)?.reply.ok).toBe(true);
    runTheLines(f, session);
    expect(dialogue.presenter.busy).toBe(true);
    playOut(f);

    await f.click('talkDone');
    expect(lastCommand(f)).toEqual({ type: 'closeTalk' });
    f.deliver();
    f.t.frame();
    expect(dialogue.talk.open).toBe(false);
    expect(f.find('talkDone')).toBeUndefined();
  });

  it('stays busy after a line while the next one waits in a frame not yet played, as the original does while its queue is not empty', async () => {
    const { f, session } = await talkToTheStubNpc(5);
    const dialogue = f.screen.dialogue;
    playOut(f);
    await f.click('talkOption2');
    session.advance({ idle: true });
    const frames = f.client.takeFrames();
    const spoken = frames.flatMap((frame, k) => (frame.events?.some((e) => e.type === 'npcQuote') ? [k] : []));
    expect(spoken).toHaveLength(2);
    const second = spoken[1] ?? frames.length;
    f.client.queued = frames.slice(second);
    f.frames(frames.slice(0, second));
    playOut(f);
    expect(dialogue.presenter.busy).toBe(false);
    expect(dialogue.talk.busy).toBe(true);
    expect(f.widget('talkDone').enabled).toBe(false);
    expect(f.widget('talkOption1').enabled).toBe(false);
    f.key('Escape');
    expect(lastCommand(f)).toEqual({ type: 'approach', kind: 'direct' });
    f.client.queued = [];
    f.frames(frames.slice(second));
    f.client.refresh();
    expect(dialogue.presenter.current?.line.surface).toBe('panel');
    playOut(f);
    expect(dialogue.talk.busy).toBe(false);
    expect(f.widget('talkDone').enabled).toBe(true);
  });

  it('stays greyed out after a cut line until the next one is said, as the original does while its queue is not empty', async () => {
    const { f, session } = await talkToTheStubNpc(5);
    const dialogue = f.screen.dialogue;
    playOut(f);
    await f.click('talkOption2');
    session.advance({ idle: true });
    const frames = f.client.takeFrames();
    const second = frames.findLastIndex((frame) => frame.events?.some((e) => e.type === 'npcQuote'));
    f.frames(frames.slice(0, second));
    expect(dialogue.presenter.current?.line.surface).toBe('panel');
    f.key('Backspace');
    expect(dialogue.presenter.busy).toBe(false);
    expect(f.client.queuedFrames).toHaveLength(0);
    expect(f.client.view.conversation?.busy).toBe(true);
    expect(dialogue.talk.busy).toBe(true);
    expect(f.widget('talkOption1').enabled).toBe(false);
    expect(f.draw().items.some((i) => i.kind === 'shadow')).toBe(true);
    f.frames(frames.slice(second));
    f.client.refresh();
    playOut(f);
    expect(dialogue.talk.busy).toBe(false);
  });

  it('stops a line another viewer cut short and plays the next one when the server says it', async () => {
    const { f, session } = await talkToTheStubNpc(5);
    const presenter = f.screen.dialogue.presenter;
    playOut(f);
    await f.click('talkOption2');
    f.advance(1);
    f.deliver();
    const cut = presenter.current?.line;
    expect(cut?.surface).toBe('panel');
    expect(session.dispatch({ type: 'skipLine', profile: cut?.profile, tick: cut?.saidAt }).data).toEqual({ skipped: true });
    f.advance(1);
    f.deliver();
    expect(presenter.current?.line.saidAt).not.toBe(cut?.saidAt);
    expect(presenter.current?.line.surface).toBe('panel');
    expect(f.client.commands.some((c) => c.cmd.type === 'skipLine')).toBe(false);
  });

  it('skips a line on a click after 500 ms, stops it at once with Backspace and closes with Esc', async () => {
    const { f } = await talkToTheStubNpc(7);
    const presenter = f.screen.dialogue.presenter;
    const first = presenter.current?.line.id;
    await f.click('talkSubtitle');
    expect(presenter.current?.line.id).toBe(first);
    f.t.frame(600);
    await f.click('talkSubtitle');
    expect(presenter.current?.line.id).not.toBe(first);
    f.key('Backspace');
    playOut(f);
    f.key('Escape');
    expect(lastCommand(f)).toEqual({ type: 'closeTalk' });
    f.deliver();
    f.t.frame();
    expect(f.screen.dialogue.talk.open).toBe(false);
  });

  it('recruits the stub R.P.C. with the Recruit approach and the hire box', async () => {
    const a10 = await campaignInA10(kit, 6, 3);
    const f = await tacticalUiTest(kit, ui, 6, a10.session);
    const merc = a10.mercs[0] ?? 0;
    expect((await f.client.command({ type: 'move', soldier: merc, to: NEAR_STUB_RPC, mode: 'walk' })).ok).toBe(true);
    a10.session.advance({ idle: true });
    const talk = await f.client.command({ type: 'talk', soldier: merc, target: { npc: STUB_RPC } });
    expect(talk.ok, talk.reason).toBe(true);
    runTheLines(f, a10.session);
    expect(f.screen.dialogue.talk.profile).toBe(STUB_RPC);
    playOut(f);
    await f.click('talkOption5');
    expect(lastCommand(f)).toEqual({ type: 'approach', kind: 'recruit' });
    runTheLines(f, a10.session);
    playOut(f);
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('npcRequestBox');
    expect(f.widget('npcRequestBox').text).toContain('$');
    await f.click('npcRequestBox.yes');
    await f.settle();
    expect(lastCommand(f)).toMatchObject({ type: 'answer', choice: 'yes' });
    runTheLines(f, a10.session);
    expect(f.client.view.soldiers.find((s) => s.profile === STUB_RPC)).toMatchObject({ team: 0, kind: 'rpc' });
  });

  it('closes the hire box when another viewer answers it', async () => {
    const a10 = await campaignInA10(kit, 6, 3);
    const f = await tacticalUiTest(kit, ui, 6, a10.session);
    const merc = a10.mercs[0] ?? 0;
    expect((await f.client.command({ type: 'move', soldier: merc, to: NEAR_STUB_RPC, mode: 'walk' })).ok).toBe(true);
    a10.session.advance({ idle: true });
    expect((await f.client.command({ type: 'talk', soldier: merc, target: { npc: STUB_RPC } })).ok).toBe(true);
    runTheLines(f, a10.session);
    playOut(f);
    await f.click('talkOption5');
    runTheLines(f, a10.session);
    playOut(f);
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('npcRequestBox');
    const request = f.client.view.npcRequest;
    expect(a10.session.dispatch({ type: 'answer', prompt: request?.id, choice: 'no' }).ok).toBe(true);
    f.client.refresh();
    f.t.frame();
    await f.settle();
    expect(f.t.runtime.host.modal).toBeNull();
    expect(lastCommand(f)).toEqual({ type: 'approach', kind: 'recruit' });
  });
});
