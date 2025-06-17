import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import ResizablePanel from '@/components/ResizablePanel'
import LiveMinutesPanel from '@/components/LiveMinutesPanel'
import LiveNextStepsPanel from '@/components/LiveNextStepsPanel'
import VoiceInputPanel from '@/components/VoiceInputPanel'
import ChatHistoryPanel from '@/components/ChatHistoryPanel'
import { logger } from '@/utils/logger'

interface LiveModeLayoutProps {
  meeting: Meeting | null
  isMinutesGenerating: boolean
  onGenerateMinutes: () => void
  onStopRecording: () => void
}

export default function LiveModeLayout({
  meeting,
  isMinutesGenerating,
  onGenerateMinutes,
  onStopRecording
}: LiveModeLayoutProps) {
  // 更新処理の排他制御
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateSource, setUpdateSource] = useState<'manual' | 'ai-edit' | null>(null)

  // 更新処理の排他制御関数
  const handleUpdate = async (source: 'manual' | 'ai-edit', updateData?: any) => {
    if (isUpdating) {
      logger.warn(`Update already in progress by ${updateSource}`)
      return { success: false, error: '更新処理が進行中です' }
    }

    setIsUpdating(true)
    setUpdateSource(source)

    try {
      if (source === 'manual') {
        // 手動更新処理
        onGenerateMinutes()
      } else if (source === 'ai-edit') {
        // AIチャット編集処理
        // updateDataに編集指示が含まれる
        await handleAiEdit(updateData)
      }
      
      return { success: true }
    } catch (error) {
      logger.error('Update failed:', error)
      return { success: false, error: error.message }
    } finally {
      setIsUpdating(false)
      setUpdateSource(null)
    }
  }

  const handleAiEdit = async (editData: any) => {
    // AI編集処理の実装
    // バックグラウンドスクリプトに編集指示を送信
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'AI_EDIT_MINUTES',
        payload: {
          meetingId: meeting?.id,
          editInstruction: editData.instruction,
          transcriptData: editData.transcriptData
        }
      }, (response) => {
        if (response?.success) {
          resolve(response)
        } else {
          reject(new Error(response?.error || 'AI編集に失敗しました'))
        }
      })
    })
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)] md:h-[calc(100vh-140px)]">
      {/* 左側: Facilitator AI */}
      <ResizablePanel
        position="left"
        defaultWidth={600}
        minWidth={400}
        maxWidth={800}
        className="flex-shrink-0"
      >
        <div className="bg-white rounded-lg shadow-sm h-full flex flex-col">
          <div className="p-4 border-b bg-blue-50">
            <h2 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
              🤖 Facilitator AI
              {meeting && (
                <div className="flex items-center gap-1 ml-auto">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-sm text-red-600 font-medium">記録中</span>
                </div>
              )}
            </h2>
          </div>
          
          <div className="flex-1 flex flex-col">
            {/* 議事録（実況）セクション */}
            <div className="flex-1 border-b">
              <LiveMinutesPanel 
                meeting={meeting}
                isGenerating={isMinutesGenerating || (isUpdating && updateSource === 'manual')}
                isLocked={isUpdating}
                onManualUpdate={() => handleUpdate('manual')}
              />
            </div>
            
            {/* ネクストステップセクション */}
            <div className="h-80">
              <LiveNextStepsPanel 
                meeting={meeting}
                isLocked={isUpdating}
              />
            </div>
          </div>
        </div>
      </ResizablePanel>

      {/* 右側: 音声入力エリア */}
      <div className="flex-1 flex flex-col gap-4">
        {/* 音声コントロールパネル */}
        <div className="h-64">
          <VoiceInputPanel
            meeting={meeting}
            isLocked={isUpdating && updateSource === 'ai-edit'}
            onAiEdit={(data) => handleUpdate('ai-edit', data)}
            onStopRecording={onStopRecording}
          />
        </div>

        {/* チャット履歴パネル */}
        <div className="flex-1">
          <ChatHistoryPanel
            meeting={meeting}
          />
        </div>
      </div>
    </div>
  )
}