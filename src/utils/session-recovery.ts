// セッション回復機能
import { logger } from './logger'
import { Meeting, SharedState } from '@/types'

interface SessionState {
  meetingId: string
  isRecording: boolean
  recordingTabId: number | null
  lastUpdate: Date
  transcriptCount: number
}

export class SessionRecovery {
  private static readonly SESSION_KEY = 'theMinutesBoard_session'
  private static readonly STATE_KEY = 'theMinutesBoard_state'
  private static readonly RECOVERY_TIMEOUT = 5 * 60 * 1000 // 5分

  // セッション状態を保存
  static async saveSession(state: Partial<SessionState>): Promise<void> {
    try {
      const currentSession = await this.getSession()
      const updatedSession = {
        ...currentSession,
        ...state,
        lastUpdate: new Date()
      }
      
      await chrome.storage.local.set({
        [this.SESSION_KEY]: updatedSession
      })
      
      logger.debug('Session saved:', updatedSession)
    } catch (error) {
      logger.error('Failed to save session:', error)
    }
  }

  // セッション状態を取得
  static async getSession(): Promise<SessionState | null> {
    try {
      const result = await chrome.storage.local.get([this.SESSION_KEY])
      const session = result[this.SESSION_KEY]
      
      if (!session) {
        return null
      }
      
      // タイムアウトチェック
      const lastUpdate = new Date(session.lastUpdate)
      const now = new Date()
      const timeDiff = now.getTime() - lastUpdate.getTime()
      
      if (timeDiff > this.RECOVERY_TIMEOUT) {
        logger.info('Session expired, clearing...')
        await this.clearSession()
        return null
      }
      
      return session
    } catch (error) {
      logger.error('Failed to get session:', error)
      return null
    }
  }

  // セッションをクリア
  static async clearSession(): Promise<void> {
    try {
      await chrome.storage.local.remove([this.SESSION_KEY, this.STATE_KEY])
      logger.info('Session cleared')
    } catch (error) {
      logger.error('Failed to clear session:', error)
    }
  }

  // セッションの回復を試みる
  static async tryRecover(): Promise<{
    success: boolean
    session?: SessionState
    meeting?: Meeting
  }> {
    try {
      const session = await this.getSession()
      
      if (!session || !session.meetingId) {
        return { success: false }
      }
      
      // 会議データを取得
      const { meetings = [] } = await chrome.storage.local.get(['meetings'])
      const meeting = meetings.find((m: Meeting) => m.id === session.meetingId)
      
      if (!meeting) {
        logger.warn('Meeting not found for session recovery:', session.meetingId)
        await this.clearSession()
        return { success: false }
      }
      
      // 会議が終了していないか確認
      if (meeting.endTime) {
        logger.info('Meeting already ended, clearing session')
        await this.clearSession()
        return { success: false }
      }
      
      logger.info('Session recovered successfully:', session)
      return {
        success: true,
        session,
        meeting
      }
    } catch (error) {
      logger.error('Session recovery failed:', error)
      return { success: false }
    }
  }

  // 共有状態を保存
  static async saveSharedState(state: SharedState): Promise<void> {
    try {
      await chrome.storage.local.set({
        [this.STATE_KEY]: {
          ...state,
          timestamp: new Date().toISOString()
        }
      })
    } catch (error) {
      logger.error('Failed to save shared state:', error)
    }
  }

  // 共有状態を取得
  static async getSharedState(): Promise<SharedState | null> {
    try {
      const result = await chrome.storage.local.get([this.STATE_KEY])
      const state = result[this.STATE_KEY]
      
      if (!state) {
        return null
      }
      
      return {
        ...state,
        lastUpdate: new Date(state.timestamp || state.lastUpdate)
      }
    } catch (error) {
      logger.error('Failed to get shared state:', error)
      return null
    }
  }

  // 定期的な状態保存を開始
  static startPeriodicSave(
    getState: () => { meetingId: string | null; isRecording: boolean; recordingTabId: number | null }
  ): number {
    return setInterval(() => {
      const state = getState()
      if (state.isRecording && state.meetingId) {
        this.saveSession({
          meetingId: state.meetingId,
          isRecording: state.isRecording,
          recordingTabId: state.recordingTabId
        })
      }
    }, 30000) as unknown as number // 30秒ごと
  }
}