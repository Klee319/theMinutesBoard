// ロギングユーティリティ
// 環境変数または設定に基づいてログレベルを制御

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

class Logger {
  private level: LogLevel
  isDevelopment: boolean

  constructor() {
    // manifest.jsonのバージョンやビルド環境に基づいて設定
    this.isDevelopment = !chrome.runtime.getManifest().update_url
    this.level = this.isDevelopment ? LogLevel.DEBUG : LogLevel.ERROR
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`[ERROR] ${message}`, ...args)
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`[WARN] ${message}`, ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(`[INFO] ${message}`, ...args)
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`[DEBUG] ${message}`, ...args)
    }
  }

  // グループ化されたログ
  group(label: string): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.group(label)
    }
  }

  groupEnd(): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.groupEnd()
    }
  }

  // エラーをフォーマットして記録
  logError(error: unknown, context?: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    
    this.error(`${context ? `[${context}] ` : ''}${errorMessage}`)
    
    if (errorStack && this.shouldLog(LogLevel.DEBUG)) {
      console.error('Stack trace:', errorStack)
    }
  }
}

// シングルトンインスタンス
export const logger = new Logger()