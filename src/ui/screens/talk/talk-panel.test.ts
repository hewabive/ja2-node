import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignInA10, STUB_NPC } from '../../../../tests/support/a10-campaign.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { FINAL_TALKING_DELAY_MS, textDelay } from '../../speech.ts';
import { placeTalkPanel, popupOrientation, popupPosition } from './talk-panel.ts';

const SLOW_MS = 120_000;
const LINE_STEP_MS = 250;
const MAX_LINE_FRAMES = 400;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

function lastCommand(f: TacticalUiTest) {
  return f.client.commands.at(-1)?.cmd ?? null;
}

function playOut(f: TacticalUiTest): number {
  let frames = 0;
  while (f.screen.dialogue.presenter.busy && frames++ < MAX_LINE_FRAMES) f.t.frame(LINE_STEP_MS);
  return frames;
}

async function talkToTheStubNpc(seed: number): Promise<{ f: TacticalUiTest; merc: number }> {
  const a10 = await campaignInA10(kit, seed);
  const f = await tacticalUiTest(kit, ui, seed, a10.session);
  const merc = a10.mercs[0] ?? 0;
  const reply = await f.client.command({ type: 'talk', soldier: merc, target: { npc: STUB_NPC } });
  expect(reply.ok, reply.reason).toBe(true);
  if ((reply.data as { walking?: boolean }).walking) a10.session.advance({ idle: true });
  f.deliver();
  return { f, merc };
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
    const { f } = await talkToTheStubNpc(5);
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
    f.deliver();
    expect(dialogue.presenter.busy).toBe(true);
    playOut(f);

    await f.click('talkDone');
    expect(lastCommand(f)).toEqual({ type: 'closeTalk' });
    f.deliver();
    f.t.frame();
    expect(dialogue.talk.open).toBe(false);
    expect(f.find('talkDone')).toBeUndefined();
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
});
