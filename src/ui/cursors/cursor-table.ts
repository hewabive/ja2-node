export const CURSORS_TABLE_PATH = 'tables/cursors.json';

export type SubPosition = number | 'center' | 'hide';
export type HotSpot = number | 'center' | 'left' | 'right' | 'top' | 'bottom';

export const CursorFlag = { FLASH: 1, FLASH2: 2, SUB_CONDITIONALLY: 4, DELAY_START: 8, PLAY_SOUND: 16 } as const;

export interface CursorFile {
  readonly name: string;
  readonly path: string | null;
  readonly outline: boolean;
}

export interface CursorComposite {
  readonly file: number;
  readonly frame: number;
  readonly x: SubPosition;
  readonly y: SubPosition;
}

export interface CursorDefinition {
  readonly name: string;
  readonly composites: readonly CursorComposite[];
  readonly hotX: HotSpot;
  readonly hotY: HotSpot;
  readonly flags: number;
  readonly hideOnTouch: boolean;
}

export interface CursorTable {
  readonly files: readonly CursorFile[];
  readonly cursors: readonly CursorDefinition[];
  readonly ids: ReadonlyMap<string, number>;
}

function isSub(value: unknown): value is SubPosition {
  return typeof value === 'number' || value === 'center' || value === 'hide';
}

function isHot(value: unknown): value is HotSpot {
  return typeof value === 'number' || value === 'center' || value === 'left' || value === 'right' || value === 'top' || value === 'bottom';
}

export function parseCursorTable(json: unknown): CursorTable {
  const root = json as { files?: unknown; cursors?: unknown } | null;
  if (!root || !Array.isArray(root.files) || !Array.isArray(root.cursors)) throw new Error('malformed cursor table');
  const files: CursorFile[] = root.files.map((f, i) => {
    const file = f as Partial<CursorFile>;
    if (typeof file.name !== 'string' || (file.path !== null && typeof file.path !== 'string') || typeof file.outline !== 'boolean')
      throw new Error(`cursor file ${i} is malformed`);
    return { name: file.name, path: file.path, outline: file.outline };
  });
  const cursors: CursorDefinition[] = root.cursors.map((c, i) => {
    const cursor = c as Partial<CursorDefinition>;
    if (typeof cursor.name !== 'string' || !Array.isArray(cursor.composites) || !isHot(cursor.hotX) || !isHot(cursor.hotY))
      throw new Error(`cursor ${i} is malformed`);
    const composites = cursor.composites.map((s) => {
      const sub = s as Partial<CursorComposite>;
      if (typeof sub.file !== 'number' || typeof sub.frame !== 'number' || !isSub(sub.x) || !isSub(sub.y) || !files[sub.file])
        throw new Error(`cursor ${cursor.name} has a malformed composite`);
      return { file: sub.file, frame: sub.frame, x: sub.x, y: sub.y };
    });
    return {
      name: cursor.name,
      composites,
      hotX: cursor.hotX,
      hotY: cursor.hotY,
      flags: cursor.flags ?? 0,
      hideOnTouch: cursor.hideOnTouch ?? false,
    };
  });
  return { files, cursors, ids: new Map(cursors.map((c, i) => [c.name, i])) };
}

export function cursorFilePaths(table: CursorTable): string[] {
  return table.files.flatMap((f) => (f.path ? [f.path] : []));
}

export function cursorFramesUsed(table: CursorTable): Map<string, number> {
  const frames = new Map<string, number>();
  for (const cursor of table.cursors) {
    for (const sub of cursor.composites) {
      const path = table.files[sub.file]?.path;
      if (!path) continue;
      frames.set(path, Math.max(frames.get(path) ?? 0, sub.frame + 1));
    }
  }
  return frames;
}
