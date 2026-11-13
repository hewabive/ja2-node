import { defineConfig, type Plugin } from 'vite';
import { REPO_ROOT } from './src/node/repo.ts';
import { checkoutEngineIdentity } from './src/server/content-identity.ts';
import { ENGINE_FILE, PACKAGE_SERVER_DIR, PLAYER_BUNDLE, SESSION_WORKER_BUNDLE } from './src/server/package-layout.ts';

function engineFile(): Plugin {
  return {
    name: 'ja2-engine-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: ENGINE_FILE, source: `${JSON.stringify(checkoutEngineIdentity(REPO_ROOT))}\n` });
    },
  };
}

export default defineConfig({
  plugins: [engineFile()],
  publicDir: false,
  build: {
    ssr: true,
    outDir: PACKAGE_SERVER_DIR,
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rollupOptions: {
      input: {
        [PLAYER_BUNDLE]: 'src/server/player/main.ts',
        [SESSION_WORKER_BUNDLE]: 'src/server/session-worker.ts',
      },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
