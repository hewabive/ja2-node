import { join } from 'node:path';
import { REPO_ROOT } from '../../src/node/repo.ts';
import { arrayItems, bracedBody, readSource, STRACCIATELLA_COMMIT, stripCComments, writeTable } from './c-source.ts';

const NUM_MEANWHILES_NAME = 'NUM_MEANWHILES';
const INTERROGATION_NAME = 'INTERROGATION';
const OUTSKIRTS_NAME = 'OUTSKIRTS_MEDUNA';

const header = stripCComments(readSource('game/Strategic/Meanwhile.h'));
const source = readSource('game/Strategic/Meanwhile.cc');
const queenCommand = readSource('game/Strategic/Queen_Command.cc');
const qarray = readSource('game/Tactical/QArray.cc');

const names = stripCComments(bracedBody(header, 'enum'))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s !== NUM_MEANWHILES_NAME);

const flags = new Map<string, number>();
for (const [, name, value] of source.matchAll(/^#define\s+(\w+)_FLAG\s+(0x[0-9a-fA-F]+)/gm))
  if (name && value) flags.set(name, Number(value));

const gridNos = arrayItems(source, 'static const UINT16 gusMeanWhileGridNo[] =').map(Number);
if (gridNos.length !== names.length) throw new Error(`gusMeanWhileGridNo has ${gridNos.length} entries for ${names.length} scenes`);

function startSwitch(): string {
  const body = bracedBody(source, 'static void StartMeanwhile(void)');
  const at = body.indexOf('switch( gCurrentMeanwhileDef.ubMeanwhileID )');
  if (at < 0) throw new Error('StartMeanwhile switch not found');
  return body.slice(at);
}

const switchSource = stripCComments(startSwitch());
const interrogationCase = switchSource.slice(switchSource.indexOf(`case\t${INTERROGATION_NAME}:`));
const npcsOf = (text: string) => [...text.matchAll(/SetNPCMeanwhile\((\w+),/g)].map(([, n]) => n ?? '');
const medunaNpcs = npcsOf(switchSource.slice(0, switchSource.indexOf(`case\t${INTERROGATION_NAME}:`))).filter(
  (n, i, all) => all.indexOf(n) === i,
);
const interrogationNpcs = npcsOf(interrogationCase);
const outskirtsOnly = /if \(gCurrentMeanwhileDef\.ubMeanwhileID == OUTSKIRTS_MEDUNA\)\s*\{\s*SetNPCMeanwhile\((\w+),/.exec(
  switchSource,
)?.[1];
if (!outskirtsOnly || interrogationNpcs.length === 0) throw new Error('scene NPCs not found');
const medunaBase = medunaNpcs.filter((n) => n !== outskirtsOnly);

const interrogationPost = /ScheduleMeanwhileEvent\(SGPSector\((\d+),\s*(\d+)\),\s*0,\s*INTERROGATION,\s*(\w+),\s*(\d+)\)/.exec(
  queenCommand,
);
const medunaSector = /static const SGPSector MedunaQueenSector\((\d+),\s*(\d+)\);/.exec(source);
if (!interrogationPost || !medunaSector) throw new Error('scene sectors not found');
const sectorName = (x: string, y: string) => `${String.fromCharCode(64 + Number(y))}${Number(x)}`;
const skipRule = /gCurrentMeanwhileDef\.ubMeanwhileID != (\w+)\s*&& MeanwhileSceneSeen/.exec(source)?.[1];
if (skipRule !== INTERROGATION_NAME) throw new Error('skip rule not found');

const scenes = names.map((name, id) => {
  const interrogation = name === INTERROGATION_NAME;
  const flag = flags.get(name);
  if (flag === undefined) throw new Error(`no flag for ${name}`);
  return {
    id,
    name,
    flag,
    sector: interrogation
      ? sectorName(interrogationPost[1] ?? '', interrogationPost[2] ?? '')
      : sectorName(medunaSector[1] ?? '', medunaSector[2] ?? ''),
    npcs: interrogation ? interrogationNpcs : name === OUTSKIRTS_NAME ? [...medunaBase, outskirtsOnly] : medunaBase,
    cameraGridNo: gridNos[id],
    skippable: !interrogation,
  };
});

function witnesses(declaration: string): number[] {
  const values = arrayItems(qarray, declaration).map(Number);
  return values.flatMap((v, profile) => (v ? [profile] : []));
}

const out = {
  source: `JA2 Stracciatella ${STRACCIATELLA_COMMIT}: src/game/Strategic/Meanwhile.h (scene ids), src/game/Strategic/Meanwhile.cc (*_FLAG, gusMeanWhileGridNo, MedunaQueenSector, StartMeanwhile, BringupMeanwhileBox), src/game/Strategic/Queen_Command.cc EndCaptureSequence (the interrogation's sector), src/game/Tactical/QArray.cc QuoteExp_WitnessDeidrannaDeath, QuoteExp_WitnessQueenBugDeath`,
  license: 'Derived from Jagged Alliance 2 source code (Strategy First SFI-SCLA). See LICENSE.',
  format:
    'scenes in id order: internal name, flag bit of uiMeanWhileFlags, scene sector, the NPC profile names moved there, the camera gridno of the scene and whether the box offers Skip once the scene was seen; witnesses: the profile ids whose QArray entry is 1 (they say the kill quote when they see the death tile), every other profile only as the killer',
  scenes,
  witnesses: {
    deidranna: witnesses('BOOLEAN QuoteExp_WitnessDeidrannaDeath[73] ='),
    queenBug: witnesses('BOOLEAN QuoteExp_WitnessQueenBugDeath[73] ='),
  },
};
const target = join(REPO_ROOT, 'data/tables/narrative-scenes.json');
writeTable(target, out);
console.log(
  `${scenes.length} scenes, ${out.witnesses.deidranna.length} Deidranna witnesses, ${out.witnesses.queenBug.length} queen bug witnesses → ${target}`,
);
