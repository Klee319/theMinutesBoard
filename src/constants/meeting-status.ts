/**
 * Meeting Status Constants
 * 会議の状態を表す定数定義
 */

export const MEETING_STATUS = {
  IDLE: 'idle',
  RECORDING: 'recording',
  PROCESSING: 'processing',
  COMPLETED: 'completed'
} as const;

export type MeetingStatus = typeof MEETING_STATUS[keyof typeof MEETING_STATUS];