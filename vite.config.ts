import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The backend (backend/, `python -m app`) behind the same origin as in production (Caddy):
// no CORS, and the refresh-token cookie is first-party.
const apiProxy = { '/api': 'http://127.0.0.1:8000' };

// TIERS_ENABLED from the repository's .env (or the environment, e.g. the Docker build arg): the same
// switch the API reads. Built in, because the landing page is prerendered with or without the tariffs.
const tiersEnabled = (mode: string) => loadEnv(mode, process.cwd(), '').TIERS_ENABLED?.trim().toLowerCase() === 'true';

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  define: { __TIERS_ENABLED__: JSON.stringify(tiersEnabled(mode)) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, host: true, proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    // pdfmake is ~1 MB minified but loads only when a PDF is exported; three.js is ~520 kB,
    // everything else stays well below.
    chunkSizeWarningLimit: 1050,
    rollupOptions: {
      // Long-lived vendor chunks stay cached between deploys; three.js loads only with the editor.
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (/\/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
