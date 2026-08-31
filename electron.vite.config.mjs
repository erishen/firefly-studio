import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    plugins: [react()],
    publicDir: resolve(__dirname, 'src/renderer/public'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    server: {
      port: 5180,
      strictPort: true
    },
    build: {
      outDir: 'out/renderer'
    }
  }
})
