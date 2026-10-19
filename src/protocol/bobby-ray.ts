export const BOBBY_RAY_SPEEDS = ['overnightExpress', 'twoBusinessDays', 'standardService'] as const;

export type BobbyRaySpeed = (typeof BOBBY_RAY_SPEEDS)[number];

const SPEED_LABELS: Readonly<Record<BobbyRaySpeed, string>> = {
  overnightExpress: 'overnight express',
  twoBusinessDays: '2 business days',
  standardService: 'standard service',
};

export function bobbyRaySpeedLabel(speed: number): string {
  const name = BOBBY_RAY_SPEEDS[speed];
  return name ? SPEED_LABELS[name] : String(speed);
}
