import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const streamingUrl = env.VITE_STREAMING_URL || process.env.VITE_STREAMING_URL || 'http://100.72.128.22:8420';
  const wsUrl = env.VITE_WS_URL || process.env.VITE_WS_URL || 'ws://100.72.128.22:8420';

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 3000,
      proxy: {
        '/api': {
          target: streamingUrl,
          changeOrigin: true,
        },
        '/ws': {
          target: wsUrl,
          ws: true,
        },
      },
    },
  };
})
