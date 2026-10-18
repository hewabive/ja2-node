import { type BenchContext, pendingLine } from '../measure.ts';

export const SAVE = 'save';

const PENDING =
  'needs the session snapshot of docs/27 §1.3 (slices S2/S3); will measure snapshot and restore of the largest states (bytes raw and gzipped, ms to serialize, gzip, parse and rebuild)';

export async function save(ctx: BenchContext): Promise<void> {
  if (ctx.variant === null) ctx.emit(pendingLine(ctx, SAVE, PENDING));
}
