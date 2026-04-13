import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/main.js',
        vite: { 
          build: { 
            outDir: 'dist-electron/main',
            rollupOptions: { 
              external: ['electron', 'electron-updater', 'fs', 'path', 'child_process', 'os', 'http', 'net', 'constants', 'node-pty']
            }
          } 
        },
      },
      {
        entry: 'src/main/preload.js',
        onstart(options) { options.reload() },
        vite: { build: { outDir: 'dist-electron/preload' } },
      }
    ])
  ],
})
