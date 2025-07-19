import React, { useState, useEffect, useMemo, startTransition } from 'react'
import { Meeting } from '@/types'
import { logger } from '@/utils/logger'
import { formatMarkdownToHTML } from '@/utils/markdown'
import { TIMING_CONSTANTS } from '@/constants'

interface LiveMinutesPanelProps {
  meeting: Meeting | null
  isGenerating: boolean
  isLocked: boolean
  onManualUpdate: () => void
  isRecording?: boolean
  showResearchPanel?: boolean
  onToggleResearchPanel?: (show: boolean) => void
}

const LiveMinutesPanel = React.memo(function LiveMinutesPanel({
  meeting,
  isGenerating,
  isLocked,
  onManualUpdate,
  isRecording = false,
  showResearchPanel = true,
  onToggleResearchPanel
}: LiveMinutesPanelProps) {
  const [minutes, setMinutes] = useState<string>('')
  const [autoUpdateInterval, setAutoUpdateInterval] = useState<number>(2)
  const [nextUpdateTime, setNextUpdateTime] = useState<Date | null>(null)
  const [isAutoUpdating, setIsAutoUpdating] = useState(false)
  const [liveDigest, setLiveDigest] = useState<{ summary: string; details: string[]; statements: { speaker: string; content: string }[] } | null>(null)
  const [isLiveDigestExpanded, setIsLiveDigestExpanded] = useState(false)
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
  const [meetingStartTime, setMeetingStartTime] = useState<Date | null>(null)

  // 設定を読み込む
  useEffect(() => {
    chrome.storage.sync.get(['settings'], (result) => {
      if (result.settings?.autoUpdateInterval !== undefined) {
        setAutoUpdateInterval(result.settings.autoUpdateInterval)
      }
    })
  }, [])

  // 自動更新タイマー
  useEffect(() => {
    if (!isRecording || autoUpdateInterval === 0 || isLocked || isGenerating) {
      setNextUpdateTime(null)
      return
    }

    const intervalMs = autoUpdateInterval * TIMING_CONSTANTS.MINUTES_TO_MS
    const timer = setInterval(() => {
      setIsAutoUpdating(true)
      onManualUpdate()
      // 更新完了後にisAutoUpdatingをfalseにする処理
      setTimeout(() => setIsAutoUpdating(false), TIMING_CONSTANTS.AUTO_UPDATE_COMPLETE_DELAY)
      setNextUpdateTime(new Date(Date.now() + intervalMs))
    }, intervalMs)

    // 初回の次回更新時刻を設定
    setNextUpdateTime(new Date(Date.now() + intervalMs))

    return () => clearInterval(timer)
  }, [isRecording, autoUpdateInterval, isLocked, isGenerating, onManualUpdate])

  // カウントダウンタイマー
  useEffect(() => {
    if (!nextUpdateTime || isAutoUpdating) return

    const countdownTimer = setInterval(() => {
      const now = Date.now()
      if (nextUpdateTime.getTime() <= now) {
        clearInterval(countdownTimer)
      }
    }, TIMING_CONSTANTS.COUNTDOWN_UPDATE_INTERVAL)

    return () => clearInterval(countdownTimer)
  }, [nextUpdateTime, isAutoUpdating])

  // 議題の抽出と解析
  const topics = useMemo(() => {
    if (!minutes || typeof minutes !== 'string') return []
    
    const topicRegex = /## \[(\d{2}:\d{2})\] (.+?) ▼\n\n### 要約: (.+)\n([\s\S]*?)(?=\n---\n\n## |\n---\n\n\*最終更新|$)/g
    const extractedTopics: Array<{
      id: string
      time: string
      title: string
      summary: string
      content: string
      startTime: Date
      duration?: string
    }> = []
    
    let match
    while ((match = topicRegex.exec(minutes)) !== null) {
      const [, time, titleWithHeadline, summary, content] = match
      const titleMatch = titleWithHeadline.match(/^(.+?)\s*\[(.+?)\]$/)
      const title = titleMatch ? titleMatch[1] : titleWithHeadline
      const headline = titleMatch ? titleMatch[2] : ''
      
      // 開始時刻の計算
      const [hours, mins] = time.split(':').map(Number)
      const topicStartTime = new Date()
      topicStartTime.setHours(hours, mins, 0, 0)
      
      extractedTopics.push({
        id: `topic-${time}`,
        time,
        title: headline || title,
        summary,
        content: content.trim(),
        startTime: topicStartTime
      })
    }
    
    // 最新を上に（時刻の降順）
    extractedTopics.reverse()
    
    // 経過時間の計算
    return extractedTopics.map((topic, index) => {
      if (index === 0) {
        // 最新の議題は現在時刻までの経過時間
        const now = new Date()
        const duration = Math.floor((now.getTime() - topic.startTime.getTime()) / 60000)
        return { ...topic, duration: `${duration}分経過` }
      } else {
        // 過去の議題は次の議題開始までの時間
        const prevTopic = extractedTopics[index - 1]
        const duration = Math.floor((prevTopic.startTime.getTime() - topic.startTime.getTime()) / 60000)
        return { ...topic, duration: `${duration}分` }
      }
    })
  }, [minutes])

  const toggleTopic = (topicId: string) => {
    setExpandedTopics(prev => {
      const newSet = new Set(prev)
      if (newSet.has(topicId)) {
        newSet.delete(topicId)
      } else {
        newSet.add(topicId)
      }
      return newSet
    })
  }

  useEffect(() => {
    try {
      if (meeting?.minutes && meeting.minutes.content) {
        const content = meeting.minutes.content
        logger.info('[LiveMinutesPanel] Meeting minutes content:', content)
        logger.info('[LiveMinutesPanel] Meeting minutes metadata:', meeting.minutes.metadata)
        startTransition(() => {
          setMinutes(content)
        })
        
        // 会議開始時刻の抽出（日付+時刻形式にも対応）
        const startTimeMatch = content.match(/開始時刻: (.+)/)
        if (startTimeMatch && !meetingStartTime) {
          try {
            // まず完全な日時形式を試す
            const parsedTime = new Date(startTimeMatch[1])
            if (!isNaN(parsedTime.getTime())) {
              setMeetingStartTime(parsedTime)
            } else {
              // HH:MM形式の場合は今日の日付で設定
              const timeMatch = startTimeMatch[1].match(/(\d{2}):(\d{2})/)
              if (timeMatch) {
                const [, hours, minutes] = timeMatch
                const startTime = new Date()
                startTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
                setMeetingStartTime(startTime)
              }
            }
          } catch (error) {
            logger.error('Failed to parse start time:', error)
          }
        }
        
        // ライブダイジェストの抽出
        try {
          const digestMatch = content.match(/## ライブダイジェスト\n### 要約: (.+)\n([\s\S]*?)\n### 発言[▼▽]/)
          if (digestMatch) {
            const summary = digestMatch[1]
            const detailsSection = digestMatch[2]
            
            // 詳細を抽出
            const details = detailsSection.match(/^- (.+)$/gm)?.map(line => line.substring(2)) || []
            
            // 発言を抽出
            const statementsMatch = content.match(/### 発言[▼▽]\n([\s\S]*?)\n\n---/)
            const statements: { speaker: string; content: string }[] = []
            if (statementsMatch) {
              const statementsText = statementsMatch[1]
              const statementLines = statementsText.match(/^- (.+?): (.+)$/gm) || []
              statementLines.forEach(line => {
                // lineが文字列であることを確認
                if (typeof line === 'string') {
                  const match = line?.match(/^- (.+?): (.+)$/)
                  if (match && match[1] && match[2]) {
                    statements.push({ speaker: match[1], content: match[2] })
                  }
                } else {
                  logger.warn('Invalid line in statementLines:', line)
                }
              })
            }
            
            startTransition(() => {
              setLiveDigest({ summary, details, statements })
            })
          } else {
            startTransition(() => {
              setLiveDigest(null)
            })
          }
        } catch (error) {
          logger.error('Failed to extract live digest:', error)
          setLiveDigest(null)
        }
      } else {
        setMinutes('')
        setLiveDigest(null)
        setMeetingStartTime(null)
      }
    } catch (error) {
      logger.error('Error in LiveMinutesPanel useEffect:', error)
      // エラーが発生してもUIをクラッシュさせない
      setMinutes('')
      setLiveDigest(null)
    }
  }, [meeting])


  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-gray-50 h-16 min-h-[64px]">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900">📝 議事録（実況）</h3>
          {isRecording && autoUpdateInterval > 0 && nextUpdateTime && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              {isAutoUpdating ? (
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 border border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>自動更新中...</span>
                </div>
              ) : (
                <span>
                  次回更新: {Math.max(0, Math.floor((nextUpdateTime.getTime() - Date.now()) / 1000))}秒後
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onManualUpdate}
            disabled={isLocked || isGenerating}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              isLocked || isGenerating
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            title="議事録とネクストステップを更新"
          >
            {isGenerating ? (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>更新中...</span>
              </div>
            ) : (
              '🔄 更新'
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {meeting ? (
          minutes ? (
            <div>
              {/* ライブダイジェスト */}
              {liveDigest && (
                <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h2 className="text-lg font-semibold text-blue-900 mb-3">ライブダイジェスト</h2>
                  <div className="mb-3">
                    <h3 className="text-md font-semibold text-gray-800 mb-1">要約: {liveDigest.summary}</h3>
                    {liveDigest.details.length > 0 && (
                      <ul className="list-disc pl-5 text-sm text-gray-700">
                        {liveDigest.details.map((detail, index) => (
                          <li key={index} className="mb-1">{detail}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  
                  {liveDigest.statements.length > 0 && (
                    <div>
                      <button
                        onClick={() => setIsLiveDigestExpanded(!isLiveDigestExpanded)}
                        className="flex items-center gap-1 text-sm font-semibold text-gray-700 hover:text-gray-900 mb-2"
                      >
                        <span>{isLiveDigestExpanded ? '▼' : '▶'}</span>
                        <span>発言</span>
                      </button>
                      {isLiveDigestExpanded && (
                        <div className="pl-3 space-y-1">
                          {liveDigest.statements.map((statement, index) => (
                            <div key={index} className="text-sm">
                              <span className="font-semibold text-gray-700">{statement.speaker}:</span>
                              <span className="text-gray-600 ml-1">{statement.content}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              {/* 議題リスト（最新が上） */}
              <div className="border-t-2 border-gray-200 pt-4">
                <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  <span>📋</span>
                  <span>議題一覧</span>
                </h2>
                <div className="space-y-2">
                  {topics.map((topic, index) => (
                    <div key={topic.id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleTopic(topic.id)}
                        className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between text-left"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <span className="text-gray-400">
                            {expandedTopics.has(topic.id) ? '▼' : '▶'}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-500">[{topic.time}]</span>
                              <span className="font-medium text-gray-900">{topic.title}</span>
                              {index === 0 && (
                                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-full">進行中</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mt-1">{topic.summary}</div>
                          </div>
                        </div>
                        <span className="text-sm text-gray-500 ml-4">{topic.duration}</span>
                      </button>
                      {expandedTopics.has(topic.id) && (
                        <div className="px-4 py-3 bg-white border-t border-gray-200">
                          <div 
                            className="prose prose-sm max-w-none text-gray-800"
                            dangerouslySetInnerHTML={{ 
                              __html: formatMarkdownToHTML(topic.content || '')
                                .replace(/<h3>/g, '<h3 class="text-md font-semibold mt-3 mb-2 text-gray-800">')
                                .replace(/<li>/g, '<li class="ml-4 mb-1">')
                                .replace(/<ul>/g, '<ul class="list-disc pl-5 mb-3">')
                                .replace(/<strong>/g, '<strong class="font-semibold text-gray-900">')
                            }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center flex-1">
              <div className="text-6xl mb-6">📝</div>
              <p className="text-lg text-gray-600 mb-6">議事録を生成してください</p>
              <button
                onClick={onManualUpdate}
                disabled={isLocked || isGenerating}
                className={`px-6 py-3 rounded-lg font-medium transition-colors text-base ${
                  isLocked || isGenerating
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isGenerating ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>生成中...</span>
                  </div>
                ) : (
                  '✨ 議事録を生成'
                )}
              </button>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 'calc(100vh - 400px)' }}>
            <div className="text-6xl mb-6">🎙️</div>
            <p className="text-lg text-gray-600 mb-4">記録中の会議がありません</p>
            <p className="text-base text-gray-500">Google Meetで記録を開始してください</p>
          </div>
        )}
      </div>

      {isLocked && (
        <div className="absolute inset-0 bg-gray-200 bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-700">処理中...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default LiveMinutesPanel