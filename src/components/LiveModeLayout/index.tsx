import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import ResizablePanel from '@/components/ResizablePanel'
import LiveMinutesPanel from '@/components/LiveMinutesPanel'
import LiveNextStepsPanel from '@/components/LiveNextStepsPanel'
import ResearchPanel from '@/components/ResearchPanel'
import { logger } from '@/utils/logger'

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
  showResearchPanel,
  onToggleResearchPanel
}: {
  meeting: Meeting | null
  isMinutesGenerating: boolean
  isUpdating: boolean
  updateSource: 'manual' | null
  onManualUpdate: () => void
  showResearchPanel: boolean
  onToggleResearchPanel: (show: boolean) => void
}) {
  const [activeTab, setActiveTab] = useState<'minutes' | 'nextsteps' | 'research'>('minutes')

  // リサーチパネルが非表示になったときの処理
  React.useEffect(() => {
    const handleResearchToggle = (event: CustomEvent) => {
      if (!event.detail.show && activeTab === 'research') {
        setActiveTab('minutes')
      }
    }
    
    window.addEventListener('researchPanelToggled', handleResearchToggle as EventListener)
    return () => {
      window.removeEventListener('researchPanelToggled', handleResearchToggle as EventListener)
    }
  }, [activeTab])

  // リサーチパネルが非表示になった場合のタブ切り替え
  React.useEffect(() => {
    if (!showResearchPanel && activeTab === 'research') {
      setActiveTab('minutes')
    }
  }, [showResearchPanel, activeTab])

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
        {showResearchPanel && (
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
        )}
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
              showResearchPanel={showResearchPanel}
              onToggleResearchPanel={onToggleResearchPanel}
            />
          </div>
        )}
        
        {activeTab === 'nextsteps' && (
          <div className="h-full bg-white rounded-lg shadow-sm">
            <LiveNextStepsPanel 
              meeting={meeting}
              isLocked={isUpdating}
            />
          </div>
        )}
        
        {activeTab === 'research' && showResearchPanel && (
          <div className="h-full bg-white rounded-lg shadow-sm">
            <ResearchPanel 
              meeting={meeting}
              isLocked={isUpdating}
            />
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
  const [updateSource, setUpdateSource] = useState<'manual' | null>(null)

  // 更新処理の排他制御関数
  const handleUpdate = async () => {
    if (isUpdating) {
      logger.warn('Update already in progress')
      return { success: false, error: '更新処理が進行中です' }
    }

    setIsUpdating(true)
    setUpdateSource('manual')

    try {
      onGenerateMinutes()
      return { success: true }
    } catch (error) {
      logger.error('Update failed:', error)
      return { success: false, error: error.message }
    } finally {
      setIsUpdating(false)
      setUpdateSource(null)
    }
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

  // パネルのリサイズ用の状態（横並び用）
  const [leftPanelWidth, setLeftPanelWidth] = useState(40) // 40%
  const [middlePanelWidth, setMiddlePanelWidth] = useState(40) // 40%
  const [rightPanelWidth, setRightPanelWidth] = useState(20) // 20%
  const [showResearchPanel, setShowResearchPanel] = useState(true) // リサーチパネルの表示/非表示

  return (
    <div className="h-[calc(100vh-120px)] md:h-[calc(100vh-140px)]">
      {isMobile ? (
        // モバイル版: タブ切り替え
        <div className="h-full">
          <MobilePanelTabs
            meeting={meeting}
            isMinutesGenerating={isMinutesGenerating}
            isUpdating={isUpdating}
            updateSource={updateSource}
            onManualUpdate={handleUpdate}
            showResearchPanel={showResearchPanel}
            onToggleResearchPanel={setShowResearchPanel}
          />
        </div>
      ) : (
        // デスクトップ版: パネルを横並び（列型）レイアウト
        <div className="h-full flex gap-2">
          {/* 左側: 議事録パネル */}
          <div 
            className="bg-white rounded-lg shadow-sm overflow-hidden"
            style={{ 
              width: showResearchPanel 
                ? `${leftPanelWidth}%` 
                : `${(leftPanelWidth / (leftPanelWidth + middlePanelWidth)) * 100}%`
            }}
          >
            <LiveMinutesPanel 
              meeting={meeting}
              isGenerating={isMinutesGenerating || (isUpdating && updateSource === 'manual')}
              isLocked={isUpdating}
              onManualUpdate={handleUpdate}
              showResearchPanel={showResearchPanel}
              onToggleResearchPanel={setShowResearchPanel}
            />
          </div>
          
          {/* リサイザー1: 議事録とネクストステップの間 */}
          <div 
              className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startLeftWidth = leftPanelWidth
                const startMiddleWidth = middlePanelWidth
                
                const handleMouseMove = (e: MouseEvent) => {
                  const deltaX = ((e.clientX - startX) / window.innerWidth) * 100
                  
                  if (showResearchPanel) {
                    // リサーチパネルが表示されている場合：左右の幅を調整、リサーチパネルの幅は固定
                    const totalLeftMiddle = leftPanelWidth + middlePanelWidth
                    const newLeftWidth = Math.max(15, Math.min(totalLeftMiddle - 15, startLeftWidth + deltaX))
                    const newMiddleWidth = totalLeftMiddle - newLeftWidth
                    
                    setLeftPanelWidth(newLeftWidth)
                    setMiddlePanelWidth(newMiddleWidth)
                  } else {
                    // リサーチパネルが非表示の場合：左右で100%を分割
                    const newLeftWidth = Math.max(20, Math.min(80, startLeftWidth + deltaX))
                    const newMiddleWidth = 100 - newLeftWidth
                    
                    setLeftPanelWidth(newLeftWidth)
                    setMiddlePanelWidth(newMiddleWidth)
                  }
                }
                
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove)
                  document.removeEventListener('mouseup', handleMouseUp)
                }
                
                document.addEventListener('mousemove', handleMouseMove)
                document.addEventListener('mouseup', handleMouseUp)
              }}
            />
          
          {/* 中央: ネクストステップパネル */}
          <div 
              className="bg-white rounded-lg shadow-sm overflow-hidden"
              style={{
                width: showResearchPanel 
                  ? `${middlePanelWidth}%` 
                  : `${(middlePanelWidth / (leftPanelWidth + middlePanelWidth)) * 100}%`
              }}
            >
              <LiveNextStepsPanel 
                meeting={meeting}
                isLocked={isUpdating}
              />
            </div>
          
          {/* リサイザー2: ネクストステップとリサーチの間（リサーチパネル表示時のみ） */}
          {showResearchPanel && (
              <div 
                className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startRightWidth = rightPanelWidth
                  
                  const handleMouseMove = (e: MouseEvent) => {
                    const deltaX = ((e.clientX - startX) / window.innerWidth) * 100
                    const newRightWidth = Math.max(15, Math.min(50, startRightWidth - deltaX))
                    const deltaWidth = newRightWidth - rightPanelWidth
                    
                    // リサーチパネルの幅変更分を議事録とネクストステップで等分
                    const leftAdjustment = deltaWidth / 2
                    const middleAdjustment = deltaWidth / 2
                    
                    const newLeftWidth = Math.max(15, leftPanelWidth - leftAdjustment)
                    const newMiddleWidth = Math.max(15, middlePanelWidth - middleAdjustment)
                    
                    // 合計が100%になるよう調整
                    const total = newLeftWidth + newMiddleWidth + newRightWidth
                    if (total <= 100) {
                      setLeftPanelWidth(newLeftWidth)
                      setMiddlePanelWidth(newMiddleWidth)
                      setRightPanelWidth(newRightWidth)
                    }
                  }
                  
                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove)
                    document.removeEventListener('mouseup', handleMouseUp)
                  }
                  
                  document.addEventListener('mousemove', handleMouseMove)
                  document.addEventListener('mouseup', handleMouseUp)
                }}
              />
          )}
          
          {/* 右側: リサーチパネル（表示時のみ） */}
          {showResearchPanel && (
              <div 
                className="bg-white rounded-lg shadow-sm overflow-hidden"
                style={{ width: `${rightPanelWidth}%` }}
              >
                <ResearchPanel 
                  meeting={meeting}
                  isLocked={isUpdating}
                />
              </div>
          )}
        </div>
      )}
    </div>
  )
}