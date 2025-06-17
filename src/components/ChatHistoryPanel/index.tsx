import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import { logger } from '@/utils/logger'

interface ChatMessage {
  id: string
  type: 'user' | 'assistant'
  content: string
  timestamp: Date
  mode?: 'edit' | 'research'
}

interface ChatHistoryPanelProps {
  meeting: Meeting | null
}

export default function ChatHistoryPanel({ meeting }: ChatHistoryPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    // 会議が変わったら履歴をクリア
    if (meeting) {
      loadChatHistory(meeting.id)
    } else {
      setMessages([])
    }
  }, [meeting])

  useEffect(() => {
    // AI処理完了メッセージを監視
    const handleAiResponse = (message: any) => {
      if (message.type === 'AI_RESPONSE' && meeting?.id === message.payload.meetingId) {
        addMessage({
          type: 'assistant',
          content: message.payload.response,
          mode: message.payload.mode
        })
      }
    }

    chrome.runtime.onMessage.addListener(handleAiResponse)
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleAiResponse)
    }
  }, [meeting])

  const loadChatHistory = async (meetingId: string) => {
    try {
      const result = await chrome.storage.local.get([`chatHistory_${meetingId}`])
      const history = result[`chatHistory_${meetingId}`] || []
      setMessages(history.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      })))
    } catch (error) {
      logger.error('Error loading chat history:', error)
    }
  }

  const saveChatHistory = async (newMessages: ChatMessage[]) => {
    if (!meeting) return
    
    try {
      await chrome.storage.local.set({
        [`chatHistory_${meeting.id}`]: newMessages
      })
    } catch (error) {
      logger.error('Error saving chat history:', error)
    }
  }

  const addMessage = (messageData: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      timestamp: new Date(),
      ...messageData
    }

    const updatedMessages = [...messages, newMessage]
    setMessages(updatedMessages)
    saveChatHistory(updatedMessages)
  }

  // 外部から呼び出されるメソッドをexpose
  useEffect(() => {
    (window as any).addChatMessage = addMessage
  }, [messages])

  const formatTimestamp = (timestamp: Date): string => {
    return timestamp.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const getModeIcon = (mode?: 'edit' | 'research'): string => {
    switch (mode) {
      case 'edit': return '✏️'
      case 'research': return '🔍'
      default: return '💬'
    }
  }

  const getModeLabel = (mode?: 'edit' | 'research'): string => {
    switch (mode) {
      case 'edit': return '編集'
      case 'research': return 'リサーチ'
      default: return ''
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm h-full flex flex-col">
      <div className="p-4 border-b bg-green-50">
        <h2 className="text-lg font-semibold text-green-900">📝 リレキ（履歴）</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {meeting ? (
          messages.length > 0 ? (
            <div className="space-y-4">
              {messages.map((message) => (
                <div key={message.id} className="flex flex-col">
                  <div className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        message.type === 'user'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      {message.type === 'user' && message.mode && (
                        <div className="flex items-center gap-1 mb-2 text-blue-100 text-xs">
                          <span>{getModeIcon(message.mode)}</span>
                          <span>{getModeLabel(message.mode)}</span>
                        </div>
                      )}
                      
                      <div className="text-sm whitespace-pre-wrap">
                        {message.content}
                      </div>
                      
                      <div className={`text-xs mt-2 ${
                        message.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                      }`}>
                        {formatTimestamp(message.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-gray-600 mb-2">まだ履歴がありません</p>
              <p className="text-sm text-gray-500">音声入力で編集やリサーチを試してみてください</p>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">📝</div>
            <p className="text-gray-600">記録を開始してください</p>
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <div className="p-3 border-t bg-gray-50 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>総メッセージ数: {messages.length}</span>
            <span>
              編集: {messages.filter(m => m.mode === 'edit').length} / 
              リサーチ: {messages.filter(m => m.mode === 'research').length}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}