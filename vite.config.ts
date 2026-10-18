import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';
import { loadOrCreateToken } from './src/node/token.ts';

export default defineConfig(() => {
  const token = loadOrCreateToken(fileURLToPath(new URL('./.ja2/token', import.meta.url)));
  const target = `http://127.0.0.1:${Number(process.env.JA2_PORT ?? 7420)}`;
  const proxy: ProxyOptions = { target, headers: { authorization: `Bearer ${token}` } };
  const proxies = { '/api': proxy, '/vfs': proxy, '/mcp': proxy, '/ws': { ...proxy, ws: true } };
  return {
    server: { host: '127.0.0.1', port: Number(process.env.JA2_WEB_PORT ?? 5173), strictPort: true, proxy: proxies },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: proxies },
    build: {
      outDir: 'dist/client',
      target: 'es2024',
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          assets: fileURLToPath(new URL('./src/devtools/asset-browser/index.html', import.meta.url)),
          maps: fileURLToPath(new URL('./src/devtools/map-viewer/index.html', import.meta.url)),
          tactical: fileURLToPath(new URL('./src/devtools/tactical/index.html', import.meta.url)),
          strategic: fileURLToPath(new URL('./src/devtools/strategic/index.html', import.meta.url)),
          video: fileURLToPath(new URL('./src/devtools/video/index.html', import.meta.url)),
        },
      },
    },
  };
});
