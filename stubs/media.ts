import { buildStubAmbient } from './ambient.ts';
import { buildStubSounds } from './audio.ts';
import { buildStubFonts } from './fonts.ts';
import { buildStubMusic } from './music.ts';
import { buildStubSpeech, mercSpeechSets, npcSpeechSets } from './speech.ts';
import { buildStubText } from './text.ts';

export async function buildStubMedia(out: string, aliases: Map<string, string>): Promise<string[]> {
  const text = await buildStubText(out);
  const sounds = await buildStubSounds(out, aliases);
  const ambient = await buildStubAmbient(out, sounds, aliases);
  const music = await buildStubMusic(out);
  const speech = await buildStubSpeech(out, [...mercSpeechSets(text.mercDialogue), ...(await npcSpeechSets())], aliases);
  const fonts = await buildStubFonts(out, aliases);
  return [...text.written, ...sounds, ...ambient, ...music, ...speech, ...fonts];
}
