import React, { useState, useEffect } from 'react'
import { Meeting, StorageData, Minutes } from '@/types'

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [currentMeeting, setCurrentMeeting] = useState<Meeting | null>(null)
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([])
  const [hasApiKey, setHasApiKey] = useState(false)
  const [isInMeet, setIsInMeet] = useState(false)
  const [selectedMinutes, setSelectedMinutes] = useState<{ meeting: Meeting; minutes: Minutes } | null>(null)
  
  useEffect(() => {
    loadData()
    checkCurrentTab()
  }, [])
  
  const loadData = async () => {
    chrome.storage.local.get(['meetings', 'settings', 'currentMeetingId'], (result) => {
      const meetings = result.meetings || []
      setRecentMeetings(meetings.slice(-5).reverse())
      
      if (result.currentMeetingId) {
        const current = meetings.find(m => m.id === result.currentMeetingId)
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
      
      setHasApiKey(!!result.settings?.apiKey)
    })
  }
  
  const checkCurrentTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const inMeet = !!(tab?.url?.includes('meet.google.com'))
      setIsInMeet(inMeet)
      
      if (inMeet && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_RECORDING_STATUS' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Content script not ready:', chrome.runtime.lastError.message)
            return
          }
          if (response?.isRecording !== undefined) {
            setIsRecording(response.isRecording)
          }
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
    
    const messageType = isRecording ? 'STOP_RECORDING' : 'START_RECORDING'
    chrome.tabs.sendMessage(tab.id, { type: messageType }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError.message)
        alert('エラー: Content Scriptが読み込まれていません。ページをリロードしてください。')
        return
      }
      
      if (response?.success) {
        setIsRecording(!isRecording)
        setTimeout(loadData, 500)
      }
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
    
    chrome.tabs.sendMessage(tab.id, { type: 'GENERATE_MINUTES' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error sending message:', chrome.runtime.lastError.message)
        alert('エラー: Content Scriptが読み込まれていません。ページをリロードしてください。')
        return
      }
      
      if (!response?.success) {
        alert('エラー: ' + (response?.error || '議事録の生成に失敗しました'))
      }
    })
  }
  
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage()
  }
  
  const handleMeetingClick = (meeting: Meeting) => {
    if (meeting.minutes) {
      setSelectedMinutes({ meeting, minutes: meeting.minutes })
    }
  }
  
  const handleDownload = (format: 'markdown' | 'txt' | 'json') => {
    if (!selectedMinutes) return
    
    let content = ''
    let filename = `minutes_${new Date(selectedMinutes.meeting.startTime).toISOString().split('T')[0]}`
    let mimeType = ''
    
    switch (format) {
      case 'markdown':
        content = selectedMinutes.minutes.content
        filename += '.md'
        mimeType = 'text/markdown'
        break
      case 'txt':
        content = selectedMinutes.minutes.content.replace(/[#*`]/g, '')
        filename += '.txt'
        mimeType = 'text/plain'
        break
      case 'json':
        content = JSON.stringify({
          meeting: selectedMinutes.meeting,
          minutes: selectedMinutes.minutes
        }, null, 2)
        filename += '.json'
        mimeType = 'application/json'
        break
    }
    
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  
  const formatMarkdownToHTML = (markdown: string): string => {
    return markdown
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^\* (.+)$/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
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
    <div className="w-96 p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">theMinutesBoard</h1>
        <button
          onClick={handleOpenOptions}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="設定"
        >
          ⚙️
        </button>
      </div>
      
      {!hasApiKey ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <div className="flex items-start gap-2">
            <span className="text-yellow-600 text-lg">⚠️</span>
            <div className="flex-1">
              <p className="text-sm text-yellow-800 font-medium">
                Gemini APIキーが設定されていません
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
              APIキーが設定されています
            </p>
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
      
      <div className="border-t pt-3">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">最近の議事録</h2>
        {recentMeetings.length > 0 ? (
          <div className="space-y-2">
            {recentMeetings.map((meeting) => (
              <div 
                key={meeting.id}
                onClick={() => handleMeetingClick(meeting)}
                className={`p-2 rounded transition-colors ${
                  meeting.minutes 
                    ? 'bg-green-50 hover:bg-green-100 cursor-pointer border border-green-200' 
                    : 'bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {meeting.title}
                    </p>
                    <p className="text-xs text-gray-600">
                      {new Date(meeting.startTime).toLocaleDateString()} • 
                      {meeting.participants.length}名
                    </p>
                  </div>
                  {meeting.minutes ? (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded font-medium">
                      📄 議事録
                    </span>
                  ) : (
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                      記録のみ
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">まだ議事録がありません</p>
        )}
      </div>
      
      {/* 議事録詳細モーダル */}
      {selectedMinutes && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] w-full flex flex-col">
            <div className="flex justify-between items-center p-6 border-b">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedMinutes.meeting.title}
                </h3>
                <p className="text-sm text-gray-600">
                  {new Date(selectedMinutes.meeting.startTime).toLocaleString()} • 
                  {selectedMinutes.meeting.participants.length}名参加
                </p>
              </div>
              <button
                onClick={() => setSelectedMinutes(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
              >
                ×
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div 
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: formatMarkdownToHTML(selectedMinutes.minutes.content) }}
              />
            </div>
            
            <div className="flex justify-end gap-3 p-6 border-t">
              <button
                onClick={() => setSelectedMinutes(null)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                閉じる
              </button>
              <button
                onClick={() => handleDownload('markdown')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                📄 Markdown
              </button>
              <button
                onClick={() => handleDownload('txt')}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                📝 テキスト
              </button>
              <button
                onClick={() => handleDownload('json')}
                className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
              >
                💾 JSON
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App