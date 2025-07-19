import React, { useState, useEffect, startTransition } from 'react'
import { Meeting, NextStep } from '@/types'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { formatDate, toSafeDate, isOverdue } from '@/utils/dateFormatter'

interface NextStepsBoardProps {
  meetings: Meeting[]
}

const NextStepsBoard = React.memo(function NextStepsBoard({ meetings }: NextStepsBoardProps) {
  const [allNextSteps, setAllNextSteps] = useState<Array<NextStep & { meetingId: string; meetingTitle: string }>>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'deleted'>('pending')
  const [isLoading, setIsLoading] = useState(false)

  // useMemoでネクストステップの収集とソートを最適化
  const sortedSteps = React.useMemo(() => {
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
      const aDate = toSafeDate(a.dueDate)
      const bDate = toSafeDate(b.dueDate)
      
      if (aDate && bDate) {
        return aDate.getTime() - bDate.getTime()
      }
      if (aDate) return -1
      if (bDate) return 1
      
      return 0
    })
    
    return steps
  }, [meetings])

  useEffect(() => {
    setAllNextSteps(sortedSteps)
  }, [sortedSteps])

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

  const filteredSteps = React.useMemo(() => {
    return allNextSteps.filter(step => {
      switch (filter) {
        case 'pending':
          return step.status === 'pending'
        case 'in_progress':
          return step.status === 'in_progress'
        case 'completed':
          return step.status === 'completed'
        case 'deleted':
          return step.status === 'deleted'
        default:
          return step.status !== 'deleted'
      }
    })
  }, [allNextSteps, filter])

  // カウントをメモ化
  const statusCounts = React.useMemo(() => ({
    pending: allNextSteps.filter(s => s.status === 'pending').length,
    in_progress: allNextSteps.filter(s => s.status === 'in_progress').length,
    completed: allNextSteps.filter(s => s.status === 'completed').length,
    deleted: allNextSteps.filter(s => s.status === 'deleted').length,
    all: allNextSteps.filter(s => s.status !== 'deleted').length,
    isPending: allNextSteps.filter(s => s.isPending).length
  }), [allNextSteps])

  const handleStatusChange = async (stepId: string, meetingId: string, newStatus: 'pending' | 'in_progress' | 'completed' | 'deleted', isPendingUpdate?: boolean) => {
    try {
      const step = allNextSteps.find(s => s.id === stepId && s.meetingId === meetingId)
      if (!step) return

      const updates: any = { status: newStatus }
      
      // isPendingフラグの更新処理
      if (isPendingUpdate !== undefined) {
        updates.isPending = isPendingUpdate
      } else if (step.isPending && newStatus !== 'pending') {
        // 要確認状態から他の状態に変更する場合は自動的にisPendingをfalseに
        updates.isPending = false
      }

      const response = await ChromeErrorHandler.sendMessage({
        type: 'UPDATE_NEXTSTEP',
        payload: {
          meetingId,
          stepId,
          updates
        }
      })
      
      if (response.success) {
        // ローカル状態を更新をstartTransitionでラップ
        startTransition(() => {
          setAllNextSteps(prev => prev.map(s => 
            s.id === stepId && s.meetingId === meetingId 
              ? { ...s, ...updates, updatedAt: new Date() }
              : s
          ))
          
          // 新しい状態に応じてフィルターを自動切り替え
          switch (newStatus) {
            case 'pending':
              setFilter('pending')
              break
            case 'in_progress':
              setFilter('in_progress')
              break
            case 'completed':
              setFilter('completed')
              break
          }
        })
      }
    } catch (error) {
      logger.error('Error updating next step status:', error)
    }
  }

  const getNextStatus = (currentStatus: string): string => {
    switch (currentStatus) {
      case 'pending':
        return 'in_progress'
      case 'in_progress':
        return 'completed'
      case 'completed':
        return 'pending'
      default:
        return 'in_progress'
    }
  }

  const getPreviousStatus = (currentStatus: string): string => {
    switch (currentStatus) {
      case 'pending':
        return 'completed'
      case 'in_progress':
        return 'pending'
      case 'completed':
        return 'in_progress'
      default:
        return 'pending'
    }
  }

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending': return '○'
      case 'in_progress': return '⏳'
      case 'completed': return '✅'
      default: return '○'
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'pending': return 'text-gray-500'
      case 'in_progress': return 'text-orange-600'
      case 'completed': return 'text-green-600'
      default: return 'text-gray-500'
    }
  }

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'pending': return '未実行'
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
    const safeDate = toSafeDate(date)
    if (!safeDate) {
      return '期限未設定'
    }
    
    const today = new Date()
    const diffTime = safeDate.getTime() - today.getTime()
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
      return formatDate(safeDate)
    }
  }

  const getDefaultDueDate = (): Date => {
    // デフォルトで1週間後を設定
    const date = new Date()
    date.setDate(date.getDate() + 7)
    return date
  }

  const handleDeletePermanently = async (stepId: string, meetingId: string) => {
    if (!confirm('このタスクを完全に削除しますか？この操作は取り消せません。')) {
      return
    }

    try {
      const response = await ChromeErrorHandler.sendMessage({
        type: 'DELETE_NEXTSTEP',
        payload: {
          meetingId,
          nextStepId: stepId
        }
      })
      
      if (response.success) {
        // ローカル状態から削除をstartTransitionでラップ
        startTransition(() => {
          setAllNextSteps(prev => prev.filter(s => 
            !(s.id === stepId && s.meetingId === meetingId)
          ))
        })
      }
    } catch (error) {
      logger.error('Error deleting next step permanently:', error)
    }
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
            未実行 ({statusCounts.pending})
          </button>
          <button
            onClick={() => setFilter('in_progress')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'in_progress'
                ? 'bg-orange-100 text-orange-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            実行中 ({statusCounts.in_progress})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'completed'
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            完了済み ({statusCounts.completed})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            すべて ({statusCounts.all})
          </button>
          <button
            onClick={() => setFilter('deleted')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              filter === 'deleted'
                ? 'bg-gray-800 text-white'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            🗑️ ゴミ箱 ({statusCounts.deleted})
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
               filter === 'deleted' ? 'ゴミ箱は空です' :
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
                } hover:shadow-sm`}
              >
                <div className="flex items-start gap-3">
                  {/* ステータスアイコン */}
                  <div className="flex flex-col gap-1 items-center">
                    <div className={`text-2xl ${getStatusColor(step.status)}`}>
                      {getStatusIcon(step.status)}
                    </div>
                    <span className={`text-xs font-medium ${getStatusColor(step.status)}`}>
                      {getStatusLabel(step.status)}
                    </span>
                  </div>

                  {/* コンテンツ */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className={`font-medium ${
                          step.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-900'
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
                    
                    {/* 状態変更ボタン */}
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {/* 要確認の場合の確認済みボタン */}
                      {step.isPending && (
                        <button
                          onClick={() => handleStatusChange(step.id, step.meetingId, step.status, false)}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          ✓ 確認済みにする
                        </button>
                      )}
                      
                      {/* 状態遷移ボタン */}
                      {step.status === 'pending' && (
                        <button
                          onClick={() => handleStatusChange(step.id, step.meetingId, 'in_progress')}
                          className="px-3 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                        >
                          → 実行中にする
                        </button>
                      )}
                      
                      {step.status === 'in_progress' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(step.id, step.meetingId, 'pending')}
                            className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                          >
                            ← 未実行に戻す
                          </button>
                          <button
                            onClick={() => handleStatusChange(step.id, step.meetingId, 'completed')}
                            className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                          >
                            ✓ 完了にする
                          </button>
                        </>
                      )}
                      
                      {step.status === 'completed' && (
                        <button
                          onClick={() => handleStatusChange(step.id, step.meetingId, 'in_progress')}
                          className="px-3 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                        >
                          ← 実行中に戻す
                        </button>
                      )}
                      
                      {/* ゴミ箱ボタン（削除済み以外のタスクに表示） */}
                      {step.status !== 'deleted' && (
                        <button
                          onClick={() => handleStatusChange(step.id, step.meetingId, 'deleted')}
                          className="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors ml-auto"
                        >
                          🗑️ 削除
                        </button>
                      )}
                      
                      {/* 復元ボタン（削除済みタスクに表示） */}
                      {step.status === 'deleted' && (
                        <>
                          <button
                            onClick={() => handleStatusChange(step.id, step.meetingId, 'pending')}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          >
                            ↩️ 復元
                          </button>
                          <button
                            onClick={() => handleDeletePermanently(step.id, step.meetingId)}
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                          >
                            ❌ 完全削除
                          </button>
                        </>
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
                        isOverdue(step.dueDate) && step.status !== 'completed' ? 'text-red-600 font-medium' : ''
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
            <p className="text-2xl font-bold text-gray-600">{statusCounts.pending}</p>
            <p className="text-xs text-gray-600">未実行</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-600">{statusCounts.in_progress}</p>
            <p className="text-xs text-gray-600">実行中</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{statusCounts.completed}</p>
            <p className="text-xs text-gray-600">完了済み</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">{statusCounts.isPending}</p>
            <p className="text-xs text-gray-600">要確認</p>
          </div>
        </div>
      </div>
    </div>
  )
})

export default NextStepsBoard