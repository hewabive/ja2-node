import { buildStubAmbient } from './ambient.ts';
import { buildStubSounds } from './audio.ts';
import { buildStubFonts } from './fonts.ts';
import { buildStubMusic } from './music.ts';
import { buildStubSpeech, mercSpeechSets, npcSpeechSets } from './speech.ts';
import { buildStubText } from './text.ts';
import { buildStubCursors } from './ui/cursors.ts';
import { buildStubFaces, buildStubPortraits } from './ui/faces.ts';
import { buildStubItemGraphics } from './ui/items.ts';
import { buildStubOwnerFaces } from './ui/owner-faces.ts';
import { buildStubRadarMaps } from './ui/radar.ts';
import { buildStubSkin } from './ui/skin.ts';
import { buildStubTestCard } from './ui-test-card.ts';
import { buildStubVideo } from './video.ts';

export async function buildStubMedia(out: string, aliases: Map<string, string>): Promise<string[]> {
  const text = await buildStubText(out);
  const sounds = await buildStubSounds(out, aliases);
  const ambient = await buildStubAmbient(out, sounds, aliases);
  const music = await buildStubMusic(out);
  const speech = await buildStubSpeech(out, [...mercSpeechSets(text.mercDialogue), ...(await npcSpeechSets())], aliases);
  const video = await buildStubVideo(out);
  const fonts = await buildStubFonts(out, aliases);
  const testCard = await buildStubTestCard(out);
  const cursors = await buildStubCursors(out);
  const faces = await buildStubFaces(out, aliases);
  const items = await buildStubItemGraphics(out, aliases);
  const radar = await buildStubRadarMaps(out, aliases);
  const before = [
    ...text.written,
    ...sounds,
    ...ambient,
    ...music,
    ...speech,
    ...video,
    ...fonts,
    ...testCard,
    ...cursors,
    ...faces,
    ...items,
    ...radar,
  ];
  const present = new Set(before);
  const skin = await buildStubSkin(out, (path) => present.has(path) || aliases.has(path), aliases);
  const portraits = await buildStubPortraits(out, (path) => present.has(path) || aliases.has(path));
  const ownerFaces = await buildStubOwnerFaces(out, (path) => present.has(path) || aliases.has(path));
  return [...before, ...skin, ...portraits, ...ownerFaces];
}
