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
      // Set CHOKIDAR_USEPOLLING=true when running under Docker with a bind-mounted
      // source (Windows/macOS hosts don't deliver file events otherwise). Native
      // `npm run dev` doesn't need it.
      usePolling: ['1', 'true'].includes(process.env.CHOKIDAR_USEPOLLING ?? ''),
    },
  },
})
