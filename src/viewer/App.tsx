import React, { useState, useEffect } from 'react'
import { Meeting, Minutes } from '@/types'
import NextStepsBoard from '@/components/NextStepsBoard'
import MeetingNextSteps from '@/components/MeetingNextSteps'
import ResizablePanel from '@/components/ResizablePanel'
import LiveModeLayout from '@/components/LiveModeLayout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { formatMarkdownToHTML } from '@/utils/markdown'
import { extractMeetingTopic } from '@/utils/meeting-utils'

function App() {
  const [currentMeeting, setCurrentMeeting] = useState<Meeting | null>(null)
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null)
  const [allMeetings, setAllMeetings] = useState<Meeting[]>([])
  const [isLiveMode, setIsLiveMode] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isDownloadDropdownOpen, setIsDownloadDropdownOpen] = useState(false)
  const [isMinutesGenerating, setIsMinutesGenerating] = useState(false)
  const [currentTab, setCurrentTab] = useState<'history' | 'nextsteps'>('history')
  const [showNextStepsPanel, setShowNextStepsPanel] = useState(true)
  const [showResearchPanel, setShowResearchPanel] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  useEffect(() => {
    logger.debug('Initial useEffect - loading data')
    loadData()
    
    // 初回の状態同期リクエスト
    ChromeErrorHandler.sendMessage({ type: 'REQUEST_STATE_SYNC' })
      .then(response => {
        if (response?.success && response.state) {
          setIsRecording(response.state.isRecording)
          setIsMinutesGenerating(response.state.isMinutesGenerating)
        }
      })
      .catch(error => {
        logger.error('Failed to sync state:', error)
      })
    
    // 状態同期のリスナーを設定
    const handleMessage = (message: any) => {
      logger.debug('Viewer received message:', message.type)
      
      switch (message.type) {
        case 'STATE_SYNC':
          setIsRecording(message.payload.isRecording)
          setIsMinutesGenerating(message.payload.isMinutesGenerating)
          break
        case 'MINUTES_GENERATION_STARTED':
          setIsMinutesGenerating(true)
          break
        case 'MINUTES_GENERATED':
          setIsMinutesGenerating(false)
          loadData() // 議事録が生成されたらデータを再読み込み
          break
        case 'MINUTES_GENERATION_FAILED':
          setIsMinutesGenerating(false)
          break
        case 'RECORDING_STOPPED':
          setIsRecording(false)
          loadData()
          break
        case 'CALL_ENDED':
          // 会議終了時の処理
          logger.debug('Call ended, reloading data')
          setIsRecording(false)
          setIsMinutesGenerating(false)
          
          // ライブモードの場合は履歴タブに切り替え
          if (isLiveMode) {
            setIsLiveMode(false)
            setCurrentTab('history')
            // currentMeetingは履歴タブで表示するために保持
            // setCurrentMeeting(null) を削除
          }
          
          loadData()
          break
        case 'HISTORY_MINUTES_GENERATED':
          // 履歴議事録生成完了時の処理
          logger.debug('History minutes generated, reloading data')
          loadData()
          
          // 通知を表示（オプション）
          const meetingId = message.payload?.meetingId
          if (meetingId) {
            // 該当の会議を選択状態にする
            chrome.storage.local.get(['meetings'], (result) => {
              const meetings = result.meetings || []
              const meeting = meetings.find((m: Meeting) => m.id === meetingId)
              if (meeting && !isLiveMode) {
                setSelectedMeeting(meeting)
              }
            })
          }
          break
      }
    }
    
    chrome.runtime.onMessage.addListener(handleMessage)
    
    // モバイル判定
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
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
      logger.debug('URL mode is history - setting states')
      setIsLiveMode(false)
      setCurrentTab('history')
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
      window.removeEventListener('resize', checkMobile)
      chrome.storage.onChanged.removeListener(handleStorageChange)
      document.removeEventListener('click', handleClickOutside)
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [])

  // 状態変更を監視
  useEffect(() => {
    logger.debug('State changed - isLiveMode:', isLiveMode, 'currentTab:', currentTab, 'allMeetings:', allMeetings.length)
  }, [isLiveMode, currentTab, allMeetings])

  const loadData = () => {
    chrome.storage.local.get(['meetings', 'currentMeetingId'], (result) => {
      logger.debug('Viewer loading data - meetings count:', result.meetings?.length || 0)
      logger.debug('Viewer loading data - currentMeetingId:', result.currentMeetingId)
      logger.debug('Viewer loading data - isLiveMode:', isLiveMode)
      
      const meetings = result.meetings || []
      setAllMeetings(meetings)
      
      if (result.currentMeetingId && isLiveMode) {
        const current = meetings.find((m: Meeting) => m.id === result.currentMeetingId)
        if (current) {
          logger.debug('Current meeting found:', current.id)
          setCurrentMeeting(current)
          setLastUpdated(new Date())
          // 議事録生成完了を検知
          if (current.minutes && isMinutesGenerating) {
            setIsMinutesGenerating(false)
          }
        } else {
          logger.warn('Current meeting not found in meetings list:', result.currentMeetingId)
          // currentMeetingIdがあるが会議が見つからない場合は、currentMeetingをnullにしない
          // 既存のcurrentMeetingを保持する
        }
      } else if (!result.currentMeetingId && isLiveMode) {
        // ライブモードだがcurrentMeetingIdがない場合
        logger.debug('Live mode but no currentMeetingId')
        // 明示的にnullに設定するのではなく、既存の状態を保持
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
    
    ChromeErrorHandler.sendMessage({
      type: 'GENERATE_MINUTES',
      payload: {
        promptType: 'live' // ライブ表示用のプロンプトを使用
      }
    })
      .then(response => {
        if (!response?.success) {
          alert('エラー: ' + (response?.error || '議事録の生成に失敗しました'))
          setIsMinutesGenerating(false)
        }
      })
      .catch(error => {
        logger.error('Failed to generate minutes:', error)
        alert(ChromeErrorHandler.getUserFriendlyMessage(error))
        setIsMinutesGenerating(false)
      })
  }

  const stopRecording = () => {
    if (!currentMeeting?.id) return
    
    if (confirm('記録を停止しますか？')) {
      ChromeErrorHandler.sendMessage({
        type: 'STOP_RECORDING'
      })
        .then(response => {
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
        .catch(error => {
          logger.error('Failed to stop recording:', error)
          alert(ChromeErrorHandler.getUserFriendlyMessage(error))
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
                    logger.debug('History button clicked')
                    setIsLiveMode(false)
                    setCurrentTab('history')
                    setTimeout(() => {
                      logger.debug('After state update - isLiveMode:', false, 'currentTab:', 'history')
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
                  ToDo
                </button>
              </div>
            </div>
            
            <div className="flex items-center gap-4 min-h-[40px]">
              {/* ライブモード時のトグルスイッチ */}
              {isLiveMode && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">表示/非表示切り替え：</span>
                  {/* ネクストステップトグル */}
                  <label className="flex items-center gap-2 cursor-pointer" title="ネクストステップパネルの表示/非表示を切り替えます">
                    <span className="text-sm text-gray-700">📝 ネクストステップ</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={showNextStepsPanel}
                        onChange={(e) => setShowNextStepsPanel(e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`w-10 h-6 rounded-full transition-colors ${
                        showNextStepsPanel ? 'bg-blue-600' : 'bg-gray-300'
                      }`}>
                        <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          showNextStepsPanel ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </div>
                    </div>
                  </label>
                  
                  {/* リサーチトグル */}
                  <label className="flex items-center gap-2 cursor-pointer" title="リサーチパネルの表示/非表示を切り替えます">
                    <span className="text-sm text-gray-700">🔍 リサーチ</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={showResearchPanel}
                        onChange={(e) => setShowResearchPanel(e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`w-10 h-6 rounded-full transition-colors ${
                        showResearchPanel ? 'bg-green-600' : 'bg-gray-300'
                      }`}>
                        <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          showResearchPanel ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </div>
                    </div>
                  </label>
                </div>
              )}
              
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

      <div className="max-w-full mx-auto p-2 md:p-4">
        {/* ネクストステップタブの全画面表示 */}
        {!isLiveMode && currentTab === 'nextsteps' && (
          <div className="h-[calc(100vh-120px)]">
            <NextStepsBoard meetings={allMeetings} />
          </div>
        )}

        {/* ライブモード - 3パネル縦積みレイアウト */}
        {isLiveMode && (
          <ErrorBoundary>
            <LiveModeLayout
              meeting={currentMeeting}
              isMinutesGenerating={isMinutesGenerating}
              onGenerateMinutes={generateMinutes}
              onStopRecording={stopRecording}
              isRecording={isRecording}
              showNextStepsPanel={showNextStepsPanel}
              showResearchPanel={showResearchPanel}
            />
          </ErrorBoundary>
        )}

        {/* 履歴タブ */}
        {!isLiveMode && currentTab === 'history' && (
          <div className="flex gap-4 h-[calc(100vh-120px)] md:h-[calc(100vh-140px)]">
            {/* 履歴サイドバー - 終了した会議のみ表示 */}
            <ResizablePanel
              position="left"
              defaultWidth={280}
              minWidth={200}
              maxWidth={400}
              className="flex-shrink-0"
            >
              <div className="bg-white rounded-lg shadow-sm p-4 h-full overflow-y-auto">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">会議履歴</h2>
                <div className="space-y-2">
                  {allMeetings.filter(m => m.endTime).length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                      まだ終了した会議の記録がありません
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-600 mb-2">
                        {allMeetings.filter(m => m.endTime).length}件の会議があります
                      </p>
                      {allMeetings
                        .filter(m => m.endTime) // 終了した会議のみ表示
                        .sort((a, b) => {
                          try {
                            return b.title.localeCompare(a.title)
                          } catch (e) {
                            return 0
                          }
                        })
                        .map((meeting) => (
                          <button
                            key={meeting.id}
                            onClick={() => handleMeetingSelect(meeting)}
                            className={`w-full p-3 rounded-lg text-left transition-colors flex flex-col ${
                              selectedMeeting?.id === meeting.id
                                ? 'bg-blue-50 border border-blue-200'
                                : 'hover:bg-gray-50 border border-transparent'
                            }`}
                          >
                            {meeting.minutes && (
                              <p className="text-sm font-medium text-gray-900 mb-1 truncate" title={extractMeetingTopic(meeting)}>
                                {extractMeetingTopic(meeting)}
                              </p>
                            )}
                            <p className="text-xs text-gray-600">
                              {meeting.title || 'Unknown date'}
                            </p>
                          </button>
                        ))}
                    </>
                  )}
                </div>
              </div>
            </ResizablePanel>

            {/* メインコンテンツ */}
            <div className="flex-1 flex gap-4">
              {/* 議事録表示エリア */}
              <div className="flex-1">
                {displayMeeting ? (
                  <div className="bg-white rounded-lg shadow-sm h-full">
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
                        
                        <div className="flex items-center gap-2">
                          {/* 履歴モードでの会議固有のボタン */}
                          {!isLiveMode && selectedMeeting && (
                            <>
                              <button
                                onClick={() => setShowNextStepsPanel(!showNextStepsPanel)}
                                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                                  showNextStepsPanel
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                📋 ネクストステップ
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 議事録コンテンツ */}
                    <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
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
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg shadow-sm p-12 text-center h-full flex items-center justify-center">
                    <div>
                      <div className="text-6xl mb-4">📚</div>
                      <p className="text-xl text-gray-600 mb-4">会議を選択してください</p>
                      <p className="text-gray-500">左側のリストから表示したい会議を選んでください</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 会議固有のネクストステップパネル（履歴モード） */}
              {!isLiveMode && selectedMeeting && showNextStepsPanel && (
                <ResizablePanel
                  position="right"
                  defaultWidth={380}
                  minWidth={300}
                  maxWidth={500}
                >
                  <div className="bg-white rounded-lg shadow-sm h-full">
                    <MeetingNextSteps meeting={selectedMeeting} />
                  </div>
                </ResizablePanel>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App