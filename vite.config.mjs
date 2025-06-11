import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { resolve } from 'path'
import { execSync } from 'child_process'

// ビルド前にシステムプロンプトを生成するプラグイン
const generateSystemPromptsPlugin = () => {
  return {
    name: 'generate-system-prompts',
    buildStart() {
      console.log('🔄 システムプロンプトを生成中...')
      try {
        execSync('node scripts/generate-system-prompts.js', { stdio: 'inherit' })
      } catch (error) {
        console.error('❌ システムプロンプトの生成に失敗しました:', error)
        throw error
      }
    },
    // 開発時にも実行
    configureServer(server) {
      server.watcher.add('src/system-prompts/*.md')
      server.watcher.on('change', (path) => {
        if (path.includes('system-prompts') && path.endsWith('.md')) {
          console.log('📝 マークダウンファイルが変更されました:', path)
          try {
            execSync('node scripts/generate-system-prompts.js', { stdio: 'inherit' })
            server.ws.send({
              type: 'full-reload',
              path: '*'
            })
          } catch (error) {
            console.error('❌ システムプロンプトの生成に失敗しました:', error)
          }
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [
    generateSystemPromptsPlugin(),
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'public/manifest.json',
          dest: ''
        },
        {
          src: 'public/*.png',
          dest: ''
        },
        {
          src: 'src/system-prompts/*',
          dest: 'system-prompts'
        }
      ]
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        options: resolve(__dirname, 'src/options/options.html'),
        viewer: resolve(__dirname, 'src/viewer/viewer.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
})