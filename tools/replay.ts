import { dataDecoding } from '../src/content/text/data-version.ts';
import type { DataVfs } from '../src/node/data-vfs.ts';
import { detectDataVersion } from '../src/server/data-version.ts';
import { cacheDirFromEnv, openRulePack } from '../src/server/rule-pack.ts';
import { contentSourceOf, createSaveEnvironment, replayStoredSave } from '../src/server/save-environment.ts';

export async function runReplay(data: DataVfs, name: string): Promise<number> {
  const dataVersion = detectDataVersion(data.vfs, data.dataDir !== null, process.env);
  const { pack } = await openRulePack({ vfs: data.vfs, source: contentSourceOf(data.dataDir), cacheDir: cacheDirFromEnv() });
  const environment = createSaveEnvironment({
    vfs: data.vfs,
    pack,
    dataDir: data.dataDir,
    dataVersion: dataVersion.version,
    decoding: dataDecoding(dataVersion.version),
    warn: (message) => console.error(message),
  });
  const t0 = performance.now();
  const result = await replayStoredSave(environment, name);
  const seconds = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`replay ${name}: ${result.entries} inputs in ${seconds} s, snapshot ${result.bytes} bytes`);
  if (result.equal) {
    console.log('the replay reproduces the save byte for byte');
    return 0;
  }
  console.log(`the replay differs ${result.difference}`);
  return 1;
}
