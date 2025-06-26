import React, { useState, useEffect } from 'react'
import { formatMarkdownToHTML } from '@/utils/markdown'
import './styles.css'

interface AIAssistantResponseProps {
  response: string
  duration: number
  onClose: () => void
}

export const AIAssistantResponse: React.FC<AIAssistantResponseProps> = ({
  response,
  duration,
  onClose
}) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    // 10秒後に自動的に閉じる
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(onClose, 300) // フェードアウトアニメーション後に削除
    }, 10000)

    return () => clearTimeout(timer)
  }, [onClose])

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className={`ai-assistant-response ${isVisible ? 'visible' : 'hidden'}`}>
      <div className="response-header">
        <div className="response-title">
          <span className="icon">🤖</span>
          <span>AIアシスタント実行結果</span>
          <span className="duration">（録音時間: {formatDuration(duration)}）</span>
        </div>
        <button onClick={onClose} className="close-button" title="閉じる">
          ×
        </button>
      </div>
      
      <div className="response-content">
        <div dangerouslySetInnerHTML={{ __html: formatMarkdownToHTML(response) }} />
      </div>
      
      <div className="response-footer">
        <div className="auto-close-hint">
          このメッセージは10秒後に自動的に閉じます
        </div>
      </div>
    </div>
  )
}