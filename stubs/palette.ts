export const RAMP = {
  gray: 0,
  green: 1,
  olive: 2,
  brown: 3,
  sand: 4,
  blue: 5,
  water: 6,
  red: 7,
  orange: 8,
  skin: 9,
  violet: 10,
  teal: 11,
  steel: 12,
  rust: 13,
  khaki: 14,
  ui: 15,
} as const;

export type RampName = keyof typeof RAMP;

const BASE: Record<RampName, readonly [number, number, number]> = {
  gray: [200, 200, 200],
  green: [80, 170, 70],
  olive: [130, 140, 60],
  brown: [140, 95, 55],
  sand: [215, 190, 130],
  blue: [70, 110, 210],
  water: [50, 120, 160],
  red: [200, 50, 45],
  orange: [230, 140, 40],
  skin: [225, 170, 130],
  violet: [140, 80, 190],
  teal: [40, 170, 160],
  steel: [120, 135, 150],
  rust: [170, 80, 40],
  khaki: [175, 160, 110],
  ui: [190, 170, 120],
};

export function color(ramp: RampName, shade: number): number {
  const s = Math.max(0, Math.min(15, Math.round(shade)));
  return Math.max(1, RAMP[ramp] * 16 + s);
}

const SHADES_PER_RAMP = 16;
const BASE_COLOR_POSITION = 0.53;
const MAX_WHITE_BLEND = 0.6;

function shadeOf(base: number, shade: number): number {
  const t = shade / (SHADES_PER_RAMP - 1);
  const darkening = t < BASE_COLOR_POSITION ? t / BASE_COLOR_POSITION : 1;
  const whitening = t < BASE_COLOR_POSITION ? 0 : ((t - BASE_COLOR_POSITION) / (1 - BASE_COLOR_POSITION)) * MAX_WHITE_BLEND;
  return Math.round(base * darkening * (1 - whitening) + 255 * whitening);
}

export function buildPalette(): Uint8Array {
  const palette = new Uint8Array(768);
  for (const [name, ramp] of Object.entries(RAMP) as [RampName, number][]) {
    const [r, g, b] = BASE[name];
    for (let shade = 0; shade < SHADES_PER_RAMP; shade++) {
      const i = (ramp * SHADES_PER_RAMP + shade) * 3;
      palette.set([shadeOf(r, shade), shadeOf(g, shade), shadeOf(b, shade)], i);
    }
  }
  palette.fill(0, 0, 3);
  return palette;
}
