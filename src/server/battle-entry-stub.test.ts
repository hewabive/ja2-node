import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARRIVAL_WAIT_SECONDS,
  arrangeBattle,
  BATTLE_BASE_SAVE,
  BATTLE_SECTOR,
  BattleVariant,
  campaignOf,
} from '../../tests/support/battle-entry.ts';
import { buildMapScreenCampaign } from '../../tests/support/e2e-campaign-saves.ts';
import { createSaveKit, type SaveKit } from '../../tests/support/saves.ts';
import { loadStubSectorKit, type StubSectorKit } from '../../tests/support/sectors.ts';
import { parseSectorString, sectorId, strategicIndex } from '../content/strategic/sector-ids.ts';
import type { PlayerView, PromptView, StrategicMercView } from '../protocol/view.ts';
import { onlyHostileCiviliansInSector } from '../sim/campaign/battle-flow.ts';
import type { SimEvent } from '../sim/events.ts';
import { Body, type Soldier, Team } from '../sim/tactical/soldier.ts';
import type { TacticalState } from '../sim/tactical/state.ts';
import type { Session } from './session.ts';

const SETUP_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 120_000;
const CREATURES = 3;

let kit: StubSectorKit;
let saves: SaveKit;

beforeAll(async () => {
  kit = await loadStubSectorKit();
  saves = await createSaveKit(kit);
  const { session } = await buildMapScreenCampaign(saves, kit);
  const saved = await saves.saves.save(session, { name: BATTLE_BASE_SAVE, description: 'battle entry base' });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await saves.dispose();
  await kit.dispose();
});

interface Battle {
  readonly session: Session;
  readonly events: SimEvent[];
}

async function battle(variant: BattleVariant | null): Promise<Battle> {
  const session = await saves.open({ load: BATTLE_BASE_SAVE, reseed: false });
  const events: SimEvent[] = [];
  session.subscribe((m) => {
    if (m.t === 'frames') for (const f of m.frames) events.push(...(f.events ?? []));
  });
  if (variant) {
    arrangeBattle(session, variant);
    session.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS });
  }
  return { session, events };
}

function view(session: Session): PlayerView {
  return JSON.parse(JSON.stringify(session.sim.view())) as PlayerView;
}

function prompt<K extends PromptView['kind']>(session: Session, kind: K): Extract<PromptView, { kind: K }> {
  const p = view(session).prompt;
  if (p?.kind !== kind) throw new Error(`expected a ${kind} prompt, got ${JSON.stringify(p)}`);
  return p as Extract<PromptView, { kind: K }>;
}

function merc(session: Session, id: number): StrategicMercView {
  const m = view(session).strategic?.mercs.find((x) => x.id === id);
  if (!m) throw new Error(`no merc ${id}`);
  return m;
}

describe('the pre-battle prompt on the stub map-screen campaign', () => {
  it(
    'shows the persistent panel of an invasion with the locator, the involved rows and the plural count',
    async () => {
      const { session } = await battle(BattleVariant.RETREAT);
      const p = prompt(session, 'preBattle');
      expect(p).toMatchObject({ sector: BATTLE_SECTOR, persistent: true, encounter: 'enemyInvasion', involvedGroups: 1 });
      expect(p.involved).toHaveLength(4);
      expect(p.involved.every((m) => m.condition === 'excellent' && m.hp === 100)).toBe(true);
      expect(p.uninvolved).toEqual([]);
      expect(p.options.map((o) => [o.choice, o.enabled])).toEqual([
        ['autoresolve', true],
        ['enterSector', true],
        ['retreat', true],
      ]);
      expect(view(session).strategic?.battleLocator).toBe(BATTLE_SECTOR);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'lists an uninvolved merc with the original destination rule and the contract departure',
    async () => {
      const { session } = await battle(null);
      const campaign = campaignOf(session).campaign;
      const roster = campaign.battle?.roster.all() ?? [];
      const away = roster[0];
      if (!away) throw new Error('no merc');
      away.sector = { ...parseSectorString('C13'), z: 0 };
      away.path.splice(0, away.path.length, strategicIndex(parseSectorString('B13')));
      arrangeBattle(session, BattleVariant.RETREAT);
      session.advance({ worldSeconds: ARRIVAL_WAIT_SECONDS });
      const p = prompt(session, 'preBattle');
      const row = p.uninvolved.find((u) => u.soldier === away.id);
      expect(row).toMatchObject({ location: 'C13', destination: 'B13', betweenSectors: false });
      const contract = merc(session, away.id).contract;
      expect(row?.departure).toBe(contract && 'minutesLeft' in contract ? (contract.minutesLeft ?? null) : null);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('the autoresolve view and events', () => {
  it(
    'carries the encounter, the merc faces and the female flag, names the weapons of shots and the bandage state',
    async () => {
      const { session, events } = await battle(BattleVariant.VICTORY);
      const pbi = prompt(session, 'preBattle');
      expect(session.dispatch({ type: 'answer', prompt: pbi.id, choice: 'autoresolve' }).ok).toBe(true);
      const ar = campaignOf(session).campaign.state.battle.autoresolve?.ar;
      const enemy = ar?.enemies[0];
      if (!enemy) throw new Error('no enemy cell');
      enemy.soldier.bodyType = Body.REGFEMALE;
      const started = view(session).autoresolve;
      expect(started?.encounter).toBe('enemyInvasion');
      for (const cell of started?.cells.filter((c) => c.side === 'merc') ?? [])
        expect(cell.profile).toBe(merc(session, cell.soldier ?? -1).profile);
      expect(started?.cells.find((c) => c.side === 'enemy')).toMatchObject({ female: true });
      session.advance({ idle: true });
      const shots = events.filter((e) => e.type === 'arAttack' && e.kind === 'shot');
      expect(shots.length).toBeGreaterThan(0);
      expect(shots.every((e) => e.type === 'arAttack' && typeof e.weapon === 'number')).toBe(true);
      const done = prompt(session, 'autoresolveDone');
      expect(done.status).toBe('victory');
      expect(done.bandageRefusal === null || ['nobodyWounded', 'noDoctor', 'noKit'].includes(done.bandageRefusal ?? '')).toBe(true);
      expect(done.canBandage).toBe(done.bandageRefusal === null);
      if (done.canBandage) {
        const bandaged = session.dispatch({ type: 'answer', prompt: done.id, choice: 'bandage' });
        expect(bandaged).toMatchObject({ ok: true, data: { bandaged: expect.stringMatching(/^(complete|incomplete)$/) } });
      } else
        expect(session.dispatch({ type: 'answer', prompt: done.id, choice: 'bandage' })).toMatchObject({
          ok: false,
          data: { refusal: done.bandageRefusal },
        });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'emits the panel with an automatic start, before the battle begins',
    async () => {
      const { session, events } = await battle(null);
      const campaign = campaignOf(session).campaign;
      campaign.state.creatures.attack.sectorId = sectorId(parseSectorString(BATTLE_SECTOR));
      campaign.state.creatures.attack.numAttacking = CREATURES;
      campaign.battle?.openCreatureAttack(true);
      const emitted = campaign.battle?.drainEvents() ?? [];
      const pre = emitted.find((e) => e.type === 'preBattle');
      expect(pre).toMatchObject({ autoStart: true, encounter: 'creatureAttack', panel: { sector: BATTLE_SECTOR, enemies: 'unknown' } });
      if (pre?.type !== 'preBattle') return;
      expect(pre.panel?.involved).toHaveLength(4);
      expect(events.some((e) => e.type === 'preBattle')).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('the stub battles the end-to-end spec plays', () => {
  async function outcome(variant: BattleVariant, retreat: boolean): Promise<string> {
    const { session } = await battle(variant);
    const pbi = prompt(session, 'preBattle');
    expect(session.dispatch({ type: 'answer', prompt: pbi.id, choice: 'autoresolve' }).ok).toBe(true);
    if (retreat) expect(session.dispatch({ type: 'autoresolveRetreat' }).ok).toBe(true);
    session.advance({ idle: true });
    return prompt(session, 'autoresolveDone').status;
  }

  it(
    'ends the victory, defeat and retreat variants as named',
    async () => {
      expect(await outcome(BattleVariant.VICTORY, false)).toBe('victory');
      expect(await outcome(BattleVariant.DEFEAT, false)).toBe('defeat');
      expect(await outcome(BattleVariant.RETREAT, true)).toBe('retreat');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('showBattle', () => {
  it(
    'refuses without a battle and opens the non-persistent summary during a tactical battle, which closes without a choice',
    async () => {
      const quiet = await battle(null);
      expect(quiet.session.dispatch({ type: 'showBattle' })).toMatchObject({ ok: false, data: { refusal: 'noBattle' } });
      const { session } = await battle(BattleVariant.RETREAT);
      const pbi = prompt(session, 'preBattle');
      expect((await session.prepareAndDispatch({ type: 'answer', prompt: pbi.id, choice: 'enterSector' })).ok).toBe(true);
      expect(view(session).strategic?.flow).toBe('tactical');
      expect(session.dispatch({ type: 'mapScreen' }).ok).toBe(true);
      expect(view(session).strategic?.battleLocator).toBe(BATTLE_SECTOR);
      const shown = session.dispatch({ type: 'showBattle' });
      expect(shown.ok).toBe(true);
      const summary = prompt(session, 'preBattle');
      expect(summary).toMatchObject({ persistent: false, encounter: 'enemyInvasion' });
      expect(summary.options.map((o) => [o.choice, o.enabled, o.reason ?? null])).toEqual([
        ['autoresolve', true, null],
        ['enterSector', true, null],
        ['retreat', false, 'battleInProgress'],
        ['close', true, null],
      ]);
      expect(session.dispatch({ type: 'compressTime', mode: 2 }).ok).toBe(false);
      expect(session.dispatch({ type: 'answer', prompt: summary.id, choice: 'close' }).ok).toBe(true);
      expect(view(session).prompt).toBeNull();
      expect(session.dispatch({ type: 'showBattle' }).ok).toBe(true);
      const again = prompt(session, 'preBattle');
      expect(session.dispatch({ type: 'answer', prompt: again.id, choice: 'autoresolve' }).ok).toBe(true);
      expect(view(session).strategic?.flow).toBe('autoresolve');
    },
    TEST_TIMEOUT_MS,
  );

  it('sees only hostile civilians when no enemy, creature or militia is left', () => {
    const soldier = (team: number, neutral: boolean): Soldier => ({ team, neutral, placed: true, life: 30 }) as Soldier;
    const tactical = (soldiers: Soldier[]) => ({ soldiers }) as unknown as TacticalState;
    expect(onlyHostileCiviliansInSector(tactical([soldier(Team.CIV, false), soldier(Team.OUR, false)]))).toBe(true);
    expect(onlyHostileCiviliansInSector(tactical([soldier(Team.CIV, true)]))).toBe(false);
    expect(onlyHostileCiviliansInSector(tactical([soldier(Team.CIV, false), soldier(Team.ENEMY, false)]))).toBe(false);
    expect(onlyHostileCiviliansInSector(tactical([soldier(Team.CIV, false), soldier(Team.MILITIA, false)]))).toBe(false);
  });
});
