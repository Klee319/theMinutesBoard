import React, { useState, useEffect } from 'react'
import { Meeting, NextStep } from '@/types'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { formatDate, formatRelativeDate } from '@/utils/dateFormatter'
import { TIMING_CONSTANTS, STATUS_ICONS, PRIORITY_COLORS, PRIORITY_LABELS } from '@/constants'

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

    const intervalMs = autoUpdateInterval * TIMING_CONSTANTS.MINUTES_TO_MS
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

  // meetingからネクストステップを読み込む
  useEffect(() => {
    if (meeting?.nextSteps) {
      setNextSteps(meeting.nextSteps)
    } else {
      setNextSteps([])
    }
  }, [meeting])

  // ネクストステップ生成完了メッセージを受信
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'NEXTSTEPS_GENERATED' && message.payload?.meetingId === meeting?.id) {
        logger.debug('LiveNextStepsPanel received NEXTSTEPS_GENERATED:', message.payload)
        if (message.payload.nextSteps) {
          setNextSteps(message.payload.nextSteps)
          // 自動更新後の処理
          if (isAutoUpdating) {
            setIsAutoUpdating(false)
            if (autoUpdateInterval > 0) {
              const intervalMs = autoUpdateInterval * TIMING_CONSTANTS.MINUTES_TO_MS
              setNextUpdateTime(new Date(Date.now() + intervalMs))
            }
          }
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [meeting?.id, isAutoUpdating, autoUpdateInterval])

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
          const intervalMs = autoUpdateInterval * TIMING_CONSTANTS.MINUTES_TO_MS
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
    return STATUS_ICONS[status as keyof typeof STATUS_ICONS] || STATUS_ICONS.pending
  }

  const getPriorityColor = (priority: string): string => {
    return PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] || PRIORITY_COLORS.low
  }

  const getPriorityLabel = (priority: string): string => {
    return PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] || ''
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center justify-between p-4 border-b bg-gray-50">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-gray-900">📋 ネクストステップ</h3>
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
          {/* ネクストステップ生成ボタンは削除（ライブ議事録更新時に自動生成） */}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {meeting ? (
          nextSteps.length > 0 ? (
            <div className="space-y-2">
              {nextSteps.map((step) => (
                <div
                  key={step.id}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    !step.assignee || !step.dueDate 
                      ? 'border-red-400 bg-red-50' 
                      : step.isPending 
                        ? 'border-orange-300 bg-orange-50' 
                        : 'border-gray-200 bg-white'
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
                        <div className="flex-1">
                          <p className={`text-sm font-medium ${
                            step.status === 'completed' 
                              ? 'line-through text-gray-500' 
                              : 'text-gray-900'
                          } ${step.isPending ? 'text-orange-700' : ''}`}>
                            {step.task}
                          </p>
                          {step.source === 'ai' && (
                            <span className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600">
                              <span>🤖</span>
                              <span>AI提案</span>
                            </span>
                          )}
                        </div>
                        
                        {step.priority && (
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${getPriorityColor(step.priority)}`}>
                            {getPriorityLabel(step.priority)}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap gap-3 text-xs">
                        <span className={`flex items-center gap-1 ${!step.assignee ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                          <span>👤</span>
                          <span>{step.assignee || '担当者未定'}</span>
                        </span>
                        <span className={`flex items-center gap-1 ${!step.dueDate ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                          <span>📅</span>
                          <span>{step.dueDate ? (() => {
                            try {
                              const formattedDate = formatDate(step.dueDate)
                              const relativeDate = formatRelativeDate(step.dueDate)
                              return `${formattedDate} (${relativeDate})`
                            } catch (error) {
                              logger.error('Error formatting date for step:', step.id, error)
                              return '期限未定'
                            }
                          })() : '期限未定'}</span>
                        </span>
                        {step.notes && (
                          <span className="flex items-center gap-1 text-gray-600" title={step.notes}>
                            <span>📝</span>
                            <span className="text-gray-500">{step.notes}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center flex-1">
              <div className="text-6xl mb-6">📋</div>
              <p className="text-lg text-gray-600 mb-4">ネクストステップがありません</p>
              {meeting.minutes ? (
                <p className="text-base text-gray-500">議事録更新時に自動生成されます</p>
              ) : (
                <p className="text-base text-gray-500">先に議事録を生成してください</p>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: 'calc(100vh - 400px)' }}>
            <div className="text-6xl mb-6">📋</div>
            <p className="text-lg text-gray-600">記録を開始してください</p>
          </div>
        )}
      </div>

      {nextSteps.length > 0 && (
        <div className="flex-shrink-0 p-3 border-t bg-gray-50 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>未完了: {nextSteps.filter(s => s.status !== 'completed').length}</span>
            <span>完了: {nextSteps.filter(s => s.status === 'completed').length}</span>
          </div>
        </div>
      )}
    </div>
  )
}