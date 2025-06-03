import React, { useState, useEffect } from 'react'
import { Meeting, Minutes, Transcript } from '@/types'

function App() {
  const [currentMeeting, setCurrentMeeting] = useState<Meeting | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)
  const [allMeetings, setAllMeetings] = useState<Meeting[]>([])
  const [isLiveMode, setIsLiveMode] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isDownloadDropdownOpen, setIsDownloadDropdownOpen] = useState(false)
  const [isMinutesGenerating, setIsMinutesGenerating] = useState(false)

  useEffect(() => {
    loadData()
    
    // URLパラメータから会議IDを取得
    const urlParams = new URLSearchParams(window.location.search)
    const meetingId = urlParams.get('meetingId')
    const mode = urlParams.get('mode')
    
    if (meetingId) {
      setIsLiveMode(false)
      // 特定の会議を表示
      chrome.storage.local.get(['meetings'], (result) => {
        const meetings = result.meetings || []
        const meeting = meetings.find((m: Meeting) => m.id === meetingId)
        if (meeting) {
          setSelectedMeeting(meeting)
        }
      })
    } else if (mode === 'history') {
      setIsLiveMode(false)
    }
    
    // ストレージの変更を監視
    const handleStorageChange = () => {
      loadData()
    }
    
    chrome.storage.onChanged.addListener(handleStorageChange)
    
    // ドロップダウンの外側クリックで閉じる
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.relative')) {
        setIsDownloadDropdownOpen(false)
      }
    }
    
    document.addEventListener('click', handleClickOutside)
    
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  const loadData = () => {
    chrome.storage.local.get(['meetings', 'currentMeetingId'], (result) => {
      const meetings = result.meetings || []
      setAllMeetings(meetings)
      
      if (result.currentMeetingId && isLiveMode) {
        const current = meetings.find((m: Meeting) => m.id === result.currentMeetingId)
        if (current) {
          setCurrentMeeting(current)
          setLastUpdated(new Date())
          // 議事録生成完了を検知
          if (current.minutes && isMinutesGenerating) {
            setIsMinutesGenerating(false)
          }
        }
      }
    })
  }

  const handleMeetingSelect = (meeting: Meeting) => {
    setSelectedMeeting(meeting)
    setIsLiveMode(false)
  }

  const handleBackToLive = () => {
    setIsLiveMode(true)
    setSelectedMeeting(null)
    loadData()
  }

  const generateMinutes = () => {
    if (!currentMeeting?.id) return
    
    setIsMinutesGenerating(true)
    
    chrome.runtime.sendMessage({
      type: 'GENERATE_MINUTES'
    }, (response) => {
      if (response?.success) {
        // 成功通知は不要（自動更新される）
      } else {
        alert('エラー: ' + (response?.error || '議事録の生成に失敗しました'))
        setIsMinutesGenerating(false)
      }
    })
  }


  const stopRecording = () => {
    if (!currentMeeting?.id) return
    
    if (confirm('記録を停止しますか？')) {
      chrome.runtime.sendMessage({
        type: 'STOP_RECORDING'
      }, (response) => {
        if (response?.success) {
          // データの再読み込み
          setTimeout(loadData, 500)
        } else {
          alert('エラー: ' + (response?.error || '記録の停止に失敗しました'))
        }
      })
    }
  }

  const downloadMinutes = (format: 'markdown' | 'txt' | 'json') => {
    const meeting = selectedMeeting || currentMeeting
    if (!meeting?.minutes) return

    let content = ''
    let filename = `minutes_${new Date(meeting.startTime).toISOString().split('T')[0]}`
    let mimeType = ''

    switch (format) {
      case 'markdown':
        content = meeting.minutes.content
        filename += '.md'
        mimeType = 'text/markdown'
        break
      case 'txt':
        content = meeting.minutes.content.replace(/[#*`]/g, '')
        filename += '.txt'
        mimeType = 'text/plain'
        break
      case 'json':
        content = JSON.stringify({ meeting, minutes: meeting.minutes }, null, 2)
        filename += '.json'
        mimeType = 'application/json'
        break
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
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

  const displayMeeting = selectedMeeting || currentMeeting

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">theMinutesBoard</h1>
              <div className="flex gap-2">
                <button
                  onClick={handleBackToLive}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    isLiveMode
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  ライブ表示
                </button>
                <button
                  onClick={() => setIsLiveMode(false)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    !isLiveMode
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  履歴
                </button>
              </div>
            </div>
            
            {displayMeeting && (
              <div className="flex items-center gap-2">
                {isLiveMode && currentMeeting && (
                  <>
                    <button
                      onClick={stopRecording}
                      className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors border border-red-600 hover:border-red-700"
                    >
                      ⏹ 記録停止
                    </button>
                    <button
                      onClick={generateMinutes}
                      disabled={isMinutesGenerating}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isMinutesGenerating ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>生成中...</span>
                        </>
                      ) : (
                        currentMeeting.minutes ? '📝 議事録を更新' : '✨ 議事録生成'
                      )}
                    </button>
                  </>
                )}
                
                {displayMeeting.minutes && (
                  <div className="relative">
                    <button
                      onClick={() => setIsDownloadDropdownOpen(!isDownloadDropdownOpen)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors text-sm"
                    >
                      💾 ダウンロード
                      <svg className={`w-4 h-4 transition-transform ${isDownloadDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    
                    {isDownloadDropdownOpen && (
                      <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-10">
                        <button
                          onClick={() => {
                            downloadMinutes('markdown')
                            setIsDownloadDropdownOpen(false)
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          📄 <span>Markdown (.md)</span>
                        </button>
                        <button
                          onClick={() => {
                            downloadMinutes('txt')
                            setIsDownloadDropdownOpen(false)
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          📝 <span>テキスト (.txt)</span>
                        </button>
                        <button
                          onClick={() => {
                            downloadMinutes('json')
                            setIsDownloadDropdownOpen(false)
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          💾 <span>JSON (.json)</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-12 gap-6">
          {/* サイドバー（履歴モード時のみ表示） */}
          {!isLiveMode && (
            <div className="col-span-3">
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">会議履歴</h2>
                <div className="space-y-2">
                  {allMeetings
                    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                    .map((meeting) => (
                      <div
                        key={meeting.id}
                        onClick={() => handleMeetingSelect(meeting)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedMeeting?.id === meeting.id
                            ? 'bg-blue-50 border border-blue-200'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {meeting.title}
                            </p>
                            <p className="text-xs text-gray-600">
                              {new Date(meeting.startTime).toLocaleDateString()}
                            </p>
                          </div>
                          {meeting.minutes && (
                            <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                              議事録
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* メインコンテンツ */}
          <div className={isLiveMode ? 'col-span-12' : 'col-span-9'}>
            
            {displayMeeting ? (
              <div className="bg-white rounded-lg shadow-sm">
                {/* 会議情報ヘッダー */}
                <div className="p-6 border-b">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        {displayMeeting.title}
                      </h2>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>📅 {new Date(displayMeeting.startTime).toLocaleString()}</span>
                        <span>👥 {displayMeeting.participants.length}名参加</span>
                        <span>💬 {displayMeeting.transcripts.length}件の発言</span>
                        {isLiveMode && lastUpdated && (
                          <span>🔄 {lastUpdated.toLocaleTimeString()} 更新</span>
                        )}
                      </div>
                    </div>
                    
                    {isLiveMode && (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                          <span className="text-sm text-red-600 font-medium">記録中</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 議事録コンテンツ */}
                <div className="p-6">
                  {displayMeeting.minutes ? (
                    <div className="prose prose-lg max-w-none">
                      <div dangerouslySetInnerHTML={{ 
                        __html: formatMarkdownToHTML(displayMeeting.minutes.content) 
                      }} />
                      
                      <div className="mt-8 pt-4 border-t border-gray-200 text-sm text-gray-500">
                        生成日時: {new Date(displayMeeting.minutes.generatedAt).toLocaleString()}
                        {displayMeeting.minutes.metadata && (
                          <>
                            {' • '}
                            単語数: {displayMeeting.minutes.metadata.wordCount}
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <div className="text-6xl mb-4">📝</div>
                      <p className="text-xl text-gray-600 mb-4">議事録がまだ生成されていません</p>
                      {isLiveMode && currentMeeting && (
                        <button
                          onClick={generateMinutes}
                          disabled={isMinutesGenerating}
                          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                        >
                          {isMinutesGenerating ? (
                            <>
                              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>生成中...</span>
                            </>
                          ) : (
                            '✨ 議事録を生成する'
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                {isLiveMode ? (
                  <>
                    <div className="text-6xl mb-4">📹</div>
                    <p className="text-xl text-gray-600 mb-4">記録中の会議がありません</p>
                    <p className="text-gray-500">Google Meetで記録を開始してください</p>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-4">📚</div>
                    <p className="text-xl text-gray-600 mb-4">会議を選択してください</p>
                    <p className="text-gray-500">左側のリストから表示したい会議を選んでください</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App