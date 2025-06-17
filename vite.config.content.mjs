import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'MinutesBoardContent',
      formats: ['iife'],
      fileName: () => 'content.js'
    },
    rollupOptions: {
      external: [],
      output: {
        extend: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') {
            return 'content.css'
          }
          return assetInfo.name
        }
      }
    }
  }
})