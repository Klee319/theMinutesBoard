import React, { useState, useEffect } from 'react'
import { Meeting, StorageData, Minutes } from '@/types'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { ClearStorageButton } from './ClearStorageButton'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [currentMeeting, setCurrentMeeting] = useState<Meeting | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [isInMeet, setIsInMeet] = useState(false)
  const [aiProvider, setAiProvider] = useState<string>('gemini')
  const [isMinutesGenerating, setIsMinutesGenerating] = useState(false)
  const [captionError, setCaptionError] = useState(false)
  
  useEffect(() => {
    loadData()
    checkCurrentTab()
    
    // 初回の状態同期リクエスト
    ChromeErrorHandler.sendMessage({ type: 'REQUEST_STATE_SYNC' })
      .then(response => {
        if (response?.success && response.state) {
          setIsRecording(response.state.isRecording)
          setIsMinutesGenerating(response.state.isMinutesGenerating)
        }
      })
      .catch(error => {
        console.error('Failed to sync state:', error)
      })
    
    // 状態同期のリスナーを設定
    const handleMessage = (message: any) => {
      switch (message.type) {
        case 'STATE_SYNC':
          setIsRecording(message.payload.isRecording)
          setIsMinutesGenerating(message.payload.isMinutesGenerating)
          if (message.payload.currentMeetingId !== currentMeeting?.id) {
            loadData() // 会議IDが変わった場合はデータを再読み込み
          }
          break
        case 'MINUTES_GENERATION_STARTED':
          setIsMinutesGenerating(true)
          break
        case 'MINUTES_GENERATED':
        case 'MINUTES_GENERATION_FAILED':
          setIsMinutesGenerating(false)
          loadData() // 議事録が生成されたらデータを再読み込み
          break
      }
    }
    
    chrome.runtime.onMessage.addListener(handleMessage)
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [])
  
  const loadData = async () => {
    chrome.storage.local.get(['meetings', 'settings', 'currentMeetingId'], (result) => {
      const meetings = result.meetings || []
      
      if (result.currentMeetingId) {
        const current = meetings.find((m: Meeting) => m.id === result.currentMeetingId)
        if (current && !current.endTime) {
          setCurrentMeeting(current)
          setIsRecording(true)
        } else {
          setCurrentMeeting(null)
          setIsRecording(false)
        }
      } else {
        setCurrentMeeting(null)
        setIsRecording(false)
      }
      
      // AIプロバイダーに応じて適切なAPIキーを確認
      if (result.settings) {
        const provider = result.settings.aiProvider || 'gemini'
        setAiProvider(provider)
        let hasKey = false
        switch (provider) {
          case 'gemini':
            hasKey = !!result.settings.apiKey
            break
          case 'openai':
            hasKey = !!result.settings.openaiApiKey
            break
          case 'claude':
            hasKey = !!result.settings.claudeApiKey
            break
          case 'openrouter':
            hasKey = !!result.settings.openrouterApiKey
            break
          default:
            hasKey = !!result.settings.apiKey
        }
        setHasApiKey(hasKey)
      } else {
        setHasApiKey(false)
      }
    })
  }
  
  const checkCurrentTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const inMeet = !!(tab?.url?.includes('meet.google.com'))
      setIsInMeet(inMeet)
      
      if (inMeet && tab.id) {
        ChromeErrorHandler.sendMessageToTab(tab.id, { type: 'GET_RECORDING_STATUS' })
          .then(response => {
            if (response?.isRecording !== undefined) {
              setIsRecording(response.isRecording)
            }
          })
          .catch(error => {
            console.log('Content script not ready:', error)
          })
      }
    } catch (error) {
      console.error('Error checking tab:', error)
    }
  }
  
  const handleToggleRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url?.includes('meet.google.com')) {
      alert('Google Meetのタブで実行してください')
      return
    }
    
    if (!tab.id) return
    
    // 記録を開始する前に字幕の状態をチェック
    if (!isRecording) {
      try {
        const captionStatus = await ChromeErrorHandler.sendMessageToTab(tab.id, { type: 'CHECK_CAPTIONS' })
        if (!captionStatus?.hasCaptions) {
          setCaptionError(true)
          // エラー表示を3秒後に自動的に消す
          setTimeout(() => setCaptionError(false), 3000)
          return
        }
      } catch (error) {
        // エラーの場合は静かに続行（字幕チェックが失敗しても記録は可能）
      }
    }
    
    const messageType = isRecording ? 'STOP_RECORDING' : 'START_RECORDING'
    ChromeErrorHandler.sendMessageToTab(tab.id, { type: messageType })
      .then(response => {
        if (response?.success) {
          setIsRecording(!isRecording)
          setTimeout(loadData, 500)
        }
      })
      .catch(error => {
        console.error('Error sending message:', error)
        alert(ChromeErrorHandler.getUserFriendlyMessage(error))
      })
  }
  
  const handleGenerateMinutes = async () => {
    if (!hasApiKey) {
      chrome.runtime.openOptionsPage()
      return
    }
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url?.includes('meet.google.com') || !tab.id) {
      alert('Google Meetのタブで実行してください')
      return
    }
    
    ChromeErrorHandler.sendMessageToTab(tab.id, { type: 'GENERATE_MINUTES' })
      .then(response => {
        if (!response?.success) {
          alert('エラー: ' + (response?.error || '議事録の生成に失敗しました'))
        }
      })
      .catch(error => {
        console.error('Error sending message:', error)
        alert(ChromeErrorHandler.getUserFriendlyMessage(error))
      })
  }
  
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage()
  }
  
  
  const formatDuration = (start: Date, end?: Date) => {
    const startTime = new Date(start).getTime()
    const endTime = end ? new Date(end).getTime() : Date.now()
    const duration = Math.floor((endTime - startTime) / 1000)
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    return hours > 0 ? `${hours}時間${minutes}分` : `${minutes}分`
  }
  
  return (
    <div className="w-full min-w-[320px] max-w-[400px] p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg md:text-xl font-bold text-gray-800">theMinutesBoard</h1>
        <button
          onClick={handleOpenOptions}
          className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium"
          title="設定"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>設定</span>
        </button>
      </div>
      
      {!hasApiKey ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-yellow-600 text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-sm text-yellow-800 font-medium">
                {aiProvider === 'gemini' && 'Gemini'}
                {aiProvider === 'openai' && 'OpenAI'}
                {aiProvider === 'claude' && 'Claude'}
                {aiProvider === 'openrouter' && 'OpenRouter'} APIキーが設定されていません
              </p>
              <button 
                onClick={handleOpenOptions}
                className="text-yellow-900 underline text-sm font-medium mt-1"
              >
                設定画面でAPIキーを入力する →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-lg">✓</span>
            <p className="text-sm text-green-800">
              {aiProvider === 'gemini' && 'Gemini'}
              {aiProvider === 'openai' && 'OpenAI'}
              {aiProvider === 'claude' && 'Claude'}
              {aiProvider === 'openrouter' && 'OpenRouter'} APIキーが設定済み
            </p>
          </div>
        </div>
      )}
      
      {captionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-red-600 text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-sm text-red-800 font-medium">
                字幕が有効になっていません
              </p>
              <p className="text-xs text-red-700 mt-1">
                Google Meetの「CC」ボタンから字幕をオンにしてください
              </p>
            </div>
          </div>
        </div>
      )}
      
      {isInMeet ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 text-lg">📹</span>
            <div className="flex-1">
              <p className="text-sm text-blue-800 font-medium">
                Google Meetに参加中
              </p>
              <p className="text-xs text-blue-700 mt-1">
                Meet画面のコントロールパネルから操作してください
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-lg">📹</span>
            <p className="text-sm text-gray-700">
              Google Meetに参加してから使用してください
            </p>
          </div>
        </div>
      )}
      
      {currentMeeting && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">記録中</span>
            <span className="text-xs text-blue-700">
              {formatDuration(currentMeeting.startTime)}
            </span>
          </div>
          <p className="text-xs text-blue-700 mt-1">
            参加者: {currentMeeting.participants.length}名
          </p>
        </div>
      )}
      
      <div className="border-t pt-3 space-y-3">
        <button
          onClick={() => {
            const url = chrome.runtime.getURL('src/viewer/viewer.html?mode=history')
            chrome.tabs.create({ url })
          }}
          className="w-full px-4 py-2 md:py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 font-medium text-sm md:text-base"
        >
          <span>📋</span>
          <span>履歴・ToDo確認</span>
        </button>
        
        <ClearStorageButton />
      </div>
    </div>
  )
}

export default App