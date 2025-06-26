import React from 'react'
import { formatMarkdownToHTML } from '@/utils/markdown'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { logger } from '@/utils/logger'
import './styles.css'

interface NextStepsEditModalProps {
  meetingId: string
  response: string
  duration: number
  onClose: () => void
}

export const NextStepsEditModal: React.FC<NextStepsEditModalProps> = ({
  meetingId,
  response,
  duration,
  onClose
}) => {
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleConfirm = async () => {
    try {
      // ネクストステップを更新するリクエストを送信
      const result = await ChromeErrorHandler.sendMessage({
        type: 'UPDATE_NEXTSTEPS_FROM_VOICE',
        payload: {
          meetingId,
          voiceInstructions: response
        }
      })

      if (result?.success) {
        logger.info('NextSteps updated successfully')
        onClose()
      } else {
        throw new Error(result?.error || 'Failed to update NextSteps')
      }
    } catch (error) {
      logger.error('Failed to update NextSteps:', error)
      alert('ネクストステップの更新に失敗しました')
    }
  }

  return (
    <div className="nextsteps-edit-modal-overlay">
      <div className="nextsteps-edit-modal">
        <div className="modal-header">
          <div className="modal-title">
            <span className="icon">🎤</span>
            <span>音声によるネクストステップ編集</span>
            <span className="duration">（録音時間: {formatDuration(duration)}）</span>
          </div>
        </div>
        
        <div className="modal-content">
          <h3>編集内容：</h3>
          <div className="instruction-content" dangerouslySetInnerHTML={{ __html: formatMarkdownToHTML(response) }} />
        </div>
        
        <div className="modal-footer">
          <button onClick={handleConfirm} className="confirm-button">
            変更を完了
          </button>
          <button onClick={onClose} className="cancel-button">
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}