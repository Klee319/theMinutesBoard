import { defineConfig, devices } from '@playwright/test'

/**
 * E2E テスト設定
 * Chrome Extension の動作を実際のブラウザで検証
 */
export default defineConfig({
  // テストファイルの場所
  testDir: './tests/e2e',
  
  // 並列実行の設定
  fullyParallel: true,
  
  // CI環境での失敗時の再試行
  retries: process.env.CI ? 2 : 0,
  
  // 並列実行数
  workers: process.env.CI ? 1 : undefined,
  
  // テストレポート設定
  reporter: 'html',
  
  // 共通設定
  use: {
    // アクション前の待機時間
    actionTimeout: 30000,
    
    // 失敗時のスクリーンショット
    screenshot: 'only-on-failure',
    
    // 失敗時のビデオ録画
    video: 'retain-on-failure',
    
    // トレース収集
    trace: 'on-first-retry',
    
    // ベースURL（Chrome Extension用）
    baseURL: 'chrome-extension://test-extension-id',
  },

  // プロジェクト設定（異なるブラウザ・環境でのテスト）
  projects: [
    {
      name: 'chrome-extension',
      use: { 
        ...devices['Desktop Chrome'],
        // Chrome Extension 固有の設定
        contextOptions: {
          // 拡張機能のパーミッション
          permissions: ['storage', 'tabs', 'activeTab'],
        }
      },
    },
    
    {
      name: 'chrome-headless',
      use: { 
        ...devices['Desktop Chrome'],
        headless: true,
        contextOptions: {
          permissions: ['storage', 'tabs', 'activeTab'],
        }
      },
    },
  ],

  // 開発サーバーの設定（必要に応じて）
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})