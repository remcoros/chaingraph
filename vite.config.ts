import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  envDir: false,
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.CHAINGRAPH_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
