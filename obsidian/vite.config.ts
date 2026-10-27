import { defineConfig } from 'vite';
import { licensesPlugin } from '../src/licenses/build-plugin';

// Builds the spike plugin into obsidian/dist/main.js (CommonJS, as Obsidian loads it).
//   npm run build:obsidian
export default defineConfig({
  root: 'obsidian',
  publicDir: false,
  plugins: [licensesPlugin('Yak Sync')],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: { entry: 'src/main.ts', formats: ['cjs'], fileName: () => 'main.js' },
    rollupOptions: { external: ['obsidian'], output: { exports: 'default' } },
  },
});
