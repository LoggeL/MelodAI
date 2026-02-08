import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000',
      '/songs': 'http://localhost:5000',
    },
  },
  build: {
    outDir: '../src/static',
    emptyOutDir: true,
  },
})
