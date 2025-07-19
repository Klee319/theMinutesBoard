import React, { useState, useEffect, useRef, startTransition } from 'react'
import { NextStep } from '@/types'
import { announceToScreenReader, generateId } from '@/utils/accessibility'
import './styles.css'

interface NextStepsPanelProps {
  meetingId: string
  nextSteps: NextStep[]
  onUpdateNextStep: (id: string, updates: Partial<NextStep>) => void
  onDeleteNextStep: (id: string) => void
  onGenerateNextSteps: () => void
  isGenerating: boolean
  userPrompt?: string
  onUserPromptChange?: (prompt: string) => void
}

export const NextStepsPanel: React.FC<NextStepsPanelProps> = ({
  meetingId,
  nextSteps,
  onUpdateNextStep,
  onDeleteNextStep,
  onGenerateNextSteps,
  isGenerating,
  userPrompt = '',
  onUserPromptChange
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState('')
  const [showUserPrompt, setShowUserPrompt] = useState(false)
  const [localUserPrompt, setLocalUserPrompt] = useState(userPrompt)

  // 優先度でソート
  const sortedNextSteps = [...nextSteps].sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    return (priorityOrder[a.priority || 'low'] - priorityOrder[b.priority || 'low']) ||
           (a.isPending ? -1 : 1)
  })

  const handleEditStart = (nextStep: NextStep) => {
    setEditingId(nextStep.id)
    setEditingTask(nextStep.task)
  }

  const handleEditSave = () => {
    if (editingId && editingTask.trim()) {
      startTransition(() => {
        onUpdateNextStep(editingId, { task: editingTask.trim() })
        setEditingId(null)
        setEditingTask('')
        announceToScreenReader('タスクが更新されました')
      })
    }
  }

  const handleEditCancel = () => {
    setEditingId(null)
    setEditingTask('')
  }

  const handleStatusToggle = (nextStep: NextStep) => {
    const statusFlow: Record<string, NextStep['status']> = {
      'pending': 'confirmed',
      'confirmed': 'in_progress',
      'in_progress': 'completed',
      'completed': 'pending'
    }
    const newStatus = statusFlow[nextStep.status]
    startTransition(() => {
      onUpdateNextStep(nextStep.id, { 
        status: newStatus,
        isPending: newStatus === 'pending'
      })
      announceToScreenReader(`ステータスが${getStatusLabel(newStatus)}に変更されました`)
    })
  }

  const handlePromptSubmit = () => {
    if (onUserPromptChange) {
      onUserPromptChange(localUserPrompt)
    }
    onGenerateNextSteps()
  }

  const getStatusIcon = (status: NextStep['status']) => {
    switch (status) {
      case 'pending': return '○'
      case 'confirmed': return '●'
      case 'in_progress': return '◐'
      case 'completed': return '✓'
    }
  }

  const getStatusLabel = (status: NextStep['status']) => {
    switch (status) {
      case 'pending': return '未確定'
      case 'confirmed': return '確定'
      case 'in_progress': return '進行中'
      case 'completed': return '完了'
    }
  }

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'text-red-600'
      case 'medium': return 'text-yellow-600'
      case 'low': return 'text-gray-600'
      default: return 'text-gray-600'
    }
  }

  const panelId = useRef(generateId('nextsteps-panel')).current
  const listId = useRef(generateId('nextsteps-list')).current

  return (
    <section className="nextsteps-panel" role="region" aria-labelledby={`${panelId}-heading`}>
      <div className="nextsteps-header">
        <h3 id={`${panelId}-heading`} className="text-lg font-semibold">ネクストステップ</h3>
        <div className="header-actions">
          <button
            onClick={() => setShowUserPrompt(!showUserPrompt)}
            className="btn-icon"
            aria-label="プロンプト設定"
            aria-expanded={showUserPrompt}
            aria-controls="user-prompt-section"
          >
            <span aria-hidden="true">⚙️</span>
          </button>
          <button
            onClick={onGenerateNextSteps}
            disabled={isGenerating}
            className="btn-generate"
            aria-label="ネクストステップを生成"
            aria-busy={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="spinner" aria-hidden="true"></span>
                <span>生成中...</span>
              </>
            ) : (
              <>
                <span className="icon" aria-hidden="true">✨</span>
                <span>生成</span>
              </>
            )}
          </button>
        </div>
      </div>

      {showUserPrompt && (
        <div id="user-prompt-section" className="user-prompt-section">
          <label htmlFor={`${panelId}-prompt-input`} className="sr-only">
            ネクストステップ生成の追加指示
          </label>
          <textarea
            id={`${panelId}-prompt-input`}
            value={localUserPrompt}
            onChange={(e) => setLocalUserPrompt(e.target.value)}
            placeholder="追加の指示を入力（例：技術的なタスクを重視して抽出してください）"
            className="user-prompt-input"
            rows={3}
            aria-describedby={`${panelId}-prompt-help`}
          />
          <span id={`${panelId}-prompt-help`} className="sr-only">
            AIがネクストステップを生成する際の追加の指示を入力できます
          </span>
          <button
            onClick={handlePromptSubmit}
            className="btn-apply-prompt"
            aria-label="プロンプトを適用してネクストステップを生成"
          >
            適用して生成
          </button>
        </div>
      )}

      <div className="nextsteps-list" role="list" aria-labelledby={`${panelId}-heading`} id={listId}>
        {sortedNextSteps.length === 0 ? (
          <div className="empty-state" role="status">
            <p>ネクストステップがありません</p>
            <p className="text-sm text-gray-500">
              会議の内容からタスクを自動抽出します
            </p>
          </div>
        ) : (
          <>
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {sortedNextSteps.length}個のネクストステップがあります
            </div>
            {sortedNextSteps.map((nextStep) => (
            <div
              key={nextStep.id}
              className={`nextstep-item ${nextStep.isPending ? 'pending' : ''} ${
                nextStep.status === 'completed' ? 'completed' : ''
              }`}
              role="listitem"
              aria-label={`タスク: ${nextStep.task}`}
            >
              <div className="nextstep-main">
                <button
                  onClick={() => handleStatusToggle(nextStep)}
                  className="status-toggle"
                  aria-label={`ステータスを変更: 現在は${getStatusLabel(nextStep.status)}`}
                  aria-pressed={nextStep.status === 'completed'}
                >
                  <span aria-hidden="true">{getStatusIcon(nextStep.status)}</span>
                </button>
                
                {editingId === nextStep.id ? (
                  <div className="task-edit" role="group" aria-label="タスク編集">
                    <label htmlFor={`edit-task-${nextStep.id}`} className="sr-only">
                      タスク内容を編集
                    </label>
                    <input
                      id={`edit-task-${nextStep.id}`}
                      type="text"
                      value={editingTask}
                      onChange={(e) => setEditingTask(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditSave()
                        if (e.key === 'Escape') handleEditCancel()
                      }}
                      className="task-input"
                      autoFocus
                      aria-describedby={`edit-help-${nextStep.id}`}
                    />
                    <span id={`edit-help-${nextStep.id}`} className="sr-only">
                      Enterキーで保存、Escapeキーでキャンセル
                    </span>
                    <button 
                      onClick={handleEditSave} 
                      className="btn-save"
                      aria-label="編集を保存"
                    >
                      <span aria-hidden="true">✓</span>
                    </button>
                    <button 
                      onClick={handleEditCancel} 
                      className="btn-cancel"
                      aria-label="編集をキャンセル"
                    >
                      <span aria-hidden="true">✗</span>
                    </button>
                  </div>
                ) : (
                  <div 
                    className="task-content"
                    onClick={() => handleEditStart(nextStep)}
                  >
                    <span className={`task-text ${nextStep.isPending ? 'text-red-600' : ''}`}>
                      {nextStep.task}
                    </span>
                    {nextStep.priority && (
                      <span className={`priority-badge ${getPriorityColor(nextStep.priority)}`}>
                        {nextStep.priority === 'high' ? '高' : 
                         nextStep.priority === 'medium' ? '中' : '低'}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="nextstep-meta">
                {nextStep.assignee && (
                  <span className="assignee">
                    👤 {nextStep.assignee}
                  </span>
                )}
                {nextStep.dueDate && (
                  <span className="due-date">
                    📅 {(() => {
                      const date = new Date(nextStep.dueDate);
                      return isNaN(date.getTime()) ? '期限未設定' : date.toLocaleDateString('ja-JP');
                    })()}
                  </span>
                )}
                {nextStep.notes && (
                  <span className="notes" title={nextStep.notes}>
                    📝
                  </span>
                )}
              </div>

              <button
                onClick={() => onDeleteNextStep(nextStep.id)}
                className="btn-delete"
                title="削除"
              >
                🗑️
              </button>
            </div>
          ))}
          </>
        )}
      </div>

      <div className="nextsteps-footer">
        <div className="legend">
          <span className="legend-item">
            <span className="text-red-600">●</span> 未確定
          </span>
          <span className="legend-item">
            <span className="text-gray-600">●</span> 確定済み
          </span>
          <span className="legend-item">
            <span className="text-gray-400">✓</span> 完了
          </span>
        </div>
      </div>
    </section>
  )
}