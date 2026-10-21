import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * After the build, write dist/sw.js from src/sw-template.js: list every file
 * in dist (the app is one HTML file plus manifest and icons) and stamp a
 * version hash of their contents, so each change makes browsers pick up a
 * fresh offline copy.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tuner-service-worker',
    apply: 'build',
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    closeBundle() {
      // every file in dist (incl. samples/…), so the whole app works offline
      const files = (readdirSync(outDir, { recursive: true }) as string[])
        .map((f) => f.split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && statSync(join(outDir, f)).isFile())
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const urls = ['./', ...files.map((f) => `./${f}`)];
      const src = readFileSync(resolve(__dirname, 'src/sw-template.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__FILES__;', `${JSON.stringify(urls)};`);
      if (src.includes('__VERSION__') || src.includes('__FILES__')) throw new Error('sw.js template not filled');
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}

// The app itself is one self-contained index.html (scripts, styles, fonts and
// the audio worklet inlined). public/ adds the manifest and icons; the plugin
// above adds the offline service worker.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), serviceWorker()],
  build: {
    target: 'es2020',
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
} as import('vite').UserConfig);
