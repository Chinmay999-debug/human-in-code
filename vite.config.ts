import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the static build works from any subpath (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  plugins: [react()],
})
