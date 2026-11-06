import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, type TacticalUiTest, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { TacticalSession } from '../../../server/sandbox.ts';
import { createItem } from '../../../sim/items/object.ts';
import { InvSlot } from '../../../sim/tactical/inventory.ts';
import { removeSoldierFromTacticalSector } from '../../../sim/tactical/sector-presence.ts';
import { type Soldier, Team } from '../../../sim/tactical/soldier.ts';
import { type TacticalState, teamMembers } from '../../../sim/tactical/state.ts';
import { MouseButton } from '../../input/events.ts';

const SECTOR_NOT_CLEARED = 44;
const AUTOBANDAGE_NOT_NEEDED = 116;
const BEGIN_AUTOBANDAGE_PROMPT_STR = 1;
const WOUNDED = { life: 60, bleeding: 8 };
const FULL_KIT = 100;
const EDGE_SCROLL_FRAMES = 5;
const EDGE_SCROLL_FRAME_MS = 20;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function sandboxOf(f: TacticalUiTest): TacticalState {
  const sim = f.session.sim;
  if (!(sim instanceof TacticalSession)) throw new Error('the UI test runs a sandbox');
  return sim.sim.state;
}

function clearedWithAPatient(f: TacticalUiTest): Soldier {
  const t = sandboxOf(f);
  for (const enemy of teamMembers(t, Team.ENEMY)) removeSoldierFromTacticalSector(t, enemy);
  const [medic, patient] = teamMembers(t, Team.OUR);
  if (!medic || !patient) throw new Error('the sandbox has no two mercs');
  medic.inv[InvSlot.BIGPOCK1] = createItem(t.content.items, t.content.items.byName.get('FIRSTAIDKIT')?.index ?? 0, FULL_KIT);
  Object.assign(patient, WOUNDED);
  f.client.refresh();
  return patient;
}

describe('auto-bandage on the tactical screen (Turn_Based_Input.cc a, Auto_Bandage.cc)', () => {
  it("shows BeginAutoBandage's OK box for the first check that fails", async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    f.key('a');
    await f.settle();
    expect(f.client.commands.at(-1)).toMatchObject({
      cmd: { type: 'autoBandage' },
      reply: { ok: false, data: { refusal: 'sectorNotCleared' } },
    });
    expect(f.t.runtime.host.modal?.id).toBe('messageBox');
    expect(f.widget('messageBox').text).toBe(f.text.string('Message', SECTOR_NOT_CLEARED));
  });

  it('shows the OK box of a question a won battle left pending when the sector changed meanwhile', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    const t = sandboxOf(f);
    for (const enemy of teamMembers(t, Team.ENEMY)) removeSoldierFromTacticalSector(t, enemy);
    t.autoBandage.pending = true;
    f.advance(1);
    f.deliver();
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('messageBox');
    expect(f.widget('messageBox').text).toBe(f.text.string('TacticalStr', AUTOBANDAGE_NOT_NEEDED));
  });

  it('asks, shows the box of medics and patients over the frozen screen, which neither scrolls nor takes another key, and ends with Done', async () => {
    const f = await tacticalUiTest(kit, ui, 5);
    const patient = clearedWithAPatient(f);
    f.key('a');
    await f.settle();
    expect(f.t.runtime.host.modal?.id).toBe('itemPromptBox');
    expect(f.widget('itemPromptBox').text).toBe(f.text.string('TacticalStr', BEGIN_AUTOBANDAGE_PROMPT_STR));
    await f.click('itemPromptBox.yes');
    await f.settle();
    const box = f.client.view.autoBandage;
    expect(box).toMatchObject({ complete: false, patients: [patient.id] });
    expect(f.widget('autoBandageBox')).toMatchObject({ visible: true, state: 'running' });
    expect([f.widget('autoBandageBox.done').enabled, f.widget('autoBandageBox.cancel').enabled]).toEqual([false, true]);
    expect(f.draw().items[0]).toMatchObject({ kind: 'snapshot' });
    f.key('m');
    f.key('Insert');
    expect([f.flow, f.screen.controls.overhead.open]).toEqual([[], false]);
    f.t.runtime.input({ kind: 'pointerMove', x: 2, y: 100, button: MouseButton.LEFT, buttons: 0, wheel: 0, modifiers: 0 });
    for (let i = 0; i < EDGE_SCROLL_FRAMES; i++) f.t.frame(EDGE_SCROLL_FRAME_MS);
    expect(f.world.scrolled).toEqual([]);

    expect(f.session.advance({ idle: true }).reason).toBe('idle');
    f.deliver();
    expect(f.widget('autoBandageBox').state).toBe('complete');
    expect([f.widget('autoBandageBox.done').enabled, f.widget('autoBandageBox.cancel').enabled]).toEqual([true, false]);
    await f.click('autoBandageBox.done');
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'endAutoBandage' }, reply: { ok: true } });
    f.advance(1);
    f.deliver();
    expect(f.client.view.autoBandage ?? null).toBeNull();
    expect(f.find('autoBandageBox')).toBeUndefined();
    expect(f.draw().items.some((i) => i.kind === 'snapshot')).toBe(false);
    expect([f.flow, f.screen.controls.overhead.open]).toEqual([[], false]);
  });
});
