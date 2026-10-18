import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeVfsAliases, VFS_ALIASES_FILE } from '../src/content/vfs/aliases.ts';
import { buildStubAmbient } from './ambient.ts';
import { buildStubSounds } from './audio.ts';
import { buildStubMusic } from './music.ts';
import { buildStubSpeech, mercSpeechSets, npcSpeechSets } from './speech.ts';
import { buildStubText } from './text.ts';

export async function buildStubMedia(out: string): Promise<string[]> {
  const aliases = new Map<string, string>();
  const text = await buildStubText(out);
  const sounds = await buildStubSounds(out, aliases);
  const ambient = await buildStubAmbient(out, sounds, aliases);
  const music = await buildStubMusic(out);
  const speech = await buildStubSpeech(out, [...mercSpeechSets(text.mercDialogue), ...(await npcSpeechSets())], aliases);
  await writeFile(join(out, VFS_ALIASES_FILE), encodeVfsAliases(aliases));
  return [...text.written, ...sounds, ...ambient, ...music, ...speech, VFS_ALIASES_FILE];
}
