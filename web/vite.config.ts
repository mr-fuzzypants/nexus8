import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// All API + media traffic proxies to the Django dev server, so the SPA and
// backend share an origin in development (no CORS, cookies just work).
const DJANGO = 'http://localhost:8000';
// The Yjs collaboration relay (npm run relay) — same-origin via /collab-ws.
const COLLAB_RELAY = process.env.NEXUS8_COLLAB_RELAY || 'http://localhost:1234';

export default defineConfig({
  appType: 'spa',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/trackables': { target: DJANGO, changeOrigin: true },
      '/discussions': { target: DJANGO, changeOrigin: true },
      '/media': { target: DJANGO, changeOrigin: true },
      // WebSocket upgrade proxied to the relay; query string (?room=...) is preserved.
      '/collab-ws': { target: COLLAB_RELAY, changeOrigin: true, ws: true },
    },
  },
});
