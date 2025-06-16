import React, { useState, useEffect } from 'react'
import { NextStep } from '@/types'
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
      onUpdateNextStep(editingId, { task: editingTask.trim() })
      setEditingId(null)
      setEditingTask('')
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
    onUpdateNextStep(nextStep.id, { 
      status: statusFlow[nextStep.status],
      isPending: statusFlow[nextStep.status] === 'pending'
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

  return (
    <div className="nextsteps-panel">
      <div className="nextsteps-header">
        <h3 className="text-lg font-semibold">ネクストステップ</h3>
        <div className="header-actions">
          <button
            onClick={() => setShowUserPrompt(!showUserPrompt)}
            className="btn-icon"
            title="プロンプト設定"
          >
            ⚙️
          </button>
          <button
            onClick={onGenerateNextSteps}
            disabled={isGenerating}
            className="btn-generate"
          >
            {isGenerating ? (
              <>
                <span className="spinner"></span>
                生成中...
              </>
            ) : (
              <>
                <span className="icon">✨</span>
                生成
              </>
            )}
          </button>
        </div>
      </div>

      {showUserPrompt && (
        <div className="user-prompt-section">
          <textarea
            value={localUserPrompt}
            onChange={(e) => setLocalUserPrompt(e.target.value)}
            placeholder="追加の指示を入力（例：技術的なタスクを重視して抽出してください）"
            className="user-prompt-input"
            rows={3}
          />
          <button
            onClick={handlePromptSubmit}
            className="btn-apply-prompt"
          >
            適用して生成
          </button>
        </div>
      )}

      <div className="nextsteps-list">
        {sortedNextSteps.length === 0 ? (
          <div className="empty-state">
            <p>ネクストステップがありません</p>
            <p className="text-sm text-gray-500">
              会議の内容からタスクを自動抽出します
            </p>
          </div>
        ) : (
          sortedNextSteps.map((nextStep) => (
            <div
              key={nextStep.id}
              className={`nextstep-item ${nextStep.isPending ? 'pending' : ''} ${
                nextStep.status === 'completed' ? 'completed' : ''
              }`}
            >
              <div className="nextstep-main">
                <button
                  onClick={() => handleStatusToggle(nextStep)}
                  className="status-toggle"
                  title={getStatusLabel(nextStep.status)}
                >
                  {getStatusIcon(nextStep.status)}
                </button>
                
                {editingId === nextStep.id ? (
                  <div className="task-edit">
                    <input
                      type="text"
                      value={editingTask}
                      onChange={(e) => setEditingTask(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleEditSave()
                        if (e.key === 'Escape') handleEditCancel()
                      }}
                      className="task-input"
                      autoFocus
                    />
                    <button onClick={handleEditSave} className="btn-save">
                      ✓
                    </button>
                    <button onClick={handleEditCancel} className="btn-cancel">
                      ✗
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
                    📅 {new Date(nextStep.dueDate).toLocaleDateString('ja-JP')}
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
          ))
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
    </div>
  )
}