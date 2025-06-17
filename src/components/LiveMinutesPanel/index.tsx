import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import { logger } from '@/utils/logger'

interface LiveMinutesPanelProps {
  meeting: Meeting | null
  isGenerating: boolean
  isLocked: boolean
  onManualUpdate: () => void
}

export default function LiveMinutesPanel({
  meeting,
  isGenerating,
  isLocked,
  onManualUpdate
}: LiveMinutesPanelProps) {
  const [minutes, setMinutes] = useState<string>('')

  useEffect(() => {
    if (meeting?.minutes) {
      setMinutes(meeting.minutes.content)
    } else {
      setMinutes('')
    }
  }, [meeting])

  const formatMarkdownToHTML = (markdown: string): string => {
    if (!markdown) return ''
    
    return markdown
      .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2 text-gray-800">$1</h3>')
      .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-6 mb-3 text-gray-900">$1</h2>')
      .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-8 mb-4 text-gray-900">$1</h1>')
      .replace(/^\* (.+)$/gim, '<li class="ml-4 mb-1">$1</li>')
      .replace(/(<li.*<\/li>)/s, '<ul class="list-disc pl-6 mb-4">$1</ul>')
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic text-gray-700">$1</em>')
      .replace(/\n\n/g, '</p><p class="mb-3">')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)/, '<p class="mb-3">$1')
      .replace(/(.+)$/, '$1</p>')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <h3 className="text-md font-semibold text-gray-900">📝 議事録（実況）</h3>
        <button
          onClick={onManualUpdate}
          disabled={isLocked || isGenerating}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            isLocked || isGenerating
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isGenerating ? (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>更新中...</span>
            </div>
          ) : (
            '🔄 更新'
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {meeting ? (
          minutes ? (
            <div 
              className="prose prose-sm max-w-none text-gray-800 leading-relaxed"
              dangerouslySetInnerHTML={{ 
                __html: formatMarkdownToHTML(minutes)
              }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-4xl mb-4">📝</div>
              <p className="text-gray-600 mb-4">議事録を生成してください</p>
              <button
                onClick={onManualUpdate}
                disabled={isLocked || isGenerating}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  isLocked || isGenerating
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isGenerating ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>生成中...</span>
                  </div>
                ) : (
                  '✨ 議事録を生成'
                )}
              </button>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">🎙️</div>
            <p className="text-gray-600 mb-2">記録中の会議がありません</p>
            <p className="text-sm text-gray-500">Google Meetで記録を開始してください</p>
          </div>
        )}
      </div>

      {isLocked && (
        <div className="absolute inset-0 bg-gray-200 bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-700">処理中...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}