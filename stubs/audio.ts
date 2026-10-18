import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  BATTLE_SOUNDS_PATH,
  type BattleSoundKind,
  type BattleSoundTable,
  battleSoundPath,
  effectPaths,
  expandBurstPattern,
  type GenericVoiceSet,
  genericVoiceSets,
  parseBattleSounds,
  parseSoundEffects,
  SOUND_EFFECTS_PATH,
  soundPathsIn,
  type VoiceBody,
  voiceSetKinds,
} from '../src/content/audio/sound-table.ts';
import { loadItemTable } from '../src/content/items/items.ts';
import { parseJsonc } from '../src/content/strategic/jsonc.ts';
import { PROJECT_DATA_DIR } from '../src/node/repo.ts';
import { encodeStubWav, HIGH, LOW, type StubFormat, VOICE, WIDE } from './stub-wav.ts';
import {
  amplitude,
  bandpass,
  crackle,
  envelope,
  fadeOut,
  formantVoice,
  highpass,
  lowpass,
  mix,
  noise,
  normalize,
  type Part,
  StubRandom,
  scale,
  sequence,
  tone,
  vibrato,
} from './synth.ts';

export const SYNTH_DIR = 'synth';
const SFX_DIR = `${SYNTH_DIR}/sfx`;
const BATTLE_DIR = `${SYNTH_DIR}/battle`;
const PEAK = 0.85;
const FALLBACK_CLASS = 'misc';
const EXTERNALIZED_SOUND_TABLES = [
  'externalized/weapons.json',
  'externalized/calibres.json',
  'externalized/explosion-animations.json',
  'externalized/vehicles.json',
] as const;

type Recipe = (r: StubRandom, rate: number) => Float32Array;

interface SoundClass {
  readonly format: StubFormat;
  readonly render: Recipe;
}

function hit(r: StubRandom, rate: number, seconds: number, cutoff: number, decay: number): Float32Array {
  return envelope(lowpass(noise(r, rate, seconds), rate, cutoff), rate, 0.002, decay);
}

function thump(rate: number, seconds: number, from: number, to: number, decay: number): Float32Array {
  return envelope(tone(rate, seconds, from, to), rate, 0.002, decay);
}

function click(r: StubRandom, rate: number, seconds = 0.03): Float32Array {
  return envelope(highpass(noise(r, rate, seconds), rate, 2000), rate, 0.0005, 0.004);
}

function ring(rate: number, seconds: number, freqs: readonly number[], decay: number): Float32Array {
  return mix(rate, ...freqs.map((f, i) => [envelope(tone(rate, seconds, f, f), rate, 0.001, decay / (1 + i * 0.3)), 1 / (i + 1)] as const));
}

function swish(r: StubRandom, rate: number, seconds: number, centre: number): Float32Array {
  const body = bandpass(noise(r, rate, seconds), rate, centre, 1.5);
  return body.map((v, i) => v * Math.sin((Math.PI * i) / body.length));
}

function repeat(rate: number, part: Float32Array, count: number, interval: number, gain = 1): Float32Array {
  return sequence(
    rate,
    Array.from({ length: count }, (_, k): Part => ({ at: k * interval, samples: part, gain })),
  );
}

function shot(r: StubRandom, rate: number, crack: number, body: number, boom: number, decay: number): Float32Array {
  return mix(
    rate,
    [envelope(highpass(noise(r, rate, 0.04), rate, 3000), rate, 0.0005, 0.008), crack],
    [hit(r, rate, decay * 4, 2500, decay), body],
    [thump(rate, decay * 4, 140, 50, decay * 1.5), boom],
  );
}

function step(r: StubRandom, rate: number, cutoff: number, grains: number): Float32Array {
  return sequence(
    rate,
    Array.from({ length: grains }, (_, k): Part => ({ at: k * 0.018, samples: hit(r, rate, 0.05, cutoff, 0.012), gain: 1 - k * 0.2 })),
  );
}

function creak(r: StubRandom, rate: number, seconds: number, low: number, high: number): Float32Array {
  const wobble = tone(rate, seconds, low + r.range(0, 30), high, 'saw');
  return fadeOut(envelope(bandpass(wobble, rate, (low + high) / 2, 3), rate, 0.03, seconds), rate, 0.05);
}

const GUN_SHOTS = {
  pistol: { render: (r: StubRandom, rate: number) => shot(r, rate, 0.6, 1, 0.5, 0.05), interval: 0.09 },
  rifle: { render: (r: StubRandom, rate: number) => shot(r, rate, 1, 1, 0.7, 0.07), interval: 0.08 },
  shotgun: { render: (r: StubRandom, rate: number) => shot(r, rate, 0.4, 1, 1, 0.12), interval: 0.22 },
  silenced: { render: (r: StubRandom, rate: number) => hit(r, rate, 0.15, 1200, 0.03), interval: 0.09 },
  launcher: {
    render: (r: StubRandom, rate: number) =>
      mix(rate, [envelope(lowpass(noise(r, rate, 0.7), rate, 900), rate, 0.05, 0.25), 1], [thump(rate, 0.4, 90, 40, 0.15), 0.6]),
    interval: 0.3,
  },
} as const;

type GunKind = keyof typeof GUN_SHOTS;

const CLASSES: Readonly<Record<string, SoundClass>> = {
  'step-gravel': { format: LOW, render: (r, rate) => step(r, rate, 3000, 3) },
  'step-gritty': { format: LOW, render: (r, rate) => highpass(step(r, rate, 5000, 2), rate, 800) },
  'step-leaves': { format: LOW, render: (r, rate) => envelope(highpass(crackle(r, rate, 0.12, 0.2), rate, 1500), rate, 0.005, 0.05) },
  crawl: { format: LOW, render: (r, rate) => swish(r, rate, 0.3, 900) },
  'step-water': { format: LOW, render: (r, rate) => swish(r, rate, 0.25, 500) },
  swim: { format: LOW, render: (r, rate) => repeat(rate, swish(r, rate, 0.2, 400), 2, 0.18) },
  'water-splash': {
    format: LOW,
    render: (r, rate) => mix(rate, [hit(r, rate, 0.3, 1500, 0.08), 1], [envelope(vibrato(rate, 0.3, 300, 0.4, 25), rate, 0.01, 0.08), 0.4]),
  },
  'gun-pistol': { format: HIGH, render: GUN_SHOTS.pistol.render },
  'gun-rifle': { format: HIGH, render: GUN_SHOTS.rifle.render },
  'gun-shotgun': { format: HIGH, render: GUN_SHOTS.shotgun.render },
  'gun-silenced': { format: LOW, render: GUN_SHOTS.silenced.render },
  'gun-launcher': { format: LOW, render: GUN_SHOTS.launcher.render },
  gunfight: {
    format: LOW,
    render: (r, rate) => {
      const shots = [GUN_SHOTS.rifle.render(r, rate), GUN_SHOTS.pistol.render(r, rate), GUN_SHOTS.shotgun.render(r, rate)];
      return sequence(
        rate,
        Array.from({ length: 14 }, (): Part => ({ at: r.range(0, 1.4), samples: r.pick(shots), gain: r.range(0.3, 1) })),
      );
    },
  },
  'dry-fire': { format: LOW, render: (r, rate) => click(r, rate, 0.04) },
  reload: {
    format: LOW,
    render: (_r, rate) =>
      sequence(rate, [
        { at: 0, samples: ring(rate, 0.08, [2200, 3400], 0.02) },
        { at: 0.18, samples: ring(rate, 0.1, [1800, 2900], 0.03) },
      ]),
  },
  'lock-n-load': {
    format: LOW,
    render: (r, rate) =>
      sequence(rate, [
        { at: 0, samples: swish(r, rate, 0.12, 2500), gain: 0.6 },
        { at: 0.14, samples: ring(rate, 0.1, [2600, 4100], 0.025) },
      ]),
  },
  attach: {
    format: LOW,
    render: (r, rate) =>
      sequence(rate, [
        { at: 0, samples: click(r, rate) },
        { at: 0.08, samples: swish(r, rate, 0.12, 3000), gain: 0.5 },
      ]),
  },
  knife: { format: LOW, render: (r, rate) => swish(r, rate, 0.2, 2200) },
  punch: { format: LOW, render: (r, rate) => mix(rate, [thump(rate, 0.12, 160, 70, 0.04), 1], [hit(r, rate, 0.08, 1500, 0.015), 0.6]) },
  ricochet: {
    format: LOW,
    render: (r, rate) => mix(rate, [envelope(tone(rate, 0.3, 2600, 700), rate, 0.002, 0.12), 0.7], [click(r, rate), 0.6]),
  },
  impact: { format: LOW, render: (r, rate) => hit(r, rate, 0.1, 1800, 0.02) },
  'impact-metal': { format: LOW, render: (r, rate) => mix(rate, [ring(rate, 0.25, [1250, 2830, 4150], 0.06), 1], [click(r, rate), 0.5]) },
  glass: {
    format: LOW,
    render: (r, rate) =>
      mix(rate, [envelope(highpass(noise(r, rate, 0.4), rate, 3500), rate, 0.001, 0.08), 0.7], [ring(rate, 0.3, [3100, 4700], 0.05), 0.4]),
  },
  drop: {
    format: LOW,
    render: (r, rate) =>
      sequence(rate, [
        { at: 0, samples: thump(rate, 0.08, 220, 120, 0.03) },
        { at: 0.05, samples: hit(r, rate, 0.06, 3000, 0.01), gain: 0.4 },
      ]),
  },
  fall: { format: LOW, render: (r, rate) => mix(rate, [thump(rate, 0.3, 90, 45, 0.08), 1], [hit(r, rate, 0.25, 900, 0.06), 0.5]) },
  'door-open': { format: LOW, render: (r, rate) => creak(r, rate, 0.45, 280, 520) },
  'door-close': {
    format: LOW,
    render: (r, rate) =>
      sequence(rate, [
        { at: 0, samples: thump(rate, 0.15, 120, 70, 0.05) },
        { at: 0.12, samples: click(r, rate) },
      ]),
  },
  'door-metal-open': { format: LOW, render: (r, rate) => envelope(bandpass(noise(r, rate, 0.5), rate, 1700, 12), rate, 0.05, 0.25) },
  'door-metal-close': {
    format: LOW,
    render: (_r, rate) => mix(rate, [ring(rate, 0.4, [420, 1130, 1960], 0.12), 1], [thump(rate, 0.15, 100, 60, 0.05), 0.6]),
  },
  'door-locked': { format: LOW, render: (r, rate) => repeat(rate, click(r, rate, 0.04), 3, 0.07) },
  lock: {
    format: LOW,
    render: (r, rate) =>
      sequence(rate, [
        { at: 0, samples: click(r, rate) },
        { at: 0.12, samples: ring(rate, 0.1, [1900], 0.02) },
      ]),
  },
  pickup: {
    format: LOW,
    render: (r, rate) =>
      sequence(rate, [
        { at: 0, samples: swish(r, rate, 0.12, 1800), gain: 0.6 },
        { at: 0.1, samples: click(r, rate) },
      ]),
  },
  stance: { format: LOW, render: (r, rate) => swish(r, rate, 0.2, 1200) },
  drink: { format: LOW, render: (_r, rate) => repeat(rate, envelope(tone(rate, 0.08, 260, 180), rate, 0.01, 0.03), 3, 0.16) },
  'laptop-beep': {
    format: LOW,
    render: (_r, rate) =>
      sequence(rate, [
        { at: 0, samples: envelope(tone(rate, 0.07, 1320, 1320, 'square'), rate, 0.002, 0.05), gain: 0.5 },
        { at: 0.08, samples: envelope(tone(rate, 0.07, 990, 990, 'square'), rate, 0.002, 0.05), gain: 0.5 },
      ]),
  },
  'laptop-power': { format: LOW, render: (_r, rate) => fadeOut(scale(tone(rate, 0.6, 200, 800, 'triangle'), 0.6), rate, 0.15) },
  static: { format: LOW, render: (r, rate) => amplitude(fadeOut(noise(r, rate, 0.4), rate, 0.1), rate, 13, 0.5) },
  'ui-click': { format: LOW, render: (r, rate) => click(r, rate, 0.015) },
  'ui-beep': { format: LOW, render: (_r, rate) => envelope(tone(rate, 0.12, 880, 880, 'square'), rate, 0.002, 0.08) },
  alarm: {
    format: LOW,
    render: (_r, rate) =>
      sequence(
        rate,
        Array.from(
          { length: 4 },
          (_, k): Part => ({ at: k * 0.25, samples: tone(rate, 0.24, k % 2 ? 900 : 600, k % 2 ? 900 : 600, 'square'), gain: 0.4 }),
        ),
      ),
  },
  bell: { format: LOW, render: (_r, rate) => ring(rate, 1.2, [523, 1240, 1870, 2690], 0.4) },
  'explosion-big': {
    format: WIDE,
    render: (r, rate) =>
      mix(rate, [envelope(lowpass(noise(r, rate, 1), rate, 700), rate, 0.005, 0.3), 1], [thump(rate, 1, 60, 30, 0.35), 0.8]),
  },
  'explosion-small': {
    format: LOW,
    render: (r, rate) => mix(rate, [hit(r, rate, 0.6, 1200, 0.15), 1], [thump(rate, 0.5, 90, 40, 0.15), 0.6]),
  },
  whistle: { format: LOW, render: (_r, rate) => fadeOut(scale(tone(rate, 1.2, 1600, 500), 0.6), rate, 0.1) },
  engine: {
    format: LOW,
    render: (_r, rate) => fadeOut(amplitude(lowpass(tone(rate, 1, 70, 75, 'saw'), rate, 600), rate, 9, 0.4), rate, 0.1),
  },
  fire: { format: LOW, render: (r, rate) => mix(rate, [lowpass(noise(r, rate, 1), rate, 500), 0.4], [crackle(r, rate, 1, 0.01), 1]) },
  electricity: {
    format: LOW,
    render: (r, rate) =>
      amplitude(mix(rate, [tone(rate, 0.4, 120, 120, 'square'), 0.5], [crackle(r, rate, 0.4, 0.05), 0.7]), rate, 30, 0.6),
  },
  'creature-shriek': { format: LOW, render: (_r, rate) => envelope(vibrato(rate, 0.5, 1400, 0.08, 18, 'saw'), rate, 0.03, 0.2) },
  creature: {
    format: LOW,
    render: (r, rate) =>
      mix(rate, [envelope(vibrato(rate, 0.6, 85, 0.15, 7, 'saw'), rate, 0.05, 0.3), 1], [lowpass(noise(r, rate, 0.6), rate, 400), 0.3]),
  },
  bloodcat: {
    format: LOW,
    render: (_r, rate) => envelope(bandpass(vibrato(rate, 0.6, 140, 0.2, 11, 'saw'), rate, 600, 2), rate, 0.04, 0.3),
  },
  cow: { format: LOW, render: (_r, rate) => formantVoice(rate, 0.7, 140, 110, 500) },
  crow: { format: LOW, render: (_r, rate) => repeat(rate, formantVoice(rate, 0.12, 900, 700, 1800), 2, 0.2) },
  robot: {
    format: LOW,
    render: (_r, rate) =>
      sequence(rate, [
        { at: 0, samples: tone(rate, 0.08, 1200, 1200, 'square'), gain: 0.4 },
        { at: 0.1, samples: tone(rate, 0.08, 800, 800, 'square'), gain: 0.4 },
      ]),
  },
  idle: { format: LOW, render: (r, rate) => swish(r, rate, 0.2, 700) },
  'ambient-bird': {
    format: LOW,
    render: (_r, rate) => repeat(rate, envelope(tone(rate, 0.09, 3200, 4200), rate, 0.005, 0.04), 3, 0.15, 0.5),
  },
  'ambient-cricket': { format: LOW, render: (_r, rate) => amplitude(scale(tone(rate, 0.8, 4300, 4300), 0.4), rate, 28, 1) },
  'ambient-owl': { format: LOW, render: (_r, rate) => repeat(rate, envelope(vibrato(rate, 0.25, 380, 0.03, 5), rate, 0.04, 0.1), 2, 0.35) },
  'ambient-rain': { format: LOW, render: (r, rate) => fadeOut(scale(lowpass(noise(r, rate, 1), rate, 2500), 0.5), rate, 0.1) },
  'ambient-storm': { format: LOW, render: (r, rate) => envelope(lowpass(noise(r, rate, 1.2), rate, 200), rate, 0.1, 0.5) },
  [FALLBACK_CLASS]: { format: LOW, render: (r, rate) => click(r, rate, 0.05) },
};

const BURST = /^burst-(\w+)-(\d+)$/;

const RULES: readonly (readonly [RegExp, string])[] = [
  [/silencer burst (\d+)/, 'burst-silenced-$1'],
  [/shotgun burst (\d+)/, 'burst-shotgun-$1'],
  [/rl automatic (\d+)/, 'burst-launcher-$1'],
  [/(?:9mm|45 caliber|5,7) burst (\d+)/, 'burst-pistol-$1'],
  [/(?:5,45|5,56|7,62 \w+|4,7 caliber) burst (\d+)/, 'burst-rifle-$1'],
  [/bursttype1/, 'burst-rifle-3'],
  [/auto resolve composite/, 'gunfight'],
  [/silencer/, 'gun-silenced'],
  [/shotgun single/, 'gun-shotgun'],
  [/rocket launcher|tank_cannon|mortar fire/, 'gun-launcher'],
  [/(?:5,45|5,56|7,62|4,7)[\w ]* single/, 'gun-rifle'],
  [/9mm|38 caliber|45 caliber|357|automag|5,7/, 'gun-pistol'],
  [/dry fire/, 'dry-fire'],
  [/lnl/, 'lock-n-load'],
  [/reload|load mortar|setting up mortar/, 'reload'],
  [/attachment|ceramic armor insert|detonator beep/, 'attach'],
  [/knife throw|swoosh|stab into flesh|chop\d/, 'knife'],
  [/slap/, 'punch'],
  [/ricochet/, 'ricochet'],
  [/glass/, 'glass'],
  [/metal hit|tire impact|alien impact/, 'impact-metal'],
  [/water impact|splash|step into water/, 'water-splash'],
  [/rock hit/, 'drop'],
  [/impact|knife hit ground/, 'impact'],
  [/fall to knees|knees to dirt|heavy fall|body_splat|adult fall|cow falling|land on roof|death hit/, 'fall'],
  [/(?:metal door|garage door|locker door|fridge door) open|statue open/, 'door-metal-open'],
  [/(?:metal door|garage door|locker door|fridge door) close/, 'door-metal-close'],
  [/(?:door|drawer|box|fence) open|doorcr/, 'door-open'],
  [/(?:door|drawer|box) close|into vehicle/, 'door-close'],
  [/key failure/, 'door-locked'],
  [/lock|wirecutters/, 'lock'],
  [/ftp gravel/, 'step-gravel'],
  [/ftp gritty|adult step/, 'step-gritty'],
  [/ftp leaves/, 'step-leaves'],
  [/crawling|baby dragging|larvae movement/, 'crawl'],
  [/water movement/, 'step-water'],
  [/swimming/, 'swim'],
  [/prone to|crouch to|stand to/, 'stance'],
  [/picking something up|catch object|grab roof/, 'pickup'],
  [/drink from canteen/, 'drink'],
  [/computer beep|email alert/, 'laptop-beep'],
  [/power up|power down/, 'laptop-power'],
  [/static\d/, 'static'],
  [/switch|text 02|glowclick/, 'ui-click'],
  [/robot/, 'robot'],
  [/beep|endturn|turn_near_end|target cursor|line 0\d fx/, 'ui-beep'],
  [/alarm/, 'alarm'],
  [/fight bell/, 'bell'],
  [/explode1|explosion \d+|cave collapsing|psionic blast|blah2/, 'explosion-big'],
  [/exploding|small explosion|gas grenade|air escaping|disintegration/, 'explosion-small'],
  [/whistle/, 'whistle'],
  [/driving|engine|heli1|tank turret|raid ambient|raid dive/, 'engine'],
  [/fire \d+ loop/, 'fire'],
  [/electricity|x ray|remote activate/, 'electricity'],
  [/shriek|blah/, 'creature-shriek'],
  [/adult|baby|larvae|queen|eating_flesh/, 'creature'],
  [/bloodcat|tiger/, 'bloodcat'],
  [/cow/, 'cow'],
  [/crow/, 'crow'],
  [/scratch|armpit|cracking back/, 'idle'],
  [/bird/, 'ambient-bird'],
  [/cricket/, 'ambient-cricket'],
  [/owl/, 'ambient-owl'],
  [/rain/, 'ambient-rain'],
  [/storm/, 'ambient-storm'],
];

export function soundClassOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.wav$/, '');
  for (const [pattern, cls] of RULES) {
    const m = pattern.exec(name);
    if (m) return cls.replace('$1', m[1] ?? '');
  }
  return FALLBACK_CLASS;
}

function burstClass(gun: GunKind, rounds: number): SoundClass {
  const { render, interval } = GUN_SHOTS[gun];
  return {
    format: LOW,
    render: (r, rate) => repeat(rate, render(r, rate), rounds, interval),
  };
}

function classByName(name: string): SoundClass {
  const known = CLASSES[name];
  if (known) return known;
  const burst = BURST.exec(name);
  const gun = burst?.[1] as GunKind | undefined;
  if (burst && gun && gun in GUN_SHOTS) return burstClass(gun, Number(burst[2]));
  throw new RangeError(`no stub sound class ${name}`);
}

function renderClass(name: string, cls: SoundClass): Uint8Array {
  const channels = cls.format.stereo ? ['left', 'right'] : ['mono'];
  return encodeStubWav(
    cls.format,
    channels.map((side) => normalize(cls.render(new StubRandom(`${name}/${side}`), cls.format.rate), PEAK)),
  );
}

const VOICE_PITCH: Readonly<Record<VoiceBody, number>> = { male: 115, female: 210, kid: 300 };
const VOICE_FORMANT: Readonly<Record<VoiceBody, number>> = { male: 650, female: 850, kid: 1000 };

interface Syllable {
  readonly at: number;
  readonly seconds: number;
  readonly from: number;
  readonly to: number;
}

const KIND_SHAPES: Readonly<Record<string, readonly Syllable[]>> = {
  ok1: [
    { at: 0, seconds: 0.12, from: 1, to: 1.05 },
    { at: 0.16, seconds: 0.16, from: 1.1, to: 1.25 },
  ],
  ok2: [{ at: 0, seconds: 0.22, from: 1.05, to: 0.95 }],
  cool: [{ at: 0, seconds: 0.35, from: 1, to: 1.3 }],
  curse: [{ at: 0, seconds: 0.25, from: 1.2, to: 0.8 }],
  hit1: [{ at: 0, seconds: 0.18, from: 1.4, to: 0.9 }],
  hit2: [{ at: 0, seconds: 0.24, from: 1.3, to: 0.8 }],
  laugh: [0, 0.14, 0.28, 0.42].map((at, k) => ({ at, seconds: 0.1, from: 1.3 - k * 0.05, to: 1.2 - k * 0.05 })),
  attn: [{ at: 0, seconds: 0.3, from: 0.95, to: 1.25 }],
  die: [{ at: 0, seconds: 0.7, from: 1.1, to: 0.6 }],
  humm: [{ at: 0, seconds: 0.4, from: 1, to: 1 }],
  noth: [{ at: 0, seconds: 0.25, from: 1, to: 0.85 }],
  gotit: [
    { at: 0, seconds: 0.1, from: 1.1, to: 1.15 },
    { at: 0.13, seconds: 0.12, from: 1.2, to: 1.3 },
  ],
  lmok1: [{ at: 0, seconds: 0.35, from: 0.9, to: 0.8 }],
  lmok2: [{ at: 0, seconds: 0.4, from: 0.85, to: 0.75 }],
  lmattn: [{ at: 0, seconds: 0.4, from: 0.85, to: 0.9 }],
  locked: [
    { at: 0, seconds: 0.15, from: 1.1, to: 1 },
    { at: 0.2, seconds: 0.2, from: 1, to: 0.85 },
  ],
  enem: [
    { at: 0, seconds: 0.14, from: 1.25, to: 1.3 },
    { at: 0.18, seconds: 0.18, from: 1.3, to: 1.1 },
  ],
};

function battleVoice(body: VoiceBody, kind: BattleSoundKind): Uint8Array {
  const rate = VOICE.rate;
  const pitch = VOICE_PITCH[body];
  const formant = VOICE_FORMANT[body];
  const shape = KIND_SHAPES[kind.file] ?? [{ at: 0, seconds: 0.25, from: 1, to: 1 }];
  const parts = shape.map((s): Part => ({ at: s.at, samples: formantVoice(rate, s.seconds, pitch * s.from, pitch * s.to, formant) }));
  return encodeStubWav(VOICE, [normalize(sequence(rate, parts), PEAK)]);
}

async function put(out: string, path: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), bytes);
  return path;
}

export async function buildBattleSounds(out: string, table: BattleSoundTable, aliases: Map<string, string>): Promise<string[]> {
  const written: string[] = [];
  const bodies = new Map<VoiceBody, GenericVoiceSet[]>();
  for (const set of genericVoiceSets()) bodies.set(set.body, [...(bodies.get(set.body) ?? []), set]);
  for (const [body, sets] of bodies) {
    for (const kind of table.kinds) {
      const users = sets.filter((set) => voiceSetKinds(table, set).includes(kind));
      if (users.length === 0) continue;
      const target = await put(out, `${BATTLE_DIR}/${body}-${kind.file}.wav`, battleVoice(body, kind));
      written.push(target);
      for (const set of users) aliases.set(battleSoundPath(table, set.basename, kind.file), target);
    }
  }
  return written;
}

export async function buildSoundEffects(out: string, paths: readonly string[], aliases: Map<string, string>): Promise<string[]> {
  const byClass = new Map<string, string[]>();
  for (const path of paths) {
    if (aliases.has(path)) continue;
    const cls = soundClassOf(path);
    byClass.set(cls, [...(byClass.get(cls) ?? []), path]);
  }
  const written: string[] = [];
  for (const [name, users] of [...byClass].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const target = await put(out, `${SFX_DIR}/${name}.wav`, renderClass(name, classByName(name)));
    written.push(target);
    for (const path of users) aliases.set(path, target);
  }
  return written;
}

async function dataJson(path: string): Promise<unknown> {
  return parseJsonc(await readFile(join(PROJECT_DATA_DIR, path), 'utf8'));
}

export async function stubSoundPaths(): Promise<string[]> {
  const table = parseSoundEffects(await dataJson(SOUND_EFFECTS_PATH));
  const items = await loadItemTable(dataJson);
  const maxRounds = Math.max(...items.ordered.map((d) => d.weapon?.shotsPerBurst ?? 0));
  const externalized = (await Promise.all(EXTERNALIZED_SOUND_TABLES.map(dataJson)))
    .flatMap(soundPathsIn)
    .flatMap((path) => expandBurstPattern(path, maxRounds));
  return [...new Set([...effectPaths(table), ...externalized])].sort();
}

export async function buildStubSounds(out: string, aliases: Map<string, string>): Promise<string[]> {
  const battle = parseBattleSounds(await dataJson(BATTLE_SOUNDS_PATH));
  const voices = await buildBattleSounds(out, battle, aliases);
  return [...voices, ...(await buildSoundEffects(out, await stubSoundPaths(), aliases))];
}
