import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@mqs/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@mqs/calc-engine': path.resolve(__dirname, '../../packages/calc-engine/src/index.ts'),
    },
  },
});
