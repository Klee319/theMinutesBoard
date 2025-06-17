import { ChromeMessage, MessageType, StorageData, Meeting, UserSettings } from '@/types'
import { geminiService } from '@/services/gemini'
import { AIServiceFactory } from '@/services/ai/factory'
import { debugStorageInfo } from './debug'
import { CHAT_ASSISTANT_PROMPT } from '@/system-prompts'
import { logger } from '@/utils/logger'

let currentMeetingId: string | null = null
let recordingTabId: number | null = null

// 議事録生成の排他制御
let isMinutesGenerating = false

// 拡張機能のインストール・更新時の処理
chrome.runtime.onInstalled.addListener((details) => {
  logger.info('Extension installed/updated:', details.reason)
  
  // データの整合性チェック
  chrome.storage.local.get(['meetings'], (result) => {
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
  })
})

// 起動時に前回の状態を確認
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['currentMeetingId', 'meetings'], (result) => {
    logger.info('Extension startup - Current meetings count:', result.meetings?.length || 0)
    if (result.currentMeetingId) {
      // 前回のセッションが残っている場合はクリア
      chrome.storage.local.remove(['currentMeetingId'])
    }
    // デバッグ情報を出力
    if (logger.isDevelopment) {
      debugStorageInfo()
    }
  })
})

chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
  logger.debug('Background received message:', message.type)
  
  try {
    switch (message.type) {
      case 'START_RECORDING':
        handleStartRecording(sender.tab?.id, message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            logger.logError(error, 'START_RECORDING')
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

async function handleStartRecording(tabId?: number, payload?: any): Promise<void> {
  if (!tabId) {
    throw new Error('No tab ID provided')
  }
  
  // 既に記録中の場合は新しい記録を開始しない
  if (currentMeetingId && recordingTabId === tabId) {
    logger.debug('Already recording in this tab')
    return
  }
  
  currentMeetingId = generateMeetingId()
  recordingTabId = tabId
  
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
  if (!currentMeetingId) {
    console.log('No active recording for transcript update')
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
        meetings[meetingIndex].transcripts.push({
          ...transcript,
          id: generateTranscriptId(),
          meetingId: currentMeetingId,
          timestamp: new Date()
        })
        
        const participants = new Set(meetings[meetingIndex].participants)
        participants.add(transcript.speaker)
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

async function handleGenerateMinutes(): Promise<any> {
  // 既に議事録生成中の場合は待機
  if (isMinutesGenerating) {
    return { success: false, error: '議事録を生成中です。しばらくお待ちください。' }
  }

  try {
    isMinutesGenerating = true // 生成開始をマーク
    
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
          
          if (currentMeeting.transcripts.length === 0) {
            isMinutesGenerating = false
            resolve({ success: false, error: 'まだ発言が記録されていません' })
            return
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
        
            // 議事録を生成（会議の時刻情報を含める）
            const minutes = await aiService.generateMinutes(
              currentMeeting.transcripts,
              mergedSettings,
          {
            startTime: new Date(currentMeeting.startTime),
            endTime: currentMeeting.endTime ? new Date(currentMeeting.endTime) : new Date()
          }
        )
        
        // 生成された議事録を保存
        const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
        if (meetingIndex !== -1) {
          meetings[meetingIndex].minutes = minutes
          
          chrome.storage.local.set({ meetings }, () => {
            isMinutesGenerating = false // 生成完了をマーク
            
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message })
            } else {
              // Content Scriptに議事録生成完了を通知
              if (recordingTabId) {
                chrome.tabs.sendMessage(recordingTabId, {
                  type: 'MINUTES_GENERATED',
                  payload: {
                    meetingId: currentMeetingId,
                    minutes
                  }
                })
              }
              
              resolve({ success: true, minutes })
            }
          })
        }
          } catch (error: any) {
            console.error('Error generating minutes:', error)
            isMinutesGenerating = false // エラー時も生成完了をマーク
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
    const nextSteps = await aiService.generateNextSteps(meeting, userPrompt)
    
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
${meeting.minutes?.content || '（議事録がまだ生成されていません）'}

【最近の発言履歴】
${meeting.transcripts.slice(-10).map(t => `${t.speaker}: ${t.content}`).join('\n')}

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