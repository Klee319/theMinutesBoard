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
  source: 'ai' | 'web' | 'voice'
  timestamp: Date
  webResults?: {
    title: string
    url: string
    snippet: string
  }[]
}

interface ChatMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function ResearchPanel({ meeting, isLocked = false }: ResearchPanelProps) {
  const [isWebSearchEnabled, setIsWebSearchEnabled] = useState(false)
  const [researchResults, setResearchResults] = useState<ResearchResult[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'research' | 'chat'>('research')

  // ミーティングが変わったらリサーチ結果をクリア
  useEffect(() => {
    if (meeting?.id) {
      loadResearchResults(meeting.id)
      loadChatHistory(meeting.id)
    } else {
      setResearchResults([])
      setChatMessages([])
    }
  }, [meeting?.id])

  const loadResearchResults = async (meetingId: string) => {
    try {
      const result = await chrome.storage.local.get([`research_${meetingId}`])
      const results = result[`research_${meetingId}`] || []
      setResearchResults(results)
    } catch (error) {
      logger.error('Failed to load research results:', error)
    }
  }

  const loadChatHistory = async (meetingId: string) => {
    try {
      const result = await chrome.storage.local.get([`research_chat_${meetingId}`])
      const messages = result[`research_chat_${meetingId}`] || []
      setChatMessages(messages)
    } catch (error) {
      logger.error('Failed to load chat history:', error)
    }
  }

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

  const handleVoiceMessage = async (userMessage: string, aiResponse: string) => {
    if (!meeting?.id) return

    const newMessages: ChatMessage[] = [
      {
        id: Date.now().toString(),
        type: 'user',
        content: userMessage,
        timestamp: new Date()
      },
      {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      }
    ]

    const updatedMessages = [...chatMessages, ...newMessages]
    setChatMessages(updatedMessages)

    // ストレージに保存
    try {
      await chrome.storage.local.set({
        [`research_chat_${meeting.id}`]: updatedMessages
      })
    } catch (error) {
      logger.error('Failed to save chat history:', error)
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
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('research')}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'research'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              検索結果
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'chat'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              チャット履歴
            </button>
          </div>
          
          {meeting && (
            <ResearchVoiceButton
              meetingId={meeting.id}
              onNewMessage={handleVoiceMessage}
              disabled={isLocked}
            />
          )}
        </div>
      </div>

      {/* コンテンツ表示エリア */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'research' ? (
          // リサーチ結果タブ
          !meeting ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🔍</div>
              <p className="text-gray-500">会議が開始されるとリサーチ結果が表示されます</p>
            </div>
          ) : researchResults.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">📚</div>
              <p className="text-gray-500">
                {isWebSearchEnabled 
                  ? '議事録の内容に基づいてリサーチを実行します' 
                  : 'Web検索を有効にするとリサーチ機能が利用できます'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {researchResults.map((result) => (
                <div key={result.id} className="border rounded-lg p-4 bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded ${
                        result.source === 'web' 
                          ? 'bg-blue-100 text-blue-700' 
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {result.source === 'web' ? '🌐 Web' : '🤖 AI'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {result.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  
                  <h3 className="font-medium text-gray-900 mb-2">{result.query}</h3>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.content}</p>
                  
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
              ))}
            </div>
          )
        ) : (
          // チャット履歴タブ
          !meeting ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">💬</div>
              <p className="text-gray-500">会議が開始されるとチャット履歴が表示されます</p>
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🎤</div>
              <p className="text-gray-500">音声でリサーチボタンを使用してAIに質問してください</p>
            </div>
          ) : (
            <div className="space-y-4">
              {chatMessages.map((message) => (
                <div 
                  key={message.id} 
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div 
                    className={`max-w-[80%] rounded-lg p-3 ${
                      message.type === 'user' 
                        ? 'bg-blue-100 text-blue-900' 
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium">
                        {message.type === 'user' ? '👤 あなた' : '🤖 AI'}
                      </span>
                      <span className="text-xs opacity-70">
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div 
                      className="text-sm whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{ 
                        __html: message.type === 'assistant' 
                          ? formatMarkdownToHTML(message.content) 
                          : message.content 
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )
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