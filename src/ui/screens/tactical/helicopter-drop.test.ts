import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { Session } from '../../../server/session.ts';
import { sectorInfo } from '../../../sim/strategic/map/sectors.ts';
import { sectorMapOf } from '../../../sim/tactical/state.ts';
import { MouseButton } from '../../input/events.ts';

const SEED = 61;
const LANDING = 'A9';
const SCREEN_EDGE = 2;
const FRAMES = 6;
const LAND = { type: 'compressTime', mode: 2 } as const;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

interface Drop {
  readonly f: TacticalUiTest;
  readonly campaign: CampaignSession;
  readonly north: number;
}

async function dropping(): Promise<Drop> {
  const campaign = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), SEED, { mercs: 2, land: false });
  Object.assign(sectorInfo(campaign.campaign.state.map, parseSectorString(LANDING)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const session = new Session('helicopter-drop', campaign);
  const f = await tacticalUiTest(kit, ui, SEED, session);
  await campaign.prepare(LAND);
  expect(session.dispatch(LAND)).toMatchObject({ ok: true });
  f.deliver();
  const t = campaign.campaign.tactical?.state;
  if (!t?.helicopterDrop.running) throw new Error('no run of the drop');
  return { f, campaign, north: sectorMapOf(t).info.northGridNo };
}

function skips(f: TacticalUiTest): number {
  return f.client.commands.filter((c) => c.cmd.type === 'skipHelicopterDrop').length;
}

function escapeKey(f: TacticalUiTest, kind: 'keyDown' | 'keyUp'): void {
  f.t.runtime.input({ kind, key: 'Escape', code: 'Escape', modifiers: 0 });
}

describe('the tactical screen through a run of the helicopter drop', () => {
  it('centres the view on the north entry point as the run starts and locks the interface under the wait cursor until it ends (GameScreen.cc:352, Handle_UI.cc:4015)', async () => {
    const { f, north } = await dropping();
    expect(f.world.centred.at(-1)).toBe(north);
    f.t.frame();
    expect([f.screen.controls.lockState(), f.screen.controls.input.lock]).toEqual(['helicopterDrop', 'helicopterDrop']);
    f.t.move(100, 100);
    f.t.frame();
    const regions = f.t.runtime.regions;
    expect([regions.current?.id, regions.current?.cursor]).toEqual(['tacticalLock', f.t.runtime.cursor.idOf('CURSOR_WAIT')]);
    escapeKey(f, 'keyDown');
    await f.settle();
    escapeKey(f, 'keyUp');
    f.deliver();
    f.t.frame();
    expect([f.screen.controls.lockState(), regions.current?.id]).toEqual(['none', 'tacticalViewport']);
  });

  it('moves the view neither by the screen edge nor by a locate while the run goes on, as gfIgnoreScrolling holds (RenderWorld.cc:1938, :3578)', async () => {
    const { f } = await dropping();
    f.t.runtime.input({ kind: 'pointerMove', x: SCREEN_EDGE, y: 100, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
    for (let frame = 0; frame < FRAMES; frame++) f.t.frame(20);
    expect([f.world.scrollingIgnored, f.world.scrolled]).toEqual([true, []]);
  });

  it('lands the seats left once while Esc is held during a run, leaves the stop of that press to the skip, which stops the merc it selects on the server, and sends no skip once the run is over (Merc_Entering.cc:462, Turn_Based_Input.cc:2313)', async () => {
    const { f, campaign } = await dropping();
    f.session.advance({ events: ['mercDropped'] });
    f.deliver();
    await f.settle();
    expect([skips(f), f.screen.selected]).toEqual([0, 0]);
    escapeKey(f, 'keyDown');
    for (let frame = 0; frame < FRAMES; frame++) f.t.frame();
    await f.settle();
    expect(f.client.commands.map((c) => [c.cmd.type, c.reply.ok])).toEqual([['skipHelicopterDrop', true]]);
    const t = campaign.campaign.tactical?.state;
    const first = t?.soldiers[t.turn.selected];
    expect([t?.helicopterDrop.running, first?.id, first?.finalDestination]).toEqual([false, 0, first?.gridNo]);
    f.deliver();
    for (let frame = 0; frame < FRAMES; frame++) f.t.frame();
    expect([skips(f), f.world.scrollingIgnored]).toEqual([1, false]);
    escapeKey(f, 'keyUp');
    escapeKey(f, 'keyDown');
    f.t.frame();
    await f.settle();
    expect(f.client.commands.map((c) => c.cmd.type)).toEqual(['skipHelicopterDrop', 'stop']);
    escapeKey(f, 'keyUp');
  });
});
