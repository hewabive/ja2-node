import { describe, expect, it } from 'vitest';
import { decodeObject, OBJECT_RECORD_BYTES } from './object.ts';

const FLAGS_OFFSET = 28;
const MISSION_OFFSET = 29;
const TRAP_OFFSET = 30;
const IMPRINT_OFFSET = 31;

describe('an OBJECTTYPE record', () => {
  it('reads ubMission between fFlags and bTrap', () => {
    const bytes = new Uint8Array(OBJECT_RECORD_BYTES + 2);
    bytes[2 + FLAGS_OFFSET] = 0x10;
    bytes[2 + MISSION_OFFSET] = 3;
    bytes[2 + TRAP_OFFSET] = 4;
    bytes[2 + IMPRINT_OFFSET] = 200;
    expect(decodeObject(bytes, 2)).toMatchObject({ flags: 0x10, mission: 3, trap: 4, imprintId: 200 });
  });
});
