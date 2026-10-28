import { createItem } from '../../src/sim/items/object.ts';
import { initNewSoldierAnim, states } from '../../src/sim/tactical/animation.ts';
import { InvSlot } from '../../src/sim/tactical/inventory.ts';
import { setSoldierPosition } from '../../src/sim/tactical/movement.ts';
import { calcActionPoints } from '../../src/sim/tactical/points.ts';
import { Attitude, Body, createSoldier, Orders, type Soldier, Team } from '../../src/sim/tactical/soldier.ts';
import { registerSoldier } from '../../src/sim/tactical/state.ts';
import type { TacticalSim } from '../../src/sim/tactical/tactical-sim.ts';
import { combatStats } from './combat.ts';

const KITS: Readonly<Record<number, readonly [string | null, string | null]>> = {
  [Body.ADULTFEMALEMONSTER]: ['CREATURE_OLD_FEMALE_CLAWS', null],
  [Body.AM_MONSTER]: ['CREATURE_OLD_MALE_CLAWS', 'CREATURE_OLD_MALE_SPIT'],
  [Body.YAF_MONSTER]: ['CREATURE_YOUNG_FEMALE_CLAWS', null],
  [Body.YAM_MONSTER]: ['CREATURE_YOUNG_MALE_CLAWS', 'CREATURE_YOUNG_MALE_SPIT'],
  [Body.INFANT_MONSTER]: ['CREATURE_INFANT_SPIT', null],
  [Body.LARVAE_MONSTER]: [null, null],
  [Body.QUEENMONSTER]: ['CREATURE_QUEEN_SPIT', 'CREATURE_QUEEN_TENTACLES'],
  [Body.BLOODCAT]: ['BLOODCAT_CLAW_ATTACK', 'BLOODCAT_BITE'],
};

const NORMAL_HUMAN_SMELL = 10;
const NORMAL_CREATURE_SMELL = 20;

export interface CreatureOptions {
  readonly life?: number;
  readonly alert?: number;
}

export function spawnCreature(
  sim: TacticalSim,
  id: number,
  body: number,
  at: number,
  direction: number,
  options: CreatureOptions = {},
): Soldier {
  const t = sim.state;
  const content = t.content;
  const bloodcat = body === Body.BLOODCAT;
  const s = createSoldier({
    id,
    team: Team.CREATURE,
    name: `C${id}`,
    bodyType: body,
    palettes: { hair: 'BLACKHEAD', skin: 'PINKSKIN', vest: 'BLUEVEST', pants: 'JEANPANTS' },
    stats: combatStats(70),
    life: options.life ?? 60,
    gridNo: at,
    direction,
    state: states(content.animations).STANDING,
    ai: {
      orders: bloodcat ? Orders.SEEKENEMY : Orders.FARPATROL,
      attitude: Attitude.AGGRESSIVE,
      ...(options.alert === undefined ? {} : { alertStatus: options.alert }),
    },
  });
  s.monsterOrAnimal = true;
  if (bloodcat) s.normalSmell = NORMAL_HUMAN_SMELL;
  else s.monsterSmell = NORMAL_CREATURE_SMELL;
  const [hand, second] = KITS[body] ?? [null, null];
  if (hand) s.inv[InvSlot.HAND] = createItem(content.items, content.items.byName.get(hand)?.index ?? 0, 100);
  if (second) s.inv[InvSlot.SECOND_HAND] = createItem(content.items, content.items.byName.get(second)?.index ?? 0, 100);
  registerSoldier(t, s);
  setSoldierPosition(t, s, at);
  initNewSoldierAnim(t, s, states(content.animations).STANDING, 0, true);
  s.actionPoints = calcActionPoints(s);
  s.initialActionPoints = s.actionPoints;
  return s;
}
