import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    // inline every asset (world map webp etc.) so the single-file build stays portable
    assetsInlineLimit: 100_000_000,
  },
})
