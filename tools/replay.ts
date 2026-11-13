import { dataDecoding } from '../src/content/text/data-version.ts';
import type { DataVfs } from '../src/node/data-vfs.ts';
import { detectDataVersion } from '../src/server/data-version.ts';
import { repoLayout, repoStateDirs } from '../src/server/repo-layout.ts';
import { repositoryHistoryOf } from '../src/server/repository-history.ts';
import { openRulePack } from '../src/server/rule-pack.ts';
import { contentSourceOf, createSaveEnvironment, nativeSavesDir, replayStoredSave } from '../src/server/save-environment.ts';

export async function runReplay(data: DataVfs, name: string): Promise<number> {
  const dataVersion = await detectDataVersion(data, process.env);
  const layout = repoLayout();
  const state = repoStateDirs();
  const { pack } = await openRulePack({ vfs: data.vfs, source: contentSourceOf(data.dataDir), cacheDir: state.cacheDir });
  const environment = createSaveEnvironment({
    vfs: data.vfs,
    pack,
    dataDir: data.dataDir,
    dataVersion: dataVersion.version,
    decoding: dataDecoding(dataVersion.version),
    saveDir: state.saveDir,
    nativeSavesDir: nativeSavesDir(data.dataDir),
    engine: layout.engine,
    savedRepositoryFile: repositoryHistoryOf(layout.repositoryRoot, layout.projectDataDir),
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
