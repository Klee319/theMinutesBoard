import React, { useState, useEffect } from 'react'
import { Meeting, NextStep } from '@/types'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { logger } from '@/utils/logger'

interface MeetingNextStepsProps {
  meeting: Meeting
}

export default function MeetingNextSteps({ meeting }: MeetingNextStepsProps) {
  const [nextSteps, setNextSteps] = useState<NextStep[]>(meeting.nextSteps || [])
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    setNextSteps(meeting.nextSteps || [])
  }, [meeting])

  const handleGenerate = async () => {
    if (!meeting.minutes) {
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
      } else {
        throw new Error(response.error || 'ネクストステップの生成に失敗しました')
      }
    } catch (error) {
      logger.error('Error generating next steps:', error)
      alert('ネクストステップの生成に失敗しました')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleStatusToggle = async (stepId: string) => {
    const step = nextSteps.find(s => s.id === stepId)
    if (!step) return

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

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">ネクストステップ</h3>
        </div>
        
        {nextSteps.length === 0 && (
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !meeting.minutes}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>生成中...</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span>ネクストステップ生成</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {nextSteps.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">📋</div>
            <p className="text-sm text-gray-600 mb-2">ネクストステップがありません</p>
            <p className="text-xs text-gray-500">議事録から生成するには上のボタンをクリック</p>
          </div>
        ) : (
          <div className="space-y-3">
            {nextSteps.map((step) => (
              <div
                key={step.id}
                className={`p-3 bg-gray-50 rounded-lg border transition-all ${
                  step.isPending ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                } ${step.status === 'completed' ? 'opacity-60' : ''} hover:shadow-sm`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => handleStatusToggle(step.id)}
                    className={`mt-0.5 text-lg transition-colors ${
                      step.status === 'completed' ? 'text-green-600' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {getStatusIcon(step.status)}
                  </button>

                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${
                        step.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                      } ${step.isPending ? 'text-orange-700' : ''}`}>
                        {step.task}
                      </p>
                      
                      {step.priority && (
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded ${getPriorityColor(step.priority)}`}>
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
                          <span>{new Date(step.dueDate).toLocaleDateString('ja-JP')}</span>
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