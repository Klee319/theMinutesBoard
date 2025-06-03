import { ChromeMessage, MessageType, StorageData, Meeting, UserSettings } from '@/types'
import { geminiService } from '@/services/gemini'
import { AIServiceFactory } from '@/services/ai/factory'

let currentMeetingId: string | null = null
let recordingTabId: number | null = null

// 議事録生成の排他制御
let isMinutesGenerating = false

// 起動時に前回の状態を確認
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['currentMeetingId'], (result) => {
    if (result.currentMeetingId) {
      // 前回のセッションが残っている場合はクリア
      chrome.storage.local.remove(['currentMeetingId'])
    }
  })
})

chrome.runtime.onMessage.addListener((message: ChromeMessage, sender, sendResponse) => {
  console.log('Background received message:', message)
  
  try {
    switch (message.type) {
      case 'START_RECORDING':
        handleStartRecording(sender.tab?.id)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error('Error starting recording:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'STOP_RECORDING':
        handleStopRecording()
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error('Error stopping recording:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'TRANSCRIPT_UPDATE':
        handleTranscriptUpdate(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch(error => {
            console.error('Error updating transcript:', error)
            sendResponse({ success: false, error: error.message })
          })
        return true
        
      case 'GENERATE_MINUTES':
        handleGenerateMinutes()
          .then(result => sendResponse(result))
          .catch(error => {
            console.error('Error generating minutes:', error)
            sendResponse({ success: false, error: error.message })
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
        
      default:
        sendResponse({ success: false, error: 'Unknown message type' })
        return false
    }
  } catch (error) {
    console.error('Unexpected error in background script:', error)
    sendResponse({ success: false, error: 'Unexpected error occurred' })
    return false
  }
})

async function handleStartRecording(tabId?: number): Promise<void> {
  if (!tabId) {
    throw new Error('No tab ID provided')
  }
  
  // 既に記録中の場合は新しい記録を開始しない
  if (currentMeetingId && recordingTabId === tabId) {
    console.log('Already recording in this tab')
    return
  }
  
  currentMeetingId = generateMeetingId()
  recordingTabId = tabId
  
  const newMeeting: Meeting = {
    id: currentMeetingId,
    title: `Meeting ${new Date().toLocaleString('ja-JP')}`,
    startTime: new Date(),
    participants: [],
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
  
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(['meetings'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
      const meetingIndex = meetings.findIndex(m => m.id === currentMeetingId)
      
      if (meetingIndex !== -1) {
        meetings[meetingIndex].endTime = new Date()
        chrome.storage.local.set({ meetings }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
          } else {
            console.log('Recording stopped:', currentMeetingId)
            currentMeetingId = null
            recordingTabId = null
            chrome.storage.local.remove(['currentMeetingId'])
            resolve()
          }
        })
      } else {
        currentMeetingId = null
        recordingTabId = null
        resolve()
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

  return new Promise(async (resolve) => {
    isMinutesGenerating = true // 生成開始をマーク
    
    chrome.storage.local.get(['meetings', 'settings'], async (result) => {
      if (chrome.runtime.lastError) {
        isMinutesGenerating = false
        resolve({ success: false, error: chrome.runtime.lastError.message })
        return
      }
      
      const meetings: Meeting[] = result.meetings || []
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
      
      if (!result.settings) {
        resolve({ success: false, error: 'AI設定が設定されていません' })
        return
      }

      // AIプロバイダーとAPIキーの検証
      if (!AIServiceFactory.validateProviderSettings(result.settings)) {
        const provider = result.settings.aiProvider || 'gemini'
        resolve({ success: false, error: `${provider} APIキーが設定されていません` })
        return
      }
      
      try {
        // 選択されたAIサービスを作成
        const aiService = AIServiceFactory.createService(result.settings)
        
        // 議事録を生成
        const minutes = await aiService.generateMinutes(
          currentMeeting.transcripts,
          result.settings
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