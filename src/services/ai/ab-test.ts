import { ABTestConfig, ABTestResult, ABTestState, ABTestVariant, VariantMetrics } from '../../types/ab-test'
import { AIProvider } from '../../types'

export class ABTestManager {
  private static instance: ABTestManager
  private state: ABTestState
  
  private constructor() {
    this.state = {
      sessionId: this.generateSessionId(),
      results: []
    }
    this.loadState()
  }
  
  static getInstance(): ABTestManager {
    if (!ABTestManager.instance) {
      ABTestManager.instance = new ABTestManager()
    }
    return ABTestManager.instance
  }
  
  private generateSessionId(): string {
    return `ab-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }
  
  private async loadState(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(['abTestState'])
      if (stored.abTestState) {
        this.state = stored.abTestState
      }
    } catch (error) {
    }
  }
  
  private async saveState(): Promise<void> {
    try {
      await chrome.storage.local.set({ abTestState: this.state })
    } catch (error) {
    }
  }
  
  // ユーザーをテストグループに割り当て
  assignUserToVariant(config: ABTestConfig): string {
    if (this.state.userVariant && this.state.activeTest?.testId === config.testId) {
      return this.state.userVariant
    }
    
    const random = Math.random() * 100
    let accumulated = 0
    
    for (const variant of config.variants) {
      accumulated += variant.weight
      if (random < accumulated) {
        this.state.userVariant = variant.id
        this.state.activeTest = config
        this.saveState()
        return variant.id
      }
    }
    
    // フォールバック（最初のバリアント）
    const fallback = config.variants[0].id
    this.state.userVariant = fallback
    this.state.activeTest = config
    this.saveState()
    return fallback
  }
  
  // 現在のバリアントを取得
  getCurrentVariant(config: ABTestConfig): ABTestVariant | null {
    if (!this.state.userVariant) {
      this.assignUserToVariant(config)
    }
    
    return config.variants.find(v => v.id === this.state.userVariant) || null
  }
  
  // テスト結果を記録
  async recordResult(result: ABTestResult): Promise<void> {
    this.state.results.push(result)
    
    // 最新の50件のみ保持（メモリ節約）
    if (this.state.results.length > 50) {
      this.state.results = this.state.results.slice(-50)
    }
    
    await this.saveState()
    await this.updateMetrics()
  }
  
  // メトリクスを更新
  private async updateMetrics(): Promise<void> {
    if (!this.state.activeTest) return
    
    const metrics = this.calculateMetrics()
    
    // メトリクスをストレージに保存
    await chrome.storage.local.set({
      abTestMetrics: {
        testId: this.state.activeTest.testId,
        metrics,
        lastUpdated: new Date().toISOString()
      }
    })
  }
  
  // メトリクスを計算
  private calculateMetrics(): Record<string, VariantMetrics> {
    const variantMetrics: Record<string, VariantMetrics> = {}
    
    if (!this.state.activeTest) return variantMetrics
    
    // 各バリアントの初期化
    for (const variant of this.state.activeTest.variants) {
      variantMetrics[variant.id] = {
        samples: 0,
        avgResponseTime: 0,
        successRate: 0,
        avgTokenCount: 0,
        errorCount: 0,
        userRatings: []
      }
    }
    
    // 結果を集計
    for (const result of this.state.results) {
      const metrics = variantMetrics[result.variantId]
      if (!metrics) continue
      
      metrics.samples++
      
      if (result.success) {
        metrics.avgResponseTime = 
          (metrics.avgResponseTime * (metrics.samples - 1) + result.responseTime) / metrics.samples
        
        if (result.tokenCount) {
          metrics.avgTokenCount = 
            (metrics.avgTokenCount * (metrics.samples - 1) + result.tokenCount) / metrics.samples
        }
      } else {
        metrics.errorCount++
      }
      
      if (result.userRating !== undefined) {
        metrics.userRatings!.push(result.userRating)
      }
      
      metrics.successRate = (metrics.samples - metrics.errorCount) / metrics.samples * 100
    }
    
    return variantMetrics
  }
  
  // A/Bテストが有効かチェック
  isTestActive(config?: ABTestConfig): boolean {
    if (!config || !config.enabled) return false
    
    const now = new Date()
    const startDate = new Date(config.startDate)
    const endDate = config.endDate ? new Date(config.endDate) : null
    
    if (now < startDate) return false
    if (endDate && now > endDate) return false
    
    return true
  }
  
  // テスト結果のエクスポート
  async exportResults(): Promise<any> {
    const metrics = this.calculateMetrics()
    
    return {
      testId: this.state.activeTest?.testId,
      sessionId: this.state.sessionId,
      userVariant: this.state.userVariant,
      totalSamples: this.state.results.length,
      metrics,
      results: this.state.results,
      exportedAt: new Date().toISOString()
    }
  }
  
  // テストをリセット
  async resetTest(): Promise<void> {
    this.state = {
      sessionId: this.generateSessionId(),
      results: []
    }
    await this.saveState()
  }
}