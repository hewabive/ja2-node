import type { EngineIdentity } from './content-identity.ts';

export interface ServerLayout {
  readonly projectDataDir: string;
  readonly stubsDir: string | null;
  readonly clientDir: string;
  readonly sessionWorker: URL;
  readonly engine: EngineIdentity;
  readonly repositoryRoot: string | null;
}

export interface StateDirs {
  readonly tokenFile: string;
  readonly saveDir: string;
  readonly cacheDir: string;
}
