// Meeting 関連のモックデータ
export * from './meetings'
export * from './transcripts'
export * from './nextSteps'
export * from './minutes'

// Chrome Extension API のモックデータ
export const mockChromeStorageData = {
  settings: {
    aiProvider: 'gemini',
    apiKey: 'test-api-key',
    autoUpdateInterval: 2,
    enableWebSearch: false,
    uiTheme: 'auto'
  },
  meetings: [
    {
      id: 'meeting-001',
      title: 'プロジェクトキックオフ会議',
      startTime: '2025-07-15T10:00:00Z',
      endTime: '2025-07-15T11:00:00Z'
    }
  ],
  transcripts: [
    {
      id: 'transcript-001',
      speaker: '田中太郎',
      content: 'テスト用の発言内容',
      timestamp: '2025-07-15T10:00:00Z',
      meetingId: 'meeting-001'
    }
  ]
}

// ユーザー設定のモックデータ
export const mockUserSettings = {
  aiProvider: 'gemini',
  apiKey: 'test-api-key-12345',
  autoUpdateInterval: 2,
  enableWebSearch: false,
  uiTheme: 'auto',
  maxTranscriptLength: 10000
}

// Google Meet DOM のモックデータ
export const mockGoogleMeetElements = {
  captionContainer: '<div class="caption-container"></div>',
  captionText: '<div class="caption-text">テスト用の字幕テキスト</div>',
  participantNames: ['田中太郎', '佐藤花子', '鈴木一郎'],
  meetingUrl: 'https://meet.google.com/abc-defg-hij'
}

// タイムスタンプ関連のモックデータ
export const mockTimestamps = {
  meetingStart: '2025-07-15T10:00:00Z',
  meetingEnd: '2025-07-15T11:00:00Z',
  currentTime: '2025-07-15T10:30:00Z',
  lastUpdate: '2025-07-15T10:29:45Z'
}

// エラーメッセージのモックデータ
export const mockErrorMessages = {
  networkError: 'ネットワークエラーが発生しました',
  authError: '認証に失敗しました',
  storageError: 'データの保存に失敗しました',
  parseError: 'データの解析に失敗しました',
  validationError: '入力データが無効です'
}

// テスト用のヘルパー関数
export const createMockTimestamp = (offsetMinutes = 0) => {
  const now = new Date()
  now.setMinutes(now.getMinutes() + offsetMinutes)
  return now.toISOString()
}

export const createMockMeetingId = () => `meeting-${Date.now()}`

export const createMockTranscriptId = () => `transcript-${Date.now()}`

export const createMockNextStepId = () => `step-${Date.now()}`