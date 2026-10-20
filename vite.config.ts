import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The build is one self-contained index.html (scripts, styles and the audio
// worklet inlined), so the same file works on GitHub Pages, as a shared link,
// opened locally, or wrapped in a desktop app later.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
} as import('vite').UserConfig);
