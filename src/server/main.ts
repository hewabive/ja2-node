import { TOKEN_ENV } from '../node/token.ts';
import { repoLayout, repoStateDirs } from './repo-layout.ts';
import { SESSION_HOST_ENV } from './session-host.ts';
import { DATA_DIR_ENV, DEFAULT_HOST, DEFAULT_PORT, HOST_ENV, PORT_ENV, type ServerReport, startServer } from './start.ts';

function banner(host: string, r: ServerReport): string[] {
  const origin = `http://${host}:${r.port}`;
  return [
    `ja2-node server on ${origin}`,
    `  original data: ${r.dataDir ?? `not set (${DATA_DIR_ENV})`}${r.dataDir ? `, ${r.slfCount} SLF` : ''}`,
    `  stubs: ${r.stubsDir ?? 'missing (run pnpm stubs)'}`,
    `  data version: ${r.dataVersion.version} (${r.dataVersion.source}), display language: ${r.language}`,
    ...(r.dataVersion.warning ? [`  warning: ${r.dataVersion.warning}`] : []),
    `  files in VFS: ${r.files}`,
    `  rule pack: ${r.rules.hash.slice(0, 16)}, ${r.rules.files} files (${r.rules.cached ? 'cached' : 'built'} in ${r.rules.dir ?? 'memory'})`,
    ...(r.sandbox ? [`  sandbox: ${String(r.sandbox.map)}, ${String(r.sandbox.soldiers)} visible soldiers`] : []),
    `  sessions: ${r.hostKind === 'worker' ? 'one worker thread each' : 'in process, time-sliced'} (${SESSION_HOST_ENV})`,
    `  saves: ${r.saveDir}${r.nativeSavesDir ? `, native saves: ${r.nativeSavesDir}` : ''}, installation: ${r.installationFile}`,
    `  token: .ja2/token (or $${TOKEN_ENV})`,
    ...(r.clientBuilt ? [`  built client: ${origin}/login?token=${r.token}`] : []),
  ];
}

const env = process.env;
const host = env[HOST_ENV] ?? DEFAULT_HOST;
const server = await startServer({
  layout: repoLayout(env),
  state: repoStateDirs(env),
  listen: { host, port: Number(env[PORT_ENV] ?? DEFAULT_PORT) },
  dataDir: env[DATA_DIR_ENV] || null,
  env,
  warn: (message) => console.warn(message),
});
for (const line of banner(host, server.report)) console.log(line);

let stopping = false;
const shutdown = (): void => {
  if (stopping) return;
  stopping = true;
  void server.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
