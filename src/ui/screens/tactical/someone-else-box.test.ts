import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSoldier } from '../../../../tests/support/combat.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../../../tests/support/sectors.ts';
import { type TacticalUiKit, tacticalUiKit, tacticalUiTest } from '../../../../tests/support/tactical-ui.ts';
import { MercType } from '../../../content/strategic/economy-content.ts';
import { parseSectorString, sameSector } from '../../../content/strategic/sector-ids.ts';
import { Direction, gridNo } from '../../../content/world/grid.ts';
import { createCampaignSession } from '../../../server/campaign-factory.ts';
import type { CampaignSession } from '../../../server/campaign-session.ts';
import { Session } from '../../../server/session.ts';
import { removeGroup } from '../../../sim/strategic/forces/groups.ts';
import { sectorInfo } from '../../../sim/strategic/map/sectors.ts';
import { soldierTakeDamage } from '../../../sim/tactical/combat/hit.ts';
import { DamageReason } from '../../../sim/tactical/combat/types.ts';
import { TEAM_FIRST_ID, Team } from '../../../sim/tactical/soldier.ts';

const SEED = 61;
const KESTREL = 0;
const VANT = 1;
const MORAGA = 2;
const LANDING = 'A9';
const WILDERNESS = 'B9';
const ROUTE_SLICE_SECONDS = 3600;
const ROUTE_BUDGET = 24;
const OUT_OF_SIGHT = gridNo(20, 80);
const KILLING_BLOW = 100;
const LOOK_BUDGET = { ticks: 2000 };
const NS_SOMEONE_ELSE_IN_SECTOR = 2;

let kit: StubSectorKit;
let ui: TacticalUiKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  ui = await tacticalUiKit(kit);
});

afterAll(async () => {
  await kit.dispose();
});

function never(what: string): never {
  throw new Error(`no ${what}`);
}

async function order(campaign: CampaignSession, session: Session, cmd: { readonly type: string; readonly [key: string]: unknown }) {
  await campaign.prepare(cmd);
  expect(session.dispatch(cmd)).toMatchObject({ ok: true });
}

function quiet(campaign: CampaignSession): void {
  const map = campaign.campaign.state.map;
  for (const name of [LANDING, WILDERNESS])
    Object.assign(sectorInfo(map, parseSectorString(name)), { numAdmins: 0, numTroops: 0, numElites: 0 });
  const ctx = campaign.campaign.strategic ?? never('strategic layer');
  for (const g of ctx.state.forces.groups.filter((group) => !group.player)) removeGroup(ctx, g, true);
}

function vantOf(campaign: CampaignSession) {
  return campaign.campaign.battle?.roster.all().find((m) => m.profile === VANT) ?? never('Vant');
}

function npcStandsInTheWilderness(campaign: CampaignSession): void {
  const types = campaign.campaign.economy?.economy.mercTypes ?? never('merc types');
  const [npc] = [...types].find(([, type]) => type === MercType.NPC) ?? never('NPC profile');
  const sector = parseSectorString(WILDERNESS);
  const p = campaign.campaign.narrative.profile(npc) ?? never('NPC progress');
  Object.assign(p, { sectorX: sector.x, sectorY: sector.y, sectorZ: 0, lastDateSpokenTo: 0 });
}

async function vantInTheWilderness(campaign: CampaignSession, session: Session): Promise<void> {
  quiet(campaign);
  await order(campaign, session, { type: 'compressTime', mode: 2 });
  await order(campaign, session, { type: 'skipHelicopterDrop' });
  await order(campaign, session, { type: 'enterSector', sector: LANDING });
  session.advance({ idle: true });
  await order(campaign, session, { type: 'mapScreen' });
  await order(campaign, session, { type: 'assignSquad', soldier: vantOf(campaign).id, squad: 'new' });
  await order(campaign, session, { type: 'route', soldier: vantOf(campaign).id, to: WILDERNESS });
  const arrived = () => sameSector(vantOf(campaign).sector, parseSectorString(WILDERNESS)) && !vantOf(campaign).betweenSectors;
  for (let k = 0; k < ROUTE_BUDGET && !arrived(); k++) session.advance({ worldSeconds: ROUTE_SLICE_SECONDS });
  if (!arrived()) throw new Error(`Vant did not reach ${WILDERNESS}`);
  npcStandsInTheWilderness(campaign);
  await order(campaign, session, { type: 'enterSector', sector: WILDERNESS });
  session.advance({ idle: true });
}

function winTheBattle(campaign: CampaignSession, session: Session): void {
  const sim = campaign.campaign.tactical ?? never('loaded sector');
  let id = TEAM_FIRST_ID[Team.ENEMY];
  while (sim.state.soldiers[id]) id++;
  const enemy = spawnSoldier(sim, id, Team.ENEMY, OUT_OF_SIGHT, Direction.NORTH);
  sim.state.turn.enemyInSector = true;
  soldierTakeDamage(sim.state, enemy, KILLING_BLOW, KILLING_BLOW, DamageReason.BLOODLOSS, null);
  session.advance({ events: ['combatEnded'] });
}

describe('the someone-else box on the tactical screen (Overhead.cc HandleThePlayerBeNotifiedOfSomeoneElseInSector)', () => {
  it('shows NS_SOMEONE_ELSE_IN_SECTOR in an OK box and answers ok', async () => {
    const campaign = await createCampaignSession(kit.read, (p) => kit.worlds.exists(p), SEED, {
      profiles: [KESTREL, VANT, MORAGA],
      land: false,
    });
    const session = new Session('someone-else', campaign);
    const f = await tacticalUiTest(kit, ui, SEED, session);
    await vantInTheWilderness(campaign, session);
    winTheBattle(campaign, session);
    expect(session.advance(LOOK_BUDGET).reason).toBe('decision');
    f.deliver();
    await f.settle();
    const prompt = f.client.view.prompt;
    expect(prompt).toMatchObject({ kind: 'someoneElseInSector', sector: WILDERNESS, choices: ['ok'] });
    expect(f.t.runtime.host.modal?.id).toBe('someoneElseBox');
    const text = f.text.string('new-strings', NS_SOMEONE_ELSE_IN_SECTOR);
    expect(text).toBeTruthy();
    expect(f.widget('someoneElseBox').text).toBe(text);
    await f.click('someoneElseBox.ok');
    await f.settle();
    expect(f.client.commands.at(-1)).toMatchObject({ cmd: { type: 'answer', prompt: prompt?.id, choice: 'ok' }, reply: { ok: true } });
    expect(f.client.view.prompt ?? null).toBeNull();
    expect(f.t.runtime.host.modal).toBeNull();
  });
});
