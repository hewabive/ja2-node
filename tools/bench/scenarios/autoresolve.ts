import { sectorId } from '../../../src/content/strategic/sector-ids.ts';
import { PreRandom, Rng } from '../../../src/core/rng.ts';
import { stubMerc } from '../../../src/server/stub-mercs.ts';
import { gameOptions } from '../../../src/sim/options.ts';
import { calcDifficultyModifier } from '../../../src/sim/strategic/ai/difficulty.ts';
import { runAutoresolve } from '../../../src/sim/strategic/forces/autoresolve/loop.ts';
import { enterAutoresolve } from '../../../src/sim/strategic/forces/autoresolve/setup.ts';
import {
  type AutoresolveEnv,
  type AutoresolveInput,
  BattleStatus,
  createAutoresolveState,
  MAX_AR_ENEMIES,
  MAX_AR_MERCS,
} from '../../../src/sim/strategic/forces/autoresolve/state.ts';
import { Difficulty, EncounterCode } from '../../../src/sim/strategic/forces/constants.ts';
import type { TacticalContent } from '../../../src/sim/tactical/content.ts';
import { createMercFromProfile } from '../../../src/sim/tactical/creation.ts';
import {
  type AutoresolveCreation,
  tacticalCreateEnemySoldierForAutoresolve,
  tacticalCreateMilitiaForAutoresolve,
} from '../../../src/sim/tactical/creation-basic.ts';
import { createEquipmentState } from '../../../src/sim/tactical/equipment.ts';
import { PlacementVerdict } from '../../../src/sim/tactical/narrative/placement.ts';
import { type ProfileProgress, progressFromProfile } from '../../../src/sim/tactical/profiles.ts';
import { type Soldier, SoldierClass, TEAM_FIRST_ID, Team } from '../../../src/sim/tactical/soldier.ts';
import { AUTORESOLVE_COUNTERS } from '../inspector.ts';
import { type BenchContext, measure, type VariantSpec } from '../measure.ts';

export const AUTORESOLVE = 'autoresolve';

const SIDES = [10, 20, 40] as const;
const BATTLE_TARGET_MS = 10;
const BATTLES_PER_RUN = 20;
const MAX_SLICES = 100_000;
const SECTOR = { x: 9, y: 1 };
const ELITE_SHARE = 4;
const MERC_DIRECTION = 4;
const MERC_GROUP = 1;
const ENEMY_GROUP = 2;
const FX_SALT = 0x5f3759df;
const BATTLE_DAY = 1;
const NO_TOWN = 0;

interface Battle {
  readonly input: AutoresolveInput;
  readonly profiles: Map<number, ProfileProgress>;
  readonly seed: number;
}

function creation(content: TacticalContent, rng: Rng): AutoresolveCreation {
  const inputs = {
    difficulty: Difficulty.MEDIUM,
    highestProgress: 0,
    predictedMineIncome: 0,
    battleSector: SECTOR,
    battleSectorTownId: NO_TOWN,
  };
  const difficultyModifier = (soldierClass: number) => calcDifficultyModifier(inputs, soldierClass);
  const options = gameOptions();
  return {
    create: {
      rng,
      content,
      options,
      equipment: { ...createEquipmentState(content.items, options), autoResolveActive: true },
      campaign: { difficultyModifier: difficultyModifier(SoldierClass.ARMY), progress: 0 },
    },
    population: {
      difficultyModifier,
      difficulty: Difficulty.MEDIUM,
      bloodcatLair: false,
      locationModifier: 0,
      autoResolveActive: true,
      profileHere: () => false,
      iceCreamTruckWithheld: () => false,
      civilianPlacement: () => PlacementVerdict.CREATE,
      upgradeEliteToProfiledEnemy: () => {},
      resetProfiledEnemyAdded: () => {},
    },
  };
}

function merc(content: TacticalContent, index: number, profiles: Map<number, ProfileProgress>): Soldier {
  const id = (TEAM_FIRST_ID[Team.OUR] ?? 0) + index;
  const profile = content.profiles[index];
  if (!profile) return stubMerc(content, id);
  profiles.set(profile.id, progressFromProfile(profile));
  return createMercFromProfile({ content, options: { gunNut: false } }, id, profile, MERC_DIRECTION);
}

function created(s: Soldier | null, what: string): Soldier {
  if (!s) throw new Error(`bench: could not create ${what}`);
  return s;
}

function battle(content: TacticalContent, side: number, seed: number): Battle {
  const rng = Rng.fromSeed(seed);
  const c = creation(content, rng);
  const profiles = new Map<number, ProfileProgress>();
  const mercCount = Math.min(MAX_AR_MERCS, Math.ceil(side / 2));
  const enemyCount = Math.min(MAX_AR_ENEMIES, side);
  const mercs = Array.from({ length: mercCount }, (_, i) => ({ soldier: merc(content, i, profiles), groupId: MERC_GROUP }));
  const militia = Array.from({ length: side - mercCount }, () =>
    created(tacticalCreateMilitiaForAutoresolve(c, SoldierClass.REG_MILITIA), 'militia'),
  );
  const enemies = Array.from({ length: enemyCount }, (_, i) => ({
    soldier: created(
      tacticalCreateEnemySoldierForAutoresolve(c, i < enemyCount / ELITE_SHARE ? SoldierClass.ELITE : SoldierClass.ARMY),
      'an enemy',
    ),
    groupId: ENEMY_GROUP,
  }));
  return { input: { sector: sectorId(SECTOR), encounter: EncounterCode.ENEMY_INVASION, mercs, militia, enemies }, profiles, seed };
}

function env(content: TacticalContent, b: Battle): AutoresolveEnv {
  const main = Rng.fromSeed(b.seed);
  return {
    content,
    profiles: b.profiles,
    rng: { main, pre: PreRandom.create(main), fx: Rng.fromSeed(b.seed ^ FX_SALT) },
    world: { day: BATTLE_DAY, playerCapturedForRescue: false },
    hooks: { surrender: () => 'reject' },
  };
}

function variant(ctx: BenchContext, side: number): VariantSpec<{ content: TacticalContent; battles: Battle[] }> {
  return {
    variant: `side-${side}`,
    metric: 'battle',
    unit: 'ms',
    target: BATTLE_TARGET_MS,
    calls: AUTORESOLVE_COUNTERS,
    perSample: true,
    setup: async () => {
      const content = await ctx.data.content();
      return { content, battles: Array.from({ length: BATTLES_PER_RUN }, (_, i) => battle(content, side, ctx.seed * BATTLES_PER_RUN + i)) };
    },
    run: ({ content, battles }) => {
      const samples: number[] = [];
      const slices: number[] = [];
      let victories = 0;
      for (const b of battles) {
        const e = env(content, b);
        const t0 = performance.now();
        const ar = createAutoresolveState(b.input);
        enterAutoresolve(e, ar);
        runAutoresolve(e, ar, { maxSlices: MAX_SLICES });
        samples.push(performance.now() - t0);
        slices.push(ar.slices);
        if (ar.status === BattleStatus.VICTORY) victories++;
      }
      const first = battles[0]?.input;
      return {
        samples,
        work: { slices: slices.reduce((a, b) => a + b, 0), victories },
        series: { slicesPerBattle: slices },
        counters: {
          battles: battles.length,
          victories,
          mercs: first?.mercs.length ?? 0,
          militia: first?.militia.length ?? 0,
          enemies: first?.enemies.length ?? 0,
        },
      };
    },
  };
}

export async function autoresolve(ctx: BenchContext): Promise<void> {
  for (const side of SIDES) await measure(ctx, AUTORESOLVE, variant(ctx, side));
}
