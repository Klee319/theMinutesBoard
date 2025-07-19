import { TIMING_CONFIG } from '@/constants/config'

// ロギングは削除（ユーザーの要望により）
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

/**
 * Service Worker最適化クラス
 * M3のService Worker最適化タスクの実装
 */
export class ServiceWorkerOptimizer {
  private static instance: ServiceWorkerOptimizer
  private keepAliveTimer?: number
  private lastActivity: number = Date.now()
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000 // 5分
  private readonly KEEP_ALIVE_INTERVAL = TIMING_CONFIG.KEEP_ALIVE_INTERVAL
  
  // メッセージチャンネルの管理
  private messageChannels = new Map<string, MessagePort>()
  
  // キャッシュされたデータ
  private cache = new Map<string, { data: any; timestamp: number }>()
  private readonly CACHE_TTL = 60 * 1000 // 1分
  
  private constructor() {
    this.setupOptimizations()
  }
  
  static getInstance(): ServiceWorkerOptimizer {
    if (!ServiceWorkerOptimizer.instance) {
      ServiceWorkerOptimizer.instance = new ServiceWorkerOptimizer()
    }
    return ServiceWorkerOptimizer.instance
  }
  
  /**
   * Service Worker最適化の初期化
   */
  private setupOptimizations() {
    // アイドルタイマーの設定
    this.setupIdleTimer()
    
    // メモリ使用量の監視
    this.monitorMemoryUsage()
    
    // イベントリスナーの最適化
    this.optimizeEventListeners()
    
    // キャッシュのクリーンアップ
    this.scheduleCacheCleanup()
  }
  
  /**
   * Service Workerを生かし続ける
   */
  keepAlive() {
    this.updateActivity()
    
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
    }
    
    // 定期的にダミーの処理を実行してService Workerを生かし続ける
    this.keepAliveTimer = setInterval(() => {
      // ダミーのchrome API呼び出し
      chrome.storage.local.get(['_keepAlive'], () => {
        this.updateActivity()
      })
    }, this.KEEP_ALIVE_INTERVAL)
    
    logger.debug('Service Worker keep-alive started')
  }
  
  /**
   * Service Workerの休止を許可
   */
  allowSleep() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = undefined
    }
    logger.debug('Service Worker keep-alive stopped')
  }
  
  /**
   * アクティビティの更新
   */
  private updateActivity() {
    this.lastActivity = Date.now()
  }
  
  /**
   * アイドルタイマーの設定
   */
  private setupIdleTimer() {
    setInterval(() => {
      const idleTime = Date.now() - this.lastActivity
      
      if (idleTime > this.IDLE_TIMEOUT) {
        // アイドル状態の場合、不要なリソースを解放
        this.releaseIdleResources()
      }
    }, 30 * 1000) // 30秒ごとにチェック
  }
  
  /**
   * アイドル時のリソース解放
   */
  private releaseIdleResources() {
    // 古いキャッシュをクリア
    this.clearExpiredCache()
    
    // 使用されていないメッセージチャンネルを閉じる
    this.messageChannels.forEach((port, id) => {
      port.close()
    })
    this.messageChannels.clear()
    
    // ガベージコレクションを促す
    if (globalThis.gc) {
      globalThis.gc()
    }
    
    logger.debug('Idle resources released')
  }
  
  /**
   * メモリ使用量の監視
   */
  private monitorMemoryUsage() {
    if (!performance.memory) {
      return
    }
    
    setInterval(() => {
      const memoryInfo = performance.memory
      const usageRatio = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit
      
      if (usageRatio > 0.9) {
        logger.warn('High memory usage detected:', {
          used: this.formatBytes(memoryInfo.usedJSHeapSize),
          limit: this.formatBytes(memoryInfo.jsHeapSizeLimit),
          ratio: (usageRatio * 100).toFixed(1) + '%'
        })
        
        // メモリ使用量が高い場合、積極的にリソースを解放
        this.releaseIdleResources()
      }
    }, 60 * 1000) // 1分ごとにチェック
  }
  
  /**
   * イベントリスナーの最適化
   */
  private optimizeEventListeners() {
    // chrome.runtime.onMessageのデバウンス
    const messageHandlers = new Map<string, Function>()
    let messageTimer: number | null = null
    
    const originalAddListener = chrome.runtime.onMessage.addListener
    chrome.runtime.onMessage.addListener = function(callback: Function) {
      const wrappedCallback = (message: any, sender: any, sendResponse: Function) => {
        // メッセージをバッファリング
        const key = JSON.stringify(message)
        messageHandlers.set(key, () => callback(message, sender, sendResponse))
        
        if (messageTimer) {
          clearTimeout(messageTimer)
        }
        
        // 10ms後にまとめて処理
        messageTimer = setTimeout(() => {
          messageHandlers.forEach(handler => handler())
          messageHandlers.clear()
          messageTimer = null
        }, 10)
        
        return true // 非同期レスポンスを許可
      }
      
      originalAddListener.call(chrome.runtime.onMessage, wrappedCallback)
    }
  }
  
  /**
   * データのキャッシュ
   */
  cacheData(key: string, data: any) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    })
  }
  
  /**
   * キャッシュからデータ取得
   */
  getCachedData(key: string): any | null {
    const cached = this.cache.get(key)
    
    if (!cached) {
      return null
    }
    
    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.cache.delete(key)
      return null
    }
    
    return cached.data
  }
  
  /**
   * 期限切れキャッシュのクリア
   */
  private clearExpiredCache() {
    const now = Date.now()
    const expiredKeys: string[] = []
    
    this.cache.forEach((value, key) => {
      if (now - value.timestamp > this.CACHE_TTL) {
        expiredKeys.push(key)
      }
    })
    
    expiredKeys.forEach(key => this.cache.delete(key))
  }
  
  /**
   * キャッシュクリーンアップのスケジュール
   */
  private scheduleCacheCleanup() {
    setInterval(() => {
      this.clearExpiredCache()
    }, 5 * 60 * 1000) // 5分ごと
  }
  
  /**
   * メッセージチャンネルの作成
   */
  createMessageChannel(id: string): MessagePort {
    const channel = new MessageChannel()
    this.messageChannels.set(id, channel.port1)
    return channel.port2
  }
  
  /**
   * メッセージチャンネルの取得
   */
  getMessageChannel(id: string): MessagePort | undefined {
    return this.messageChannels.get(id)
  }
  
  /**
   * バイト数のフォーマット
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  
  /**
   * パフォーマンス統計の取得
   */
  getPerformanceStats() {
    return {
      cacheSize: this.cache.size,
      messageChannels: this.messageChannels.size,
      lastActivity: new Date(this.lastActivity),
      idleTime: Date.now() - this.lastActivity,
      memoryUsage: performance.memory ? {
        used: this.formatBytes(performance.memory.usedJSHeapSize),
        limit: this.formatBytes(performance.memory.jsHeapSizeLimit),
        ratio: (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit * 100).toFixed(1) + '%'
      } : null
    }
  }
}

// シングルトンインスタンスのエクスポート
export const serviceWorkerOptimizer = ServiceWorkerOptimizer.getInstance()