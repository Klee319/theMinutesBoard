import { ChromeMessage, MessageType, StorageData, Meeting, UserSettings, SharedState, Transcript } from '@/types'
import { geminiService } from '@/services/gemini'
import { AIServiceFactory } from '@/services/ai/factory'
import { EnhancedAIService } from '@/services/ai/enhanced-ai-service'
import { debugStorageInfo } from './debug'
import { CHAT_ASSISTANT_PROMPT, RESEARCH_ASSISTANT_PROMPT } from '@/system-prompts'
import { logger } from '@/utils/logger'
import { storageService } from '@/services/storage'
import { SessionRecovery } from '@/utils/session-recovery'
import { TRANSCRIPT_CONSTANTS, STORAGE_CONSTANTS, TIMING_CONSTANTS, API_CONSTANTS } from '../constants'
import { TIMING_CONFIG, STORAGE_CONFIG } from '@/constants/config'
import { sessionManager } from './session-manager'
import { performanceMonitor } from '@/utils/performance-monitor'
import { serviceWorkerOptimizer } from './service-worker-optimizer'

let currentMeetingId: string | null = null
let recordingTabId: number | null = null

// 議事録生成の排他制御
let isMinutesGenerating = false

// ストレージ管理用の定数
const STORAGE_WARNING_THRESHOLD = STORAGE_CONFIG.STORAGE_WARNING_THRESHOLD
const STORAGE_CRITICAL_THRESHOLD = STORAGE_CONFIG.STORAGE_CRITICAL_THRESHOLD
const MAX_TRANSCRIPTS_PER_MEETING = STORAGE_CONFIG.MAX_TRANSCRIPTS_PER_MEETING
const TRANSCRIPT_BATCH_SIZE = TRANSCRIPT_CONSTANTS.MAX_BUFFER_SIZE

// 共有状態
let sharedState: SharedState = {
  isRecording: false,
  currentMeetingId: null,
  isMinutesGenerating: false,
  hasMinutes: false,
  recordingTabId: null,
  lastUpdate: new Date()
}

// Chrome Storageから取得したMeetingオブジェクトの日付フィールドをDate型に変換する
function normalizeMeeting(meeting: Meeting): Meeting {
  return {
    ...meeting,
    startTime: meeting.startTime instanceof Date ? meeting.startTime : new Date(meeting.startTime),
    endTime: meeting.endTime ? (meeting.endTime instanceof Date ? meeting.endTime : new Date(meeting.endTime)) : undefined,
    transcripts: meeting.transcripts.map(t => ({
      ...t,
      timestamp: t.timestamp instanceof Date ? t.timestamp : new Date(t.timestamp)
    })),
    minutes: meeting.minutes ? {
      ...meeting.minutes,
      generatedAt: meeting.minutes.generatedAt instanceof Date ? meeting.minutes.generatedAt : new Date(meeting.minutes.generatedAt),
      editHistory: meeting.minutes.editHistory?.map(e => ({
        ...e,
        timestamp: e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp)
      }))
    } : undefined,
    nextSteps: meeting.nextSteps?.map(ns => ({
      ...ns,
      dueDate: ns.dueDate ? (ns.dueDate instanceof Date ? ns.dueDate : new Date(ns.dueDate)) : undefined,
      createdAt: ns.createdAt instanceof Date ? ns.createdAt : new Date(ns.createdAt),
      updatedAt: ns.updatedAt instanceof Date ? ns.updatedAt : new Date(ns.updatedAt)
    }))
  }
}

// 状態を更新して全タブに通知する関数
async function updateSharedState(updates: Partial<SharedState>) {
  sharedState = {
    ...sharedState,
    ...updates,
    lastUpdate: new Date()
  }
  
  // 共有状態を保存
  await SessionRecovery.saveSharedState(sharedState)
  
  // 全てのタブに状態更新を通知
  const tabs = await chrome.tabs.query({})
  tabs.forEach(tab => {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'STATE_SYNC',
        payload: sharedState
      }).catch(() => {
        // エラーは無視（タブがメッセージを受信できない可能性）
      })
    }
  })
  
  // ポップアップにも通知
  chrome.runtime.sendMessage({
    type: 'STATE_SYNC',
    payload: sharedState
  }).catch(() => {
    // エラーは無視（ポップアップが開いていない可能性）
  })
}

// 拡張機能のインストール・更新時の処理
chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('Extension installed/updated:', details.reason)
  
  // データの整合性チェック
  chrome.storage.local.get(['meetings'], async (result) => {
    if (chrome.runtime.lastError) {
      logger.error('Storage error on install:', chrome.runtime.lastError)
      return
    }
    
    const meetings = result.meetings || []
    logger.info(`Extension ${details.reason} - existing meetings: ${meetings.length}`)
    
    // データが破損していないか確認
    if (meetings.length > 0 && !Array.isArray(meetings)) {
      logger.error('Corrupted meetings data detected, initializing...')
      chrome.storage.local.set({ meetings: [] })
    }
    
    // ストレージ使用状況をチェック
    await checkStorageUsage()
  })
})

// 起動時に前回の状態を確認
chrome.runtime.onStartup.addListener(async () => {
  // Service Worker最適化の初期化
  serviceWorkerOptimizer.keepAlive()
  
  logger.info('Extension startup - attempting session recovery')
  
  // セッション回復を試みる
  const recovery = await SessionRecovery.tryRecover()
  
  if (recovery.success && recovery.session && recovery.meeting) {
    logger.info('Session recovered successfully')
    
    // 状態を復元
    currentMeetingId = recovery.session.meetingId
    recordingTabId = recovery.session.recordingTabId
    
    sharedState = {
      isRecording: true,
      currentMeetingId,
      isMinutesGenerating: false,
      hasMinutes: !!recovery.meeting.minutes,
      recordingTabId,
      lastUpdate: new Date()
    }
    
    // キープアライブを再開
    if (recovery.session.isRecording) {
      startKeepAlive()
    }
  } else {
    logger.info('No session to recover')
    
    // 状態を初期化
    sharedState = {
      isRecording: false,
      currentMeetingId: null,
      isMinutesGenerating: false,
      hasMinutes: false,
      recordingTabId: null,
      lastUpdate: new Date()
    }
  }
  
  // ストレージ使用状況をチェック
  const storageStatus = await checkStorageUsage()
  
  // ストレージが逼迫している場合は起動時にクリーンアップ
  if (storageStatus.percentage > STORAGE_WARNING_THRESHOLD) {
    logger.warn(`High storage usage detected on startup: ${(storageStatus.percentage * 100).toFixed(1)}%`)
    await performStorageCleanup()
  }
  
  // デバッグ情報を出力
  if (logger.isDevelopment) {
    debugStorageInfo()
  }
})

// 定期的なセッション保存を開始
let sessionSaveInterval: number | null = null

function startSessionSave() {
  if (sessionSaveInterval) return
  
  sessionSaveInterval = SessionRecovery.startPeriodicSave(() => ({
    meetingId: currentMeetingId,
    isRecording: sharedState.isRecording,
    recordingTabId
  }))
}

function stopSessionSave() {
  if (sessionSaveInterval) {
    clearInterval(sessionSaveInterval)
    sessionSaveInterval = null
  }
}

// Service Workerのキープアライブ機能
let keepAliveInterval: NodeJS.Timeout | null = null

function startKeepAlive() {
  if (keepAliveInterval) return
  
  // Keep-aliveアラームを設定
  chrome.alarms.create('keep-alive', { periodInMinutes: TIMING_CONFIG.KEEP_ALIVE_INTERVAL / 60000 })
  logger.info('Keep-alive alarm created')
}

function stopKeepAlive() {
  chrome.alarms.clear('keep-alive')
  logger.info('Keep-alive alarm cleared')
}

// アラームリスナー
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keep-alive') {
    // 何もしなくても、このイベントでService Workerがアクティブになる
    logger.debug('Keep-alive alarm fired')
  } else if (alarm.name === 'storage-cleanup') {
    // 定期的なストレージクリーンアップ
    performStorageCleanup()
  }
})

// ストレージのクリーンアップアラームを設定
chrome.alarms.create('storage-cleanup', { periodInMinutes: TIMING_CONFIG.STORAGE_CLEANUP_INTERVAL / 60000 })

// 記録開始時にキープアライブを開始
function onRecordingStarted() {
  startKeepAlive()
  startSessionSave()
}

// 記録停止時にキープアライブを停止
function onRecordingStopped() {
  stopKeepAlive()
  stopSessionSave()
  SessionRecovery.clearSession()
}

chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
  logger.debug('Background received message:', message.type)
  
  // メッセージ処理前にlastErrorをチェック
  if (chrome.runtime.lastError) {
    logger.error('Chrome runtime error before processing:', chrome.runtime.lastError)
    sendResponse({ success: false, error: chrome.runtime.lastError.message })
    return false
  }
  
  try {
    switch (message.type) {
      case 'KEEP_ALIVE':
        // キープアライブpingに応答
        sendResponse({ success: true, timestamp: Date.now() })
        return false
        
      case 'PING':
        // 接続確認用ping
        sendResponse({ success: true, pong: true })
        return false
      case 'START_RECORDING':
        // Popupからのリクエスト：Content Scriptに字幕チェックを依頼
        handleStartRecording(sender.tab?.id, message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.logError(error, 'START_RECORDING')
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Recording failed' })
          })
        return true
        
      case 'START_RECORDING_CONFIRMED':
        // Content Scriptからの確認済みリクエスト：直接記録開始処理を行う
        handleActualStartRecording(sender.tab?.id, message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.logError(error, 'START_RECORDING_CONFIRMED')
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Recording failed' })
          })
        return true
        
      case 'STOP_RECORDING':
        handleStopRecording()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.logError(error, 'STOP_RECORDING')
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Stop recording failed' })
          })
        return true
        
      case 'TRANSCRIPT_UPDATE':
        handleTranscriptUpdate(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.logError(error, 'TRANSCRIPT_UPDATE')
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Transcript update failed' })
          })
        return true
        
      case 'GENERATE_MINUTES':
        handleGenerateMinutes(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            logger.logError(error, 'GENERATE_MINUTES')
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Minutes generation failed' })
          })
        return true
        
      case 'EXPORT_MINUTES':
        handleExportMinutes(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'OPEN_VIEWER_TAB':
        handleOpenViewerTab(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'FOCUS_TAB':
        handleFocusTab(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true

      case 'CALL_ENDED':
        handleCallEnded(message.reason || 'Unknown', message.timestamp || new Date().toISOString(), sender.tab?.id)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'GENERATE_NEXTSTEPS':
        handleGenerateNextSteps(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'UPDATE_NEXTSTEP':
        handleUpdateNextStep(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'DELETE_NEXTSTEP':
        handleDeleteNextStep(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'PARTICIPANT_UPDATE':
        handleParticipantUpdate(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'CHAT_MESSAGE':
        handleChatMessage(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'AI_EDIT_MINUTES':
        handleAiEditMinutes(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'AI_RESEARCH':
        // Service Workerを起動状態に保つ
        serviceWorkerOptimizer.keepAlive()
        
        handleAiResearch(message.payload)
          .then(result => {
            sendResponse(result)
          })
          .catch(error => {
            logger.error('AI_RESEARCH handler error:', error)
            sendResponse({ success: false, error: error.message || 'リサーチ処理中にエラーが発生しました' })
          })
        return true
        
      case 'UPDATE_RESEARCH_MODE':
        handleUpdateResearchMode(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'REQUEST_STATE_SYNC':
        // 現在の状態を送信
        sendResponse({ success: true, state: sharedState })
        return false
        
      case 'AI_ASSISTANT_START':
        // Service Workerを起動状態に保つ
        serviceWorkerOptimizer.keepAlive()
        
        handleAIAssistantStart(message.payload)
          .then(result => {
            sendResponse(result)
          })
          .catch(error => {
            logger.error('AI_ASSISTANT_START handler error:', error)
            sendResponse({ success: false, error: error.message || '音声記録の開始に失敗しました' })
          })
        return true
        
      case 'AI_ASSISTANT_STOP':
        // Service Workerを起動状態に保つ
        serviceWorkerOptimizer.keepAlive()
        
        handleAIAssistantStop(message.payload)
          .then(result => {
            sendResponse(result)
          })
          .catch(error => {
            logger.error('AI_ASSISTANT_STOP handler error:', error)
            sendResponse({ success: false, error: error.message || '音声記録の停止に失敗しました' })
          })
        return true
        
      case 'AI_ASSISTANT_PROCESS':
        handleAIAssistantProcess(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'UPDATE_NEXTSTEPS_FROM_VOICE':
        handleUpdateNextStepsFromVoice(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      default:
        sendResponse({ success: false, error: 'Unknown message type' })
        return false
    }
  } catch (error) {
    logger.logError(error, 'BACKGROUND_MESSAGE_HANDLER')
    sendResponse({ success: false, error: 'Unexpected error occurred' })
    return false
  }
})

// Popupからの記録開始リクエストを処理（Content Scriptに字幕チェックを依頼）
async function handleStartRecording(tabId?: number, payload?: any): Promise<void> {
  if (!tabId) {
    throw new Error('No tab ID provided')
  }
  
  // 既に記録中の場合は新しい記録を開始しない
  if (currentMeetingId && recordingTabId === tabId) {
    logger.debug('Already recording in this tab')
    return
  }
  
  // Content Scriptに字幕チェックを依頼
  try {
    const response = await new Promise<{success: boolean; error?: string}>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING', payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      })
    })
    
    if (!response || !response.success) {
      throw new Error(response?.error || '字幕が有効になっていません。Google Meetの字幕をONにしてください。')
    }
    
    // 字幕チェックが成功した場合のみ実際の記録開始を行う
    await handleActualStartRecording(tabId, payload)
  } catch (error) {
    logger.error('Failed to start recording:', error)
    throw error
  }
}

// Content Scriptからの記録開始リクエストを処理（字幕チェック済み）
async function handleActualStartRecording(tabId?: number, payload?: any): Promise<void> {
  if (!tabId) {
    throw new Error('No tab ID provided')
  }
  
  // 既に記録中の場合は新しい記録を開始しない
  if (currentMeetingId && recordingTabId === tabId) {
    logger.debug('Already recording in this tab')
    return
  }
  
  logger.info('Starting recording after captions check passed')
  
  currentMeetingId = generateMeetingId()
  recordingTabId = tabId
  
  // SessionManagerでセッションを作成
  sessionManager.createSession(currentMeetingId)
  
  // キープアライブを開始
  onRecordingStarted()
  
  // 状態を更新
  await updateSharedState({
    isRecording: true,
    currentMeetingId,
    recordingTabId,
    hasMinutes: false
  })
  
  const newMeeting: Meeting = {
    id: currentMeetingId,
    title: new Date().toLocaleString('ja-JP'),
    startTime: new Date(),
    participants: payload?.initialParticipants || [],
    transcripts: []
  }
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['meetings'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings = result.meetings || []
      meetings.push(newMeeting)
      chrome.storage.local.set({ 
        meetings, 
        currentMeetingId 
      }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          // ストレージ容量を確認
          chrome.storage.local.getBytesInUse(['meetings'], (bytesInUse) => {
            logger.debug('Storage used for meetings:', bytesInUse, 'bytes')
          })
          resolve()
        }
      })
    })
  })
}

// 会議終了時刻を更新する関数
async function updateMeetingEndTime(meetingId: string): Promise<Meeting[]> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['meetings'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
      const meetingIndex = meetings.findIndex(m => m.id === meetingId)
      
      if (meetingIndex !== -1) {
        meetings[meetingIndex].endTime = new Date()
        
        chrome.storage.local.set({ meetings }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            resolve(meetings)
          }
        })
      } else {
        resolve(meetings)
      }
    })
  })
}

// 履歴用議事録生成の判定と実行
async function generateHistoryMinutesIfNeeded(meeting: Meeting): Promise<void> {
  const shouldGenerateHistoryMinutes = meeting.minutes && 
                                     meeting.transcripts.length > 10
  
  if (!shouldGenerateHistoryMinutes) {
    return
  }
  
  // 一時的にcurrentMeetingIdを設定して議事録生成
  const tempMeetingId = currentMeetingId
  currentMeetingId = meeting.id
  
  try {
    
    // endTimeがない場合は現在時刻を設定
    if (!meeting.endTime) {
      try {
        meeting.endTime = new Date()
        // Invalid Date チェック
        if (isNaN(meeting.endTime.getTime())) {
          console.warn('Created invalid endTime, using epoch time')
          meeting.endTime = new Date(Date.now())
        }
      } catch (error) {
        meeting.endTime = new Date(Date.now())
      }
    }
    
    const result = await handleGenerateMinutes({ promptType: 'history' })
    if (result.success) {
      
      // 履歴用議事録を別フィールドに保存
      chrome.storage.local.get(['meetings'], (storageResult) => {
        const updatedMeetings: Meeting[] = storageResult.meetings || []
        const updatedMeetingIndex = updatedMeetings.findIndex(m => m.id === meeting.id)
        if (updatedMeetingIndex !== -1 && result.minutes) {
          // 履歴用議事録をmetadataに保存
          updatedMeetings[updatedMeetingIndex].minutes = {
            ...result.minutes,
            metadata: {
              ...result.minutes.metadata,
              isHistoryVersion: true
            }
          }
          chrome.storage.local.set({ meetings: updatedMeetings })
        }
      })
    }
  } catch (error) {
  } finally {
    currentMeetingId = tempMeetingId
  }
}

// 全Google Meetタブに記録停止を通知
function notifyAllMeetTabs(meetingId: string): void {
  chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: 'RECORDING_STOPPED',
          payload: { meetingId }
        }).catch(() => {
          // エラーは無視（タブが閉じられている可能性）
        })
      }
    })
  })
}

async function handleStopRecording(): Promise<void> {
  if (!currentMeetingId) {
    return
  }
  
  const stoppedMeetingId = currentMeetingId
  const stoppedTabId = recordingTabId
  
  // SessionManagerから全てのトランスクリプトを取得してからセッションを終了
  const allTranscripts = sessionManager.endSession(stoppedMeetingId)
  
  // キープアライブを停止
  onRecordingStopped()
  
  // 状態を更新
  await updateSharedState({
    isRecording: false,
    currentMeetingId: null,
    recordingTabId: null
  })
  
  try {
    // 会議終了時刻を更新（全てのトランスクリプトを保存）
    const meetings = await updateMeetingEndTime(stoppedMeetingId)
    const meeting = meetings.find(m => m.id === stoppedMeetingId)
    
    if (meeting) {
      // 全てのトランスクリプトを会議データに保存
      meeting.transcripts = allTranscripts
      
      // ストレージに保存
      await new Promise<void>((resolve, reject) => {
        chrome.storage.local.set({ meetings }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError)
          } else {
            resolve()
          }
        })
      })
      
      // 履歴用議事録を生成（バックグラウンドで実行）
      await generateHistoryMinutesIfNeeded(meeting)
    }
    
    // 記録状態をクリア
    currentMeetingId = null
    recordingTabId = null
    
    // ストレージから現在の会議IDを削除
    chrome.storage.local.remove(['currentMeetingId'])
    
    // 全てのGoogle Meetタブに停止完了を通知
    notifyAllMeetTabs(stoppedMeetingId)
  } catch (error) {
    // エラーが発生しても記録状態はクリアする
    currentMeetingId = null
    recordingTabId = null
    chrome.storage.local.remove(['currentMeetingId'])
  }
}

async function handleTranscriptUpdate(transcript: any): Promise<void> {
  if (!currentMeetingId) {
    return
  }
  
  // SessionManagerに新しいトランスクリプトを追加
  const transcriptData: Transcript = {
    ...transcript,
    id: generateTranscriptId(),
    meetingId: currentMeetingId,
    timestamp: new Date()
  }
  
  const added = sessionManager.addTranscript(currentMeetingId, transcriptData)
  if (!added) {
    // セッションが存在しない場合は作成
    sessionManager.createSession(currentMeetingId)
    sessionManager.addTranscript(currentMeetingId, transcriptData)
  }
  
  return new Promise(async (resolve, reject) => {
    chrome.storage.local.get(['meetings'], async (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
      const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
      
      if (meetingIndex !== -1) {
        // ストレージには最新のトランスクリプトのみ保存（メモリ効率化）
        const recentTranscripts = sessionManager.getTranscripts(currentMeetingId, TRANSCRIPT_BATCH_SIZE)
        meetings[meetingIndex].transcripts = recentTranscripts
        
        const participants = new Set(meetings[meetingIndex].participants)
        participants.add(transcript.speaker)
        meetings[meetingIndex].participants = Array.from(participants)
        
        // AIアシスタントセッションにも字幕を追加（アクティブなセッションのみ）
        if (activeVoiceSession && activeVoiceSession.meetingId === currentMeetingId) {
          const session = aiAssistantSessions.get(currentMeetingId)
          if (session) {
            session.transcripts.push({
              ...transcript,
              id: generateTranscriptId(),
              meetingId: currentMeetingId,
              timestamp: new Date()
            })
          }
        }
        
        // ストレージ使用状況をチェック
        const storageCheck = await checkStorageUsage()
        if (storageCheck.percentage > STORAGE_CRITICAL_THRESHOLD) {
          logger.error('Storage critically full, performing emergency cleanup')
          await performEmergencyCleanup()
          
          // 再度ストレージをチェック
          const recheckStorage = await checkStorageUsage()
          if (recheckStorage.percentage > 0.95) {
            // それでも容量が足りない場合は、現在の会議の字幕を大幅に削減
            meetings[meetingIndex].transcripts = meetings[meetingIndex].transcripts.slice(-100)
            logger.warn('Extreme storage pressure - kept only last 100 transcripts')
          }
        }
        
        chrome.storage.local.set({ meetings }, () => {
          if (chrome.runtime.lastError) {
            // ストレージエラーの場合、さらに古いデータを削除して再試行
            if (chrome.runtime.lastError.message.includes('quota')) {
              logger.error('Storage quota exceeded, attempting to free space')
              
              // 最も古い会議を削除
              if (meetings.length > 1) {
                meetings.shift() // 最初の要素を削除
                
                // 再度保存を試みる
                chrome.storage.local.set({ meetings }, () => {
                  if (chrome.runtime.lastError) {
                    reject(new Error('Storage critically full: ' + chrome.runtime.lastError.message))
                  } else {
                    logger.info('Freed space by removing oldest meeting')
                    resolve()
                  }
                })
              } else {
                reject(new Error('Storage quota exceeded and no meetings to delete'))
              }
            } else {
              reject(new Error(chrome.runtime.lastError.message))
            }
          } else {
            resolve()
          }
        })
      } else {
        reject(new Error('Meeting not found'))
      }
    })
  })
}

async function handleGenerateMinutes(payload?: { promptType?: 'live' | 'history' | 'default' }): Promise<any> {
  // 既に議事録生成中の場合は待機
  if (isMinutesGenerating) {
    return { success: false, error: '議事録を生成中です。しばらくお待ちください。' }
  }

  try {
    isMinutesGenerating = true // 生成開始をマーク
    
    // 状態を更新（議事録生成開始）
    await updateSharedState({
      isMinutesGenerating: true
    })
    
    // 全タブに議事録生成開始を通知
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'MINUTES_GENERATION_STARTED',
            payload: { meetingId: currentMeetingId }
          }).catch(() => {})
        }
      })
    })
    
    return await new Promise((resolve) => {
      chrome.storage.local.get(['meetings', 'settings'], async (localResult) => {
        if (chrome.runtime.lastError) {
          isMinutesGenerating = false
          resolve({ success: false, error: chrome.runtime.lastError.message })
          return
        }
        
        // sync storageからも設定を読み込む
        chrome.storage.sync.get(['settings'], async (syncResult) => {
          if (chrome.runtime.lastError) {
            console.warn('Failed to load sync settings:', chrome.runtime.lastError)
          }
          
          // localとsyncの設定をマージ（sync優先）
          const mergedSettings = {
            ...(localResult.settings || {}),
            ...(syncResult.settings || {})
          }
          
          // データ整合性チェック
          if (!localResult.meetings || !Array.isArray(localResult.meetings)) {
            isMinutesGenerating = false
            resolve({ success: false, error: 'ストレージデータが破損しています' })
            return
          }
        
          const meetings: Meeting[] = localResult.meetings || []
          const currentMeeting = meetings.find(m => m.id === currentMeetingId)
          
          if (!currentMeeting) {
            isMinutesGenerating = false
            resolve({ success: false, error: '記録中の会議がありません' })
            return
          }
          
          // SessionManagerから全てのトランスクリプトを取得
          const allTranscripts = sessionManager.getTranscripts(currentMeetingId)
          if (allTranscripts.length === 0) {
            isMinutesGenerating = false
            resolve({ success: false, error: 'まだ発言が記録されていません' })
            return
          }
          
          // 議事録生成時に使用するトランスクリプトを更新
          currentMeeting.transcripts = allTranscripts
          
          // 字幕が異常に多い場合のみ警告
          if (allTranscripts.length > 1000) {
            console.warn('Large number of transcripts:', {
              count: allTranscripts.length,
              totalCharacters: allTranscripts.reduce((sum, t) => sum + (t.text || t.content || '').length, 0)
            })
          }
          
          if (!mergedSettings || Object.keys(mergedSettings).length === 0) {
            isMinutesGenerating = false
            resolve({ success: false, error: 'AI設定が設定されていません' })
            return
          }

          // AIプロバイダーとAPIキーの検証
          if (!AIServiceFactory.validateProviderSettings(mergedSettings)) {
            const provider = mergedSettings.aiProvider || 'gemini'
            isMinutesGenerating = false
            resolve({ success: false, error: `${provider} APIキーが設定されていません` })
            return
          }
          
          try {
            // EnhancedAIServiceを作成（フォールバック対応）
            const enhancedService = new EnhancedAIService(mergedSettings)
        
            // 時刻データの正規化（Dateオブジェクトか文字列かの判定）
            const normalizeDate = (dateValue: any): Date => {
              if (!dateValue) return new Date()
              if (dateValue instanceof Date) {
                return isNaN(dateValue.getTime()) ? new Date() : dateValue
              }
              try {
                const parsed = new Date(dateValue)
                return isNaN(parsed.getTime()) ? new Date() : parsed
              } catch {
                return new Date()
              }
            }
            
            const startTime = normalizeDate(currentMeeting.startTime)
            const endTime = normalizeDate(currentMeeting.endTime)
            
            
            // AIサービス呼び出しログ（重要な情報のみ）
            logger.info(`Generating minutes: ${currentMeeting.transcripts.length} transcripts, provider: ${mergedSettings.aiProvider || 'default'}`)
            
            // 議事録を生成
            const result = await enhancedService.generateMinutes(
              currentMeeting.transcripts,
              {
                enableFallback: true,
                retryConfig: {
                  maxRetries: 3,
                  retryDelay: 1000,
                  exponentialBackoff: true
                },
                promptType: payload?.promptType || 'default'
              }
            )
            
            // 既存のAIサービスと同じ形式に変換
            const minutes = {
              content: result.content,
              generatedAt: new Date(),
              provider: mergedSettings.aiProvider
            }
        
        // 生成された議事録を保存
        const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
        if (meetingIndex !== -1) {
          meetings[meetingIndex].minutes = minutes
          
          chrome.storage.local.set({ meetings }, async () => {
            isMinutesGenerating = false // 生成完了をマーク
            
            if (chrome.runtime.lastError) {
              // エラー時の状態更新
              await updateSharedState({
                isMinutesGenerating: false
              })
              
              // 全タブに失敗を通知
              chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                  if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                      type: 'MINUTES_GENERATION_FAILED',
                      payload: { error: chrome.runtime.lastError.message }
                    }).catch(() => {})
                  }
                })
              })
              
              resolve({ success: false, error: chrome.runtime.lastError.message })
            } else {
              // 成功時の状態更新
              await updateSharedState({
                isMinutesGenerating: false,
                hasMinutes: true
              })
              
              // 全タブに議事録生成完了を通知
              chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                  if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                      type: 'MINUTES_GENERATED',
                      payload: {
                        meetingId: currentMeetingId,
                        minutes
                      }
                    }).catch(() => {})
                  }
                })
              })
              
              // ネクストステップを自動生成（議事録更新時は常に再生成）
              logger.info('Auto-generating/updating next steps for meeting:', currentMeetingId)
              handleGenerateNextSteps({ meetingId: currentMeetingId, userPrompt: '' })
                .then((result) => {
                  if (result.success) {
                    logger.info('Next steps auto-generated/updated successfully')
                    
                    // 全タブにネクストステップ更新完了を通知
                    chrome.tabs.query({}, (tabs) => {
                      tabs.forEach(tab => {
                        if (tab.id) {
                          chrome.tabs.sendMessage(tab.id, {
                            type: 'NEXTSTEPS_GENERATED',
                            payload: {
                              meetingId: currentMeetingId,
                              nextSteps: result.nextSteps
                            }
                          }).catch(() => {})
                        }
                      })
                    })
                  } else {
                    logger.error('Failed to auto-generate/update next steps:', result.error)
                  }
                })
                .catch((error) => {
                })
              
              resolve({ success: true, minutes })
            }
          })
        }
          } catch (error: any) {
            isMinutesGenerating = false // エラー時も生成完了をマーク
            
            // エラー時の状態更新
            await updateSharedState({
              isMinutesGenerating: false
            })
            
            // 全タブに失敗を通知
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach(tab => {
                if (tab.id) {
                  chrome.tabs.sendMessage(tab.id, {
                    type: 'MINUTES_GENERATION_FAILED',
                    payload: { error: error.message || '議事録の生成中にエラーが発生しました' }
                  }).catch(() => {})
                }
              })
            })
            
            resolve({ 
              success: false, 
              error: error.message || '議事録の生成中にエラーが発生しました' 
            })
          }
        })
      })
  }) 
  } catch (error) {
    isMinutesGenerating = false
    return { success: false, error: 'Unexpected error occurred' }
  } finally {
    // タイムアウト保護: 30秒後に必ずフラグをリセット
    setTimeout(() => {
      if (isMinutesGenerating) {
        console.warn('Resetting isMinutesGenerating flag due to timeout')
        isMinutesGenerating = false
      }
    }, TIMING_CONSTANTS.DEFAULT_TIMEOUT)
  }
}

async function handleExportMinutes(format: string): Promise<any> {
  return { success: true, message: 'Export functionality will be implemented' }
}

async function handleOpenViewerTab(payload: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['currentMeetingId'], (result) => {
      const url = chrome.runtime.getURL('src/viewer/viewer.html')
      const fullUrl = result.currentMeetingId 
        ? `${url}?meetingId=${result.currentMeetingId}` 
        : url
      
      chrome.tabs.create({ url: fullUrl }, (tab) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
        } else if (tab && tab.id) {
          // Content Scriptにタブ情報を送信
          if (recordingTabId) {
            chrome.tabs.sendMessage(recordingTabId, {
              type: 'VIEWER_TAB_OPENED',
              payload: { tabId: tab.id }
            }).catch(() => {
              // エラーは無視（Content Scriptが準備できていない可能性）
            })
          }
          resolve({ success: true, tabId: tab.id })
        } else {
          resolve({ success: false, error: 'Failed to create tab' })
        }
      })
    })
  })
}

async function handleFocusTab(payload: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.tabs.update(payload.tabId, { active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve({ success: true })
      }
    })
  })
}

function generateMeetingId(): string {
  return `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function generateTranscriptId(): string {
  return `transcript_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}



chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === recordingTabId) {
    handleStopRecording()
  }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === recordingTabId && changeInfo.url && !changeInfo.url.includes('meet.google.com')) {
    handleStopRecording()
  }
})

async function handleParticipantUpdate(payload: any): Promise<void> {
  if (!currentMeetingId) {
    return
  }
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['meetings'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
      const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
      
      if (meetingIndex !== -1) {
        const participants = new Set(meetings[meetingIndex].participants)
        
        if (payload.action === 'joined') {
          participants.add(payload.participant)
          
          // 参加者の入室を記録
          meetings[meetingIndex].transcripts.push({
            id: generateTranscriptId(),
            meetingId: currentMeetingId,
            speaker: 'System',
            content: `${payload.participant} が参加しました`,
            timestamp: new Date(payload.timestamp)
          })
        } else if (payload.action === 'left') {
          participants.delete(payload.participant)
          
          // 参加者の退室を記録
          meetings[meetingIndex].transcripts.push({
            id: generateTranscriptId(),
            meetingId: currentMeetingId,
            speaker: 'System',
            content: `${payload.participant} が退出しました`,
            timestamp: new Date(payload.timestamp)
          })
        }
        
        meetings[meetingIndex].participants = Array.from(participants)
        
        chrome.storage.local.set({ meetings }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            resolve()
          }
        })
      } else {
        reject(new Error('Meeting not found'))
      }
    })
  })
}

async function handleCallEnded(reason: string, timestamp: string, tabId?: number): Promise<{ success: boolean }> {
  logger.info('Call ended detected in background:', { reason, timestamp, tabId, currentMeetingId, recordingTabId })
  
  // 現在記録中の会議があり、該当タブからの通知の場合のみ処理
  if (!currentMeetingId || (tabId && tabId !== recordingTabId)) {
    logger.debug('No active recording or tab mismatch, ignoring call end')
    return { success: true }
  }
  
  const endedMeetingId = currentMeetingId
  
  try {
    // 会議終了時刻を記録
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meetingIndex = meetings.findIndex(m => m.id === endedMeetingId)
    if (meetingIndex !== -1) {
      meetings[meetingIndex].endTime = new Date(timestamp)
      meetings[meetingIndex].callEndReason = reason
      
      // 会議データを保存
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ meetings }, () => {
          resolve()
        })
      })
      
      // 記録を自動停止
      logger.info('Auto-stopping recording due to call end')
      await handleStopRecording()
      
      
      // 履歴用議事録を生成（非同期で実行し、完了後にviewerに通知）
      const meeting = meetings[meetingIndex]
      if (meeting.minutes && meeting.transcripts.length > 10) {
        generateHistoryMinutesIfNeeded(meeting).then(() => {
          // 履歴議事録生成完了をviewerに通知
          chrome.runtime.sendMessage({
            type: 'HISTORY_MINUTES_GENERATED',
            payload: { meetingId: endedMeetingId }
          }).catch(() => {
            // エラーは無視（viewerが開いていない可能性）
          })
        })
      }
    }
    
    // 記録状態をクリア
    currentMeetingId = null
    recordingTabId = null
    isMinutesGenerating = false
    
    // 状態を更新
    await updateSharedState({
      isRecording: false,
      currentMeetingId: null,
      recordingTabId: null,
      isMinutesGenerating: false
    })
    
    // ストレージの状態もクリア
    await new Promise<void>((resolve) => {
      chrome.storage.local.remove(['currentMeetingId'], () => {
        resolve()
      })
    })
    
    // 全てのMeetタブとviewerに終了を通知
    notifyAllMeetTabs(endedMeetingId)
    
    // viewerに会議終了を通知
    chrome.runtime.sendMessage({
      type: 'CALL_ENDED',
      payload: { meetingId: endedMeetingId, reason, timestamp }
    }).catch(() => {
      // エラーは無視（viewerが開いていない可能性）
    })
    
    logger.info('Call end handling completed successfully')
    return { success: true }
    
  } catch (error) {
    throw error
  }
}

// ネクストステップ生成のハンドラー
async function handleGenerateNextSteps(payload: any): Promise<any> {
  const { meetingId, userPrompt } = payload || {}
  
  if (!meetingId) {
    return { success: false, error: 'Meeting ID is required' }
  }
  
  try {
    // 会議データを取得
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting) {
      return { success: false, error: 'Meeting not found' }
    }
    
    // Meetingオブジェクトの日付フィールドを正規化
    const normalizedMeeting = normalizeMeeting(meeting)
    logger.debug(`handleGenerateNextSteps: normalized startTime = ${normalizedMeeting.startTime}`)
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // EnhancedAIServiceを使用してネクストステップを生成
    const enhancedService = new EnhancedAIService(settings)
    
    // ネクストステップを生成（Meetingオブジェクトを渡す）
    const result = await enhancedService.generateNextSteps(
      normalizedMeeting,
      userPrompt || '',
      undefined, // userName
      {
        enableFallback: true,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          exponentialBackoff: true
        }
      }
    )
    
    // resultは既にNextStep[]型なので、そのまま使用
    const generatedNextSteps = result
    
    // 既存のネクストステップとマージ
    if (meeting.nextSteps && meeting.nextSteps.length > 0) {
      // 既存のネクストステップをマップに変換（タスク内容をキーとして）
      const existingStepsMap = new Map<string, NextStep>()
      meeting.nextSteps.forEach(step => {
        // タスク内容と担当者をキーとして保存
        const key = `${step.task.toLowerCase()}_${(step.assignee || '').toLowerCase()}`
        existingStepsMap.set(key, step)
      })
      
      // 新しく生成されたネクストステップをマージ
      const mergedSteps: NextStep[] = []
      const usedKeys = new Set<string>()
      
      generatedNextSteps.forEach(newStep => {
        const key = `${newStep.task.toLowerCase()}_${(newStep.assignee || '').toLowerCase()}`
        const existingStep = existingStepsMap.get(key)
        
        if (existingStep) {
          // 既存のステップがある場合、状態を保持しつつ更新
          mergedSteps.push({
            ...newStep,
            id: existingStep.id, // IDを保持
            status: existingStep.status || 'pending', // 状態を保持
            createdAt: existingStep.createdAt, // 作成日時を保持
            updatedAt: new Date(),
            // ユーザーが編集したフィールドは保持
            notes: existingStep.notes || newStep.notes,
            dueDate: existingStep.dueDate || newStep.dueDate
          })
          usedKeys.add(key)
        } else {
          // 新しいステップの場合はそのまま追加
          mergedSteps.push(newStep)
        }
      })
      
      // 完了済みの既存ステップを保持
      existingStepsMap.forEach((step, key) => {
        if (!usedKeys.has(key) && step.status === 'completed') {
          mergedSteps.push(step)
        }
      })
      
      meeting.nextSteps = mergedSteps
      logger.info(`Merged next steps: ${existingStepsMap.size} existing, ${generatedNextSteps.length} generated, ${mergedSteps.length} total`)
    } else {
      // 既存のネクストステップがない場合はそのまま設定
      meeting.nextSteps = generatedNextSteps
    }
    
    // 会議データを保存
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ meetings }, () => {
        resolve()
      })
    })
    
    // Content Scriptに通知
    if (recordingTabId) {
      chrome.tabs.sendMessage(recordingTabId, {
        type: 'NEXTSTEPS_GENERATED',
        payload: { meetingId, nextSteps: meeting.nextSteps }
      })
    }
    
    return { success: true, nextSteps: meeting.nextSteps }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// ネクストステップ更新のハンドラー
async function handleUpdateNextStep(payload: any): Promise<any> {
  const { meetingId, stepId, updates } = payload || {}
  
  if (!meetingId || !stepId) {
    return { success: false, error: 'Meeting ID and Step ID are required' }
  }
  
  try {
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting || !meeting.nextSteps) {
      return { success: false, error: 'Meeting or nextSteps not found' }
    }
    
    const nextStepIndex = meeting.nextSteps.findIndex(ns => ns.id === stepId)
    if (nextStepIndex === -1) {
      return { success: false, error: 'NextStep not found' }
    }
    
    // 更新を適用
    meeting.nextSteps[nextStepIndex] = {
      ...meeting.nextSteps[nextStepIndex],
      ...updates,
      updatedAt: new Date()
    }
    
    // 保存
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ meetings }, () => {
        resolve()
      })
    })
    
    return { success: true, nextStep: meeting.nextSteps[nextStepIndex] }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// ネクストステップ削除のハンドラー
async function handleDeleteNextStep(payload: any): Promise<any> {
  const { meetingId, nextStepId } = payload || {}
  
  if (!meetingId || !nextStepId) {
    return { success: false, error: 'Meeting ID and NextStep ID are required' }
  }
  
  try {
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting || !meeting.nextSteps) {
      return { success: false, error: 'Meeting or nextSteps not found' }
    }
    
    // フィルタリングして削除
    meeting.nextSteps = meeting.nextSteps.filter(ns => ns.id !== nextStepId)
    
    // 保存
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ meetings }, () => {
        resolve()
      })
    })
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

async function handleChatMessage(payload: { meetingId: string; message: string; context?: any }): Promise<{ success: boolean; response?: string; error?: string }> {
  const { meetingId, message, context } = payload
  
  if (!meetingId || !message) {
    return { success: false, error: 'Meeting ID and message are required' }
  }
  
  try {
    // 会議データを取得
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting) {
      return { success: false, error: 'Meeting not found' }
    }
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // EnhancedAIServiceを使用してチャット応答を生成
    const enhancedService = new EnhancedAIService(settings)
    
    // コンテキストを構築
    const chatContext = {
      systemPrompt: CHAT_ASSISTANT_PROMPT,
      meetingInfo: {
        title: meeting.title,
        startTime: meeting.startTime,
        participants: meeting.participants,
        transcriptsCount: meeting.transcripts.length,
        hasMinutes: !!meeting.minutes
      },
      minutes: meeting.minutes?.content || null,
      recentTranscripts: meeting.transcripts.slice(-20), // 最新20件の字幕
      ...context
    }
    
    // チャットメッセージを送信
    const result = await enhancedService.generateChatResponse(
      message,
      JSON.stringify(chatContext),
      {
        enableFallback: true,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          exponentialBackoff: true
        }
      }
    )
    const response = result.text
    
    return { success: true, response }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function handleAiEditMinutes(payload: { meetingId: string; instruction: string; transcripts: string[] }): Promise<{ success: boolean; error?: string }> {
  const { meetingId, instruction, transcripts } = payload
  
  if (!meetingId || !instruction) {
    return { success: false, error: 'Meeting ID and instruction are required' }
  }
  
  try {
    // 会議データを取得
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting) {
      return { success: false, error: 'Meeting not found' }
    }
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // EnhancedAIServiceを使用して議事録を編集
    const enhancedService = new EnhancedAIService(settings)
    
    // 編集プロンプトを構築
    const editPrompt = `
現在の議事録を以下の指示に従って編集してください。

【編集指示】
${instruction}

【音声入力内容】
${transcripts.join('\n')}

【現在の議事録】
${meeting.minutes?.content || '（議事録がまだ生成されていません）'}

【編集方針】
1. 指示された内容を適切に反映する
2. 既存の構造と形式を維持する
3. 追加情報がある場合は適切な場所に挿入する
4. 修正が必要な場合は正確に反映する
5. マークダウン形式を維持する

編集後の議事録全文を返してください。
`
    
    const editedContent = await enhancedService.generateText(
      editPrompt,
      {
        maxTokens: API_CONSTANTS.MAX_TOKENS.MINUTES_GENERATION,
        temperature: 0.3
      },
      {
        enableFallback: true,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          exponentialBackoff: true
        }
      }
    )
    
    // 編集された議事録を保存
    const meetingIndex = meetings.findIndex(m => m.id === meetingId)
    if (meetingIndex !== -1) {
      meetings[meetingIndex].minutes = {
        id: meetings[meetingIndex].minutes?.id || `minutes_${Date.now()}`,
        content: editedContent,
        generatedAt: new Date(),
        format: 'markdown' as const,
        editHistory: [
          ...(meetings[meetingIndex].minutes?.editHistory || []),
          {
            timestamp: new Date(),
            instruction,
            transcripts
          }
        ]
      }
      
      // 保存
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ meetings }, () => {
          resolve()
        })
      })
      
      // LiveModeLayoutに更新通知
      if (recordingTabId) {
        chrome.tabs.sendMessage(recordingTabId, {
          type: 'MINUTES_UPDATED',
          payload: {
            meetingId,
            minutes: meetings[meetingIndex].minutes,
            source: 'ai-edit'
          }
        }).catch(() => {
          // エラーは無視
        })
      }
    }
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function handleAiResearch(payload: { meetingId: string; question: string; transcripts: string[] }): Promise<{ success: boolean; response?: string; error?: string }> {
  try {
    const { meetingId, question, transcripts } = payload
    
    // パラメータの検証
    if (!meetingId) {
      logger.error('handleAiResearch: Meeting ID is missing')
      return { success: false, error: 'Meeting IDが必要です' }
    }
    
    if (!question || question.trim() === '') {
      logger.error('handleAiResearch: Question is missing or empty')
      return { success: false, error: '質問内容が必要です' }
    }
    
    logger.info(`handleAiResearch called with meetingId: ${meetingId}, question length: ${question.length}`)
    
    // 実際のミーティングIDを取得（currentMeetingIdを優先）
    const actualMeetingId = currentMeetingId || meetingId
    logger.info(`handleAiResearch: using actualMeetingId=${actualMeetingId}, currentMeetingId=${currentMeetingId}`)
    // 会議データを取得
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === actualMeetingId)
    if (!meeting) {
      logger.error(`Meeting not found: actualMeetingId=${actualMeetingId}, availableMeetings=${meetings.map(m => m.id).join(', ')}`)
      return { success: false, error: '会議が見つかりません' }
    }
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // EnhancedAIServiceを使用してリサーチ応答を生成
    const enhancedService = new EnhancedAIService(settings)
    
    // AIアシスタントセッションから差分を計算
    const session = aiAssistantSessions.get(meetingId) || aiAssistantSessions.get(actualMeetingId)
    let differenceTranscripts: Transcript[] = []
    
    if (session && session.type === 'research') {
      // セッション中に記録された文字起こしのみを使用
      differenceTranscripts = session.transcripts || []
      logger.info(`Research mode - Using session transcripts: ${differenceTranscripts.length} transcripts recorded during session`)
    } else {
      // セッションがない場合は、音声入力の内容のみを使用
      logger.warn('Research session not found, using voice input only')
      // transcriptsパラメータは音声入力の内容なので、それをそのまま使用することはできない
      differenceTranscripts = []
    }
    
    // 現在の議題の要約を取得（議事録から）
    let currentTopicSummary = ''
    if (meeting.minutes?.content) {
      const minutesContent = meeting.minutes.content
      
      // ライブダイジェストを取得（現在の議題）
      const liveDigestMatch = minutesContent.match(/## ライブダイジェスト[\s\S]*?### 要約:([^\n]+)/)
      if (liveDigestMatch) {
        currentTopicSummary = `現在の議題の要約: ${liveDigestMatch[1].trim()}`
      }
      
      // 現在の議題がない場合は、最新の議題を取得
      if (!currentTopicSummary) {
        const topicsMatches = minutesContent.match(/## \[\d{2}:\d{2}\]([^\n]+)[\s\S]*?### 要約:([^\n]+)/g)
        if (topicsMatches && topicsMatches.length > 0) {
          const latestMatch = topicsMatches[topicsMatches.length - 1].match(/## \[\d{2}:\d{2}\]([^\n]+)[\s\S]*?### 要約:([^\n]+)/)
          if (latestMatch) {
            currentTopicSummary = `現在の議題: ${latestMatch[1].trim()}\n要約: ${latestMatch[2].trim()}`
          }
        }
      }
    }
    
    // リサーチプロンプトを構築（音声入力中の内容のみを使用）
    const researchPrompt = `${RESEARCH_ASSISTANT_PROMPT}

${currentTopicSummary ? `[CONTEXT: ${currentTopicSummary}]` : '[CONTEXT: 会議の議題情報は現在利用できません]'}

User Query: ${question}

${transcripts.length > 0 ? `【音声入力中の内容】\n${transcripts.join('\n')}\n` : ''}
`
    
    // デバッグ用ログ
    logger.info(`AI Research Debug:`, {
      query: question,
      contextAvailable: !!currentTopicSummary,
      sessionExists: !!session,
      sessionType: session?.type,
      startIndex: session?.startTranscriptIndex,
      differenceTranscripts: differenceTranscripts.length,
      voiceTranscripts: transcripts.length,
      transcriptsUsed: transcripts
    })
    
    const result = await enhancedService.generateResearch(
      question,
      {
        systemPrompt: RESEARCH_ASSISTANT_PROMPT,
        currentTopicSummary,
        meetingContext: {
          title: meeting.title,
          participants: meeting.participants,
          minutesContent: meeting.minutes?.content || '',
          transcriptsCount: meeting.transcripts.length
        },
        differenceTranscripts,
        enableWebSearch: settings.enableWebSearch ?? true,
        maxTokens: API_CONSTANTS.MAX_TOKENS.CONTENT_GENERATION,
        temperature: 0.7
      },
      {
        enableFallback: true,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          exponentialBackoff: true
        }
      }
    )
    const response = result.text
    
    // リサーチ処理が完了したらセッションを削除
    if (session) {
      aiAssistantSessions.delete(meetingId)
      logger.info(`AI Research session cleaned up for meeting: ${meetingId}`)
    }
    
    return { success: true, response }
  } catch (error) {
    logger.error('handleAiResearch error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'リサーチ処理中にエラーが発生しました' }
  }
}

// リサーチモードの更新ハンドラー
async function handleUpdateResearchMode(payload: { meetingId: string; enabled: boolean }): Promise<{ success: boolean; error?: string }> {
  const { meetingId, enabled } = payload
  
  if (!meetingId) {
    return { success: false, error: 'Meeting ID is required' }
  }
  
  try {
    // 設定を保存
    await chrome.storage.local.set({
      [`research_mode_${meetingId}`]: enabled
    })
    
    // 全タブに通知
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'RESEARCH_MODE_UPDATED',
            payload: { meetingId, enabled }
          }).catch(() => {})
        }
      })
    })
    
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ストレージ使用状況のチェック
async function checkStorageUsage(): Promise<{ used: number; total: number; percentage: number }> {
  const CHROME_STORAGE_QUOTA = 10 * 1024 * 1024 // 10MB
  
  try {
    const bytesInUse = await chrome.storage.local.getBytesInUse()
    const percentage = bytesInUse / CHROME_STORAGE_QUOTA
    
    logger.debug(`Storage usage: ${(bytesInUse / 1024 / 1024).toFixed(2)}MB / ${(CHROME_STORAGE_QUOTA / 1024 / 1024).toFixed(2)}MB (${(percentage * 100).toFixed(1)}%)`)
    
    // 警告レベルに達した場合
    if (percentage > STORAGE_WARNING_THRESHOLD) {
      logger.warn('Storage usage is high, consider cleanup')
      // Content Scriptに警告を送信
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'STORAGE_WARNING',
              payload: { percentage: percentage * 100 }
            }).catch(() => {})
          }
        })
      })
    }
    
    return {
      used: bytesInUse,
      total: CHROME_STORAGE_QUOTA,
      percentage
    }
  } catch (error) {
    logger.error('Failed to check storage usage:', error)
    return { used: 0, total: CHROME_STORAGE_QUOTA, percentage: 0 }
  }
}

// 定期的なストレージクリーンアップ
async function performStorageCleanup(): Promise<void> {
  logger.info('Performing scheduled storage cleanup')
  
  try {
    const storageInfo = await storageService.getStorageInfo()
    logger.info(`Storage info before cleanup: ${JSON.stringify(storageInfo)}`)
    
    // 古い会議データの削除（30日以上前）
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - TIMING_CONFIG.OLD_MEETING_RETENTION_DAYS)
    
    const meetings = await storageService.getMeetings()
    const oldMeetings = meetings.filter(m => {
      const meetingDate = m.startTime instanceof Date ? m.startTime : new Date(m.startTime || Date.now())
      return meetingDate < thirtyDaysAgo
    })
    
    for (const meeting of oldMeetings) {
      await storageService.deleteMeeting(meeting.id)
      logger.info(`Deleted old meeting: ${meeting.id}`)
    }
    
    // ストレージ情報を再チェック
    const newStorageInfo = await storageService.getStorageInfo()
    logger.info(`Storage info after cleanup: ${JSON.stringify(newStorageInfo)}`)
  } catch (error) {
    logger.error('Storage cleanup failed:', error)
  }
}

// 緊急クリーンアップ（ストレージがほぼ満杯の場合）
async function performEmergencyCleanup(): Promise<void> {
  logger.warn('Performing emergency storage cleanup')
  
  try {
    const meetings = await storageService.getMeetings()
    
    // 段階的なクリーンアップ戦略
    // 1. まず7日以上前の会議を削除
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const oldMeetings = meetings.filter(m => {
      const meetingDate = m.startTime instanceof Date ? m.startTime : new Date(m.startTime || Date.now())
      return meetingDate < sevenDaysAgo
    })
    
    if (oldMeetings.length > 0) {
      for (const meeting of oldMeetings) {
        await storageService.deleteMeeting(meeting.id)
        logger.info(`Emergency deleted old meeting: ${meeting.id}`)
      }
      
      // ストレージ再チェック
      const storageCheck = await checkStorageUsage()
      if (storageCheck.percentage < STORAGE_CRITICAL_THRESHOLD) {
        return // 十分な空き容量が確保できた
      }
    }
    
    // 2. それでも足りない場合は、最も古い会議から20%削除
    const remainingMeetings = await storageService.getMeetings()
    const deleteCount = Math.max(1, Math.floor(remainingMeetings.length * 0.2))
    
    const sortedMeetings = remainingMeetings.sort((a, b) => {
      const dateA = a.startTime instanceof Date ? a.startTime : new Date(a.startTime || Date.now())
      const dateB = b.startTime instanceof Date ? b.startTime : new Date(b.startTime || Date.now())
      return dateA.getTime() - dateB.getTime()
    })
    
    for (let i = 0; i < deleteCount && i < sortedMeetings.length; i++) {
      // 現在記録中の会議は削除しない
      if (sortedMeetings[i].id !== currentMeetingId) {
        await storageService.deleteMeeting(sortedMeetings[i].id)
        logger.info(`Emergency deleted meeting: ${sortedMeetings[i].id}`)
      }
    }
    
    // 3. 現在の会議の古い字幕も削除（500件を超える場合）
    if (currentMeetingId) {
      const currentMeeting = await storageService.getMeeting(currentMeetingId)
      if (currentMeeting && currentMeeting.transcripts.length > 500) {
        // 最新500件を保持
        currentMeeting.transcripts = currentMeeting.transcripts.slice(-500)
        await storageService.saveMeeting(currentMeeting)
        logger.info('Trimmed current meeting transcripts to last 500')
      }
    }
  } catch (error) {
    logger.error('Emergency cleanup failed:', error)
  }
}

// AIアシスタントのセッション管理（メモリリーク対策: 最大10セッションを保持）
const MAX_AI_SESSIONS = 10
const aiAssistantSessions = new Map<string, {
  meetingId: string
  actualMeetingId?: string  // 実際のミーティングID（currentMeetingIdと同じ）
  startTime: Date
  transcripts: Transcript[]
  type: 'nextsteps' | 'research'
  startTranscriptIndex: number  // 録音開始時の字幕インデックスを記録
}>()

// 古いセッションを定期的にクリーンアップ
setInterval(() => {
  if (aiAssistantSessions.size > MAX_AI_SESSIONS) {
    const sortedSessions = Array.from(aiAssistantSessions.entries())
      .sort((a, b) => a[1].startTime.getTime() - b[1].startTime.getTime())
    
    // 最も古いセッションから削除
    const deleteCount = aiAssistantSessions.size - MAX_AI_SESSIONS
    for (let i = 0; i < deleteCount; i++) {
      aiAssistantSessions.delete(sortedSessions[i][0])
      logger.info(`Cleaned up old AI session: ${sortedSessions[i][0]}`)
    }
  }
}, STORAGE_CONSTANTS.CLEANUP_INTERVAL) // 1分ごとにチェック

// 現在アクティブな音声記録セッション
let activeVoiceSession: { meetingId: string; type: 'nextsteps' | 'research' } | null = null

// AIアシスタント録音開始
async function handleAIAssistantStart(payload: { meetingId: string; type?: 'nextsteps' | 'research' }): Promise<{ success: boolean; error?: string }> {
  const { meetingId, type = 'nextsteps' } = payload
  
  if (!meetingId) {
    return { success: false, error: 'Meeting ID is required' }
  }
  
  // 他の音声記録セッションが実行中かチェック
  if (activeVoiceSession) {
    const sessionType = activeVoiceSession.type === 'nextsteps' ? 'ネクストステップ編集' : 'リサーチ'
    return { 
      success: false, 
      error: `他の音声記録（${sessionType}）が実行中です。先に停止してください。` 
    }
  }
  
  // 記録中のタブIDを取得
  const tabId = recordingTabId
  if (!tabId) {
    logger.error(`AI Assistant Start failed: No recording tab found for meetingId: ${meetingId}`)
    return { success: false, error: '記録中の会議が見つかりません' }
  }
  
  // currentMeetingIdを使用して実際のミーティングIDを取得
  const actualMeetingId = currentMeetingId || meetingId
  logger.info(`AI Assistant Start: requestedMeetingId=${meetingId}, currentMeetingId=${currentMeetingId}, actualMeetingId=${actualMeetingId}`)
  
  // Content Scriptに字幕チェックを依頼
  try {
    const response = await new Promise<{success: boolean; error?: string}>((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { type: 'CHECK_CAPTIONS' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve(response)
        }
      })
    })
    
    if (!response || !response.success) {
      return { 
        success: false, 
        error: '字幕が有効になっていません。Google Meetの字幕をONにしてから音声記録を開始してください。' 
      }
    }
  } catch (error) {
    logger.error('Failed to check captions:', error)
    return { 
      success: false, 
      error: '字幕の確認に失敗しました。Google Meetの字幕をONにしてから音声記録を開始してください。' 
    }
  }
  
  // 既存のセッションがある場合は削除
  if (aiAssistantSessions.has(meetingId)) {
    logger.warn('AI Assistant session already exists for this meeting, replacing it')
    aiAssistantSessions.delete(meetingId)
  }
  
  // 現在の会議の字幕数を取得して開始インデックスを記録
  let startTranscriptIndex = 0
  
  try {
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const currentMeeting = meetings.find(m => m.id === actualMeetingId)
    if (currentMeeting) {
      startTranscriptIndex = currentMeeting.transcripts.length
      logger.info(`AI Assistant Start - Recording starting at transcript index: ${startTranscriptIndex}`, {
        requestedMeetingId: meetingId,
        actualMeetingId,
        currentMeetingId,
        currentTranscriptsCount: currentMeeting.transcripts.length,
        lastTranscript: currentMeeting.transcripts[currentMeeting.transcripts.length - 1]
      })
    } else {
      logger.warn(`AI Assistant Start - Meeting not found for ID: ${actualMeetingId}`, {
        requestedMeetingId: meetingId,
        actualMeetingId,
        currentMeetingId,
        availableMeetings: meetings.map(m => m.id)
      })
    }
  } catch (error) {
    logger.error('Failed to get start transcript index:', error)
  }
  
  // 新しいセッションを開始
  aiAssistantSessions.set(meetingId, {
    meetingId,
    actualMeetingId, // 実際のミーティングID
    startTime: new Date(),
    transcripts: [],
    type,
    startTranscriptIndex
  })
  
  // アクティブセッションを記録
  activeVoiceSession = { meetingId, type }
  
  logger.info(`AI Assistant recording started for meeting: ${meetingId}, type: ${type}`)
  return { success: true }
}

// AIアシスタント録音停止
async function handleAIAssistantStop(payload: { meetingId: string }): Promise<{ success: boolean; error?: string; transcripts?: Transcript[] }> {
  const { meetingId } = payload
  
  if (!meetingId) {
    return { success: false, error: 'Meeting ID is required' }
  }
  
  const session = aiAssistantSessions.get(meetingId)
  if (!session) {
    return { success: false, error: 'No active AI Assistant session found' }
  }
  
  // セッション開始時からの差分字幕を取得
  let transcripts: Transcript[] = []
  
  // 実際のミーティングIDを使用（セッションに保存されている場合）
  const actualMeetingId = session.actualMeetingId || meetingId
  
  try {
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const currentMeeting = meetings.find(m => m.id === actualMeetingId)
    if (currentMeeting) {
      // 開始インデックスから現在までの字幕を取得（差分）
      transcripts = currentMeeting.transcripts.slice(session.startTranscriptIndex)
      logger.info(`AI Assistant Stop Debug:`, {
        requestedMeetingId: meetingId,
        actualMeetingId,
        sessionType: session.type,
        startIndex: session.startTranscriptIndex,
        currentTranscriptsLength: currentMeeting.transcripts.length,
        diffTranscriptsLength: transcripts.length,
        diffContent: transcripts.map(t => `${t.speaker}: ${t.content}`).slice(0, 3), // 最初の3件を表示
        allTranscriptsPreview: currentMeeting.transcripts.slice(-3).map(t => `${t.speaker}: ${t.content}`) // 最後の3件を表示
      })
      
      // セッションに差分字幕を保存（リサーチ時に使用するため）
      session.transcripts = transcripts
    }
  } catch (error) {
    logger.error('Failed to get transcript diff:', error)
    // エラーの場合はセッションに記録された字幕を使用
    transcripts = session.transcripts
  }
  
  logger.info(`AI Assistant recording stopped for meeting: ${meetingId}, returning ${transcripts.length} transcripts`)
  
  // セッションは削除せず、リサーチ処理後に削除する
  // aiAssistantSessions.delete(meetingId)
  
  // アクティブセッションをクリア
  if (activeVoiceSession?.meetingId === meetingId) {
    activeVoiceSession = null
  }
  
  logger.info(`AI Assistant recording stopped for meeting: ${meetingId}, recorded ${transcripts.length} transcripts`)
  return { success: true, transcripts }
}

// AIアシスタントで記録した内容を処理
async function handleAIAssistantProcess(payload: { meetingId: string; recordingDuration: number }): Promise<{ success: boolean; error?: string }> {
  const { meetingId, recordingDuration } = payload
  
  if (!meetingId) {
    return { success: false, error: 'Meeting ID is required' }
  }
  
  try {
    // 会議データを取得
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting) {
      return { success: false, error: 'Meeting not found' }
    }
    
    // AI処理用のセッション取得（既に削除されている可能性があるため、最近の字幕を使用）
    const recentTranscripts = meeting.transcripts.slice(-50) // 最近の50件の字幕を使用
    
    if (recentTranscripts.length === 0) {
      return { success: false, error: 'No transcripts available for processing' }
    }
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // EnhancedAIServiceを使用してネクストステップを更新
    const enhancedService = new EnhancedAIService(settings)
    
    // 録音された内容から指示を抽出
    const instructions = recentTranscripts
      .map(t => t.content)
      .join(' ')
    
    // 会議の文脈を最小化 - 指示に関連する部分のみを抽出
    let relevantContext = ''
    if (meeting.minutes) {
      // 議事録から関連箇所を簡潔に抽出
      const minutesContent = meeting.minutes.content
      
      // 現在の議題のみを抽出
      const currentTopicMatch = minutesContent.match(/## ライブダイジェスト\n### 要約: (.+)\n([\s\S]*?)(?=\n---|\n## |$)/)
      if (currentTopicMatch) {
        relevantContext = `現在の議題: ${currentTopicMatch[1]}\n`
      }
      
      // キーワードに基づいて関連部分を抽出
      const keywords = instructions.toLowerCase().split(/\s+/).filter(word => word.length > 3)
      if (keywords.length > 0) {
        const relevantLines = minutesContent.split('\n')
          .filter(line => keywords.some(keyword => line.toLowerCase().includes(keyword)))
          .slice(0, 5) // 最大5行まで
        
        if (relevantLines.length > 0) {
          relevantContext += '\n関連する議事録の内容:\n' + relevantLines.join('\n')
        }
      }
    }
    
    // プロンプトを構築（会議文脈を最小化）
    const prompt = `
以下の音声指示に基づいて、質問に答えるかリサーチを実行してください。

【音声指示内容】
${instructions}

${relevantContext ? `【関連する会議情報】\n${relevantContext}\n` : ''}

【回答形式】
質問に対して簡潔に回答してください。必要な場合のみ会議の文脈を参照してください。
`
    
    const response = await enhancedService.generateText(
      prompt,
      {
        maxTokens: API_CONSTANTS.MAX_TOKENS.CONTENT_GENERATION,
        temperature: 0.7
      },
      {
        enableFallback: true,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          exponentialBackoff: true
        }
      }
    )
    
    // レスポンスをviewerに通知
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id && tab.url?.includes('viewer.html')) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'AI_ASSISTANT_RESPONSE',
            payload: {
              meetingId,
              response,
              duration: recordingDuration
            }
          }).catch(() => {})
        }
      })
    })
    
    logger.info('AI Assistant processing completed')
    return { success: true }
  } catch (error) {
    logger.error('Error processing AI assistant:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// 音声指示によるネクストステップ更新
async function handleUpdateNextStepsFromVoice(payload: { meetingId: string; voiceInstructions: string }): Promise<{ success: boolean; error?: string }> {
  const { meetingId, voiceInstructions } = payload
  
  if (!meetingId || !voiceInstructions) {
    return { success: false, error: 'Meeting ID and voice instructions are required' }
  }
  
  try {
    // 会議データを取得
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meeting = meetings.find(m => m.id === meetingId)
    if (!meeting) {
      return { success: false, error: 'Meeting not found' }
    }
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // EnhancedAIServiceを使用してネクストステップを更新
    const enhancedService = new EnhancedAIService(settings)
    
    // プロンプトを構築
    const prompt = `
以下の音声指示に基づいて、ネクストステップリストを更新してください。

【音声指示】
${voiceInstructions}

【現在のネクストステップ】
${meeting.nextSteps?.map(ns => `- ${ns.task} (担当: ${ns.assignee || '未定'}, 期限: ${ns.dueDate ? new Date(ns.dueDate).toLocaleDateString('ja-JP') : '未定'})`).join('\n') || 'なし'}

【実行内容】
1. 新しいタスクの追加
2. 既存タスクの修正
3. 担当者や期限の更新
4. タスクの削除

指示に従って更新されたネクストステップリストをJSON形式で返してください。
`
    
    const updatedNextStepsJson = await enhancedService.generateText(
      prompt,
      {
        maxTokens: API_CONSTANTS.MAX_TOKENS.CONTENT_GENERATION,
        temperature: 0.3
      },
      {
        enableFallback: true,
        retryConfig: {
          maxRetries: 3,
          retryDelay: 1000,
          exponentialBackoff: true
        }
      }
    )
    
    // JSONをパース
    let updatedNextSteps
    try {
      updatedNextSteps = JSON.parse(updatedNextStepsJson)
    } catch (parseError) {
      // JSONパースエラーの場合は、AIに再度生成を依頼
      const retryPrompt = `${prompt}\n\n重要: 必ず有効なJSON形式で返してください。`
      const retryJson = await enhancedService.generateText(
        retryPrompt,
        {
          maxTokens: API_CONSTANTS.MAX_TOKENS.CONTENT_GENERATION,
          temperature: 0.3
        },
        {
          enableFallback: true,
          retryConfig: {
            maxRetries: 3,
            retryDelay: 1000,
            exponentialBackoff: true
          }
        }
      )
      updatedNextSteps = JSON.parse(retryJson)
    }
    
    // 会議データを更新
    meeting.nextSteps = updatedNextSteps
    
    // 保存
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ meetings }, () => {
        resolve()
      })
    })
    
    return { success: true }
  } catch (error) {
    logger.error('Error updating NextSteps from voice:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// 字幕更新時にAIアシスタントセッションにも記録
const originalHandleTranscriptUpdate = handleTranscriptUpdate
handleTranscriptUpdate = async function(payload: any): Promise<void> {
  // 元の処理を実行
  await originalHandleTranscriptUpdate(payload)
  
  // AIアシスタントセッションがある場合は字幕を記録（アクティブなセッションのみ）
  if (activeVoiceSession && activeVoiceSession.meetingId === currentMeetingId) {
    const session = aiAssistantSessions.get(currentMeetingId)
    if (session && payload?.transcript) {
      session.transcripts.push({
        ...payload.transcript,
        timestamp: new Date()
      })
    }
  }
}