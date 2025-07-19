import { Transcript } from '../../types/transcript'

export const mockTranscripts: Transcript[] = [
  {
    id: 'transcript-001',
    speaker: '田中太郎',
    content: 'おはようございます。今日はプロジェクトキックオフ会議にお集まりいただき、ありがとうございます。',
    timestamp: '2025-07-15T10:00:30Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-002',
    speaker: '佐藤花子',
    content: 'おはようございます。よろしくお願いします。',
    timestamp: '2025-07-15T10:01:00Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-003',
    speaker: '田中太郎',
    content: 'まず、今回のプロジェクトの概要についてお話しします。目標は来月末までに新機能をリリースすることです。',
    timestamp: '2025-07-15T10:02:00Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-004',
    speaker: '鈴木一郎',
    content: 'スケジュールについて確認したいのですが、開発期間はどのくらいを想定していますか？',
    timestamp: '2025-07-15T10:03:00Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-005',
    speaker: '田中太郎',
    content: '開発期間は3週間を予定しています。その後、1週間でテストとデバッグを行います。',
    timestamp: '2025-07-15T10:03:30Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-006',
    speaker: '佐藤花子',
    content: 'UIデザインについてはどのようなスケジュールになりますか？',
    timestamp: '2025-07-15T10:04:00Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-007',
    speaker: '田中太郎',
    content: 'UIデザインは来週火曜日までに完成予定です。その後、開発チームに引き継ぎます。',
    timestamp: '2025-07-15T10:04:30Z',
    meetingId: 'meeting-001'
  }
]

export const mockTranscript: Transcript = mockTranscripts[0]

// 長時間会議用のモックデータ
export const longMeetingTranscripts: Transcript[] = Array.from({ length: 50 }, (_, index) => ({
  id: `transcript-long-${index + 1}`,
  speaker: ['田中太郎', '佐藤花子', '鈴木一郎'][index % 3],
  content: `これは長時間会議の発言内容です。発言番号: ${index + 1}`,
  timestamp: new Date(Date.now() + index * 60000).toISOString(),
  meetingId: 'meeting-long'
}))

// エラーテスト用のモックデータ
export const malformedTranscripts: Partial<Transcript>[] = [
  {
    id: 'transcript-error-001',
    speaker: '',
    content: 'スピーカーが空の場合',
    timestamp: '2025-07-15T10:00:00Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-error-002',
    speaker: '田中太郎',
    content: '',
    timestamp: '2025-07-15T10:00:00Z',
    meetingId: 'meeting-001'
  },
  {
    id: 'transcript-error-003',
    speaker: '田中太郎',
    content: 'タイムスタンプが無効な場合',
    timestamp: 'invalid-timestamp',
    meetingId: 'meeting-001'
  }
]