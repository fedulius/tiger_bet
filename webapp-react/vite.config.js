import { defineConfig } from 'vite';

export default defineConfig({
  base: '/webapp/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
