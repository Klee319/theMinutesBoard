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
}

export interface Minutes {
  id: string
  meetingId: string
  content: string
  generatedAt: Date
  format: 'markdown' | 'plain'
  metadata?: {
    totalDuration: number
    participantCount: number
    wordCount: number
  }
}

export interface UserSettings {
  aiProvider: AIProvider
  apiKey?: string
  openaiApiKey?: string
  claudeApiKey?: string
  openrouterApiKey?: string
  selectedModel?: string
  promptTemplate: string
  autoGenerate: boolean
  generateInterval: number
  exportFormat: ExportFormat
  theme: 'light' | 'dark' | 'auto'
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
}

export type MessageType = 
  | 'START_RECORDING'
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

export interface StorageData {
  meetings: Meeting[]
  settings: UserSettings
  currentMeetingId?: string
}