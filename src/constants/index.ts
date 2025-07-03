// セレクター関連の定数
export * from './selectors'

// AIモデル関連の定数
export * from './ai-models'

// タイミング関連の定数
export const TIMING_CONSTANTS = {
  AUTO_UPDATE_COMPLETE_DELAY: 2000, // 自動更新完了後の遅延時間（ms）
  COUNTDOWN_UPDATE_INTERVAL: 1000, // カウントダウン更新間隔（ms）
  MINUTES_TO_MS: 60 * 1000, // 分をミリ秒に変換する係数
  FLUSH_INTERVAL: 5000, // トランスクリプトバッファのフラッシュ間隔（ms）
  DEFAULT_TIMEOUT: 30000, // APIリクエストのデフォルトタイムアウト（ms）
} as const

// トランスクリプト関連の定数
export const TRANSCRIPT_CONSTANTS = {
  MAX_TRANSCRIPTS_FOR_MINUTES: 500, // 議事録生成時の最大トランスクリプト数
  MAX_TRANSCRIPTS_PER_MEETING: 10000, // 会議あたりの最大トランスクリプト数
  MIN_TRANSCRIPTS_FOR_HISTORY: 10, // 履歴議事録生成に必要な最小トランスクリプト数
  MAX_BUFFER_SIZE: 50, // トランスクリプトバッファの最大サイズ
} as const

// API関連の定数
export const API_CONSTANTS = {
  MAX_TOKENS: {
    MINUTES_GENERATION: 4000,
    CONTENT_GENERATION: 2000,
    CHAT_MESSAGE: 1000,
    API_KEY_VALIDATION: 10,
  },
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 初期リトライ遅延（ms）
} as const

// UI関連の定数
export const UI_CONSTANTS = {
  MOBILE_BREAKPOINT: 768, // モバイルビューの境界値（px）
  PANEL_WIDTH: {
    MINUTES_ONLY: 100,
    TWO_PANEL_LEFT: 70,
    TWO_PANEL_RIGHT: 30,
    TWO_PANEL_EQUAL: 50,
    THREE_PANEL_LEFT: 40,
    THREE_PANEL_MIDDLE: 40,
    THREE_PANEL_RIGHT: 20,
  },
} as const

// ステータス関連の定数
export const STATUS_ICONS = {
  pending: '○',
  confirmed: '●',
  in_progress: '◐',
  completed: '✓',
} as const

export const PRIORITY_COLORS = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  low: 'bg-gray-100 text-gray-700 border-gray-200',
} as const

export const PRIORITY_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
} as const

// ストレージ関連の定数
export const STORAGE_CONSTANTS = {
  CLEANUP_INTERVAL: 60000, // ストレージクリーンアップの間隔（ms）
  SYNC_STORAGE_LIMIT: 8192, // Chrome sync storageの制限（バイト）
  LOCAL_STORAGE_LIMIT: 5242880, // Chrome local storageの制限（バイト）
} as const

// 温度設定の定数
export const TEMPERATURE_SETTINGS = {
  CREATIVE: 0.7,
  BALANCED: 0.5,
  PRECISE: 0.3,
} as const

// 音声録音関連の定数
export const RECORDING_CONSTANTS = {
  SAMPLE_RATE: 16000,
  CHANNELS: 1,
  BIT_DEPTH: 16,
} as const