import { logger } from './logger'

export type ErrorType = 'network' | 'storage' | 'permission' | 'context' | 'unknown'

export interface ErrorInfo {
  type: ErrorType
  message: string
  userMessage: string
  details?: any
}

export class ErrorHandler {
  static handleError(error: any, context: string): ErrorInfo {
    logger.error(`Error in ${context}:`, error)
    
    if (error.message?.includes('Extension context invalidated')) {
      return {
        type: 'context',
        message: error.message,
        userMessage: '拡張機能を再読み込みしてください',
        details: error
      }
    }
    
    if (error.message?.includes('quota')) {
      return {
        type: 'storage',
        message: error.message,
        userMessage: 'ストレージ容量が不足しています。古いデータを削除してください',
        details: error
      }
    }
    
    if (error.message?.includes('network') || error.message?.includes('fetch')) {
      return {
        type: 'network',
        message: error.message,
        userMessage: 'ネットワークエラーが発生しました。接続を確認してください',
        details: error
      }
    }
    
    if (error.message?.includes('permission')) {
      return {
        type: 'permission',
        message: error.message,
        userMessage: '必要な権限がありません。拡張機能の設定を確認してください',
        details: error
      }
    }
    
    return {
      type: 'unknown',
      message: error.message || 'Unknown error',
      userMessage: 'エラーが発生しました。しばらくしてからもう一度お試しください',
      details: error
    }
  }
  
  static getUserMessage(error: any, context: string): string {
    const errorInfo = this.handleError(error, context)
    return errorInfo.userMessage
  }
}