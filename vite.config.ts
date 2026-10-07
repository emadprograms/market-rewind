import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const streamingUrl = env.VITE_STREAMING_URL || process.env.VITE_STREAMING_URL || 'http://localhost:8765';
  const wsUrl = env.VITE_WS_URL || process.env.VITE_WS_URL || 'ws://localhost:8765';

  const proxy = {
    '/api': {
      target: streamingUrl,
      changeOrigin: true,
    },
    '/ws': {
      target: wsUrl,
      ws: true,
    },
  };

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 3000,
      proxy,
      // Same rationale as the preview block below: `host: true` binds all interfaces
      // but Vite still rejects unrecognised Host headers (its DNS-rebinding guard), so
      // reaching the dev server by hostname — .local, or a tunnelled hostname — returns
      // 403. Bare IPs are not affected, which is why this only bites some setups. Keep
      // this in step with preview so `start-frontend.sh --dev` stays usable off-machine.
      allowedHosts: true,
    },
    // Serving the built bundle is the default outside local development (see
    // tools/mac/start-frontend.sh): one bundled asset instead of a per-module request
    // waterfall. Mirrors the dev proxy so both modes behave identically.
    preview: {
      host: true,
      port: 3000,
      proxy,
      // Vite rejects requests whose Host header it does not recognise (DNS-rebinding
      // guard). This app is reached from a tablet by LAN IP, hostname, or a tunnelled
      // hostname — none of which are fixed — so the check is disabled for this
      // LAN-internal tool. Without this, production mode returns 403 to the tablet.
      allowedHosts: true,
    },
  };
})
