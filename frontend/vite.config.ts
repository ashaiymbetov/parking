import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin API in dev, like nginx does in Docker.
    proxy: {
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3000',
    },
  },
})
