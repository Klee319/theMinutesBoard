import React, { useState, useEffect } from 'react'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { logger } from '@/utils/logger'
import './styles.css'

interface AIAssistantButtonProps {
  meetingId: string
  className?: string
}

export const AIAssistantButton: React.FC<AIAssistantButtonProps> = ({ 
  meetingId,
  className = ''
}) => {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)

  // 録音中の時間を更新
  useEffect(() => {
    if (!isRecording || !recordingStartTime) return

    const interval = setInterval(() => {
      const now = new Date()
      const duration = Math.floor((now.getTime() - recordingStartTime.getTime()) / 1000)
      setRecordingDuration(duration)
    }, 1000)

    return () => clearInterval(interval)
  }, [isRecording, recordingStartTime])

  const handleToggleRecording = async () => {
    if (isRecording) {
      // 停止して処理を実行
      setIsRecording(false)
      setIsProcessing(true)

      try {
        const response = await ChromeErrorHandler.sendMessage({
          type: 'AI_ASSISTANT_STOP',
          payload: { meetingId }
        })

        if (response?.success) {
          // AIアシスタントに処理を依頼
          await ChromeErrorHandler.sendMessage({
            type: 'AI_ASSISTANT_PROCESS',
            payload: { 
              meetingId,
              recordingDuration
            }
          })
        } else {
          throw new Error(response?.error || 'Failed to stop recording')
        }
      } catch (error) {
        logger.error('Failed to stop AI assistant recording:', error)
        alert('音声記録の停止に失敗しました')
      } finally {
        setIsProcessing(false)
        setRecordingStartTime(null)
        setRecordingDuration(0)
      }
    } else {
      // 録音を開始
      setIsRecording(true)
      setRecordingStartTime(new Date())
      setRecordingDuration(0)

      try {
        const response = await ChromeErrorHandler.sendMessage({
          type: 'AI_ASSISTANT_START',
          payload: { meetingId, type: 'nextsteps' }
        })

        if (!response?.success) {
          throw new Error(response?.error || 'Failed to start recording')
        }
      } catch (error: any) {
        logger.error('Failed to start AI assistant recording:', error)
        alert(error.message || '音声記録の開始に失敗しました')
        setIsRecording(false)
        setRecordingStartTime(null)
      }
    }
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className={`ai-assistant-button-container ${className}`}>
      <button
        onClick={handleToggleRecording}
        disabled={isProcessing}
        className={`ai-assistant-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
        title={isRecording ? '音声記録を停止' : '音声でネクストステップを編集'}
      >
        {isProcessing ? (
          <>
            <span className="spinner"></span>
            <span>処理中...</span>
          </>
        ) : isRecording ? (
          <>
            <span className="recording-indicator">⏺</span>
            <span>録音中 {formatDuration(recordingDuration)}</span>
            <span className="stop-text">（停止）</span>
          </>
        ) : (
          <>
            <span className="icon">🎤</span>
            <span>音声でネクストステップを編集</span>
          </>
        )}
      </button>
      
      {isRecording && (
        <div className="recording-hint">
          ネクストステップの編集内容を話してください。停止ボタンを押すと編集内容が表示されます。
        </div>
      )}
    </div>
  )
}