// Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Modified for ja2-node: reimplemented in TypeScript, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/game/TileEngine/Physics.h vector_3; Physics.cc VDotProduct, VGetNormal (float32 throughout)

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const f32 = Math.fround;

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x: f32(x), y: f32(y), z: f32(z) };
}

export function copy(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export function scale(v: Vec3, m: number): Vec3 {
  return { x: f32(v.x * m), y: f32(v.y * m), z: f32(v.z * m) };
}

export function addInPlace(v: Vec3, d: Vec3): void {
  v.x = f32(v.x + d.x);
  v.y = f32(v.y + d.y);
  v.z = f32(v.z + d.z);
}

export function dot(a: Vec3, b: Vec3): number {
  return f32(f32(f32(a.x * b.x) + f32(a.y * b.y)) + f32(a.z * b.z));
}

export function normal(a: Vec3): Vec3 {
  const length = dot(a, a);
  if (length === 0) return vec3();
  return scale(a, f32(1 / f32(Math.sqrt(length))));
}
