/**
 * Chrome拡張機能のエラーハンドリングユーティリティ
 * Extension context invalidatedエラーの検出と回復を行う
 */

import { logger } from './logger'

export interface ChromeErrorHandlerOptions {
  onContextInvalidated?: () => void
  maxRetries?: number
  retryDelay?: number
}

export class ChromeErrorHandler {
  private static isContextInvalidated = false
  private static reconnectionCallbacks: Set<() => void> = new Set()
  
  /**
   * Extension context invalidatedエラーかどうかを判定
   */
  static isExtensionContextError(error: any): boolean {
    if (!error) return false
    
    const errorMessage = error.message || error.toString()
    return errorMessage.includes('Extension context invalidated') ||
           errorMessage.includes('Could not establish connection') ||
           errorMessage.includes('Receiving end does not exist')
  }
  
  /**
   * Chrome runtime lastErrorをチェック
   */
  static checkLastError(): Error | null {
    if (chrome.runtime.lastError) {
      const error = new Error(chrome.runtime.lastError.message || 'Unknown Chrome runtime error')
      logger.error('Chrome runtime error detected:', error)
      
      if (this.isExtensionContextError(error)) {
        this.isContextInvalidated = true
        this.notifyContextInvalidated()
      }
      
      return error
    }
    return null
  }
  
  /**
   * 安全にメッセージを送信（リトライ機能付き）
   */
  static async sendMessage<T = any>(
    message: any, 
    options: ChromeErrorHandlerOptions = {}
  ): Promise<T> {
    const { maxRetries = 3, retryDelay = 1000 } = options
    
    // 最初にランタイムが利用可能か確認
    if (!chrome.runtime?.id) {
      this.isContextInvalidated = true
      this.notifyContextInvalidated()
      throw new Error('Extension context is not available')
    }
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 既にコンテキストが無効と分かっている場合は即座にエラー
        if (this.isContextInvalidated) {
          throw new Error('Extension context is known to be invalidated')
        }
        
        return await new Promise<T>((resolve, reject) => {
          // ランタイムIDを再度確認
          if (!chrome.runtime?.id) {
            reject(new Error('Extension context invalidated'))
            return
          }
          
          chrome.runtime.sendMessage(message, (response) => {
            const error = this.checkLastError()
            if (error) {
              reject(error)
            } else {
              resolve(response)
            }
          })
        })
      } catch (error) {
        logger.error(`Message send attempt ${attempt + 1} failed:`, error)
        
        if (this.isExtensionContextError(error)) {
          this.isContextInvalidated = true
          this.notifyContextInvalidated()
          
          // 最後の試行でなければリトライ
          if (attempt < maxRetries - 1) {
            await this.delay(retryDelay * (attempt + 1))
            continue
          }
        }
        
        throw error
      }
    }
    
    throw new Error('Max retries exceeded')
  }
  
  /**
   * タブにメッセージを送信（エラーハンドリング付き）
   */
  static async sendMessageToTab<T = any>(
    tabId: number,
    message: any,
    options: ChromeErrorHandlerOptions = {}
  ): Promise<T> {
    const { maxRetries = 3, retryDelay = 1000 } = options
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await new Promise<T>((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            const error = this.checkLastError()
            if (error) {
              reject(error)
            } else {
              resolve(response)
            }
          })
        })
      } catch (error) {
        logger.error(`Tab message send attempt ${attempt + 1} failed:`, error)
        
        if (this.isExtensionContextError(error)) {
          // 最後の試行でなければリトライ
          if (attempt < maxRetries - 1) {
            await this.delay(retryDelay * (attempt + 1))
            continue
          }
        }
        
        throw error
      }
    }
    
    throw new Error('Max retries exceeded')
  }
  
  /**
   * 再接続コールバックを登録
   */
  static onReconnectionNeeded(callback: () => void): () => void {
    this.reconnectionCallbacks.add(callback)
    
    // アンサブスクライブ関数を返す
    return () => {
      this.reconnectionCallbacks.delete(callback)
    }
  }
  
  /**
   * コンテキスト無効化を通知
   */
  private static notifyContextInvalidated() {
    logger.warn('Extension context invalidated - notifying callbacks')
    this.reconnectionCallbacks.forEach(callback => {
      try {
        callback()
      } catch (error) {
        logger.error('Error in reconnection callback:', error)
      }
    })
  }
  
  /**
   * コンテキストの有効性をチェック
   */
  static async checkContextValidity(): Promise<boolean> {
    try {
      // シンプルなpingメッセージでコンテキストの有効性を確認
      await this.sendMessage({ type: 'PING' }, { maxRetries: 1 })
      this.isContextInvalidated = false
      return true
    } catch (error) {
      if (this.isExtensionContextError(error)) {
        this.isContextInvalidated = true
        return false
      }
      // その他のエラーは無視（PINGに対応していない可能性）
      return true
    }
  }
  
  /**
   * コンテキストをリセット
   */
  static resetContext() {
    this.isContextInvalidated = false
  }
  
  /**
   * 遅延ユーティリティ
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  /**
   * ユーザーフレンドリーなエラーメッセージを取得
   */
  static getUserFriendlyMessage(error: any): string {
    if (this.isExtensionContextError(error)) {
      return '拡張機能との接続が切断されました。ページを再読み込みしてください。'
    }
    
    if (error.message?.includes('API key')) {
      return 'APIキーが設定されていません。設定画面でAPIキーを入力してください。'
    }
    
    return error.message || 'エラーが発生しました'
  }
}

/**
 * Service Workerのキープアライブ機能
 */
export class ServiceWorkerKeepAlive {
  private static keepAliveInterval: number | null = null
  private static readonly KEEP_ALIVE_INTERVAL = 20000 // 20秒ごと
  
  /**
   * キープアライブを開始
   */
  static start() {
    if (this.keepAliveInterval) return
    
    // 初回実行
    this.ping()
    
    // 定期実行
    this.keepAliveInterval = window.setInterval(() => {
      this.ping()
    }, this.KEEP_ALIVE_INTERVAL)
    
    logger.debug('Service Worker keep-alive started')
  }
  
  /**
   * キープアライブを停止
   */
  static stop() {
    if (this.keepAliveInterval) {
      window.clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
      logger.debug('Service Worker keep-alive stopped')
    }
  }
  
  /**
   * Service Workerにpingを送信
   */
  private static async ping() {
    try {
      await ChromeErrorHandler.sendMessage(
        { type: 'KEEP_ALIVE' },
        { maxRetries: 1 }
      )
    } catch (error) {
      // エラーは無視（Service Workerが一時的に応答しない可能性）
      logger.debug('Keep-alive ping failed:', error)
    }
  }
}