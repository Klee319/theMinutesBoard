import { logger } from '@/utils/logger'

interface CacheEntry<T> {
  data: T
  timestamp: number
  key: string
}

interface BatchRequest<T> {
  id: string
  resolve: (value: T) => void
  reject: (error: any) => void
  params: any
}

export class RequestOptimizer {
  private cache = new Map<string, CacheEntry<any>>()
  private batchQueue = new Map<string, BatchRequest<any>[]>()
  private batchTimers = new Map<string, NodeJS.Timeout>()
  
  // キャッシュの有効期限（ミリ秒）
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5分
  // バッチ処理の待機時間（ミリ秒）
  private readonly BATCH_DELAY = 100
  // 最大バッチサイズ
  private readonly MAX_BATCH_SIZE = 10
  
  /**
   * リクエストのキャッシュを確認し、キャッシュがあればそれを返す
   */
  getCachedResponse<T>(key: string): T | null {
    const entry = this.cache.get(key)
    
    if (!entry) {
      return null
    }
    
    // キャッシュの有効期限をチェック
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key)
      return null
    }
    
    logger.debug(`Cache hit for key: ${key}`)
    return entry.data as T
  }
  
  /**
   * レスポンスをキャッシュに保存
   */
  setCachedResponse<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      key
    })
    
    // キャッシュサイズの制限（最大100エントリ）
    if (this.cache.size > 100) {
      // 最も古いエントリを削除
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0]
      this.cache.delete(oldestKey)
    }
  }
  
  /**
   * キャッシュキーの生成
   */
  generateCacheKey(method: string, params: any): string {
    return `${method}:${JSON.stringify(params)}`
  }
  
  /**
   * バッチリクエストの追加
   */
  async addToBatch<T>(
    batchKey: string,
    requestId: string,
    params: any,
    batchProcessor: (requests: BatchRequest<T>[]) => Promise<Map<string, T>>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: BatchRequest<T> = {
        id: requestId,
        resolve,
        reject,
        params
      }
      
      // バッチキューに追加
      if (!this.batchQueue.has(batchKey)) {
        this.batchQueue.set(batchKey, [])
      }
      this.batchQueue.get(batchKey)!.push(request)
      
      // 既存のタイマーをクリア
      if (this.batchTimers.has(batchKey)) {
        clearTimeout(this.batchTimers.get(batchKey)!)
      }
      
      // バッチサイズが最大値に達した場合、即座に処理
      const queue = this.batchQueue.get(batchKey)!
      if (queue.length >= this.MAX_BATCH_SIZE) {
        this.processBatch(batchKey, batchProcessor)
      } else {
        // 新しいタイマーを設定
        const timer = setTimeout(() => {
          this.processBatch(batchKey, batchProcessor)
        }, this.BATCH_DELAY)
        this.batchTimers.set(batchKey, timer)
      }
    })
  }
  
  /**
   * バッチ処理の実行
   */
  private async processBatch<T>(
    batchKey: string,
    batchProcessor: (requests: BatchRequest<T>[]) => Promise<Map<string, T>>
  ): Promise<void> {
    const queue = this.batchQueue.get(batchKey)
    if (!queue || queue.length === 0) {
      return
    }
    
    // キューをクリア
    this.batchQueue.delete(batchKey)
    this.batchTimers.delete(batchKey)
    
    try {
      logger.debug(`Processing batch for ${batchKey} with ${queue.length} requests`)
      
      // バッチ処理を実行
      const results = await batchProcessor(queue)
      
      // 結果を各リクエストに配信
      queue.forEach(request => {
        const result = results.get(request.id)
        if (result !== undefined) {
          request.resolve(result)
        } else {
          request.reject(new Error('No result found for request'))
        }
      })
    } catch (error) {
      // エラーの場合、すべてのリクエストを拒否
      queue.forEach(request => {
        request.reject(error)
      })
    }
  }
  
  /**
   * リトライロジックの実装
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: any
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error: any) {
        lastError = error
        
        // リトライ可能なエラーかチェック
        if (!this.isRetryableError(error) || attempt === maxRetries) {
          throw error
        }
        
        logger.debug(`Retry attempt ${attempt + 1} after ${retryDelay}ms`)
        
        // 指数バックオフ
        const delay = retryDelay * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    throw lastError
  }
  
  /**
   * リトライ可能なエラーかチェック
   */
  private isRetryableError(error: any): boolean {
    // ネットワークエラーやタイムアウトはリトライ可能
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true
    }
    
    // 5xx系のHTTPエラーはリトライ可能
    if (error.status >= 500 && error.status < 600) {
      return true
    }
    
    // レート制限エラーはリトライ可能
    if (error.status === 429) {
      return true
    }
    
    return false
  }
  
  /**
   * キャッシュのクリア
   */
  clearCache(): void {
    this.cache.clear()
  }
  
  /**
   * 期限切れキャッシュの削除
   */
  cleanupExpiredCache(): void {
    const now = Date.now()
    const expiredKeys: string[] = []
    
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > this.CACHE_TTL) {
        expiredKeys.push(key)
      }
    })
    
    expiredKeys.forEach(key => this.cache.delete(key))
    
    if (expiredKeys.length > 0) {
      logger.debug(`Cleaned up ${expiredKeys.length} expired cache entries`)
    }
  }
}

// シングルトンインスタンス
export const requestOptimizer = new RequestOptimizer()

// 定期的なキャッシュクリーンアップ
setInterval(() => {
  requestOptimizer.cleanupExpiredCache()
}, 60 * 1000) // 1分ごと