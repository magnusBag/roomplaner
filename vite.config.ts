import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // relative asset paths, so the build works under GitHub Pages' /<repo>/ path
  build: { chunkSizeWarningLimit: 1000 }, // three.js lives in the lazy 3D chunk
})
