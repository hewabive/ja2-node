import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ANIM_CONTROL_PATH, ANIM_SURFACES_PATH, AnimFlags, parseAnimationTables, stateId } from '../src/content/anim/tables.ts';
import { MAX_ANIMATIONS, MAX_FRAMES_PER_ANIM, writeAnimationScripts } from '../src/content/formats/ja2bin.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';

export const STUB_FRAMES_PER_DIRECTION = 12;
const LOOP_FRAMES = 12;
const ONE_SHOT_FRAMES = 8;
const START_SWAT_FRAMES = 5;
const HOP_FENCE_HALF = 9;
const JUMP_TO_START = 501;
const END_OF_ANIMATION = 499;
const NONINTERRUPTIBLE_DONE = 442;
const RT_NONINTERRUPTIBLE_DONE = 772;
const NONINTERRUPT_FLAG = 0x00000080;
const RT_NONINTERRUPT_FLAG = 0x04000000;
const BEGIN_HOP_FENCE = 450;
const END_HOP_FENCE = 444;
const LOOPING_STATES = ['STANDING', 'CROUCHING', 'PRONE', 'COWERING'];

function frames(count: number, first = 1): number[] {
  return Array.from({ length: count }, (_, i) => first + i);
}

function stateJump(state: number): number {
  return state < 100 ? 600 + state : 700 + state;
}

const OPEN_DOOR = 495;
const OPEN_STRUCT = 494;
const REACH_OUT = [1, 2, 3, 4, 5, 6, 6, 6, 6, 5, NONINTERRUPTIBLE_DONE];
const PULL_BACK = [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION];
const SWING_SHUT = (code: number) => [1, 2, 3, 4, 5, 6, code, 5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION];
type ScriptBuilder = (tables: Parameters<typeof stateId>[0]) => number[];
const DOOR_SCRIPTS: Readonly<Record<string, ScriptBuilder>> = {
  OPEN_DOOR: (t) => [1, 2, 3, 4, 5, 6, 6, 6, 6, 5, NONINTERRUPTIBLE_DONE, OPEN_DOOR, stateJump(stateId(t, 'END_OPEN_DOOR'))],
  OPEN_DOOR_CROUCHED: (t) => [
    1,
    2,
    3,
    4,
    5,
    6,
    6,
    6,
    6,
    5,
    NONINTERRUPTIBLE_DONE,
    OPEN_DOOR,
    stateJump(stateId(t, 'END_OPEN_DOOR_CROUCHED')),
  ],
  END_OPEN_DOOR: () => [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  END_OPEN_DOOR_CROUCHED: () => [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  CLOSE_DOOR: () => [1, 2, 3, 4, 5, 6, OPEN_DOOR, 5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  CLOSE_DOOR_CROUCHED: () => [1, 2, 3, 4, 5, 6, OPEN_DOOR, 5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  END_OPEN_LOCKED_DOOR: () => [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  END_OPEN_LOCKED_DOOR_CROUCHED: () => [5, 4, 3, 2, 1, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  KICK_DOOR: () => [1, 2, 3, 4, 5, 6, 6, NONINTERRUPTIBLE_DONE, OPEN_DOOR, 5, 4, 3, 2, 1, END_OF_ANIMATION],
  PICK_LOCK: () => [1, 2, 3, 4, 5, 6, 6, 6, 6, NONINTERRUPTIBLE_DONE, OPEN_DOOR, 5, 4, 3, 2, 1, END_OF_ANIMATION],
  LOCKPICK_CROUCHED: () => [1, 2, 3, 4, 5, 6, 6, 6, 6, NONINTERRUPTIBLE_DONE, OPEN_DOOR, 5, 4, 3, 2, 1, END_OF_ANIMATION],
  BEGIN_OPENSTRUCT: (t) => [...REACH_OUT, OPEN_DOOR, stateJump(stateId(t, 'END_OPENSTRUCT'))],
  BEGIN_OPENSTRUCT_CROUCHED: (t) => [...REACH_OUT, OPEN_DOOR, stateJump(stateId(t, 'END_OPENSTRUCT_CROUCHED'))],
  END_OPENSTRUCT: () => PULL_BACK,
  END_OPENSTRUCT_CROUCHED: () => PULL_BACK,
  END_OPENSTRUCT_LOCKED: () => PULL_BACK,
  END_OPENSTRUCT_LOCKED_CROUCHED: () => PULL_BACK,
  OPEN_STRUCT: () => SWING_SHUT(OPEN_STRUCT),
  OPEN_STRUCT_CROUCHED: () => SWING_SHUT(OPEN_STRUCT),
};

const THROW_RELEASE = 460;
const LOB_RELEASE = 461;
const LIFE_ZERO = 465;
const DEATH_COMMIT = 440;
const DEATH_OR_RELEASE = 497;
const PICKUP_ITEM_CODE = 493;
const Sound = {
  FOOTSTEP_LEFT: 703,
  FOOTSTEP_RIGHT: 704,
  KNEEL_UP: 773,
  KNEEL_DOWN: 774,
  PRONE_UP: 775,
  PRONE_DOWN: 776,
  PICK_UP: 777,
  FALL_TO_GROUND: 721,
  HEAVY_FALL: 722,
} as const;
const STEPPING_STATES = ['WALKING', 'RUNNING', 'SWATTING', 'CRAWLING'];
const STANCE_SOUNDS: Readonly<Record<string, number>> = {
  KNEEL_UP: Sound.KNEEL_UP,
  KNEEL_DOWN: Sound.KNEEL_DOWN,
  PRONE_UP: Sound.PRONE_UP,
  PRONE_DOWN: Sound.PRONE_DOWN,
};
const STEP_AFTER_FRAMES = 3;
const SECOND_STEP_AFTER_FRAMES = 6;

function steppingLoop(): number[] {
  const rest = LOOP_FRAMES - STEP_AFTER_FRAMES - SECOND_STEP_AFTER_FRAMES;
  return [
    ...frames(STEP_AFTER_FRAMES),
    Sound.FOOTSTEP_LEFT,
    ...frames(SECOND_STEP_AFTER_FRAMES, STEP_AFTER_FRAMES + 1),
    Sound.FOOTSTEP_RIGHT,
    ...frames(rest, STEP_AFTER_FRAMES + SECOND_STEP_AFTER_FRAMES + 1),
    JUMP_TO_START,
  ];
}
const DROP_ITEM_CODE = 487;
const END_FIRST_AID = 768;
const GIVE_ITEM_CODE = 486;
const ROLLOVER_GETUP = 437;
const ClimbOp = {
  FORWARD_FALL: 403,
  BACKWARD: 404,
  MOVE_DOWN: 409,
  BACKWARD_FALL: 453,
  UP_COMMIT: 408,
  GROUND_HEIGHT: 410,
  DOWN_START: 411,
  UP: 454,
  UP_FORWARD: 455,
  DOWN: 456,
  DOWN_COMMIT: 475,
} as const;
const ITEM_SCRIPTS: Readonly<Record<string, ScriptBuilder>> = {
  PICKUP_ITEM: () => [
    ...frames(2),
    Sound.PICK_UP,
    ...frames(3, 3),
    PICKUP_ITEM_CODE,
    ...frames(4, 6),
    NONINTERRUPTIBLE_DONE,
    END_OF_ANIMATION,
  ],
  ADJACENT_GET_ITEM: () => [
    ...frames(2),
    Sound.PICK_UP,
    ...frames(3, 3),
    PICKUP_ITEM_CODE,
    ...frames(4, 6),
    NONINTERRUPTIBLE_DONE,
    END_OF_ANIMATION,
  ],
  DROP_ITEM: () => [...frames(5), DROP_ITEM_CODE, ...frames(4, 6), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  GIVE_ITEM: () => [...frames(5), GIVE_ITEM_CODE, ...frames(4, 6), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION],
  START_AID: (t) => [...frames(4), NONINTERRUPTIBLE_DONE, stateJump(stateId(t, 'GIVING_AID'))],
  GIVING_AID: () => [...frames(LOOP_FRAMES), JUMP_TO_START],
  END_AID: () => [4, 3, 2, 1, END_FIRST_AID, END_OF_ANIMATION],
  ROLLOVER: () => [...frames(8), ROLLOVER_GETUP],
  GETUP_FROM_ROLLOVER: (t) => [...frames(5), stateJump(stateId(t, 'KNEEL_UP'))],
  START_COWER: (t) => [...frames(5), NONINTERRUPTIBLE_DONE, stateJump(stateId(t, 'COWERING'))],
  THROW_ITEM: (t) => [...frames(8), THROW_RELEASE, ...frames(5, 9), NONINTERRUPTIBLE_DONE, stateJump(stateId(t, 'STANDING'))],
  LOB_ITEM: (t) => [...frames(6), LOB_RELEASE, ...frames(7, 7), NONINTERRUPTIBLE_DONE, stateJump(stateId(t, 'STANDING'))],
  FALLOFF: () => [...fallScript(ClimbOp.BACKWARD_FALL, 19, 25), ClimbOp.GROUND_HEIGHT, NONINTERRUPTIBLE_DONE, DEATH_OR_RELEASE],
  FALLFORWARD_ROOF: () => [...fallScript(ClimbOp.FORWARD_FALL, 23, 26), ClimbOp.GROUND_HEIGHT, NONINTERRUPTIBLE_DONE, DEATH_OR_RELEASE],
  SHOOT_ROCKET: () => [Op.BUSY_UP, ...frames(8), Op.OK_FIRE, Op.FIRE, ...frames(6, 9), Op.BUSY_DOWN, END_OF_ANIMATION],
  THROW_KNIFE: () => [
    Op.BUSY_UP,
    ...frames(6),
    Op.KNIFE_THROW_SOUND,
    ...frames(3, 7),
    Op.FIRE,
    ...frames(5, 10),
    Op.BUSY_DOWN,
    NONINTERRUPTIBLE_DONE,
    END_OF_ANIMATION,
  ],
  SHOOT_MORTAR: () => [Op.BUSY_UP, ...frames(16), Op.OK_FIRE, Op.FIRE, ...frames(16, 17), Op.BUSY_DOWN, END_OF_ANIMATION],
  CHARIOTS_OF_FIRE: () => [...frames(12), LIFE_ZERO, DEATH_COMMIT, DEATH_OR_RELEASE, NONINTERRUPTIBLE_DONE],
  BODYEXPLODING: () => [...frames(10), LIFE_ZERO, DEATH_COMMIT, DEATH_OR_RELEASE, NONINTERRUPTIBLE_DONE],
  CLIMBUPROOF: (t) => [
    ...frames(4),
    ...interleave(ClimbOp.UP, 4, 5),
    ...interleave(ClimbOp.UP_FORWARD, 6, 9),
    ...frames(4, 15),
    ...interleave(ClimbOp.UP_FORWARD, 2, 19),
    ...frames(2, 21),
    NONINTERRUPTIBLE_DONE,
    ClimbOp.UP_COMMIT,
    stateJump(stateId(t, 'CROUCHING')),
  ],
  CLIMBDOWNROOF: (t) => [
    ClimbOp.DOWN_START,
    ...frames(6),
    ...interleave(ClimbOp.BACKWARD, 8, 7),
    ...interleave(ClimbOp.DOWN, 3, 15),
    ...frames(2, 18),
    NONINTERRUPTIBLE_DONE,
    ClimbOp.GROUND_HEIGHT,
    ClimbOp.DOWN_COMMIT,
    stateJump(stateId(t, 'STANDING')),
  ],
};

function fallScript(moveOp: number, moves: number, drops: number): number[] {
  const steps = Math.max(moves, drops);
  return Array.from({ length: steps }, (_, k) => [...(k < moves ? [moveOp] : []), ...(k < drops ? [ClimbOp.MOVE_DOWN] : []), 1 + k]).flat();
}

function interleave(op: number, count: number, firstFrame: number): number[] {
  return Array.from({ length: count }, (_, k) => [op, firstFrame + k]).flat();
}

const Op = {
  BUSY_UP: 757,
  BUSY_DOWN: 753,
  OK_FIRE: 470,
  FLASH: 441,
  FIRE: 430,
  BURST: 448,
  END_BURST: 449,
  IMPROPER_END: 473,
  FIRST_HAND: 459,
  SECOND_HAND: 458,
  TURN_FROM_HIT: 478,
  INCAPACITATED: 433,
  BACK_TO_AIM: 472,
  TRY_TO_FALL: 447,
  DEATH_OR_RELEASE: 497,
  DEAD: 440,
  PREVIOUS: 496,
  LIFE_ZERO: 465,
  LOCK_N_LOAD: 708,
  KNIFE_THROW_SOUND: 709,
  RESUME_FIRE: 476,
} as const;

const UNJAM_STATES = [
  'STANDING_SHOOT_UNJAM',
  'CROUCH_SHOOT_UNJAM',
  'PRONE_SHOOT_UNJAM',
  'STANDING_SHOOT_DWEL_UNJAM',
  'CROUCH_SHOOT_DWEL_UNJAM',
  'PRONE_SHOOT_DWEL_UNJAM',
  'STANDING_SHOOT_LOW_UNJAM',
] as const;

const STANCES = ['STAND', 'CROUCH', 'PRONE'] as const;
const LOOPS = [
  'AIM_RIFLE_STAND',
  'AIM_RIFLE_CROUCH',
  'AIM_RIFLE_PRONE',
  'AIM_DUAL_STAND',
  'AIM_DUAL_CROUCH',
  'AIM_DUAL_PRONE',
  'STAND_FALLFORWARD_STOP',
  'FALLBACKHIT_STOP',
  'PRONE_LAYFROMHIT_STOP',
  'FLYBACKHIT_STOP',
  'FALLFORWARD_HITDEATH_STOP',
  'FALLBACK_HITDEATH_STOP',
  'PRONE_HITDEATH_STOP',
  'FLYBACK_HITDEATH_STOP',
  'JFK_HITDEATH_STOP',
  'WATER_DIE_STOP',
  'DEEP_WATER_DIE_STOPPING',
  'BLOODCAT_DYING_STOP',
  'COW_DYING_STOP',
];

const CREATURE_HITS = ['ADULTMONSTER_HIT', 'LARVAE_HIT', 'INFANT_HIT', 'QUEEN_HIT', 'BLOODCAT_HIT', 'COW_HIT'];
const CREATURE_FALLS = ['ADULTMONSTER_DYING', 'LARVAE_DIE', 'QUEEN_DIE', 'INFANT_DIE'];
const CREATURE_DEATHS = ['ADULTMONSTER_DYING_STOP', 'LARVAE_DIE_STOP', 'QUEEN_DIE_STOP', 'INFANT_DIE_STOP'];
const ANIMAL_DEATHS = ['BLOODCAT_DYING', 'COW_DYING'];

function combatScripts(t: Parameters<typeof stateId>[0]): Map<string, number[]> {
  const to = (name: string) => stateJump(stateId(t, name));
  const m = new Map<string, number[]>();
  for (const stance of STANCES) {
    m.set(`READY_RIFLE_${stance}`, [...frames(4), to(`AIM_RIFLE_${stance}`)]);
    m.set(`READY_DUAL_${stance}`, [...frames(4), to(`AIM_DUAL_${stance}`)]);
    m.set(`END_RIFLE_${stance}`, [...frames(4), END_OF_ANIMATION]);
    m.set(`END_DUAL_${stance}`, [...frames(4), END_OF_ANIMATION]);
    m.set(`SHOOT_RIFLE_${stance}`, [
      Op.BUSY_UP,
      Op.OK_FIRE,
      Op.FLASH,
      Op.FIRE,
      ...frames(6),
      Op.BUSY_DOWN,
      RT_NONINTERRUPTIBLE_DONE,
      Op.IMPROPER_END,
      to(`AIM_RIFLE_${stance}`),
    ]);
    m.set(`SHOOT_DUAL_${stance}`, [
      Op.BUSY_UP,
      Op.FIRST_HAND,
      Op.OK_FIRE,
      Op.FLASH,
      Op.FIRE,
      ...frames(4),
      Op.SECOND_HAND,
      Op.OK_FIRE,
      Op.FLASH,
      Op.FIRE,
      ...frames(4),
      Op.BUSY_DOWN,
      Op.IMPROPER_END,
      to(`AIM_DUAL_${stance}`),
    ]);
  }
  m.set('FIRE_LOW_STAND', [
    Op.BUSY_UP,
    ...frames(4),
    Op.OK_FIRE,
    Op.FLASH,
    Op.FIRE,
    ...frames(6),
    Op.BUSY_DOWN,
    Op.IMPROPER_END,
    to('AIM_RIFLE_STAND'),
  ]);
  const burst = (aim: string, lead: number) => [
    Op.BUSY_UP,
    ...frames(lead),
    ...Array.from({ length: 6 }, () => [Op.FLASH, Op.BURST, Op.FIRE, ...frames(2)]).flat(),
    ...frames(2),
    Op.END_BURST,
    Op.BUSY_DOWN,
    Op.IMPROPER_END,
    to(aim),
  ];
  for (const name of UNJAM_STATES) m.set(name, [1, Op.LOCK_N_LOAD, ...frames(6, 2), NONINTERRUPTIBLE_DONE, Op.RESUME_FIRE]);
  m.set('STANDING_BURST', burst('AIM_RIFLE_STAND', 0));
  m.set('CROUCHED_BURST', burst('AIM_RIFLE_CROUCH', 0));
  m.set('PRONE_BURST', burst('AIM_RIFLE_PRONE', 0));
  m.set('FIRE_BURST_LOW_STAND', burst('AIM_RIFLE_STAND', 4));
  m.set('GENERIC_HIT_STAND', [Op.TURN_FROM_HIT, 1, NONINTERRUPTIBLE_DONE, Op.INCAPACITATED, 2, 3, Op.BACK_TO_AIM, END_OF_ANIMATION]);
  m.set('RIFLE_STAND_HIT', [Op.TURN_FROM_HIT, 1, 2, NONINTERRUPTIBLE_DONE, Op.INCAPACITATED, 3, 4, 5, Op.BACK_TO_AIM, END_OF_ANIMATION]);
  m.set('STANDING_BURST_HIT', [1, 2, Op.INCAPACITATED, 3, Op.BACK_TO_AIM, END_OF_ANIMATION]);
  m.set('GENERIC_HIT_CROUCH', [
    ...frames(3),
    NONINTERRUPTIBLE_DONE,
    Op.INCAPACITATED,
    4,
    5,
    NONINTERRUPTIBLE_DONE,
    Op.BACK_TO_AIM,
    END_OF_ANIMATION,
  ]);
  m.set('GENERIC_HIT_PRONE', [
    ...frames(3),
    NONINTERRUPTIBLE_DONE,
    Op.INCAPACITATED,
    ...frames(3, 4),
    NONINTERRUPTIBLE_DONE,
    Op.BACK_TO_AIM,
    END_OF_ANIMATION,
  ]);
  m.set('FALLFORWARD_FROMHIT_STAND', [
    ...frames(4),
    Op.TRY_TO_FALL,
    ...frames(6, 5),
    Sound.FALL_TO_GROUND,
    ...frames(2, 11),
    NONINTERRUPTIBLE_DONE,
    Op.DEATH_OR_RELEASE,
  ]);
  m.set('FALLFORWARD_FROMHIT_CROUCH', [...frames(4), Op.TRY_TO_FALL, 5, 6, NONINTERRUPTIBLE_DONE, to('ENDFALLFORWARD_FROMHIT_CROUCH')]);
  m.set('ENDFALLFORWARD_FROMHIT_CROUCH', [...frames(5), Sound.FALL_TO_GROUND, ...frames(3, 6), NONINTERRUPTIBLE_DONE, Op.DEATH_OR_RELEASE]);
  m.set('FALLBACK_HIT_STAND', [...frames(5), Sound.HEAVY_FALL, ...frames(4, 6), NONINTERRUPTIBLE_DONE, Op.DEATH_OR_RELEASE]);
  m.set('PRONE_LAY_FROMHIT', [...frames(7), NONINTERRUPTIBLE_DONE, Op.DEATH_OR_RELEASE]);
  m.set('FLYBACK_HIT', [1, NONINTERRUPTIBLE_DONE, ...frames(7, 2), Sound.HEAVY_FALL, ...frames(3, 9), Op.DEATH_OR_RELEASE]);
  m.set('JFK_HITDEATH', [...frames(6), Sound.FALL_TO_GROUND, ...frames(3, 7), Sound.HEAVY_FALL, ...frames(3, 10), Op.DEAD]);
  for (const name of ['GENERIC_HIT_DEATH', 'FALLBACK_HIT_DEATH', 'PRONE_HIT_DEATH', 'FLYBACK_HIT_DEATH', 'CIV_DIE2'])
    m.set(name, [...frames(6), Op.DEAD]);
  for (const name of ['WATER_DIE', 'DEEP_WATER_DIE']) m.set(name, [...frames(8), Op.LIFE_ZERO, Op.DEAD]);
  for (const name of ['GENERIC_HIT_DEATHTWITCHNB', 'FALLBACK_HIT_DEATHTWITCHNB', 'PRONE_HIT_DEATHTWITCHNB'])
    m.set(name, [...frames(3), NONINTERRUPTIBLE_DONE, Op.DEATH_OR_RELEASE]);
  for (const name of ['GENERIC_HIT_DEATHTWITCHB', 'FALLBACK_HIT_DEATHTWITCHB', 'PRONE_HIT_DEATHTWITCHB', 'JFK_HITDEATH_TWITCHB'])
    m.set(name, [...frames(3), Op.PREVIOUS]);
  for (const name of CREATURE_HITS) m.set(name, [1, 2, NONINTERRUPTIBLE_DONE, Op.INCAPACITATED, 3, 4, END_OF_ANIMATION]);
  for (const name of CREATURE_FALLS) m.set(name, [...frames(8), NONINTERRUPTIBLE_DONE, Op.DEATH_OR_RELEASE]);
  for (const name of CREATURE_DEATHS) m.set(name, [1, Op.DEAD, ...frames(LOOP_FRAMES - 1, 2), JUMP_TO_START]);
  for (const name of ANIMAL_DEATHS) m.set(name, [...frames(8), Op.LIFE_ZERO, Op.DEAD]);
  for (const [name, script] of meleeScripts(t)) m.set(name, script);
  for (const [name, script] of creatureAttackScripts(t)) m.set(name, script);
  for (const name of LOOPS) m.set(name, [...frames(LOOP_FRAMES), JUMP_TO_START]);
  return m;
}

const MeleeOp = { SWOOSH: 727, DODGE: 492, END_PUNCH: 468 } as const;

function meleeScripts(t: Parameters<typeof stateId>[0]): Map<string, number[]> {
  const to = (name: string) => stateJump(stateId(t, name));
  const swing = (windUp: number, toStrike: number, followThrough: number) => [
    Op.BUSY_UP,
    ...frames(windUp),
    MeleeOp.SWOOSH,
    MeleeOp.DODGE,
    ...frames(toStrike, windUp + 1),
    Op.FIRE,
    ...frames(followThrough, LOOP_FRAMES + 1 - followThrough),
  ];
  return new Map([
    ['STAB', [...swing(7, 2, 6), NONINTERRUPTIBLE_DONE, to('KNIFE_GOTOBREATH')]],
    ['SLICE', [...swing(7, 2, 5), NONINTERRUPTIBLE_DONE, to('KNIFE_GOTOBREATH')]],
    ['CROUCH_STAB', [...swing(6, 3, 6), Op.BUSY_DOWN, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['KNIFE_GOTOBREATH', [...frames(4), NONINTERRUPTIBLE_DONE, Op.BUSY_DOWN, to('KNIFE_BREATH')]],
    ['KNIFE_ENDBREATH', [...frames(5), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['PUNCH', [...swing(6, 3, 7), Op.BUSY_DOWN, NONINTERRUPTIBLE_DONE, MeleeOp.END_PUNCH]],
    ['PUNCH_LOW', [Op.BUSY_UP, ...frames(9), Op.FIRE, ...frames(5, 8), Op.BUSY_DOWN, NONINTERRUPTIBLE_DONE, MeleeOp.END_PUNCH]],
    ['CROWBAR_ATTACK', [Op.BUSY_UP, ...frames(9), Op.FIRE, ...frames(10, 3), Op.BUSY_DOWN, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['DODGE_ONE', [...frames(LOOP_FRAMES), END_OF_ANIMATION]],
    ['KNIFE_BREATH', [...frames(LOOP_FRAMES), JUMP_TO_START]],
    ['PUNCH_BREATH', [...frames(LOOP_FRAMES), JUMP_TO_START]],
  ]);
}

const CreatureOp = { QUEEN_SWIPE_DAMAGE: 755, EAT_FLESH_DAMAGE: 761 } as const;

function creatureAttackScripts(t: Parameters<typeof stateId>[0]): Map<string, number[]> {
  const to = (name: string) => stateJump(stateId(t, name));
  const strike = (windUp: number, followThrough: number) => [
    Op.BUSY_UP,
    ...frames(windUp),
    Op.FIRE,
    ...frames(followThrough, windUp + 1),
    Op.BUSY_DOWN,
  ];
  const lunge = [Op.BUSY_UP, ...frames(5), MeleeOp.DODGE, ...frames(3, 6), Op.FIRE, ...frames(4, 9), Op.BUSY_DOWN, to('STANDING')];
  const swipe = [
    Op.BUSY_UP,
    ...frames(4),
    CreatureOp.QUEEN_SWIPE_DAMAGE,
    5,
    CreatureOp.QUEEN_SWIPE_DAMAGE,
    6,
    CreatureOp.QUEEN_SWIPE_DAMAGE,
    ...frames(4, 7),
    Op.BUSY_DOWN,
    NONINTERRUPTIBLE_DONE,
    END_OF_ANIMATION,
  ];
  return new Map([
    [
      'MONSTER_CLOSE_ATTACK',
      [
        Op.BUSY_UP,
        ...frames(6),
        MeleeOp.DODGE,
        ...frames(2, 7),
        Op.FIRE,
        ...frames(3, 9),
        Op.BUSY_DOWN,
        NONINTERRUPTIBLE_DONE,
        END_OF_ANIMATION,
      ],
    ],
    ['ADULTMONSTER_ATTACKING', lunge],
    ['MONSTER_SPIT_ATTACK', [...strike(7, 5), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['INFANT_ATTACK', [...strike(6, 4), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['QUEEN_SPIT', [...strike(8, 4), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['QUEEN_SWIPE', swipe],
    ['BLOODCAT_SWIPE', [...strike(5, 4), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['BLOODCAT_BITE_ANIM', [...strike(6, 5), NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
    ['MONSTER_BEGIN_EATTING_FLESH', [Op.BUSY_UP, ...frames(6), NONINTERRUPTIBLE_DONE, to('MONSTER_EATTING_FLESH')]],
    ['MONSTER_EATTING_FLESH', [...frames(5, 7), CreatureOp.EAT_FLESH_DAMAGE, ...frames(4, 8), to('MONSTER_END_EATTING_FLESH')]],
    ['MONSTER_END_EATTING_FLESH', [...frames(6), Op.BUSY_DOWN, NONINTERRUPTIBLE_DONE, END_OF_ANIMATION]],
  ]);
}

export async function buildStubAnimationScripts(): Promise<Uint8Array> {
  const read = async (path: string) => JSON.parse(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
  const tables = parseAnimationTables(await read(ANIM_CONTROL_PATH), await read(ANIM_SURFACES_PATH));
  const codes = new Uint16Array(MAX_ANIMATIONS * MAX_FRAMES_PER_ANIM);
  const looping = new Set(LOOPING_STATES.map((n) => stateId(tables, n)));
  const startSwat = stateId(tables, 'START_SWAT');
  const hopFence = stateId(tables, 'HOPFENCE');
  const combat = combatScripts(tables);
  for (const control of tables.controls) {
    const releases = [
      ...(control.flags & NONINTERRUPT_FLAG ? [NONINTERRUPTIBLE_DONE] : []),
      ...(control.flags & RT_NONINTERRUPT_FLAG ? [RT_NONINTERRUPTIBLE_DONE] : []),
    ];
    let script: number[];
    const door = DOOR_SCRIPTS[control.id] ?? ITEM_SCRIPTS[control.id];
    const fight = combat.get(control.id);
    if (fight) script = fight;
    else if (door) script = door(tables);
    else if (control.index === startSwat) script = [...frames(START_SWAT_FRAMES), stateJump(stateId(tables, 'SWATTING'))];
    else if (control.index === hopFence)
      script = [
        BEGIN_HOP_FENCE,
        ...frames(HOP_FENCE_HALF),
        END_HOP_FENCE,
        ...frames(HOP_FENCE_HALF, HOP_FENCE_HALF + 1),
        ...releases,
        END_OF_ANIMATION,
      ];
    else if (STEPPING_STATES.includes(control.id)) script = steppingLoop();
    else if (looping.has(control.index) || control.flags & AnimFlags.MOVING) script = [...frames(LOOP_FRAMES), JUMP_TO_START];
    else if (STANCE_SOUNDS[control.id] !== undefined)
      script = [1, STANCE_SOUNDS[control.id] as number, ...frames(ONE_SHOT_FRAMES - 1, 2), ...releases, END_OF_ANIMATION];
    else script = [...frames(ONE_SHOT_FRAMES), ...releases, END_OF_ANIMATION];
    script.forEach((code, pc) => {
      codes[control.index * MAX_FRAMES_PER_ANIM + pc] = code;
    });
  }
  return writeAnimationScripts({ codes });
}
