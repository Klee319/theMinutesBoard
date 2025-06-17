import React, { useState, useEffect } from 'react'
import { Meeting, NextStep } from '@/types'
import { logger } from '@/utils/logger'

interface NextStepsBoardProps {
  meetings: Meeting[]
}

export default function NextStepsBoard({ meetings }: NextStepsBoardProps) {
  const [allNextSteps, setAllNextSteps] = useState<Array<NextStep & { meetingId: string; meetingTitle: string }>>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('pending')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // すべての会議からネクストステップを収集
    const steps: Array<NextStep & { meetingId: string; meetingTitle: string }> = []
    
    meetings.forEach(meeting => {
      if (meeting.nextSteps) {
        meeting.nextSteps.forEach(step => {
          steps.push({
            ...step,
            meetingId: meeting.id,
            meetingTitle: meeting.title || extractMeetingTopic(meeting.minutes?.content || '')
          })
        })
      }
    })
    
    // 優先度と期限でソート
    steps.sort((a, b) => {
      // まず状態でソート（未完了を優先）
      if (a.status === 'completed' && b.status !== 'completed') return 1
      if (a.status !== 'completed' && b.status === 'completed') return -1
      
      // 次に優先度でソート
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3
      if (aPriority !== bPriority) return aPriority - bPriority
      
      // 最後に期限でソート
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      }
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      
      return 0
    })
    
    setAllNextSteps(steps)
  }, [meetings])

  const extractMeetingTopic = (content: string): string => {
    // 会議の目的を優先的に抽出
    const purposePatterns = [
      /会議の目的[:：]\s*(.+?)[\n\r]/,
      /\*\*会議の目的\*\*[:：]\s*(.+?)[\n\r]/,
      /目的[:：]\s*(.+?)[\n\r]/
    ]
    
    for (const pattern of purposePatterns) {
      const match = content.match(pattern)
      if (match && match[1]) {
        const purpose = match[1].trim()
        return purpose.length > 30 ? purpose.substring(0, 30) + '...' : purpose
      }
    }
    
    return '議題情報なし'
  }

  const filteredSteps = allNextSteps.filter(step => {
    switch (filter) {
      case 'pending':
        return step.status === 'pending' || step.status === 'confirmed'
      case 'in_progress':
        return step.status === 'in_progress'
      case 'completed':
        return step.status === 'completed'
      default:
        return true
    }
  })

  const handleStatusChange = async (stepId: string, meetingId: string, newStatus: 'pending' | 'in_progress' | 'completed') => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_NEXTSTEP',
        payload: {
          meetingId,
          stepId,
          updates: { status: newStatus }
        }
      })
      
      if (response.success) {
        // ローカル状態を更新
        setAllNextSteps(prev => prev.map(s => 
          s.id === stepId && s.meetingId === meetingId 
            ? { ...s, status: newStatus, updatedAt: new Date() }
            : s
        ))
      }
    } catch (error) {
      logger.error('Error updating next step status:', error)
    }
  }

  const getNextStatus = (currentStatus: string): string => {
    switch (currentStatus) {
      case 'pending':
      case 'confirmed':
        return 'in_progress'
      case 'in_progress':
        return 'completed'
      case 'completed':
        return 'pending'
      default:
        return 'in_progress'
    }
  }

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending': return '○'
      case 'confirmed': return '●'
      case 'in_progress': return '⏳'
      case 'completed': return '✅'
      default: return '○'
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending': return 'text-gray-500'
      case 'confirmed': return 'text-blue-600'
      case 'in_progress': return 'text-orange-600'
      case 'completed': return 'text-green-600'
      default: return 'text-gray-500'
    }
  }

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'pending': return '未実行'
      case 'confirmed': return '確認済み'
      case 'in_progress': return '実行中'
      case 'completed': return '完了済み'
      default: return '未実行'
    }
  }

  const getPriorityLabel = (priority: string): string => {
    switch (priority) {
      case 'high': return '高'
      case 'medium': return '中'
      case 'low': return '低'
      default: return ''
    }
  }

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700'
      case 'medium': return 'bg-yellow-100 text-yellow-700'
      case 'low': return 'bg-gray-100 text-gray-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const formatDueDate = (date: string | Date | undefined): string => {
    if (!date) {
      return '期限未設定'
    }
    
    const dueDate = new Date(date)
    
    // Invalid Date チェック
    if (isNaN(dueDate.getTime())) {
      return '期限未設定'
    }
    
    const today = new Date()
    const diffTime = dueDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays < 0) {
      return `${Math.abs(diffDays)}日経過`
    } else if (diffDays === 0) {
      return '今日'
    } else if (diffDays === 1) {
      return '明日'
    } else if (diffDays <= 7) {
      return `${diffDays}日後`
    } else {
      return dueDate.toLocaleDateString('ja-JP')
    }
  }

  const getDefaultDueDate = (): Date => {
    // デフォルトで1週間後を設定
    const date = new Date()
    date.setDate(date.getDate() + 7)
    return date
  }

  return (
    <div className="h-full flex flex-col">
      {/* ヘッダー */}
      <div className="p-4 border-b">
        <h2 className="text-xl font-bold text-gray-900 mb-4">ネクストステップ総合ボード</h2>
        
        {/* フィルター */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'pending'
                ? 'bg-gray-100 text-gray-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            未実行 ({allNextSteps.filter(s => s.status === 'pending' || s.status === 'confirmed').length})
          </button>
          <button
            onClick={() => setFilter('in_progress')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'in_progress'
                ? 'bg-orange-100 text-orange-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            実行中 ({allNextSteps.filter(s => s.status === 'in_progress').length})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'completed'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            完了済み ({allNextSteps.filter(s => s.status === 'completed').length})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            すべて ({allNextSteps.length})
          </button>
        </div>
      </div>

      {/* ネクストステップリスト */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredSteps.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📋</div>
            <p className="text-xl text-gray-600 mb-2">
              {filter === 'pending' ? '未実行のタスクはありません' :
               filter === 'in_progress' ? '実行中のタスクはありません' :
               filter === 'completed' ? '完了済みのタスクはありません' :
               'ネクストステップがありません'}
            </p>
            <p className="text-gray-500">会議の議事録からネクストステップを生成してください</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSteps.map((step) => (
              <div
                key={`${step.meetingId}-${step.id}`}
                className={`p-4 bg-white rounded-lg border transition-all ${
                  step.isPending ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                } ${step.status === 'completed' ? 'opacity-60' : ''} hover:shadow-sm`}
              >
                <div className="flex items-start gap-3">
                  {/* ステータスボタン */}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => handleStatusChange(step.id, step.meetingId, getNextStatus(step.status) as 'pending' | 'in_progress' | 'completed')}
                      className={`text-lg transition-all hover:scale-110 ${getStatusColor(step.status)}`}
                      title={`${getStatusLabel(step.status)} → ${getStatusLabel(getNextStatus(step.status))}`}
                    >
                      {getStatusIcon(step.status)}
                    </button>
                    <span className={`text-xs font-medium ${getStatusColor(step.status)}`}>
                      {getStatusLabel(step.status)}
                    </span>
                  </div>

                  {/* コンテンツ */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className={`font-medium ${
                          step.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                        } ${step.isPending ? 'text-orange-700' : ''}`}>
                          {step.task}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {step.meetingTitle}
                        </p>
                      </div>
                      
                      {/* 優先度バッジ */}
                      {step.priority && (
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded ${getPriorityColor(step.priority)}`}>
                          {getPriorityLabel(step.priority)}
                        </span>
                      )}
                    </div>

                    {/* メタ情報 */}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                      {step.assignee && (
                        <span className="flex items-center gap-1">
                          <span>👤</span>
                          <span>{step.assignee}</span>
                        </span>
                      )}
                      <span className={`flex items-center gap-1 ${
                        step.dueDate && new Date(step.dueDate) < new Date() && step.status !== 'completed' ? 'text-red-600 font-medium' : ''
                      }`}>
                        <span>📅</span>
                        <span>{formatDueDate(step.dueDate)}</span>
                      </span>
                      {step.notes && (
                        <span className="flex items-center gap-1" title={step.notes}>
                          <span>📝</span>
                          <span className="truncate max-w-xs">{step.notes}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 統計情報 */}
      <div className="p-4 border-t bg-gray-50">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-gray-600">{allNextSteps.filter(s => s.status === 'pending' || s.status === 'confirmed').length}</p>
            <p className="text-xs text-gray-600">未実行</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-600">{allNextSteps.filter(s => s.status === 'in_progress').length}</p>
            <p className="text-xs text-gray-600">実行中</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{allNextSteps.filter(s => s.status === 'completed').length}</p>
            <p className="text-xs text-gray-600">完了済み</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">{allNextSteps.filter(s => s.isPending).length}</p>
            <p className="text-xs text-gray-600">要確認</p>
          </div>
        </div>
      </div>
    </div>
  )
}