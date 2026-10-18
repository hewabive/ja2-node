import { dataDecoding } from '../content/text/data-version.ts';
import { openDataVfs } from '../node/data-vfs.ts';
import type { EngineIdentity } from './content-identity.ts';
import { createSaveEnvironment } from './save-environment.ts';
import type { SaveService } from './save-service.ts';
import type { SessionText } from './session.ts';
import { createSessionFactory } from './session-factory.ts';
import { type HostFactory, inProcessHostFactory } from './session-host.ts';

export interface SessionDataDirs {
  readonly projectDataDir?: string | undefined;
  readonly dataDir?: string | undefined;
  readonly stubsDir?: string | undefined;
}

export interface SessionEnvironmentConfig {
  readonly data: SessionDataDirs;
  readonly text: SessionText;
  readonly engine: EngineIdentity;
  readonly env: Readonly<Record<string, string>>;
}

export interface SessionEnvironment {
  readonly createHost: HostFactory;
  readonly saves: SaveService;
  close(): Promise<void>;
}

export async function openSessionEnvironment(
  config: SessionEnvironmentConfig,
  warn: (message: string) => void,
): Promise<SessionEnvironment> {
  const data = await openDataVfs(config.data);
  try {
    const dataVersion = config.text.dataVersion;
    const environment = createSaveEnvironment({
      vfs: data.vfs,
      dataDir: data.dataDir,
      dataVersion,
      decoding: dataDecoding(dataVersion),
      env: { ...config.env },
      engine: config.engine,
      warn,
    });
    const factory = createSessionFactory({ ...environment.sources, text: config.text, saves: environment.saves });
    return {
      createHost: inProcessHostFactory(factory, environment.saves),
      saves: environment.saves,
      close: async () => {
        await environment.saves.flush();
        await data.close();
      },
    };
  } catch (err) {
    await data.close();
    throw err;
  }
}
