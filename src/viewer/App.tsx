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
  const [currentTab, setCurrentTab] = useState<'history' | 'nextsteps'>('history')

  useEffect(() => {
    console.log('Initial useEffect - loading data')
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
      console.log('URL mode is history - setting states')
      setIsLiveMode(false)
      setCurrentTab('history')
    }
    
    // デバッグ用: グローバル関数を追加
    (window as any).createTestMeeting = async () => {
      const testMeeting: Meeting = {
        id: `test_${Date.now()}`,
        title: 'テスト会議 ' + new Date().toLocaleString('ja-JP'),
        startTime: new Date(Date.now() - 3600000), // 1時間前
        endTime: new Date(),
        participants: ['田中太郎', '佐藤花子', '鈴木一郎'],
        transcripts: [
          {
            id: 'trans_1',
            speaker: '田中太郎',
            content: 'それでは、本日の会議を始めさせていただきます。',
            timestamp: new Date(Date.now() - 3500000),
            meetingId: ''
          },
          {
            id: 'trans_2',
            speaker: '佐藤花子',
            content: 'プロジェクトの進捗について報告します。',
            timestamp: new Date(Date.now() - 3400000),
            meetingId: ''
          }
        ],
        minutes: {
          id: 'minutes_1',
          content: `# テスト会議議事録\n\n## 概要\n- **参加者**: 田中太郎、佐藤花子、鈴木一郎\n- **会議の目的**: プロジェクト進捗確認\n\n## 決定事項\n- **次回の会議は来週月曜日に実施**`,
          generatedAt: new Date(),
          format: 'markdown' as const
        }
      }
      
      const result = await chrome.storage.local.get(['meetings'])
      const meetings = result.meetings || []
      meetings.push(testMeeting)
      await chrome.storage.local.set({ meetings })
      
      console.log('Test meeting created:', testMeeting.id)
      loadData() // データを再読み込み
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

  // 状態変更を監視
  useEffect(() => {
    console.log('State changed - isLiveMode:', isLiveMode, 'currentTab:', currentTab, 'allMeetings:', allMeetings.length)
  }, [isLiveMode, currentTab, allMeetings])

  const loadData = () => {
    chrome.storage.local.get(['meetings', 'currentMeetingId'], (result) => {
      console.log('Viewer loading data - meetings count:', result.meetings?.length || 0)
      console.log('Raw meetings data:', result.meetings)
      console.log('Current isLiveMode:', isLiveMode)
      console.log('Current currentTab:', currentTab)
      const meetings = result.meetings || []
      setAllMeetings(meetings)
      
      // デバッグ: 各会議の詳細をログ出力
      meetings.forEach((meeting: Meeting, index: number) => {
        console.log(`Meeting ${index}:`, {
          id: meeting.id,
          title: meeting.title,
          startTime: meeting.startTime,
          hasMinutes: !!meeting.minutes
        })
      })
      
      // allMeetingsの状態を確認
      console.log('allMeetings state after setAllMeetings:', meetings)
      
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
          // 停止成功後、currentMeetingをクリアしてUIを更新
          setCurrentMeeting(null)
          setIsMinutesGenerating(false)
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

  const extractMeetingTopic = (content: string): string => {
    // 会議の目的を優先的に抽出
    const purposePatterns = [
      /会議の目的[:：]\s*(.+?)[\n\r]/,
      /\*\*会議の目的\*\*[:：]\s*(.+?)[\n\r]/,
      /目的[:：]\s*(.+?)[\n\r]/
    ]
    
    for (const pattern of purposePatterns) {
      const match = content.match(pattern)
      if (match && match[1]) {
        const purpose = match[1].trim()
        return purpose.length > 30 ? purpose.substring(0, 30) + '...' : purpose
      }
    }
    
    // 次に主要議題を探す
    const topicPatterns = [
      /## 主要議題と討議内容\s*\n+### \d+\.\s*(.+?)[\n\r]/,
      /### \d+\.\s*(.+?)[\n\r]/,
      /議題[:：]\s*(.+?)[\n\r]/,
      /主な議題[:：]\s*(.+?)[\n\r]/
    ]
    
    for (const pattern of topicPatterns) {
      const match = content.match(pattern)
      if (match && match[1]) {
        const topic = match[1].trim()
        return topic.length > 30 ? topic.substring(0, 30) + '...' : topic
      }
    }
    
    // 決定事項から抽出
    const decisionPattern = /## 決定事項\s*\n+[\-\*]\s*\*\*(.+?)\*\*/
    const decisionMatch = content.match(decisionPattern)
    if (decisionMatch && decisionMatch[1]) {
      const decision = decisionMatch[1].trim()
      return decision.length > 30 ? decision.substring(0, 30) + '...' : decision
    }
    
    // それでも見つからない場合は「内容なし」
    return '議題情報なし'
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
                  onClick={() => {
                    console.log('History button clicked')
                    setIsLiveMode(false)
                    setCurrentTab('history')
                    // 状態更新後にデータを再読み込み
                    setTimeout(() => {
                      console.log('After state update - isLiveMode:', false, 'currentTab:', 'history')
                      loadData()
                    }, 100)
                  }}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    !isLiveMode && currentTab === 'history'
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  履歴
                </button>
                <button
                  onClick={() => {
                    setIsLiveMode(false)
                    setCurrentTab('nextsteps')
                  }}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                    !isLiveMode && currentTab === 'nextsteps'
                      ? 'bg-blue-100 text-blue-800'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  ネクストステップ
                </button>
              </div>
            </div>
            
            <div className="flex items-center gap-2 min-h-[40px]">
              {displayMeeting && (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-12 gap-6">
          {/* サイドバー（履歴モード時のみ表示） */}
          {console.log('Sidebar render check - isLiveMode:', isLiveMode, 'currentTab:', currentTab, 'allMeetings:', allMeetings.length)}
          {!isLiveMode && currentTab === 'history' && (
            <div className="col-span-3">
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">会議履歴</h2>
                <div className="space-y-2">
                  {console.log('Rendering meetings list, count:', allMeetings.length)}
                  {console.log('All meetings data:', allMeetings)}
                  {allMeetings.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                      まだ会議の記録がありません
                    </p>
                  ) : (
                    <>
                    <p className="text-xs text-gray-600 mb-2">
                      {allMeetings.length}件の会議があります
                    </p>
                    {allMeetings
                    .filter((meeting) => {
                      // Invalid Dateを除外
                      try {
                        // startTimeがオブジェクトの場合の処理
                        let startTime = meeting.startTime
                        if (typeof startTime === 'object' && startTime !== null && !startTime instanceof Date) {
                          // Firestoreタイムスタンプ形式の可能性
                          if ('seconds' in startTime || '_seconds' in startTime) {
                            const seconds = startTime.seconds || startTime._seconds
                            startTime = new Date(seconds * 1000)
                          } else if ('toDate' in startTime && typeof startTime.toDate === 'function') {
                            startTime = startTime.toDate()
                          } else {
                            // その他のオブジェクト形式
                            console.log('Unknown date object format:', meeting.id, startTime)
                            return true // とりあえず表示する
                          }
                        }
                        const date = new Date(startTime)
                        const isValid = !isNaN(date.getTime())
                        if (!isValid) {
                          console.log('Invalid date for meeting:', meeting.id, meeting.startTime)
                        }
                        return true // 日付が無効でも表示する
                      } catch (e) {
                        console.error('Date processing error:', e)
                        return true
                      }
                    })
                    .sort((a, b) => {
                      try {
                        // 簡易的にtitleの日付文字列でソート
                        return b.title.localeCompare(a.title)
                      } catch (e) {
                        return 0
                      }
                    })
                    .map((meeting) => {
                      console.log('Rendering meeting item:', meeting.id, meeting.title)
                      return (
                      <div
                        key={meeting.id}
                        onClick={() => handleMeetingSelect(meeting)}
                        className={`p-3 rounded-lg cursor-pointer transition-colors ${
                          selectedMeeting?.id === meeting.id
                            ? 'bg-blue-50 border border-blue-200'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div>
                          {meeting.minutes && (
                            <p className="text-sm font-medium text-gray-900 mb-1" title={extractMeetingTopic(meeting.minutes.content)}>
                              {extractMeetingTopic(meeting.minutes.content)}
                            </p>
                          )}
                          <p className="text-xs text-gray-600">
                            {meeting.title || 'Unknown date'}
                          </p>
                        </div>
                      </div>
                    )})}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* メインコンテンツ */}
          <div className={isLiveMode ? 'col-span-12' : currentTab === 'history' ? 'col-span-9' : 'col-span-12'}>
            
            {/* ネクストステップタブの内容 */}
            {!isLiveMode && currentTab === 'nextsteps' && (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                <div className="text-6xl mb-4">📋</div>
                <p className="text-xl text-gray-600 mb-4">ネクストステップ機能は準備中です</p>
                <p className="text-gray-500">会議の決定事項から次のアクションを管理できるようになります</p>
              </div>
            )}
            
            {/* 履歴タブまたはライブ表示の内容 */}
            {(isLiveMode || currentTab === 'history') && displayMeeting ? (
              <div className="bg-white rounded-lg shadow-sm">
                {/* 会議情報ヘッダー */}
                <div className="p-6 border-b">
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        {displayMeeting.title}
                      </h2>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        {displayMeeting.participants && (
                          <span>参加者: {displayMeeting.participants.length}名</span>
                        )}
                        {displayMeeting.transcripts && (
                          <span>発言数: {displayMeeting.transcripts.length}件</span>
                        )}
                        {isLiveMode && lastUpdated && (
                          <span>最終更新: {lastUpdated.toLocaleTimeString()}</span>
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
            ) : (isLiveMode || currentTab === 'history') ? (
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App