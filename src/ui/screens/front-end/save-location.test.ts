import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadMapTestFacts } from '../../../../tests/support/strategic.ts';
import { parseSectorString } from '../../../content/strategic/sector-ids.ts';
import { loadUiStrings } from '../../../content/text/strings.ts';
import { PROJECT_DATA_DIR } from '../../../node/repo.ts';
import type { PlayerView, StrategicView } from '../../../protocol/view.ts';
import type { SectorName } from '../../saves/save-rows.ts';
import { StringsTextService, type UiTextService } from '../../text/text-service.ts';
import type { MapFacts } from '../map/facts.ts';
import { saveLocationName } from './save-location.ts';

let facts: MapFacts;
let text: UiTextService;

beforeAll(async () => {
  facts = await loadMapTestFacts();
  text = new StringsTextService(await loadUiStrings(async (path) => new Uint8Array(await readFile(join(PROJECT_DATA_DIR, path))), 'eng'));
});

function viewWithSecrets(secretsFound: readonly string[]): PlayerView {
  return { tick: 0, mapPath: null, soldiers: [], strategic: { secretsFound } as unknown as StrategicView };
}

function named(name: SectorName, label: string, z = 0): string {
  return name(parseSectorString(label, z));
}

describe('the location of a save on the canvas save screen (GetSectorIDString)', () => {
  it('names the town, the mine town and the land type, without the detailed facilities', () => {
    const name = saveLocationName(facts, text, 'load', null);
    expect(named(name, 'A9')).toBe('A9: Omerta');
    expect(named(name, 'D4')).toBe('D4: San Mona');
    expect(named(name, 'D4', 1)).toBe('D4: San Mona');
    expect(named(name, 'B13')).toBe('B13: Drassen');
    expect(named(name, 'D15')).toBe('D15: SAM site');
    expect(named(name, 'A1')).toBe('A1: Tropical');
  });

  it('names every underground level of the list even unvisited, and leaves an unlisted one empty (gfGettingNameFromSaveLoadScreen)', () => {
    const name = saveLocationName(facts, text, 'load', null);
    expect(named(name, 'J9', 1)).toBe('J9: Tixa Dungeon');
    expect(named(name, 'A9', 1)).toBe('');
  });

  it('counts every secret as found on the load screen and reads the running game on the save screen (IsSecretFoundAt)', () => {
    expect(named(saveLocationName(facts, text, 'load', viewWithSecrets([])), 'J9')).toBe('J9: Tixa');
    expect(named(saveLocationName(facts, text, 'save', viewWithSecrets([])), 'J9')).toBe('J9: Desert');
    expect(named(saveLocationName(facts, text, 'save', viewWithSecrets(['J9'])), 'J9')).toBe('J9: Tixa');
    expect(named(saveLocationName(facts, text, 'save', null), 'K4')).toBe('K4: Orta');
  });
});
