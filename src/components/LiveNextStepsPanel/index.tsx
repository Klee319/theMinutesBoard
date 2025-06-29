import React, { useState, useEffect } from 'react'
import { Meeting, NextStep } from '@/types'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { formatDate } from '@/utils/dateFormatter'
import { AIAssistantButton } from '@/components/AIAssistantButton'

interface LiveNextStepsPanelProps {
  meeting: Meeting | null
  isLocked: boolean
  isRecording?: boolean
}

export default function LiveNextStepsPanel({
  meeting,
  isLocked,
  isRecording = false
}: LiveNextStepsPanelProps) {
  const [nextSteps, setNextSteps] = useState<NextStep[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [autoUpdateInterval, setAutoUpdateInterval] = useState<number>(2)
  const [nextUpdateTime, setNextUpdateTime] = useState<Date | null>(null)
  const [isAutoUpdating, setIsAutoUpdating] = useState(false)

  // 設定を読み込む
  useEffect(() => {
    chrome.storage.sync.get(['settings'], (result) => {
      if (result.settings?.autoUpdateInterval !== undefined) {
        setAutoUpdateInterval(result.settings.autoUpdateInterval)
      }
    })
  }, [])

  // 自動更新タイマー
  useEffect(() => {
    if (!isRecording || autoUpdateInterval === 0 || isLocked || isGenerating || !meeting?.minutes) {
      setNextUpdateTime(null)
      return
    }

    const intervalMs = autoUpdateInterval * 60 * 1000 // 分をミリ秒に変換
    const timer = setInterval(() => {
      if (nextSteps.length > 0) { // 既にネクストステップがある場合のみ自動更新
        setIsAutoUpdating(true)
        handleGenerate()
      }
    }, intervalMs)

    // 初回の次回更新時刻を設定
    if (nextSteps.length > 0) {
      setNextUpdateTime(new Date(Date.now() + intervalMs))
    }

    return () => clearInterval(timer)
  }, [isRecording, autoUpdateInterval, isLocked, isGenerating, meeting?.minutes, nextSteps.length])

  // カウントダウンタイマー
  useEffect(() => {
    if (!nextUpdateTime || isAutoUpdating) return

    const countdownTimer = setInterval(() => {
      const now = Date.now()
      if (nextUpdateTime.getTime() <= now) {
        clearInterval(countdownTimer)
      }
    }, 1000)

    return () => clearInterval(countdownTimer)
  }, [nextUpdateTime, isAutoUpdating])

  useEffect(() => {
    if (meeting?.nextSteps) {
      setNextSteps(meeting.nextSteps)
    } else {
      setNextSteps([])
    }
  }, [meeting])

  const handleGenerate = async () => {
    if (!meeting?.minutes) {
      alert('先に議事録を生成してください')
      return
    }

    setIsGenerating(true)
    
    try {
      const response = await ChromeErrorHandler.sendMessage({
        type: 'GENERATE_NEXTSTEPS',
        payload: {
          meetingId: meeting.id,
          userPrompt: ''
        }
      })
      
      if (response.success && response.nextSteps) {
        setNextSteps(response.nextSteps)
        // 自動更新の場合は次回更新時刻を設定
        if (isAutoUpdating && autoUpdateInterval > 0) {
          const intervalMs = autoUpdateInterval * 60 * 1000
          setNextUpdateTime(new Date(Date.now() + intervalMs))
        }
      } else {
        throw new Error(response.error || 'ネクストステップの生成に失敗しました')
      }
    } catch (error) {
      logger.error('Error generating next steps:', error)
      if (!isAutoUpdating) {
        alert('ネクストステップの生成に失敗しました')
      }
    } finally {
      setIsGenerating(false)
      setIsAutoUpdating(false)
    }
  }

  const handleStatusToggle = async (stepId: string) => {
    const step = nextSteps.find(s => s.id === stepId)
    if (!step || !meeting) return

    const newStatus = step.status === 'completed' ? 'pending' : 'completed'
    
    try {
      const response = await ChromeErrorHandler.sendMessage({
        type: 'UPDATE_NEXTSTEP',
        payload: {
          meetingId: meeting.id,
          stepId,
          updates: { status: newStatus }
        }
      })
      
      if (response.success) {
        setNextSteps(prev => prev.map(s => 
          s.id === stepId ? { ...s, status: newStatus } : s
        ))
      }
    } catch (error) {
      logger.error('Error updating next step status:', error)
    }
  }

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'pending': return '○'
      case 'confirmed': return '●'
      case 'in_progress': return '◐'
      case 'completed': return '✓'
      default: return '○'
    }
  }

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-200'
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'low': return 'bg-gray-100 text-gray-700 border-gray-200'
      default: return 'bg-gray-100 text-gray-700 border-gray-200'
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <h3 className="text-md font-semibold text-gray-900">📋 ネクストステップ</h3>
          {isRecording && autoUpdateInterval > 0 && nextUpdateTime && nextSteps.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              {isAutoUpdating ? (
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 border border-green-600 border-t-transparent rounded-full animate-spin"></div>
                  <span>自動更新中...</span>
                </div>
              ) : (
                <span>
                  次回更新: {Math.max(0, Math.floor((nextUpdateTime.getTime() - Date.now()) / 1000))}秒後
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {meeting && (
            <AIAssistantButton 
              meetingId={meeting.id} 
              className="mr-2"
            />
          )}
          {nextSteps.length === 0 && meeting?.minutes && (
            <button
              onClick={handleGenerate}
              disabled={isLocked || isGenerating}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                isLocked || isGenerating
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isGenerating ? (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>生成中...</span>
                </div>
              ) : (
                '✨ 生成'
              )}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {meeting ? (
          nextSteps.length > 0 ? (
            <div className="space-y-2">
              {nextSteps.map((step) => (
                <div
                  key={step.id}
                  className={`p-3 rounded-lg border transition-all ${
                    step.isPending ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white'
                  } ${step.status === 'completed' ? 'opacity-60' : ''} hover:shadow-sm`}
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => handleStatusToggle(step.id)}
                      disabled={isLocked}
                      className={`mt-0.5 text-lg transition-colors ${
                        step.status === 'completed' 
                          ? 'text-green-600' 
                          : 'text-gray-400 hover:text-gray-600'
                      } ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      {getStatusIcon(step.status)}
                    </button>

                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium ${
                          step.status === 'completed' 
                            ? 'line-through text-gray-500' 
                            : 'text-gray-900'
                        } ${step.isPending ? 'text-orange-700' : ''}`}>
                          {step.task}
                        </p>
                        
                        {step.priority && (
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${getPriorityColor(step.priority)}`}>
                            {getPriorityLabel(step.priority)}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-600">
                        {step.assignee && (
                          <span className="flex items-center gap-1">
                            <span>👤</span>
                            <span>{step.assignee}</span>
                          </span>
                        )}
                        {step.dueDate && (
                          <span className="flex items-center gap-1">
                            <span>📅</span>
                            <span>{formatDate(step.dueDate)}</span>
                          </span>
                        )}
                        {step.notes && (
                          <span className="flex items-center gap-1" title={step.notes}>
                            <span>📝</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-3xl mb-3">📋</div>
              <p className="text-sm text-gray-600 mb-2">ネクストステップがありません</p>
              {meeting.minutes ? (
                <p className="text-xs text-gray-500">上のボタンから生成してください</p>
              ) : (
                <p className="text-xs text-gray-500">先に議事録を生成してください</p>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-3xl mb-3">📋</div>
            <p className="text-sm text-gray-600">記録を開始してください</p>
          </div>
        )}
      </div>

      {nextSteps.length > 0 && (
        <div className="p-3 border-t bg-gray-50 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>未完了: {nextSteps.filter(s => s.status !== 'completed').length}</span>
            <span>完了: {nextSteps.filter(s => s.status === 'completed').length}</span>
          </div>
        </div>
      )}
    </div>
  )
}