import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ABTestManager } from '@/services/ai/ab-test'
import { AIServiceFactory } from '@/services/ai/factory'
import { UserSettings, ABTestConfig } from '@/types'

// Chrome Storage API のモック
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
  }
}

global.chrome = {
  storage: mockChromeStorage
} as any

describe('A/Bテスト統合テスト', () => {
  let abTestManager: ABTestManager
  let testConfig: ABTestConfig
  let userSettings: UserSettings

  beforeEach(() => {
    vi.clearAllMocks()
    abTestManager = ABTestManager.getInstance()
    
    testConfig = {
      enabled: true,
      testId: 'test-001',
      startDate: new Date().toISOString(),
      variants: [
        { id: 'variant-a', name: 'Gemini', provider: 'gemini', weight: 50 },
        { id: 'variant-b', name: 'OpenAI', provider: 'openai', weight: 50 }
      ],
      metrics: {
        variantMetrics: {},
        totalSamples: 0
      }
    }

    userSettings = {
      aiProvider: 'gemini',
      apiKey: 'test-key',
      openaiApiKey: 'openai-test-key',
      promptTemplate: '',
      autoUpdateInterval: 0,
      exportFormat: 'markdown',
      abTestEnabled: true,
      abTestConfig: testConfig
    }

    // ストレージモックの設定
    mockChromeStorage.local.get.mockResolvedValue({})
    mockChromeStorage.local.set.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('バリアント割り当て', () => {
    it('ユーザーを適切なバリアントに割り当てる', () => {
      const variant = abTestManager.assignUserToVariant(testConfig)
      expect(['variant-a', 'variant-b']).toContain(variant)
    })

    it('同じユーザーには同じバリアントを割り当てる', () => {
      const variant1 = abTestManager.assignUserToVariant(testConfig)
      const variant2 = abTestManager.assignUserToVariant(testConfig)
      expect(variant1).toBe(variant2)
    })

    it('重みに基づいて割り当てを行う', () => {
      const skewedConfig = {
        ...testConfig,
        variants: [
          { id: 'variant-a', name: 'Gemini', provider: 'gemini', weight: 90 },
          { id: 'variant-b', name: 'OpenAI', provider: 'openai', weight: 10 }
        ]
      }

      const assignments = new Map<string, number>()
      // 100回のシミュレーション
      for (let i = 0; i < 100; i++) {
        vi.spyOn(Math, 'random').mockReturnValueOnce(i / 100)
        const variant = abTestManager.assignUserToVariant(skewedConfig)
        assignments.set(variant, (assignments.get(variant) || 0) + 1)
      }

      // 90%がvariant-aに割り当てられることを確認（誤差を考慮）
      const variantACount = assignments.get('variant-a') || 0
      expect(variantACount).toBeGreaterThan(80)
      expect(variantACount).toBeLessThan(95)
    })
  })

  describe('AIサービスファクトリー統合', () => {
    it('A/Bテストが有効な場合、バリアントのプロバイダーを使用する', () => {
      const createServiceSpy = vi.spyOn(AIServiceFactory, 'createService')
      
      // variant-bが選択されるようにモック
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.7)
      
      AIServiceFactory.createService(userSettings)
      
      expect(createServiceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProvider: 'openai' // variant-bのプロバイダー
        })
      )
    })

    it('A/Bテストが無効な場合、元のプロバイダーを使用する', () => {
      const disabledSettings = {
        ...userSettings,
        abTestEnabled: false
      }
      
      const createServiceSpy = vi.spyOn(AIServiceFactory, 'createService')
      
      AIServiceFactory.createService(disabledSettings)
      
      expect(createServiceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          aiProvider: 'gemini' // 元のプロバイダー
        })
      )
    })
  })

  describe('メトリクス収集', () => {
    it('成功した結果を記録する', async () => {
      const result = {
        variantId: 'variant-a',
        responseTime: 1500,
        success: true,
        tokenCount: 150
      }

      await abTestManager.recordResult(result)
      
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          abTestState: expect.objectContaining({
            results: expect.arrayContaining([result])
          })
        })
      )
    })

    it('失敗した結果を記録する', async () => {
      const result = {
        variantId: 'variant-b',
        responseTime: 3000,
        success: false,
        error: 'API rate limit exceeded'
      }

      await abTestManager.recordResult(result)
      
      expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          abTestState: expect.objectContaining({
            results: expect.arrayContaining([result])
          })
        })
      )
    })

    it('メトリクスを正しく計算する', async () => {
      // 複数の結果を記録
      const results = [
        { variantId: 'variant-a', responseTime: 1000, success: true, tokenCount: 100 },
        { variantId: 'variant-a', responseTime: 2000, success: true, tokenCount: 200 },
        { variantId: 'variant-a', responseTime: 1500, success: false, error: 'Error' },
        { variantId: 'variant-b', responseTime: 1500, success: true, tokenCount: 150 }
      ]

      for (const result of results) {
        await abTestManager.recordResult(result)
      }

      const metrics = await abTestManager.exportResults()
      
      // variant-aのメトリクスを確認
      expect(metrics.metrics['variant-a']).toEqual({
        samples: 3,
        avgResponseTime: 1500, // (1000 + 2000) / 2
        successRate: 66.67, // 2/3 * 100
        avgTokenCount: 150, // (100 + 200) / 2
        errorCount: 1,
        userRatings: []
      })

      // variant-bのメトリクスを確認
      expect(metrics.metrics['variant-b']).toEqual({
        samples: 1,
        avgResponseTime: 1500,
        successRate: 100,
        avgTokenCount: 150,
        errorCount: 0,
        userRatings: []
      })
    })
  })

  describe('テストの有効期限', () => {
    it('開始日前はテストを無効にする', () => {
      const futureConfig = {
        ...testConfig,
        startDate: new Date(Date.now() + 86400000).toISOString() // 明日
      }

      expect(abTestManager.isTestActive(futureConfig)).toBe(false)
    })

    it('終了日後はテストを無効にする', () => {
      const expiredConfig = {
        ...testConfig,
        endDate: new Date(Date.now() - 86400000).toISOString() // 昨日
      }

      expect(abTestManager.isTestActive(expiredConfig)).toBe(false)
    })

    it('期間内はテストを有効にする', () => {
      const activeConfig = {
        ...testConfig,
        startDate: new Date(Date.now() - 86400000).toISOString(), // 昨日
        endDate: new Date(Date.now() + 86400000).toISOString() // 明日
      }

      expect(abTestManager.isTestActive(activeConfig)).toBe(true)
    })
  })

  describe('フォールバック処理との統合', () => {
    it('A/Bテストとフォールバックが連携する', async () => {
      const recordSpy = vi.spyOn(AIServiceFactory, 'recordABTestResult')
      
      try {
        await AIServiceFactory.createServiceWithFallback(userSettings, ['claude'])
      } catch (error) {
        // エラーは期待される（モックAPIキーのため）
      }

      // A/Bテスト結果が記録されることを確認
      expect(recordSpy).toHaveBeenCalled()
    })
  })
})