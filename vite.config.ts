import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.GMS_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1600 }, // maplibre-gl alone is ~1 MB
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': api,
      '/ws': { target: api, ws: true },
    },
  },
});
