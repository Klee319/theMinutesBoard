import React, { useState, useEffect } from 'react'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { logger } from '@/utils/logger'
import './styles.css'

interface ResearchVoiceButtonProps {
  meetingId: string
  onNewMessage: (userMessage: string, aiResponse: string) => void
  disabled?: boolean
}

export const ResearchVoiceButton: React.FC<ResearchVoiceButtonProps> = ({ 
  meetingId,
  onNewMessage,
  disabled = false
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
        // 音声記録を停止
        const stopResponse = await ChromeErrorHandler.sendMessage({
          type: 'AI_ASSISTANT_STOP',
          payload: { meetingId }
        })

        if (stopResponse?.success && stopResponse.transcripts) {
          // 記録された音声内容を取得
          const voiceQuery = stopResponse.transcripts
            .map((t: any) => t.content)
            .join(' ')

          // リサーチを実行
          const researchResponse = await ChromeErrorHandler.sendMessage({
            type: 'AI_RESEARCH',
            payload: { 
              meetingId,
              question: voiceQuery,
              transcripts: stopResponse.transcripts.map((t: any) => t.content)
            }
          })

          if (researchResponse?.success && researchResponse.response) {
            // チャットログに追加
            onNewMessage(voiceQuery, researchResponse.response)
          } else {
            throw new Error(researchResponse?.error || 'リサーチに失敗しました')
          }
        } else {
          throw new Error(stopResponse?.error || '音声記録の取得に失敗しました')
        }
      } catch (error) {
        logger.error('Failed to process voice research:', error)
        alert('音声リサーチの処理に失敗しました')
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
          payload: { meetingId, type: 'research' }
        })

        if (!response?.success) {
          throw new Error(response?.error || '音声記録の開始に失敗しました')
        }
      } catch (error: any) {
        logger.error('Failed to start voice recording:', error)
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
    <div className="research-voice-button-container">
      <button
        onClick={handleToggleRecording}
        disabled={disabled || isProcessing}
        className={`research-voice-button ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''} ${disabled ? 'disabled' : ''}`}
        title={isRecording ? '音声記録を停止' : '音声でリサーチ'}
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
            <span>音声でリサーチ</span>
          </>
        )}
      </button>
      
      {isRecording && (
        <div className="recording-hint">
          質問内容を話してください。停止ボタンを押すとリサーチを実行します。
        </div>
      )}
    </div>
  )
}