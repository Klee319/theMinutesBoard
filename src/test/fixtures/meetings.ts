import { Meeting } from '../../types/meeting'

export const mockMeetings: Meeting[] = [
  {
    id: 'meeting-001',
    title: 'プロジェクトキックオフ会議',
    startTime: '2025-07-15T10:00:00Z',
    endTime: '2025-07-15T11:00:00Z',
    participants: ['田中太郎', '佐藤花子', '鈴木一郎'],
    url: 'https://meet.google.com/abc-defg-hij',
    status: 'completed'
  },
  {
    id: 'meeting-002',
    title: 'スプリントレビュー',
    startTime: '2025-07-15T14:00:00Z',
    endTime: '2025-07-15T15:30:00Z',
    participants: ['田中太郎', '佐藤花子', '山田次郎', '高橋美咲'],
    url: 'https://meet.google.com/xyz-uvwx-yzz',
    status: 'in_progress'
  },
  {
    id: 'meeting-003',
    title: '月次レポート会議',
    startTime: '2025-07-15T16:00:00Z',
    endTime: '2025-07-15T17:00:00Z',
    participants: ['田中太郎', '佐藤花子'],
    url: 'https://meet.google.com/def-ghij-klm',
    status: 'scheduled'
  }
]

export const mockMeeting: Meeting = mockMeetings[0]