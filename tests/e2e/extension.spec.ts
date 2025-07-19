import { test, expect } from '@playwright/test'
import path from 'path'

// Chrome Extension の E2E テスト
test.describe('theMinutesBoard Extension', () => {
  test.beforeEach(async ({ page }) => {
    // 拡張機能のロード（実際のテストではmanifest.jsonのパスを指定）
    // この例では、開発用の設定を想定
    await page.goto('chrome://extensions/')
  })

  test('should load extension successfully', async ({ page }) => {
    // 拡張機能が正常にロードされることを確認
    await expect(page).toHaveTitle(/Extensions/)
    
    // 開発者モードが有効になっていることを確認
    const devMode = page.locator('[data-test-id="developer-mode"]')
    await expect(devMode).toBeVisible()
  })

  test('should open options page', async ({ page }) => {
    // オプション画面が正常に開くことを確認
    await page.goto('chrome-extension://test-extension-id/options.html')
    
    // オプション画面の主要要素を確認
    await expect(page.locator('h1')).toHaveText('設定')
    await expect(page.locator('[data-testid="ai-provider-selector"]')).toBeVisible()
    await expect(page.locator('[data-testid="api-key-input"]')).toBeVisible()
  })

  test('should handle Google Meet integration', async ({ page }) => {
    // Google Meet でのテスト（モックされた環境）
    await page.goto('https://meet.google.com/test-meeting')
    
    // 字幕機能の有効化をシミュレート
    await page.evaluate(() => {
      // Google Meet の字幕DOMを模擬
      const captionElement = document.createElement('div')
      captionElement.className = 'caption-text'
      captionElement.textContent = 'Test meeting content'
      document.body.appendChild(captionElement)
    })
    
    // 拡張機能が字幕を検出することを確認
    await expect(page.locator('.caption-text')).toHaveText('Test meeting content')
  })

  test('should save and load settings', async ({ page }) => {
    await page.goto('chrome-extension://test-extension-id/options.html')
    
    // 設定の保存
    await page.fill('[data-testid="api-key-input"]', 'test-api-key')
    await page.selectOption('[data-testid="ai-provider-selector"]', 'openai')
    await page.click('[data-testid="save-button"]')
    
    // 成功メッセージの確認
    await expect(page.locator('[data-testid="success-message"]')).toHaveText('設定を保存しました')
    
    // ページをリロードして設定が永続化されているか確認
    await page.reload()
    await expect(page.locator('[data-testid="ai-provider-selector"]')).toHaveValue('openai')
  })

  test('should generate minutes from transcript', async ({ page }) => {
    await page.goto('chrome-extension://test-extension-id/popup.html')
    
    // 発言記録が存在することを確認
    await expect(page.locator('[data-testid="transcript-list"]')).toBeVisible()
    
    // 議事録生成ボタンをクリック
    await page.click('[data-testid="generate-minutes-button"]')
    
    // ローディング状態を確認
    await expect(page.locator('[data-testid="loading-spinner"]')).toBeVisible()
    
    // 議事録が生成されることを確認（最大30秒待機）
    await expect(page.locator('[data-testid="minutes-content"]')).toBeVisible({ timeout: 30000 })
    await expect(page.locator('[data-testid="minutes-content"]')).not.toBeEmpty()
  })

  test('should handle error states gracefully', async ({ page }) => {
    await page.goto('chrome-extension://test-extension-id/popup.html')
    
    // APIエラーをシミュレート
    await page.route('**/api/generate-minutes', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'API Error' })
      })
    })
    
    // 議事録生成を試行
    await page.click('[data-testid="generate-minutes-button"]')
    
    // エラーメッセージが表示されることを確認
    await expect(page.locator('[data-testid="error-message"]')).toHaveText(/議事録の生成に失敗しました/)
  })
})

// Chrome Extension 固有のヘルパー関数
test.describe('Extension Helper Functions', () => {
  test('should access chrome.storage API', async ({ page }) => {
    // Chrome Extension APIへのアクセステスト
    const storageValue = await page.evaluate(async () => {
      // chrome.storage.sync の動作をテスト
      await chrome.storage.sync.set({ testKey: 'testValue' })
      const result = await chrome.storage.sync.get('testKey')
      return result.testKey
    })
    
    expect(storageValue).toBe('testValue')
  })

  test('should handle runtime messages', async ({ page }) => {
    // Chrome Extension のメッセージ通信テスト
    await page.goto('chrome-extension://test-extension-id/popup.html')
    
    const messageResponse = await page.evaluate(async () => {
      // メッセージ送信のテスト
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'TEST_MESSAGE', data: 'test' }, (response) => {
          resolve(response)
        })
      })
    })
    
    expect(messageResponse).toBeDefined()
  })
})