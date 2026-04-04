import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: { main: 'index.html' }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});
