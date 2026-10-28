// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-24. See LICENSE (SFI-SCLA).
// @src src/game/Strategic/Auto_Resolve.cc PlayAutoResolveSample (volume 50, nothing once Finish was pressed), FireAShot
// @src (the lock'n'load sound after a reload, the weapon's sound, ACR_SPIT for male creatures), AttackTarget (MISS_KNIFE,
// @src ACR_SWIPE or ACR_LUNGE on Chance(50), SWOOSH_1-6, BULLET_IMPACT_1-3, the target's HIT1 battle sound while it is
// @src conscious or a creature, FALL_1, DOORCR_1 and HEADCR_1 at HIGHVOLUME for a merc killed), TargetHitCallback (MISS_1-8,
// @src the impact, HIT1 while conscious, FALL_1, the merc's death sounds, BODY_SPLAT_1 or HEADSPLAT_1 below -60 life, else
// @src DIE1), ProcessBattleFrame (ACR_SMELL_THREAT or ACR_SMELL_PREY), IsBattleOver (LAUGH1 of the first live enemy, or
// @src ACR_EATFLESH in a creature attack, even after Finish). The variants come from the simulation's cosmetic stream
// @src ; the generic voice of militia and enemies and the splat choice are the client's.

import type { AutoresolveCellView } from '../../../protocol/view.ts';
import { isCreatureCell } from './autoresolve-cells.ts';
import { type ArEvent, cellKey, type DisplayState } from './autoresolve-playback.ts';
import type { BattleSoundRequest, BattleVoice, BattleVoiceSound } from './environment.ts';

const CONSCIOUSNESS = 10;
const GENERIC_VOICES = 3;
const SPLAT_CHOICES = 3;
const CLAW_SWIPE_BELOW = 50;
const REGMALE = 0;
const REGFEMALE = 3;
const CREATURE_BODIES: Readonly<Record<string, number>> = {
  adultFemaleCreature: 4,
  adultMaleCreature: 5,
  youngFemaleCreature: 6,
  youngMaleCreature: 7,
};
const RANGES: Readonly<Record<string, readonly string[]>> = {
  impact: ['BULLET_IMPACT_1', 'BULLET_IMPACT_2', 'BULLET_IMPACT_3'],
  miss: ['MISS_1', 'MISS_2', 'MISS_3', 'MISS_4', 'MISS_5', 'MISS_6', 'MISS_7', 'MISS_8'],
  swoosh: ['SWOOSH_1', 'SWOOSH_2', 'SWOOSH_3', 'SWOOSH_4', 'SWOOSH_5', 'SWOOSH_6'],
  smell: ['ACR_SMELL_THREAT', 'ACR_SMELL_PREY'],
};

export interface SoundOut {
  readonly request: BattleSoundRequest;
  readonly ungated: boolean;
}

export interface SoundContext {
  readonly encounter: string;
  readonly random: (range: number) => number;
  readonly voiceOf: (soldier: number) => number | null;
}

export interface SoundMemory {
  previous: ArEvent | null;
  meleeHit: string | null;
  readonly voices: Map<string, number>;
}

export function soundMemory(): SoundMemory {
  return { previous: null, meleeHit: null, voices: new Map() };
}

const effect = (name: string, loud = false, ungated = false): SoundOut => ({ request: { kind: 'effect', name, loud }, ungated });

function cellOf(state: DisplayState, ref: { readonly side: AutoresolveCellView['side']; readonly index: number }) {
  return state.cells.find((c) => c.side === ref.side && c.index === ref.index) ?? null;
}

function voice(cell: AutoresolveCellView, ctx: SoundContext, memory: SoundMemory): BattleVoice {
  if (cell.side === 'merc')
    return { profile: cell.soldier === undefined ? null : ctx.voiceOf(cell.soldier), generic: 0, bodyType: REGMALE };
  const key = cellKey(cell);
  const generic = memory.voices.get(key) ?? ctx.random(GENERIC_VOICES);
  memory.voices.set(key, generic);
  return { profile: null, generic, bodyType: CREATURE_BODIES[cell.kind] ?? (cell.female ? REGFEMALE : REGMALE) };
}

function voiceSound(cell: AutoresolveCellView, sound: BattleVoiceSound, ctx: SoundContext, memory: SoundMemory, ungated = false): SoundOut {
  return { request: { kind: 'voice', sound, voice: voice(cell, ctx, memory) }, ungated };
}

function consciousBefore(cell: AutoresolveCellView): boolean {
  if (cell.side === 'merc') return (cell.life ?? 0) >= CONSCIOUSNESS;
  return cell.state !== 'unconscious';
}

function rangeSound(sound: string, variant: number): SoundOut[] {
  if (sound === 'claw') return [effect(variant < CLAW_SWIPE_BELOW ? 'ACR_SWIPE' : 'ACR_LUNGE')];
  const range = RANGES[sound];
  const name = range?.[variant] ?? range?.[0];
  return name ? [effect(name)] : [];
}

function hitSounds(e: Extract<ArEvent, { type: 'arHit' }>, state: DisplayState, ctx: SoundContext, memory: SoundMemory): SoundOut[] {
  const target = cellOf(state, e.target);
  memory.meleeHit = e.melee && target ? cellKey(target) : null;
  if (!target) return [];
  return consciousBefore(target) || (e.melee && isCreatureCell(target)) ? [voiceSound(target, 'HIT1', ctx, memory)] : [];
}

function deathSounds(e: Extract<ArEvent, { type: 'arDied' }>, state: DisplayState, ctx: SoundContext, memory: SoundMemory): SoundOut[] {
  const target = cellOf(state, e.cell);
  if (!target) return [];
  const out: SoundOut[] = target.side === 'merc' ? [effect('DOORCR_1', true), effect('HEADCR_1', true)] : [];
  if (memory.meleeHit === cellKey(target)) return out;
  if (e.splat) out.push(effect(ctx.random(SPLAT_CHOICES) ? 'BODY_SPLAT_1' : 'HEADSPLAT_1'));
  else out.push(voiceSound(target, 'DIE1', ctx, memory));
  return out;
}

function defeatSounds(state: DisplayState, ctx: SoundContext, memory: SoundMemory): SoundOut[] {
  const enemy = state.cells.find((c) => c.side === 'enemy' && c.state !== 'dead');
  if (!enemy) return [];
  if (ctx.encounter === 'creatureAttack') return [effect('ACR_EATFLESH', false, true)];
  return [voiceSound(enemy, 'LAUGH1', ctx, memory, true)];
}

function knifeMissed(previous: ArEvent | null): boolean {
  return previous?.type === 'arAttack' && previous.kind === 'knife';
}

function eventSounds(e: ArEvent, state: DisplayState, ctx: SoundContext, memory: SoundMemory): SoundOut[] {
  switch (e.type) {
    case 'arAttack':
      if (e.kind === 'spit') return [effect('ACR_SPIT')];
      if (e.kind !== 'shot' || e.weapon === undefined) return [];
      return [{ request: { kind: 'weapon', item: e.weapon, reloaded: e.reloaded === true }, ungated: false }];
    case 'arSound':
      return rangeSound(e.sound, e.variant);
    case 'arMiss':
      return knifeMissed(memory.previous) ? [effect('MISS_KNIFE')] : [];
    case 'arHit':
      return hitSounds(e, state, ctx, memory);
    case 'arFell':
      return [effect('FALL_1')];
    case 'arDied':
      return deathSounds(e, state, ctx, memory);
    case 'arBattleOver':
      return e.status === 'defeat' ? defeatSounds(state, ctx, memory) : [];
    default:
      return [];
  }
}

export function autoresolveSounds(e: ArEvent, state: DisplayState, ctx: SoundContext, memory: SoundMemory): SoundOut[] {
  const out = eventSounds(e, state, ctx, memory);
  memory.previous = e;
  return out;
}
