import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { TacticalSession } from '../../../server/sandbox.ts';
import { createItem, ObjectFlags } from '../../../sim/items/object.ts';
import { Team } from '../../../sim/tactical/soldier.ts';
import { teamMembers } from '../../../sim/tactical/state.ts';
import { addItemToPool, Visibility } from '../../../sim/tactical/world-items.ts';

const KNOWN_TRAP = 2;
const DISARM_BOOBYTRAP_PROMPT = 24;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

describe('a tactical item prompt on the tactical screen (Handle_Items.cc ContinuePastBoobyTrap)', () => {
  it('asks DISARM_BOOBYTRAP_PROMPT in a yes/no box and answers no', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    const sim = f.session.sim;
    if (!(sim instanceof TacticalSession)) throw new Error('the UI test runs a sandbox');
    const t = sim.sim.state;
    const merc = teamMembers(t, Team.OUR)[0];
    if (!merc) throw new Error('the sandbox has no merc');
    const canteen = createItem(t.content.items, t.content.items.byName.get('CANTEEN')?.index ?? 0, 100);
    canteen.trap = KNOWN_TRAP;
    canteen.flags |= ObjectFlags.KNOWN_TO_BE_TRAPPED;
    addItemToPool(t, merc.gridNo, canteen, Visibility.VISIBLE, 0);
    expect(f.session.dispatch({ type: 'pickUp', soldier: merc.id })).toMatchObject({ ok: true });
    expect(f.session.advance({ idle: true }).reason).toBe('decision');
    f.deliver();
    await f.settle();
    const prompt = f.client.view.prompt;
    expect(prompt).toMatchObject({ kind: 'disarmTrap', soldier: merc.id, buried: false, item: 'CANTEEN' });
    expect(f.t.runtime.host.modal?.id).toBe('itemPromptBox');
    expect(f.widget('itemPromptBox').text).toBe(f.text.string('TacticalStr', DISARM_BOOBYTRAP_PROMPT));
    await f.click('itemPromptBox.no');
    await f.settle();
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'answer', prompt: prompt?.id, choice: 'no' }, reply: { ok: true } });
    expect(f.client.view.prompt ?? null).toBeNull();
    expect(f.t.runtime.host.modal).toBeNull();
  });
});
