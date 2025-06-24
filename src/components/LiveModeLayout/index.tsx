import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import ResizablePanel from '@/components/ResizablePanel'
import LiveMinutesPanel from '@/components/LiveMinutesPanel'
import LiveNextStepsPanel from '@/components/LiveNextStepsPanel'
import VoiceInputPanel from '@/components/VoiceInputPanel'
import ChatHistoryPanel from '@/components/ChatHistoryPanel'
import ResearchPanel from '@/components/ResearchPanel'
import { logger } from '@/utils/logger'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'

interface LiveModeLayoutProps {
  meeting: Meeting | null
  isMinutesGenerating: boolean
  onGenerateMinutes: () => void
  onStopRecording: () => void
  isRecording?: boolean
}

// モバイル用タブコンポーネント
function MobilePanelTabs({
  meeting,
  isMinutesGenerating,
  isUpdating,
  updateSource,
  onManualUpdate,
  onAiEdit,
  onStopRecording,
  isRecording = false
}: {
  meeting: Meeting | null
  isMinutesGenerating: boolean
  isUpdating: boolean
  updateSource: 'manual' | 'ai-edit' | null
  onManualUpdate: () => void
  onAiEdit: (data: any) => void
  onStopRecording: () => void
  isRecording?: boolean
}) {
  const [activeTab, setActiveTab] = useState<'minutes' | 'nextsteps' | 'research' | 'voice'>('minutes')

  return (
    <div className="h-full flex flex-col">
      {/* タブヘッダー */}
      <div className="bg-white border-b flex overflow-x-auto">
        <button
          onClick={() => setActiveTab('minutes')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
            activeTab === 'minutes' 
              ? 'border-b-2 border-blue-500 text-blue-600' 
              : 'text-gray-600'
          }`}
        >
          議事録
        </button>
        <button
          onClick={() => setActiveTab('nextsteps')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
            activeTab === 'nextsteps' 
              ? 'border-b-2 border-blue-500 text-blue-600' 
              : 'text-gray-600'
          }`}
        >
          ネクストステップ
        </button>
        <button
          onClick={() => setActiveTab('research')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
            activeTab === 'research' 
              ? 'border-b-2 border-blue-500 text-blue-600' 
              : 'text-gray-600'
          }`}
        >
          リサーチ
        </button>
        <button
          onClick={() => setActiveTab('voice')}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
            activeTab === 'voice' 
              ? 'border-b-2 border-blue-500 text-blue-600' 
              : 'text-gray-600'
          }`}
        >
          音声/チャット
        </button>
      </div>

      {/* タブコンテンツ */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'minutes' && (
          <div className="h-full bg-white rounded-lg shadow-sm">
            <LiveMinutesPanel 
              meeting={meeting}
              isGenerating={isMinutesGenerating || (isUpdating && updateSource === 'manual')}
              isLocked={isUpdating}
              onManualUpdate={onManualUpdate}
              isRecording={isRecording}
            />
          </div>
        )}
        
        {activeTab === 'nextsteps' && (
          <div className="h-full bg-white rounded-lg shadow-sm">
            <LiveNextStepsPanel 
              meeting={meeting}
              isLocked={isUpdating}
              isRecording={isRecording}
            />
          </div>
        )}
        
        {activeTab === 'research' && (
          <div className="h-full bg-white rounded-lg shadow-sm">
            <ResearchPanel 
              meeting={meeting}
              isLocked={isUpdating}
            />
          </div>
        )}
        
        {activeTab === 'voice' && (
          <div className="h-full flex flex-col gap-4">
            <div className="h-32 flex-shrink-0">
              <VoiceInputPanel
                meeting={meeting}
                isLocked={isUpdating && updateSource === 'ai-edit'}
                onAiEdit={onAiEdit}
                onStopRecording={onStopRecording}
              />
            </div>
            <div className="flex-1 min-h-0">
              <ChatHistoryPanel
                meeting={meeting}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function LiveModeLayout({
  meeting,
  isMinutesGenerating,
  onGenerateMinutes,
  onStopRecording,
  isRecording = false
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
    return ChromeErrorHandler.sendMessage({
      type: 'AI_EDIT_MINUTES',
      payload: {
        meetingId: meeting?.id,
        editInstruction: editData.instruction,
        transcriptData: editData.transcriptData
      }
    }).then(response => {
      if (response?.success) {
        return response
      } else {
        throw new Error(response?.error || 'AI編集に失敗しました')
      }
    }).catch(error => {
      logger.error('AI edit failed:', error)
      throw new Error(ChromeErrorHandler.getUserFriendlyMessage(error))
    })
  }

  // モバイル判定
  const [isMobile, setIsMobile] = useState(false)
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => {
      window.removeEventListener('resize', checkMobile)
    }
  }, [])

  // パネルのリサイズ用の状態
  const [topPanelHeight, setTopPanelHeight] = useState(33) // 33%
  const [middlePanelHeight, setMiddlePanelHeight] = useState(33) // 33%
  // bottomPanelHeight は 100 - topPanelHeight - middlePanelHeight で計算

  return (
    <div className={`${isMobile ? 'flex-col' : 'flex'} gap-4 h-[calc(100vh-120px)] md:h-[calc(100vh-140px)]`}>
      {/* 左側: 3分割パネル（縦積み） */}
      {isMobile ? (
        // モバイル版: ResizablePanelなし、タブ切り替え
        <div className="flex-1 flex flex-col">
          <MobilePanelTabs
            meeting={meeting}
            isMinutesGenerating={isMinutesGenerating}
            isUpdating={isUpdating}
            updateSource={updateSource}
            onManualUpdate={() => handleUpdate('manual')}
            onAiEdit={(data) => handleUpdate('ai-edit', data)}
            onStopRecording={onStopRecording}
            isRecording={isRecording}
          />
        </div>
      ) : (
        <ResizablePanel
          position="left"
          defaultWidth={window.innerWidth * 0.65}
          minWidth={window.innerWidth * 0.4}
          maxWidth={window.innerWidth * 0.85}
          className="flex-shrink-0"
        >
          <div className="h-full flex flex-col gap-2">
          {/* 上部: 議事録パネル */}
          <div 
            className="bg-white rounded-lg shadow-sm overflow-hidden"
            style={{ height: `${topPanelHeight}%` }}
          >
            <LiveMinutesPanel 
              meeting={meeting}
              isGenerating={isMinutesGenerating || (isUpdating && updateSource === 'manual')}
              isLocked={isUpdating}
              onManualUpdate={() => handleUpdate('manual')}
            />
          </div>
          
          {/* リサイザー1 */}
          <div 
            className="h-1 bg-gray-300 hover:bg-blue-500 cursor-row-resize transition-colors"
            onMouseDown={(e) => {
              e.preventDefault()
              const startY = e.clientY
              const startTopHeight = topPanelHeight
              
              const handleMouseMove = (e: MouseEvent) => {
                const deltaY = ((e.clientY - startY) / window.innerHeight) * 100
                const newTopHeight = Math.max(20, Math.min(60, startTopHeight + deltaY))
                setTopPanelHeight(newTopHeight)
              }
              
              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }
              
              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          />
          
          {/* 中部: ネクストステップパネル */}
          <div 
            className="bg-white rounded-lg shadow-sm overflow-hidden"
            style={{ height: `${middlePanelHeight}%` }}
          >
            <LiveNextStepsPanel 
              meeting={meeting}
              isLocked={isUpdating}
              isRecording={isRecording}
            />
          </div>
          
          {/* リサイザー2 */}
          <div 
            className="h-1 bg-gray-300 hover:bg-blue-500 cursor-row-resize transition-colors"
            onMouseDown={(e) => {
              e.preventDefault()
              const startY = e.clientY
              const startMiddleHeight = middlePanelHeight
              
              const handleMouseMove = (e: MouseEvent) => {
                const deltaY = ((e.clientY - startY) / window.innerHeight) * 100
                const newMiddleHeight = Math.max(20, Math.min(60, startMiddleHeight + deltaY))
                const maxMiddleHeight = 100 - topPanelHeight - 20 // 下部パネルの最小高さを確保
                setMiddlePanelHeight(Math.min(newMiddleHeight, maxMiddleHeight))
              }
              
              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove)
                document.removeEventListener('mouseup', handleMouseUp)
              }
              
              document.addEventListener('mousemove', handleMouseMove)
              document.addEventListener('mouseup', handleMouseUp)
            }}
          />
          
          {/* 下部: リサーチパネル */}
          <div 
            className="bg-white rounded-lg shadow-sm overflow-hidden flex-1"
            style={{ minHeight: '20%' }}
          >
            <ResearchPanel 
              meeting={meeting}
              isLocked={isUpdating}
            />
          </div>
        </div>
      </ResizablePanel>
      )}

      {/* 右側: 音声入力とチャット履歴 (デスクトップのみ) */}
      {!isMobile && (
        <div className="flex-1 flex flex-col gap-4">
        {/* 音声コントロールパネル */}
        <div className="h-32 flex-shrink-0">
          <VoiceInputPanel
            meeting={meeting}
            isLocked={isUpdating && updateSource === 'ai-edit'}
            onAiEdit={(data) => handleUpdate('ai-edit', data)}
            onStopRecording={onStopRecording}
          />
        </div>

        {/* チャット履歴パネル */}
        <div className="flex-1 min-h-0">
          <ChatHistoryPanel
            meeting={meeting}
          />
        </div>
      </div>
      )}
    </div>
  )
}