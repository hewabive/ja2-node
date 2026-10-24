import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serialisedView, withQueries } from '../../../../tests/support/hints.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { inTheInterrogation } from '../../../../tests/support/story.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { MusicMode } from '../../../protocol/music-modes.ts';

const SLOW_MS = 120_000;
const SEED = 51;
const QUEEN = 75;
const LINE_STEP_MS = 250;
const MAX_LINE_FRAMES = 400;
const REQUEST_BOX = 'npcRequestBox';
const STEP_TICKS = 20;
const MAX_STEPS = 600;
const MAX_ADVANCES = 6;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
}, SLOW_MS);

afterAll(async () => {
  await kit.dispose();
});

function playOut(f: TacticalUiTest): void {
  for (let frames = 0; f.screen.dialogue.presenter.busy && frames < MAX_LINE_FRAMES; frames++) f.t.frame(LINE_STEP_MS);
}

describe('the interrogation on the tactical screen (docs/28 §10.1, docs/26 §2.3)', { timeout: SLOW_MS }, () => {
  it('shows the Queen’s talk panel, then the YES/NO/LIE box once the panel is gone, refuses every other command, ignores Escape and ends with the enemy-present music', async () => {
    const { session } = await inTheInterrogation(kit, SEED);
    const sources = { read: kit.read, exists: (p: string) => kit.worlds.exists(p), world: (p: string) => kit.worlds.world(p) };
    const f = await tacticalUiTest(kit, ui, SEED, withQueries(session, sources));
    expect(f.client.view.strategic?.flow).toBe('meanwhile');
    expect(f.client.view.meanwhile).toEqual({ seq: 1, scene: 'interrogation' });
    expect(serialisedView(session).music?.mode).toBe(MusicMode.TACTICAL_NOTHING);
    const stood = await f.client.command({
      type: 'stance',
      soldier: f.client.view.soldiers.find((s) => s.team === 0)?.id ?? 0,
      stance: 'crouch',
    });
    expect(stood).toMatchObject({ ok: false, data: { refusal: 'inMeanwhile' } });
    let panelOpened = false;
    for (let k = 0; k < MAX_STEPS && !f.client.view.npcRequest; k++) {
      session.advance({ ticks: STEP_TICKS });
      f.deliver();
      await f.settle(1);
      if (!panelOpened && f.screen.dialogue.talk.open && f.screen.dialogue.talk.profile === QUEEN) {
        panelOpened = true;
        f.key('Escape');
        await f.settle(1);
        expect(session.sim.view().meanwhile).toEqual({ seq: 1, scene: 'interrogation' });
      }
    }
    expect(panelOpened).toBe(true);
    expect(f.client.view.npcRequest).toMatchObject({ request: 'lie', choices: ['yes', 'no', 'lie'] });
    playOut(f);
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe(REQUEST_BOX);
    expect(['yes', 'no', 'ok'].map((b) => f.find(`${REQUEST_BOX}.${b}`)?.text)).toEqual(['YES', 'NO', 'LIE']);
    expect(f.screen.dialogue.talk.open).toBe(false);
    f.key('Escape');
    expect(f.t.runtime.host.modal?.id).toBe(REQUEST_BOX);
    expect(session.sim.view().meanwhile).toEqual({ seq: 1, scene: 'interrogation' });
    await f.click(`${REQUEST_BOX}.yes`);
    await f.settle();
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'answer', choice: 'yes' }, reply: { ok: true } });
    for (let k = 0; k < MAX_ADVANCES && f.client.view.strategic?.flow === 'meanwhile'; k++) {
      session.advance({ idle: true });
      f.deliver();
    }
    expect(f.client.view.strategic?.flow).toBe('tactical');
    expect(f.client.view.meanwhile ?? null).toBeNull();
    expect(serialisedView(session).music?.mode).toBe(MusicMode.TACTICAL_ENEMY_PRESENT);
  });
});
