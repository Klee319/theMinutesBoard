import { ChromeMessage, MessageType, StorageData, Meeting, UserSettings, SharedState } from '@/types'
import { geminiService } from '@/services/gemini'
import { AIServiceFactory } from '@/services/ai/factory'
import { debugStorageInfo } from './debug'
import { CHAT_ASSISTANT_PROMPT } from '@/system-prompts'
import { logger } from '@/utils/logger'
import { storageService } from '@/services/storage'
import { SessionRecovery } from '@/utils/session-recovery'

let currentMeetingId: string | null = null
let recordingTabId: number | null = null

// 議事録生成の排他制御
let isMinutesGenerating = false

// ストレージ管理用の定数
const STORAGE_WARNING_THRESHOLD = 0.7 // 70%使用で警告
const STORAGE_CRITICAL_THRESHOLD = 0.85 // 85%使用でクリティカル
const MAX_TRANSCRIPTS_PER_MEETING = 1000 // 1会議あたりの最大字幕数
const TRANSCRIPT_BATCH_SIZE = 50 // バッチ処理する字幕の数

// 共有状態
let sharedState: SharedState = {
  isRecording: false,
  currentMeetingId: null,
  isMinutesGenerating: false,
  hasMinutes: false,
  recordingTabId: null,
  lastUpdate: new Date()
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
  
  // 25秒ごとにアラームを設定（Service Workerは30秒で非アクティブになるため）
  chrome.alarms.create('keep-alive', { periodInMinutes: 0.4 }) // 24秒
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
chrome.alarms.create('storage-cleanup', { periodInMinutes: 30 }) // 30分ごと

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
        handleGenerateMinutes()
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
            console.error('Error exporting minutes:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'OPEN_VIEWER_TAB':
        handleOpenViewerTab(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error opening viewer tab:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'FOCUS_TAB':
        handleFocusTab(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error focusing tab:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true

      case 'CALL_ENDED':
        handleCallEnded(message.reason || 'Unknown', message.timestamp || new Date().toISOString(), sender.tab?.id)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error handling call end:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'GENERATE_NEXTSTEPS':
        handleGenerateNextSteps(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error generating next steps:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'UPDATE_NEXTSTEP':
        handleUpdateNextStep(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error updating next step:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'DELETE_NEXTSTEP':
        handleDeleteNextStep(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error deleting next step:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'PARTICIPANT_UPDATE':
        handleParticipantUpdate(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error('Error updating participant:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'CHAT_MESSAGE':
        handleChatMessage(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error handling chat message:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'AI_EDIT_MINUTES':
        handleAiEditMinutes(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error handling AI edit minutes:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'AI_RESEARCH':
        handleAiResearch(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error handling AI research:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'UPDATE_RESEARCH_MODE':
        handleUpdateResearchMode(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error updating research mode:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'REQUEST_STATE_SYNC':
        // 現在の状態を送信
        sendResponse({ success: true, state: sharedState })
        return false
        
      case 'AI_ASSISTANT_START':
        handleAIAssistantStart(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error starting AI assistant:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'AI_ASSISTANT_STOP':
        handleAIAssistantStop(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error stopping AI assistant:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'AI_ASSISTANT_PROCESS':
        handleAIAssistantProcess(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error processing AI assistant:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'UPDATE_NEXTSTEPS_FROM_VOICE':
        handleUpdateNextStepsFromVoice(message.payload)
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error updating nextsteps from voice:', error)
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
    const response = await new Promise((resolve, reject) => {
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
          console.log('Recording started:', currentMeetingId)
          console.log('Initial participants:', newMeeting.participants)
          console.log('Total meetings after save:', meetings.length)
          // ストレージ容量を確認
          chrome.storage.local.getBytesInUse(['meetings'], (bytesInUse) => {
            console.log('Storage used for meetings:', bytesInUse, 'bytes')
          })
          resolve()
        }
      })
    })
  })
}

async function handleStopRecording(): Promise<void> {
  if (!currentMeetingId) {
    console.log('No active recording to stop')
    return
  }
  
  const stoppedMeetingId = currentMeetingId
  const stoppedTabId = recordingTabId
  
  // キープアライブを停止
  onRecordingStopped()
  
  // 状態を更新
  await updateSharedState({
    isRecording: false,
    currentMeetingId: null,
    recordingTabId: null
  })
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['meetings'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
      const meetingIndex = meetings.findIndex(m => m.id === stoppedMeetingId)
      
      if (meetingIndex !== -1) {
        meetings[meetingIndex].endTime = new Date()
        chrome.storage.local.set({ meetings }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            console.log('Recording stopped:', stoppedMeetingId)
            currentMeetingId = null
            recordingTabId = null
            chrome.storage.local.remove(['currentMeetingId'], () => {
              // 全てのGoogle Meetタブに停止完了を通知
              chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
                tabs.forEach(tab => {
                  if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, {
                      type: 'RECORDING_STOPPED',
                      payload: { meetingId: stoppedMeetingId }
                    }).catch(() => {
                      // エラーは無視（タブが閉じられている可能性）
                    })
                  }
                })
              })
              resolve()
            })
          }
        })
      } else {
        currentMeetingId = null
        recordingTabId = null
        chrome.storage.local.remove(['currentMeetingId'], () => {
          resolve()
        })
      }
    })
  })
}

async function handleTranscriptUpdate(transcript: any): Promise<void> {
  console.log('[TRANSCRIPT DEBUG] Received transcript:', transcript)
  
  if (!currentMeetingId) {
    console.log('[TRANSCRIPT DEBUG] No active recording (currentMeetingId is null)')
    return
  }
  
  console.log('[TRANSCRIPT DEBUG] Current meeting ID:', currentMeetingId)
  
  return new Promise(async (resolve, reject) => {
    chrome.storage.local.get(['meetings'], async (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
      const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
      
      if (meetingIndex !== -1) {
        // 字幕数の制限チェック
        if (meetings[meetingIndex].transcripts.length >= MAX_TRANSCRIPTS_PER_MEETING) {
          logger.warn(`Transcript limit reached for meeting ${currentMeetingId}`)
          // 古い字幕を削除（最初の30%を削除）
          const removeCount = Math.floor(MAX_TRANSCRIPTS_PER_MEETING * 0.3)
          meetings[meetingIndex].transcripts.splice(0, removeCount)
          logger.info(`Removed ${removeCount} old transcripts`)
        }
        
        meetings[meetingIndex].transcripts.push({
          ...transcript,
          id: generateTranscriptId(),
          meetingId: currentMeetingId,
          timestamp: new Date()
        })
        
        const participants = new Set(meetings[meetingIndex].participants)
        participants.add(transcript.speaker)
        meetings[meetingIndex].participants = Array.from(participants)
        
        // AIアシスタントセッションにも字幕を追加
        if (currentMeetingId && aiAssistantSessions.has(currentMeetingId)) {
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

async function handleGenerateMinutes(): Promise<any> {
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
            console.error('Invalid meetings data:', localResult.meetings)
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
          
          // デバッグ: 文字起こしデータの内容を確認
          console.log('[BACKGROUND DEBUG] Meeting ID:', currentMeetingId)
          console.log('[BACKGROUND DEBUG] Transcripts count:', currentMeeting.transcripts.length)
          if (currentMeeting.transcripts.length > 0) {
            console.log('[BACKGROUND DEBUG] First transcript:', currentMeeting.transcripts[0])
            console.log('[BACKGROUND DEBUG] Last transcript:', currentMeeting.transcripts[currentMeeting.transcripts.length - 1])
          }
          
          if (currentMeeting.transcripts.length === 0) {
            isMinutesGenerating = false
            resolve({ success: false, error: 'まだ発言が記録されていません' })
            return
          }
          
          // 字幕が異常に多い場合のみ警告
          if (currentMeeting.transcripts.length > 1000) {
            console.warn('Large number of transcripts:', {
              count: currentMeeting.transcripts.length,
              totalCharacters: currentMeeting.transcripts.reduce((sum, t) => sum + (t.content || '').length, 0)
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
            // 選択されたAIサービスを作成
            const aiService = AIServiceFactory.createService(mergedSettings)
        
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
            console.log(`Generating minutes: ${currentMeeting.transcripts.length} transcripts, provider: ${mergedSettings.aiProvider || 'default'}`)
            
            // 議事録を生成（会議の時刻情報を含める）
            const minutes = await aiService.generateMinutes(
              currentMeeting.transcripts,
              mergedSettings,
              {
                startTime,
                endTime
              }
            )
        
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
              
              resolve({ success: true, minutes })
            }
          })
        }
          } catch (error: any) {
            console.error('Error generating minutes:', error)
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
    console.error('Unexpected error in handleGenerateMinutes:', error)
    isMinutesGenerating = false
    return { success: false, error: 'Unexpected error occurred' }
  } finally {
    // タイムアウト保護: 30秒後に必ずフラグをリセット
    setTimeout(() => {
      if (isMinutesGenerating) {
        console.warn('Resetting isMinutesGenerating flag due to timeout')
        isMinutesGenerating = false
      }
    }, 30000)
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
    console.log('No active recording for participant update')
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
          console.log(`Participant joined: ${payload.participant}`)
          
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
          console.log(`Participant left: ${payload.participant}`)
          
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
  console.log('Call ended detected in background:', { reason, timestamp, tabId, currentMeetingId, recordingTabId })
  
  // 現在記録中の会議があり、該当タブからの通知の場合のみ処理
  if (!currentMeetingId || (tabId && tabId !== recordingTabId)) {
    console.log('No active recording or tab mismatch, ignoring call end')
    return { success: true }
  }
  
  try {
    // 会議終了時刻を記録
    const meetings = await new Promise<Meeting[]>((resolve) => {
      chrome.storage.local.get(['meetings'], (result) => {
        resolve(result.meetings || [])
      })
    })
    
    const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
    if (meetingIndex !== -1) {
      meetings[meetingIndex].endTime = new Date(timestamp)
      meetings[meetingIndex].callEndReason = reason
      
      // 会議データを保存
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ meetings }, () => {
          resolve()
        })
      })
      
      console.log('Meeting end time updated:', meetings[meetingIndex])
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
    
    console.log('Call end handling completed successfully')
    return { success: true }
    
  } catch (error) {
    console.error('Error handling call end:', error)
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
    
    // 設定を取得
    const settings = await new Promise<UserSettings>((resolve) => {
      chrome.storage.local.get(['settings'], (result) => {
        resolve(result.settings || {})
      })
    })
    
    // AIサービスを使用してネクストステップを生成
    const aiService = AIServiceFactory.createService(settings)
    const nextSteps = await aiService.generateNextSteps(meeting, userPrompt, settings.userName)
    
    // 生成されたネクストステップを会議データに追加
    meeting.nextSteps = nextSteps
    
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
        payload: { meetingId, nextSteps }
      })
    }
    
    return { success: true, nextSteps }
  } catch (error) {
    console.error('Error generating next steps:', error)
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
    console.error('Error updating next step:', error)
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
    console.error('Error deleting next step:', error)
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
    
    // AIサービスを使用してチャット応答を生成
    const aiService = AIServiceFactory.createService(settings)
    
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
    const response = await aiService.sendChatMessage(message, chatContext)
    
    return { success: true, response }
  } catch (error) {
    console.error('Error handling chat message:', error)
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
    
    // AIサービスを使用して議事録を編集
    const aiService = AIServiceFactory.createService(settings)
    
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
    
    const editedContent = await aiService.generateText(editPrompt, {
      maxTokens: 4000,
      temperature: 0.3
    })
    
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
    console.error('Error handling AI edit minutes:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

async function handleAiResearch(payload: { meetingId: string; question: string; transcripts: string[] }): Promise<{ success: boolean; response?: string; error?: string }> {
  const { meetingId, question, transcripts } = payload
  
  if (!meetingId || !question) {
    return { success: false, error: 'Meeting ID and question are required' }
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
    
    // AIサービスを使用してリサーチ応答を生成
    const aiService = AIServiceFactory.createService(settings)
    
    // コンテクストの最適化: 議事録から関連部分のみを抽出
    let relevantMinutesContent = ''
    if (meeting.minutes?.content) {
      const minutesContent = meeting.minutes.content
      
      // 議事録のサイズをチェック（200KB制限）
      const MAX_MINUTES_SIZE = 200 * 1024 // 200KB
      if (minutesContent.length > MAX_MINUTES_SIZE) {
        // 大きすぎる場合は、ライブダイジェストと最新の議題のみを抽出
        const liveDigestMatch = minutesContent.match(/## ライブダイジェスト[\s\S]*?(?=\n---\n\n##|$)/)
        const topicsMatches = minutesContent.match(/## \[\d{2}:\d{2}\].*?[\s\S]*?(?=\n---\n\n##|$)/g)
        
        relevantMinutesContent = '【議事録（要約版）】\n'
        if (liveDigestMatch) {
          relevantMinutesContent += liveDigestMatch[0] + '\n\n'
        }
        if (topicsMatches && topicsMatches.length > 0) {
          // 最新の3つの議題のみを含める
          const recentTopics = topicsMatches.slice(-3)
          relevantMinutesContent += '【最近の議題】\n' + recentTopics.join('\n---\n\n')
        }
      } else {
        relevantMinutesContent = minutesContent
      }
    } else {
      relevantMinutesContent = '（議事録がまだ生成されていません）'
    }
    
    // 関連する発言を質問に基づいて抽出（最大20件）
    const relevantTranscripts = meeting.transcripts
      .filter(t => {
        const lowerContent = t.content.toLowerCase()
        const lowerQuestion = question.toLowerCase()
        const keywords = lowerQuestion.split(/\s+/).filter(word => word.length > 2)
        return keywords.some(keyword => lowerContent.includes(keyword))
      })
      .slice(-20)
    
    // 関連発言がない場合は最新の発言を使用
    const transcriptsToUse = relevantTranscripts.length > 0 
      ? relevantTranscripts 
      : meeting.transcripts.slice(-15)
    
    // リサーチプロンプトを構築
    const researchPrompt = `
以下の質問について、会議の内容と文脈を踏まえて詳しく回答してください。

【質問】
${question}

【音声入力内容】
${transcripts.join('\n')}

【会議情報】
- タイトル: ${meeting.title}
- 参加者: ${meeting.participants.join(', ')}
- 発言数: ${meeting.transcripts.length}件

【議事録】
${relevantMinutesContent}

【関連する発言履歴】
${transcriptsToUse.map(t => `${t.speaker}: ${t.content}`).join('\n')}

【回答方針】
1. 会議の内容に基づいて具体的に回答する
2. 関連する発言や決定事項があれば引用する
3. 不明な点は正直に「会議では言及されていません」と伝える
4. 必要に応じて追加の質問や提案をする
5. 簡潔で分かりやすい回答を心がける

質問に対する回答をお願いします。
`
    
    const response = await aiService.generateText(researchPrompt, {
      maxTokens: 2000,
      temperature: 0.7
    })
    
    return { success: true, response }
  } catch (error) {
    console.error('Error handling AI research:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
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
    console.error('Error updating research mode:', error)
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
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    
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
  startTime: Date
  transcripts: Transcript[]
  type: 'nextsteps' | 'research'
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
}, 60000) // 1分ごとにチェック

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
  
  // 既存のセッションがある場合は削除
  if (aiAssistantSessions.has(meetingId)) {
    logger.warn('AI Assistant session already exists for this meeting, replacing it')
    aiAssistantSessions.delete(meetingId)
  }
  
  // 新しいセッションを開始
  aiAssistantSessions.set(meetingId, {
    meetingId,
    startTime: new Date(),
    transcripts: [],
    type
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
  
  // セッションを終了して記録された字幕を返す
  const transcripts = session.transcripts
  aiAssistantSessions.delete(meetingId)
  
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
    
    // AIサービスを使用してネクストステップを更新
    const aiService = AIServiceFactory.createService(settings)
    
    // 録音された内容から指示を抽出
    const instructions = recentTranscripts
      .map(t => t.content)
      .join(' ')
    
    // プロンプトを構築
    const prompt = `
以下の音声指示に基づいて、ネクストステップの編集やリサーチを実行してください。

【音声指示内容】
${instructions}

【現在のネクストステップ】
${meeting.nextSteps?.map(ns => `- ${ns.task} (担当: ${ns.assignee || '未定'}, 期限: ${ns.dueDate ? new Date(ns.dueDate).toLocaleDateString('ja-JP') : '未定'})`).join('\n') || 'なし'}

【実行内容】
1. 指示に従ってネクストステップを編集する場合：
   - 新しいタスクの追加
   - 既存タスクの修正
   - 担当者や期限の更新
   - タスクの削除

2. リサーチや調査を求められた場合：
   - 会議内容から関連情報を抽出
   - 質問に対する回答を提供

【回答形式】
実行した内容と結果を簡潔に説明してください。
`
    
    const response = await aiService.generateText(prompt, {
      maxTokens: 2000,
      temperature: 0.7
    })
    
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
    
    // AIサービスを使用してネクストステップを更新
    const aiService = AIServiceFactory.createService(settings)
    
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
    
    const updatedNextStepsJson = await aiService.generateText(prompt, {
      maxTokens: 2000,
      temperature: 0.3
    })
    
    // JSONをパース
    let updatedNextSteps
    try {
      updatedNextSteps = JSON.parse(updatedNextStepsJson)
    } catch (parseError) {
      // JSONパースエラーの場合は、AIに再度生成を依頼
      const retryPrompt = `${prompt}\n\n重要: 必ず有効なJSON形式で返してください。`
      const retryJson = await aiService.generateText(retryPrompt, {
        maxTokens: 2000,
        temperature: 0.3
      })
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
  
  // AIアシスタントセッションがある場合は字幕を記録
  if (currentMeetingId) {
    const session = aiAssistantSessions.get(currentMeetingId)
    if (session && payload?.transcript) {
      session.transcripts.push({
        ...payload.transcript,
        timestamp: new Date()
      })
    }
  }
}