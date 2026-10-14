import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * T-086 (register UX-07): the pinned heic-to CSP build (libheif + libde265
 * compiled to plain asm.js with NO dynamic evaluation — chosen precisely
 * because it needs neither 'unsafe-eval' nor 'wasm-unsafe-eval', so the
 * extension's strict manifest CSP stays untouched) ships its decoder inside
 * a Web Worker it instantiates from a blob: URL — which MV3 extension pages
 * cannot create (blob: worker scripts are blocked on extension pages
 * regardless of CSP). This plugin:
 *
 *   1. extracts the embedded worker source VERBATIM and emits it as a real
 *      extension file, dist/heic-decoder-worker.js (same-origin, allowed
 *      under script-src 'self');
 *   2. transforms the heic-to module at build time so its lazy worker
 *      getter instantiates that packaged file instead of a blob, and strips
 *      the ~3.1 MB embedded worker string from the bundled chunk (the bytes
 *      ship ONCE, as the worker file — never twice).
 */
function heicDecoderWorkerPlugin(): Plugin {
  // `let t='<worker source>',e=new Blob([t]` — the bundle's lazy getter.
  const WORKER_LITERAL_RE = /let t='((?:[^'\\]|\\.)*)',e=new Blob\(\[t\]/;
  const BLOB_BOOTSTRAP_RE = /new Worker\(URL\.createObjectURL\(e\)\)/;
  const heicToId = here('./node_modules/heic-to/dist/csp/heic-to.js');

  /**
   * Unescape the exact single-quoted JS string literal the bundle embeds
   * (standard escape grammar only — deterministic, no eval anywhere).
   */
  const unescapeLiteral = (raw: string): string => {
    let out = '';
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const next = raw[++i];
      switch (next) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case '0': out += '\0'; break;
        case '\'': out += '\''; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        case '\n': break; // line continuation
        case 'x': {
          out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 3), 16));
          i += 2;
          break;
        }
        case 'u': {
          if (raw[i + 1] === '{') {
            const close = raw.indexOf('}', i + 2);
            out += String.fromCodePoint(Number.parseInt(raw.slice(i + 2, close), 16));
            i = close;
          } else {
            out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 5), 16));
            i += 4;
          }
          break;
        }
        default:
          throw new Error(
            `heic-decoder-worker: unexpected escape '\\${next ?? ''}' in the worker literal`,
          );
      }
    }
    return out;
  };

  const extractWorker = (): string => {
    const source = readFileSync(heicToId, 'utf8');
    const match = WORKER_LITERAL_RE.exec(source);
    if (match === null) {
      throw new Error(
        'heic-decoder-worker: the pinned heic-to bundle no longer embeds its worker as the `t` string literal — update the extraction',
      );
    }
    const extracted = unescapeLiteral(match[1] ?? '');
    if (extracted.length < 1_000_000) {
      throw new Error(
        'heic-decoder-worker: extracted worker suspiciously small — extraction regex is wrong',
      );
    }
    if (!extracted.includes('postMessage') || !extracted.includes('heif_context')) {
      throw new Error(
        'heic-decoder-worker: extracted worker does not look like the libheif decode worker',
      );
    }
    if (/new Function|[^a-zA-Z]eval\(/.test(extracted)) {
      throw new Error(
        'heic-decoder-worker: extracted worker gained dynamic evaluation — it would violate the extension CSP',
      );
    }
    return extracted;
  };

  return {
    name: 'heic-decoder-worker',
    buildStart() {
      this.emitFile({
        type: 'asset',
        fileName: 'heic-decoder-worker.js',
        source: extractWorker(),
      });
    },
    transform(code, id) {
      if (id !== heicToId) return null;
      if (!BLOB_BOOTSTRAP_RE.test(code)) {
        throw new Error(
          'heic-decoder-worker: the pinned heic-to bundle no longer bootstraps its worker from a blob URL — update the transform',
        );
      }
      // Redirect the worker to the packaged extension file (the extension is
      // the only production host; the blob path is left as an honest dead
      // stub for non-extension contexts).
      const redirected = code.replace(
        BLOB_BOOTSTRAP_RE,
        'new Worker((typeof chrome!=="undefined"&&chrome.runtime&&typeof chrome.runtime.getURL==="function")?chrome.runtime.getURL("heic-decoder-worker.js"):URL.createObjectURL(e))',
      );
      const stripped = redirected.replace(
        WORKER_LITERAL_RE,
        'let t=\'console.error("heic decoder: this build ships the worker as heic-decoder-worker.js next to the extension files")\',e=new Blob([t]',
      );
      if (stripped === code) return null;
      return { code: stripped, map: null };
    },
  };
}

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
  plugins: [heicDecoderWorkerPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // The dashboard bundle carries Tiptap + lowlight (~775 kB min / ~245 kB
    // gzip). For an unpacked extension every byte loads from local disk —
    // there is no network latency — and PRD §11 asks for the size to be
    // measured and explained, not minimised at the cost of features.
    chunkSizeWarningLimit: 1024,
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
