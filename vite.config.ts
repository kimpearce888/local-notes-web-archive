import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Build for the unpacked Chrome extension release folder (dist/).
 *
 * Entries:
 *  - src/background/index.ts -> dist/assets/background.js (MV3 module service worker)
 *  - dashboard.html          -> dist/dashboard.html          (dashboard tab UI)
 *
 * public/ carries manifest.json and icons verbatim. Rules enforced by the
 * release gate (scripts/release.mjs): no remote imports, no dynamic code
 * (eval/new Function), everything bundled locally (PRD §7).
 */
export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        background: here('./src/background/index.ts'),
        dashboard: here('./dashboard.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
});
