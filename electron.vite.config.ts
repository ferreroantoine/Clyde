import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'src/shared')

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    define: { __CLYDE_DISTRIBUTION__: JSON.stringify(process.env['CLYDE_DISTRIBUTION'] === '1') }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preloads cannot require() node_modules, so everything is bundled.
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': shared
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
