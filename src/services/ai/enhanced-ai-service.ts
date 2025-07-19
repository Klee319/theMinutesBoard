import { AIProvider, UserSettings, AIGenerationResult, Meeting } from '@/types'
import { BaseAIService } from './base'
import { AIServiceFactory } from './factory'

interface RetryConfig {
  maxRetries: number
  retryDelay: number
  exponentialBackoff: boolean
}

interface CircuitBreakerState {
  failures: number
  lastFailureTime: number
  state: 'closed' | 'open' | 'half-open'
}

export class EnhancedAIService {
  private circuitBreakers = new Map<AIProvider, CircuitBreakerState>()
  private defaultRetryConfig: RetryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true
  }

  private circuitBreakerConfig = {
    failureThreshold: 5,    // 5回失敗でオープン
    resetTimeout: 60000,    // 1分後にhalf-openに移行
    monitoringWindow: 300000 // 5分間の監視ウィンドウ
  }

  constructor(private settings: UserSettings) {}

  async generateMinutes(
    transcripts: any[],
    options?: {
      retryConfig?: Partial<RetryConfig>
      enableFallback?: boolean
      meetingInfo?: { startTime?: Date; endTime?: Date }
      promptType?: 'live' | 'history' | 'default'
    }
  ): Promise<AIGenerationResult> {
    return this.executeWithFallback(
      (service) => service.generateMinutes(
        transcripts, 
        this.settings,
        options?.meetingInfo,
        options?.promptType
      ),
      options
    )
  }

  async generateNextSteps(
    minutesOrMeeting: string | Meeting,
    userPrompt?: string,
    userName?: string,
    options?: {
      retryConfig?: Partial<RetryConfig>
      enableFallback?: boolean
    }
  ): Promise<AIGenerationResult> {
    return this.executeWithFallback(
      (service) => {
        // 互換性のため、文字列が渡された場合はMeetingオブジェクトを作成
        if (typeof minutesOrMeeting === 'string') {
          const meeting: Meeting = {
            id: `temp_${Date.now()}`,
            startTime: new Date(),
            endTime: new Date(),
            participants: [],
            transcripts: [],
            minutes: {
              content: minutesOrMeeting,
              format: 'structured',
              metadata: {
                totalDuration: 0,
                participantCount: 0,
                wordCount: minutesOrMeeting.split(/\s+/).length
              }
            },
            title: 'Temporary Meeting',
            url: ''
          }
          return service.generateNextSteps(meeting, userPrompt, userName)
        } else {
          return service.generateNextSteps(minutesOrMeeting, userPrompt, userName)
        }
      },
      options
    )
  }

  async generateChatResponse(
    message: string,
    context?: string,
    options?: {
      retryConfig?: Partial<RetryConfig>
      enableFallback?: boolean
    }
  ): Promise<AIGenerationResult> {
    return this.executeWithFallback(
      async (service) => {
        const response = await service.sendChatMessage(message, context)
        return { text: response, usage: { totalTokens: 0 } }
      },
      options
    )
  }

  async generateText(
    prompt: string,
    config?: { maxTokens?: number; temperature?: number },
    options?: {
      retryConfig?: Partial<RetryConfig>
      enableFallback?: boolean
    }
  ): Promise<string> {
    const result = await this.executeWithFallback(
      async (service) => {
        const response = await service.generateText(prompt, config)
        return { text: response, usage: { totalTokens: 0 } }
      },
      options
    )
    return result.text
  }

  async generateResearch(
    query: string,
    context: any,
    options?: {
      retryConfig?: Partial<RetryConfig>
      enableFallback?: boolean
    }
  ): Promise<AIGenerationResult> {
    return this.executeWithFallback(
      async (service) => {
        // リサーチはsendChatMessageを使用
        // contextオブジェクトを適切に渡す
        const response = await service.sendChatMessage(query, context)
        return { text: response, usage: { totalTokens: 0 } }
      },
      options
    )
  }

  private async executeWithFallback<T>(
    operation: (service: BaseAIService) => Promise<T>,
    options?: {
      retryConfig?: Partial<RetryConfig>
      enableFallback?: boolean
    }
  ): Promise<T> {
    const enableFallback = options?.enableFallback ?? true
    const retryConfig = { ...this.defaultRetryConfig, ...options?.retryConfig }

    // プロバイダーの優先順位を決定
    const primaryProvider = this.settings.aiProvider
    const availableProviders = AIServiceFactory.getAvailableProviders(this.settings)
    const fallbackProviders = enableFallback 
      ? AIServiceFactory.getRecommendedFallbackOrder(primaryProvider)
          .filter(p => availableProviders.includes(p))
      : []

    const providers = [primaryProvider, ...fallbackProviders]
    const errors: { provider: AIProvider; error: string; retriable: boolean }[] = []

    for (const provider of providers) {
      // サーキットブレーカーの状態をチェック
      if (this.isCircuitBreakerOpen(provider)) {
        errors.push({
          provider,
          error: 'Circuit breaker is open',
          retriable: false
        })
        continue
      }

      try {
        const result = await this.executeWithRetry(
          provider,
          operation,
          retryConfig
        )
        
        // 成功時はサーキットブレーカーをリセット
        this.resetCircuitBreaker(provider)
        return result

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isRetriable = this.isRetriableError(error)
        
        errors.push({
          provider,
          error: errorMessage,
          retriable: isRetriable
        })

        // サーキットブレーカーに失敗を記録
        this.recordCircuitBreakerFailure(provider)

        console.warn(`AI service failed for provider ${provider}:`, errorMessage)
      }
    }

    // 全プロバイダーで失敗
    const errorSummary = errors.map(e => 
      `${e.provider}: ${e.error}${e.retriable ? ' (retriable)' : ''}`
    ).join(', ')
    
    throw new Error(`All AI providers failed: ${errorSummary}`)
  }

  private async executeWithRetry<T>(
    provider: AIProvider,
    operation: (service: BaseAIService) => Promise<T>,
    retryConfig: RetryConfig
  ): Promise<T> {
    let lastError: Error

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // レート制限をチェック
        if (AIServiceFactory.isRateLimited(provider)) {
          const status = AIServiceFactory.getRateLimitStatus(provider)
          const waitTime = status.resetTime ? status.resetTime - Date.now() : 60000
          
          if (waitTime > 0 && waitTime < 120000) { // 2分以内なら待機
            console.log(`Rate limited for ${provider}, waiting ${waitTime}ms`)
            await this.sleep(waitTime)
          } else {
            throw new Error(`Rate limit exceeded for ${provider}`)
          }
        }

        // リクエストを記録
        AIServiceFactory.recordRequest(provider)

        // サービスを作成して実行
        const serviceSettings = { ...this.settings, aiProvider: provider }
        
        // OpenRouterの場合、selectedModelがundefinedでもデフォルトで動作
        if (provider === 'openrouter' && !serviceSettings.selectedModel) {
          // OpenRouterServiceはデフォルトモデルを持つため、ここでは設定しない
          // サービス側でデフォルト値が使用される
        }
        
        const service = AIServiceFactory.createService(serviceSettings)
        
        return await operation(service)

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        // リトライ可能なエラーかチェック
        if (!this.isRetriableError(error) || attempt === retryConfig.maxRetries) {
          throw lastError
        }

        // 待機時間を計算
        const delay = retryConfig.exponentialBackoff
          ? retryConfig.retryDelay * Math.pow(2, attempt)
          : retryConfig.retryDelay

        console.log(`Retrying ${provider} in ${delay}ms (attempt ${attempt + 1}/${retryConfig.maxRetries})`)
        await this.sleep(delay)
      }
    }

    throw lastError!
  }

  private isRetriableError(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      
      // レート制限、タイムアウト、一時的なサーバーエラーはリトライ可能
      return message.includes('rate limit') ||
             message.includes('timeout') ||
             message.includes('502') ||
             message.includes('503') ||
             message.includes('504') ||
             message.includes('network') ||
             message.includes('connection')
    }
    
    return false
  }

  // サーキットブレーカー関連メソッド
  private isCircuitBreakerOpen(provider: AIProvider): boolean {
    const state = this.circuitBreakers.get(provider)
    if (!state) return false

    const now = Date.now()

    switch (state.state) {
      case 'closed':
        return false
      
      case 'open':
        // リセット時間を過ぎたらhalf-openに移行
        if (now - state.lastFailureTime >= this.circuitBreakerConfig.resetTimeout) {
          state.state = 'half-open'
          return false
        }
        return true
      
      case 'half-open':
        return false
      
      default:
        return false
    }
  }

  private recordCircuitBreakerFailure(provider: AIProvider): void {
    const now = Date.now()
    const state = this.circuitBreakers.get(provider) || {
      failures: 0,
      lastFailureTime: now,
      state: 'closed' as const
    }

    state.failures++
    state.lastFailureTime = now

    // 失敗回数が閾値を超えたらオープン状態に
    if (state.failures >= this.circuitBreakerConfig.failureThreshold) {
      state.state = 'open'
      console.warn(`Circuit breaker opened for ${provider} after ${state.failures} failures`)
    }

    this.circuitBreakers.set(provider, state)
  }

  private resetCircuitBreaker(provider: AIProvider): void {
    const state = this.circuitBreakers.get(provider)
    if (state) {
      state.failures = 0
      state.state = 'closed'
      console.log(`Circuit breaker reset for ${provider}`)
    }
  }

  // ユーティリティメソッド
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 状態取得メソッド
  getProviderStatus(): {
    provider: AIProvider
    rateLimitStatus: ReturnType<typeof AIServiceFactory.getRateLimitStatus>
    circuitBreakerState: CircuitBreakerState | null
  }[] {
    const availableProviders = AIServiceFactory.getAvailableProviders(this.settings)
    
    return availableProviders.map(provider => ({
      provider,
      rateLimitStatus: AIServiceFactory.getRateLimitStatus(provider),
      circuitBreakerState: this.circuitBreakers.get(provider) || null
    }))
  }

  // 設定更新
  updateSettings(settings: UserSettings): void {
    this.settings = settings
  }
}