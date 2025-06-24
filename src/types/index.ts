export interface Transcript {
  id: string
  speaker: string
  content: string
  timestamp: Date
  meetingId: string
}

export interface Meeting {
  id: string
  title: string
  startTime: Date
  endTime?: Date
  participants: string[]
  transcripts: Transcript[]
  minutes?: Minutes
  callEndReason?: string
  duration?: number // 会議時間（秒）
  nextSteps?: NextStep[] // ネクストステップ追加
}

export interface Minutes {
  id: string
  meetingId?: string
  content: string
  generatedAt: Date
  format: 'markdown' | 'plain'
  metadata?: {
    totalDuration: number
    participantCount: number
    wordCount: number
  }
  editHistory?: EditHistoryEntry[]
}

export interface EditHistoryEntry {
  timestamp: Date
  instruction: string
  transcripts: string[]
}

export interface UserSettings {
  aiProvider: AIProvider
  apiKey?: string
  openaiApiKey?: string
  claudeApiKey?: string
  openrouterApiKey?: string
  selectedModel?: string
  promptTemplate: string
  autoUpdateInterval: number // 自動更新間隔（分）、0はOFF
  exportFormat: ExportFormat
  userName?: string // 拡張機能利用者名を追加
}

export type AIProvider = 'gemini' | 'openai' | 'claude' | 'openrouter'

export interface AIModel {
  id: string
  name: string
  provider: AIProvider
  contextLength?: number
  pricing?: {
    input: number
    output: number
  }
}

export type ExportFormat = 'markdown' | 'pdf' | 'txt' | 'json'

export interface RateLimitStatus {
  remaining: number
  reset: Date
  limit: number
}

export interface ChromeMessage {
  type: MessageType
  payload?: any
  reason?: string
  timestamp?: string
}

export type MessageType = 
  | 'START_RECORDING'
  | 'START_RECORDING_CONFIRMED'
  | 'STOP_RECORDING'
  | 'TRANSCRIPT_UPDATE'
  | 'GENERATE_MINUTES'
  | 'EXPORT_MINUTES'
  | 'SETTINGS_UPDATE'
  | 'GET_RECORDING_STATUS'
  | 'MINUTES_GENERATED'
  | 'OPEN_VIEWER_TAB'
  | 'FOCUS_TAB'
  | 'VIEWER_TAB_OPENED'
  | 'AI_REQUEST'
  | 'AI_RESPONSE'
  | 'OPEN_ASSISTANT_TAB'
  | 'KEYWORD_DETECTED'
  | 'REALTIME_TRANSCRIPT'
  | 'CALL_ENDED'
  | 'MINUTES_UPDATE'
  | 'MINUTES_UPDATED'
  | 'PARTICIPANT_UPDATE'
  | 'RECORDING_STOPPED'
  | 'RESTORE_SESSION'
  | 'GENERATE_NEXTSTEPS'
  | 'UPDATE_NEXTSTEP'
  | 'DELETE_NEXTSTEP'
  | 'NEXTSTEPS_GENERATED'
  | 'AI_EDIT_MINUTES'
  | 'AI_RESEARCH'
  | 'CHAT_MESSAGE'
  | 'STATE_SYNC'
  | 'REQUEST_STATE_SYNC'
  | 'MINUTES_GENERATION_STARTED'
  | 'MINUTES_GENERATION_COMPLETED'
  | 'MINUTES_GENERATION_FAILED'

export interface StorageData {
  meetings: Meeting[]
  settings: UserSettings
  currentMeetingId?: string
  nextStepsPrompt?: string // ネクストステップ生成用プロンプト
}

export interface AIResponse {
  id: string
  content: string
  generatedAt: Date
  requestType: 'general' | 'search' | 'minutes_edit'
  context?: {
    transcripts?: Transcript[]
    minutesContent?: string
  }
}

export interface AIAssistantSession {
  id: string
  meetingId?: string
  messages: AIConversationMessage[]
  createdAt: Date
  lastActivity: Date
}

export interface AIConversationMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: Date
  context?: {
    transcripts?: Transcript[]
    minutesContent?: string
  }
}

export interface KeywordDetection {
  keyword: string
  context: string
  timestamp: Date
  confidence: number
  extractedRequest?: string
}

// ネクストステップ型（新規追加）
export interface NextStep {
  id: string
  meetingId: string
  task: string
  assignee?: string
  dueDate?: Date
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'deleted'
  isPending: boolean // 未確定項目フラグ（赤字表示用）
  priority?: 'high' | 'medium' | 'low'
  dependencies: string[] // 他のタスクID
  notes: string
  createdAt: Date
  updatedAt: Date
}

// 共有状態を表す型
export interface SharedState {
  isRecording: boolean
  currentMeetingId: string | null
  isMinutesGenerating: boolean
  hasMinutes: boolean
  recordingTabId: number | null
  lastUpdate: Date
}