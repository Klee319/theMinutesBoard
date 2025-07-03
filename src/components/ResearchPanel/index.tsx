import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { ResearchVoiceButton } from '@/components/ResearchVoiceButton'
import { formatMarkdownToHTML } from '@/utils/markdown'

interface ResearchPanelProps {
  meeting: Meeting | null
  isLocked?: boolean
}

interface ResearchResult {
  id: string
  query: string
  content: string
  source: 'ai' | 'web' | 'voice' | 'user' | 'assistant'
  timestamp: Date
  webResults?: {
    title: string
    url: string
    snippet: string
  }[]
  // チャットメッセージ用の追加フィールド
  type?: 'user' | 'assistant'
  voiceTranscripts?: string[] // 音声入力中の字幕
}

export default function ResearchPanel({ meeting, isLocked = false }: ResearchPanelProps) {
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false)
  const [researchResults, setResearchResults] = useState<ResearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [voiceStartTime, setVoiceStartTime] = useState<Date | null>(null)

  // ミーティングが変わったらリサーチ結果をクリア
  useEffect(() => {
    if (meeting?.id) {
      loadResearchResults(meeting.id)
    } else {
      setResearchResults([])
    }
  }, [meeting?.id])

  // 音声録音状態の監視
  useEffect(() => {
    const handleVoiceRecordingStateChange = (event: CustomEvent) => {
      setIsRecordingVoice(event.detail.isRecording)
      if (event.detail.isRecording) {
        setVoiceStartTime(new Date())
      } else {
        setVoiceStartTime(null)
      }
    }

    window.addEventListener('voiceRecordingStateChanged', handleVoiceRecordingStateChange as EventListener)
    return () => {
      window.removeEventListener('voiceRecordingStateChanged', handleVoiceRecordingStateChange as EventListener)
    }
  }, [])

  const loadResearchResults = async (meetingId: string) => {
    try {
      const result = await chrome.storage.local.get([`research_${meetingId}`])
      const results = result[`research_${meetingId}`] || []
      setResearchResults(results)
    } catch (error) {
      logger.error('Failed to load research results:', error)
    }
  }

  // チャット履歴もリサーチ結果に統合するため削除

  const handleWebSearchToggle = () => {
    setIsWebSearchEnabled(!isWebSearchEnabled)
    logger.info('Web search toggled:', !isWebSearchEnabled)
  }

  const performResearch = async (query: string) => {
    if (!meeting?.id || isLocked) return

    setIsLoading(true)
    try {
      const response = await ChromeErrorHandler.sendMessage({
        type: 'PERFORM_RESEARCH',
        payload: {
          meetingId: meeting.id,
          query,
          enableWebSearch: isWebSearchEnabled
        }
      })

      if (response?.success && response.result) {
        const newResult: ResearchResult = {
          id: Date.now().toString(),
          query,
          content: response.result.content,
          source: response.result.source,
          timestamp: new Date(),
          webResults: response.result.webResults
        }

        const updatedResults = [...researchResults, newResult]
        setResearchResults(updatedResults)

        // ストレージに保存
        await chrome.storage.local.set({
          [`research_${meeting.id}`]: updatedResults
        })
      }
    } catch (error) {
      logger.error('Research failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 議事録の内容が更新されたら自動でリサーチを実行（オプション）
  useEffect(() => {
    if (meeting?.minutes && isWebSearchEnabled) {
      // 議事録から重要なトピックを抽出してリサーチ
      const topics = extractImportantTopics(meeting.minutes.content)
      topics.forEach(topic => {
        performResearch(topic)
      })
    }
  }, [meeting?.minutes?.content, isWebSearchEnabled])

  const extractImportantTopics = (content: string): string[] => {
    // 簡単な実装：決定事項や課題から抽出
    const topics: string[] = []
    
    // 決定事項の抽出
    const decisionMatch = content.match(/## 決定事項\s*\n+([\s\S]*?)(?=##|$)/i)
    if (decisionMatch) {
      const decisions = decisionMatch[1].match(/[-*]\s*(.+)/g)
      if (decisions) {
        topics.push(...decisions.slice(0, 2).map(d => d.replace(/[-*]\s*/, '')))
      }
    }

    return topics
  }

  const handleVoiceMessage = async (userMessage: string, aiResponse: string, voiceTranscripts?: string[]) => {
    if (!meeting?.id) return

    // ユーザーメッセージ（音声入力）を追加
    const userResult: ResearchResult = {
      id: Date.now().toString(),
      query: userMessage,
      content: userMessage,
      source: 'voice',
      type: 'user',
      timestamp: new Date()
      // voiceTranscriptsは内部的に使用されるため、チャット履歴には保存しない
    }

    // AIレスポンスを追加
    const aiResult: ResearchResult = {
      id: (Date.now() + 1).toString(),
      query: userMessage,
      content: aiResponse,
      source: 'assistant',
      type: 'assistant',
      timestamp: new Date()
    }

    const updatedResults = [...researchResults, userResult, aiResult]
    setResearchResults(updatedResults)

    // ストレージに保存
    try {
      await chrome.storage.local.set({
        [`research_${meeting.id}`]: updatedResults
      })
    } catch (error) {
      logger.error('Failed to save research results:', error)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white rounded-lg shadow-sm">
      {/* ヘッダー */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">🔍 リサーチ</h2>
          
          {/* Web検索トグル */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Web検索</span>
            <button
              onClick={handleWebSearchToggle}
              disabled={isLocked}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isWebSearchEnabled ? 'bg-blue-600' : 'bg-gray-200'
              } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isWebSearchEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
        
        {/* タブとボタン */}
        <div className="flex items-center justify-between">
          <h3 className="text-md font-semibold text-gray-900">🔍 リサーチ & チャット</h3>
          
          {meeting && (
            <ResearchVoiceButton
              meetingId={meeting.id}
              onNewMessage={handleVoiceMessage}
              disabled={isLocked}
            />
          )}
        </div>
      </div>

      {/* コンテンツ表示エリア - 統合ビュー */}
      <div className="flex-1 overflow-y-auto p-4">
        {!meeting ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🔍</div>
            <p className="text-gray-500">会議が開始されるとリサーチ機能が利用できます</p>
          </div>
        ) : researchResults.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🎤</div>
            <p className="text-gray-500">
              音声ボタンを押してAIに質問したり、リサーチを依頼してください
            </p>
            {!isWebSearchEnabled && (
              <p className="text-xs text-gray-400 mt-2">
                Web検索を有効にすると、より詳細なリサーチが可能になります
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {researchResults.map((result) => (
              <div key={result.id}>
                {/* ユーザーメッセージまたは検索クエリ */}
                {(result.type === 'user' || result.source === 'voice') && (
                  <div className="flex justify-end mb-2">
                    <div className="max-w-[80%] bg-blue-100 text-blue-900 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">👤 あなた</span>
                        <span className="text-xs opacity-70">
                          {result.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm">{result.query}</p>
                      {/* 音声入力中の字幕は表示しない（内部的にコンテキストとして使用） */}
                    </div>
                  </div>
                )}
                
                {/* AIレスポンスまたは検索結果 */}
                {(result.type === 'assistant' || (result.source !== 'voice' && result.source !== 'user')) && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] bg-gray-100 text-gray-900 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-1 rounded ${
                          result.source === 'web' 
                            ? 'bg-blue-100 text-blue-700' 
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {result.source === 'web' ? '🌐 Web' : '🤖 AI'}
                        </span>
                        <span className="text-xs opacity-70">
                          {result.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <div 
                        className="text-sm whitespace-pre-wrap"
                        dangerouslySetInnerHTML={{ 
                          __html: formatMarkdownToHTML(result.content)
                        }}
                      />
                      
                      {/* Web検索結果のリンク */}
                      {result.webResults && result.webResults.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs text-gray-500 mb-2">参考リンク:</p>
                          <div className="space-y-1">
                            {result.webResults.map((webResult, idx) => (
                              <a
                                key={idx}
                                href={webResult.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-xs text-blue-600 hover:text-blue-800 truncate"
                              >
                                {webResult.title}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {isLoading && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    </div>
  )
}