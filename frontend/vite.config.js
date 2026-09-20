import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      host: 'localhost',
    },
    watch: {
      // Docker bind mounts from a Windows/macOS host don't deliver file events, so
      // docker-compose.yml sets CHOKIDAR_USEPOLLING=true. Native `npm run dev` doesn't need it.
      usePolling: ['1', 'true'].includes(process.env.CHOKIDAR_USEPOLLING ?? ''),
    },
  },
})
