import { z } from 'zod';
import type { PlayerView } from '../protocol/view.ts';
import type { SessionHost, SessionObservation } from './session-host.ts';
import { labelledView } from './text-keys.ts';
import type { TextService } from './text-service.ts';

export type Observation = PlayerView & Pick<SessionObservation, 'language' | 'dataVersion'> & SessionObservation['status'];

export type ObservationField = keyof Observation;

const EVERY_FIELD: Record<ObservationField, true> = {
  tick: true,
  mapPath: true,
  clock: true,
  strategic: true,
  prompt: true,
  contractPrompt: true,
  autoresolve: true,
  shop: true,
  laptop: true,
  conversation: true,
  npcRequest: true,
  scriptedSequence: true,
  meanwhile: true,
  ended: true,
  boxing: true,
  autoBandage: true,
  soldiers: true,
  openDoors: true,
  openContainers: true,
  doors: true,
  combat: true,
  selected: true,
  currentSquad: true,
  revealedRooms: true,
  revealedAtLoad: true,
  revealedTiles: true,
  slantRoofCeilings: true,
  knownMines: true,
  items: true,
  corpses: true,
  smoke: true,
  light: true,
  tileChanges: true,
  addedExitGrids: true,
  blood: true,
  itemLocatorsLocked: true,
  interfaceLocked: true,
  radarContacts: true,
  helicopterDrop: true,
  music: true,
  language: true,
  dataVersion: true,
  options: true,
  saveMode: true,
  canSave: true,
  saveRefusal: true,
  viewerPrompts: true,
};

export const OBSERVATION_FIELDS = Object.keys(EVERY_FIELD) as readonly ObservationField[];

function unknownField(input: unknown): string {
  return `${JSON.stringify(input)} is not an observe field; the fields are ${OBSERVATION_FIELDS.join(', ')}`;
}

export const OBSERVE_SHAPE = {
  fields: z
    .array(z.enum(OBSERVATION_FIELDS, { error: (issue) => unknownField(issue.input) }))
    .optional()
    .describe(
      'the top-level keys of the observation to answer with, e.g. ["soldiers", "combat", "prompt"]; without it the whole observation',
    ),
};

function onlyFields(whole: Record<string, unknown>, fields: readonly ObservationField[] | undefined): Record<string, unknown> {
  if (fields === undefined) return whole;
  const wanted = new Set<string>(fields);
  return Object.fromEntries(Object.entries(whole).filter(([key]) => wanted.has(key)));
}

export async function observation(
  host: SessionHost,
  texts: TextService | undefined,
  fields?: readonly ObservationField[] | undefined,
): Promise<Record<string, unknown>> {
  const { view, language, dataVersion, status } = await host.observe();
  const strings = texts ? await texts.strings(language).catch(() => null) : null;
  return onlyFields({ ...(strings ? labelledView(view, strings.strings) : view), language, dataVersion, ...status }, fields);
}
