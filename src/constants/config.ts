/**
 * アプリケーション設定定数
 */

// タイミング設定
export const TIMING_CONFIG = {
  // Service Worker
  KEEP_ALIVE_INTERVAL: 24000, // 24秒（ms）
  STORAGE_CLEANUP_INTERVAL: 30 * 60 * 1000, // 30分（ms）
  OLD_MEETING_RETENTION_DAYS: 30, // 30日
  MINUTES_GENERATION_TIMEOUT: 60000, // 60秒（ms）
  
  // Content Script
  URL_CHECK_INTERVAL: 500, // URLチェック間隔（ms）
  CAPTIONS_MAX_WAIT_TIME: 30000, // 字幕待機最大時間（ms）
  CAPTIONS_RETRY_COUNT: 3, // 字幕チェック再試行回数
  CAPTIONS_RETRY_DELAY: 1000, // 字幕チェック再試行待機時間（ms）
  TRANSCRIPT_CHECK_INTERVAL: 3000, // 字幕チェック間隔（ms）
  TOAST_DISPLAY_TIME: {
    SUCCESS: 3000, // 成功通知表示時間（ms）
    ERROR: 5000, // エラー通知表示時間（ms）
  },
  
  // Buffer設定
  TRANSCRIPT_BUFFER_SIZE: 50, // バッファサイズ
  TRANSCRIPT_BUFFER_FLUSH_INTERVAL: 5000, // バッファフラッシュ間隔（ms）
} as const

// API設定
export const API_CONFIG = {
  // OpenRouter
  OPENROUTER_REFERER: 'https://theminutesboard.com/',
  OPENROUTER_TITLE: 'theMinutesBoard',
  
  // レート制限
  API_TIMEOUT: 30000, // API呼び出しタイムアウト（ms）
  API_RETRY_COUNT: 3, // API再試行回数
  API_RETRY_DELAY: 1000, // API再試行待機時間（ms）
} as const

// ストレージ設定
export const STORAGE_CONFIG = {
  MAX_STORAGE_BYTES: 4 * 1024 * 1024, // 4MB
  STORAGE_WARNING_THRESHOLD: 0.9, // 90%で警告
  MAX_TRANSCRIPTS_PER_MEETING: 10000, // 会議あたりの最大字幕数
} as const

// UI設定
export const UI_CONFIG = {
  // レスポンシブブレークポイント
  BREAKPOINTS: {
    MOBILE: 768,
    TABLET: 1024,
  },
  
  // デフォルトパネル幅（%）
  DEFAULT_PANEL_WIDTHS: {
    DESKTOP: {
      MINUTES: 50,
      NEXTSTEPS: 25,
      RESEARCH: 25,
    },
    TABLET: {
      MINUTES: 60,
      NEXTSTEPS: 40,
    },
  },
} as const

// GitHub設定
export const GITHUB_CONFIG = {
  REPO_URL: 'https://github.com/anthropics/theMinutesBoard',
  ISSUES_URL: 'https://github.com/anthropics/theMinutesBoard/issues',
} as const

// バージョン情報
export const APP_INFO = {
  NAME: 'theMinutesBoard',
  VERSION: '2.2.0',
  DESCRIPTION: 'Google Meet議事録自動生成Chrome拡張機能',
} as const