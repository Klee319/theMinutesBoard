import { AIProvider, UserSettings } from '@/types'
import { BaseAIService } from './base'
import { GeminiService } from '../gemini'
import { OpenAIService } from './openai'
import { ClaudeService } from './claude'
import { OpenRouterService } from './openrouter'
import { ABTestManager } from './ab-test'
import { ABTestConfig, ABTestResult } from '@/types/ab-test'
import { API_CONFIG } from '@/constants/config'
import { logger } from '@/utils/logger'

interface RateLimitInfo {
  lastRequestTime: number
  requestCount: number
  resetTime: number
}

export class AIServiceFactory {
  private static rateLimitMap = new Map<string, RateLimitInfo>()
  private static abTestManager = ABTestManager.getInstance()
  
  static createService(settings: UserSettings): BaseAIService {
    let { aiProvider } = settings
    
    // A/Bテストが有効な場合、バリアントに基づいてプロバイダーを選択
    if (settings.abTestEnabled && settings.abTestConfig) {
      const testManager = this.abTestManager
      if (testManager.isTestActive(settings.abTestConfig)) {
        const variant = testManager.getCurrentVariant(settings.abTestConfig)
        if (variant) {
          aiProvider = variant.provider as AIProvider
          logger.info(`A/B Test: Using variant ${variant.name} (${variant.provider})`)
        }
      }
    }
    
    switch (aiProvider) {
      case 'gemini':
        const geminiKey = settings.apiKey || ''
        return new GeminiService(geminiKey) as any
        
      case 'openai':
        const openaiKey = settings.openaiApiKey || ''
        return new OpenAIService(openaiKey)
        
      case 'claude':
        const claudeKey = settings.claudeApiKey || ''
        return new ClaudeService(claudeKey)
        
      case 'openrouter':
        const openrouterKey = settings.openrouterApiKey || ''
        return new OpenRouterService(openrouterKey)
        
      default:
        throw new Error(`Unsupported AI provider: ${aiProvider}`)
    }
  }

  static async createServiceWithFallback(
    settings: UserSettings,
    fallbackProviders: AIProvider[] = []
  ): Promise<{ service: BaseAIService; provider: AIProvider }> {
    const startTime = Date.now()
    let selectedVariant: string | null = null
    
    // A/Bテストが有効な場合の処理
    if (settings.abTestEnabled && settings.abTestConfig) {
      const testManager = this.abTestManager
      if (testManager.isTestActive(settings.abTestConfig)) {
        const variant = testManager.getCurrentVariant(settings.abTestConfig)
        if (variant) {
          selectedVariant = variant.id
          // バリアントのプロバイダーを最優先に
          const variantProvider = variant.provider as AIProvider
          if (!providers.includes(variantProvider)) {
            providers.unshift(variantProvider)
          }
        }
      }
    }
    
    const providers = [settings.aiProvider, ...fallbackProviders]
    const errors: { provider: AIProvider; error: string }[] = []

    for (const provider of providers) {
      try {
        // レート制限チェック
        if (this.isRateLimited(provider)) {
          errors.push({ 
            provider, 
            error: `Rate limit exceeded for ${provider}` 
          })
          continue
        }

        const serviceSettings = { ...settings, aiProvider: provider }
        
        // 設定の有効性をチェック
        if (!this.validateProviderSettings(serviceSettings)) {
          errors.push({ 
            provider, 
            error: `Invalid settings for ${provider}` 
          })
          continue
        }

        const service = this.createService(serviceSettings)
        logger.info(`Using AI provider: ${provider}`)
        
        // A/Bテストの成功を記録
        if (selectedVariant && settings.abTestConfig) {
          const responseTime = Date.now() - startTime
          await this.recordABTestResult({
            variantId: selectedVariant,
            responseTime,
            success: true
          })
        }
        
        return { service, provider }
        
      } catch (error) {
        errors.push({ 
          provider, 
          error: error instanceof Error ? error.message : String(error) 
        })
      }
    }

    // 全プロバイダーが失敗した場合
    logger.error('All AI providers failed:', errors)
    
    // A/Bテストの失敗を記録
    if (selectedVariant && settings.abTestConfig) {
      const responseTime = Date.now() - startTime
      await this.recordABTestResult({
        variantId: selectedVariant,
        responseTime,
        success: false,
        error: errors[0]?.error || 'All providers failed'
      })
    }
    
    throw new Error(`All AI providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join(', ')}`)
  }

  static getCurrentApiKey(settings: UserSettings): string {
    switch (settings.aiProvider) {
      case 'gemini': return settings.apiKey || ''
      case 'openai': return settings.openaiApiKey || ''
      case 'claude': return settings.claudeApiKey || ''
      case 'openrouter': return settings.openrouterApiKey || ''
      default: return ''
    }
  }

  static validateProviderSettings(settings: UserSettings): boolean {
    const apiKey = AIServiceFactory.getCurrentApiKey(settings)
    if (!apiKey) return false
    
    // OpenRouterの場合、selectedModelがなくてもデフォルトで動作するため検証を緩和
    // generateMinutes内でデフォルトモデルが使用される
    
    return true
  }

  // レート制限管理機能
  static isRateLimited(provider: AIProvider): boolean {
    const rateLimitInfo = this.rateLimitMap.get(provider)
    if (!rateLimitInfo) return false

    const now = Date.now()
    
    // リセット時間を過ぎた場合はリセット
    if (now >= rateLimitInfo.resetTime) {
      this.rateLimitMap.delete(provider)
      return false
    }

    // プロバイダー別の制限値をチェック
    const limits = this.getProviderLimits(provider)
    return rateLimitInfo.requestCount >= limits.maxRequests
  }

  static recordRequest(provider: AIProvider): void {
    const now = Date.now()
    const limits = this.getProviderLimits(provider)
    const rateLimitInfo = this.rateLimitMap.get(provider)

    if (!rateLimitInfo || now >= rateLimitInfo.resetTime) {
      // 新しい期間を開始
      this.rateLimitMap.set(provider, {
        lastRequestTime: now,
        requestCount: 1,
        resetTime: now + limits.windowMs
      })
    } else {
      // 既存の期間内でカウントを増加
      rateLimitInfo.requestCount++
      rateLimitInfo.lastRequestTime = now
    }
  }

  static getProviderLimits(provider: AIProvider): { maxRequests: number; windowMs: number } {
    // プロバイダー別のレート制限設定
    const windowMs = 60 * 1000 // 1分間
    switch (provider) {
      case 'openai':
        return { maxRequests: API_CONFIG.RATE_LIMITS.OPENAI, windowMs }
      case 'claude':
        return { maxRequests: API_CONFIG.RATE_LIMITS.CLAUDE, windowMs }
      case 'gemini':
        return { maxRequests: API_CONFIG.RATE_LIMITS.GEMINI, windowMs }
      case 'openrouter':
        return { maxRequests: API_CONFIG.RATE_LIMITS.OPENROUTER, windowMs }
      default:
        return { maxRequests: API_CONFIG.RATE_LIMITS.CLAUDE, windowMs } // デフォルト
    }
  }

  static getRateLimitStatus(provider: AIProvider): {
    isLimited: boolean
    remainingRequests: number
    resetTime: number | null
  } {
    const rateLimitInfo = this.rateLimitMap.get(provider)
    const limits = this.getProviderLimits(provider)
    
    if (!rateLimitInfo) {
      return {
        isLimited: false,
        remainingRequests: limits.maxRequests,
        resetTime: null
      }
    }

    const now = Date.now()
    if (now >= rateLimitInfo.resetTime) {
      return {
        isLimited: false,
        remainingRequests: limits.maxRequests,
        resetTime: null
      }
    }

    const remainingRequests = Math.max(0, limits.maxRequests - rateLimitInfo.requestCount)
    
    return {
      isLimited: remainingRequests === 0,
      remainingRequests,
      resetTime: rateLimitInfo.resetTime
    }
  }

  // 利用可能なプロバイダーのリストを取得（設定済みのもののみ）
  static getAvailableProviders(settings: UserSettings): AIProvider[] {
    const providers: AIProvider[] = []
    
    if (settings.apiKey) providers.push('gemini')
    if (settings.openaiApiKey) providers.push('openai')
    if (settings.claudeApiKey) providers.push('claude')
    if (settings.openrouterApiKey) providers.push('openrouter')
    
    return providers
  }

  // フォールバック順序の推奨設定
  static getRecommendedFallbackOrder(primaryProvider: AIProvider): AIProvider[] {
    const fallbackMatrix: Record<AIProvider, AIProvider[]> = {
      'openai': ['claude', 'gemini', 'openrouter'],
      'claude': ['openai', 'gemini', 'openrouter'],
      'gemini': ['openai', 'claude', 'openrouter'],
      'openrouter': ['openai', 'claude', 'gemini']
    }
    
    return fallbackMatrix[primaryProvider] || []
  }
  
  // A/Bテスト結果を記録
  static async recordABTestResult(result: ABTestResult): Promise<void> {
    try {
      await this.abTestManager.recordResult(result)
    } catch (error) {
      logger.error('Failed to record A/B test result:', error)
    }
  }
  
  // A/Bテストのメトリクスを取得
  static async getABTestMetrics(): Promise<any> {
    try {
      return await this.abTestManager.exportResults()
    } catch (error) {
      logger.error('Failed to get A/B test metrics:', error)
      return null
    }
  }
}