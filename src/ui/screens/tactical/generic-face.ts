export interface GenericFace {
  readonly eyes: readonly [number, number];
  readonly mouth: readonly [number, number];
  readonly blinkFrequency: number;
  readonly expressionFrequency: number;
}

export const GENERIC_FACE: GenericFace = {
  eyes: [12, 13],
  mouth: [17, 29],
  blinkFrequency: 3000,
  expressionFrequency: 2500,
};

export const GENERIC_FACE_BODY_TYPES = 4;
export const GENERIC_FACE_DIR = 'faces/generic';

export function genericFacePath(bodyType: number): string {
  const body = Number.isInteger(bodyType) && bodyType >= 0 && bodyType < GENERIC_FACE_BODY_TYPES ? bodyType : 0;
  return `${GENERIC_FACE_DIR}/body${body}.sti`;
}
