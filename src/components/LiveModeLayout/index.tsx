import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import ResizablePanel from '@/components/ResizablePanel'
import LiveMinutesPanel from '@/components/LiveMinutesPanel'
import LiveNextStepsPanel from '@/components/LiveNextStepsPanel'
import ResearchPanel from '@/components/ResearchPanel'
import { NextStepsEditModal } from '@/components/NextStepsEditModal'
import { logger } from '@/utils/logger'

interface LiveModeLayoutProps {
  meeting: Meeting | null
  isMinutesGenerating: boolean
  onGenerateMinutes: () => void
  onStopRecording: () => void
  isRecording?: boolean
  showNextStepsPanel?: boolean
  showResearchPanel?: boolean
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
  
  // ネクストステップパネルが非表示になった場合のタブ切り替え
  React.useEffect(() => {
    if (!showNextStepsPanel && activeTab === 'nextsteps') {
      setActiveTab('minutes')
    }
  }, [showNextStepsPanel, activeTab])

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
              isRecording={isRecording}
              showResearchPanel={showResearchPanel}
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
  isRecording = false,
  showNextStepsPanel: showNextStepsPanelProp = true,
  showResearchPanel: showResearchPanelProp = true
}: LiveModeLayoutProps) {
  // 更新処理の排他制御
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateSource, setUpdateSource] = useState<'manual' | null>(null)
  
  // AIアシスタントのレスポンス管理
  const [aiResponses, setAiResponses] = useState<Array<{
    id: string
    response: string
    duration: number
  }>>([])
  
  // AIアシスタントのレスポンスを受信
  useEffect(() => {
    const handleAIResponse = (message: any) => {
      if (message.type === 'AI_ASSISTANT_RESPONSE' && message.payload.meetingId === meeting?.id) {
        const newResponse = {
          id: Date.now().toString(),
          response: message.payload.response,
          duration: message.payload.duration
        }
        setAiResponses(prev => [...prev, newResponse])
      }
    }
    
    chrome.runtime.onMessage.addListener(handleAIResponse)
    return () => chrome.runtime.onMessage.removeListener(handleAIResponse)
  }, [meeting?.id])
  
  const handleCloseAIResponse = (id: string) => {
    setAiResponses(prev => prev.filter(r => r.id !== id))
  }

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
  const showResearchPanel = showResearchPanelProp
  const showNextStepsPanel = showNextStepsPanelProp
  
  // パネルの表示状態が変更された時に幅を再計算
  useEffect(() => {
    if (!showNextStepsPanel && !showResearchPanel) {
      // 議事録のみ表示
      setLeftPanelWidth(100)
    } else if (!showNextStepsPanel && showResearchPanel) {
      // 議事録とリサーチの2パネル
      setLeftPanelWidth(70)
      setRightPanelWidth(30)
    } else if (showNextStepsPanel && !showResearchPanel) {
      // 議事録とネクストステップの2パネル
      setLeftPanelWidth(50)
      setMiddlePanelWidth(50)
    } else {
      // 3パネルすべて表示
      // デフォルトの3パネル配分に設定
      setLeftPanelWidth(40)
      setMiddlePanelWidth(40)
      setRightPanelWidth(20)
    }
  }, [showNextStepsPanel, showResearchPanel])

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
            showNextStepsPanel={showNextStepsPanel}
          />
        </div>
      ) : (
        // デスクトップ版: パネルを横並び（列型）レイアウト
        <div className="h-full flex gap-2">
          {/* 左側: 議事録パネル */}
          <div 
            className="bg-white rounded-lg shadow-sm overflow-hidden"
            style={{ 
              width: (() => {
                if (!showNextStepsPanel && !showResearchPanel) {
                  return '100%';
                } else if (!showNextStepsPanel && showResearchPanel) {
                  return `${(leftPanelWidth / (leftPanelWidth + rightPanelWidth)) * 100}%`;
                } else if (showNextStepsPanel && !showResearchPanel) {
                  return `${(leftPanelWidth / (leftPanelWidth + middlePanelWidth)) * 100}%`;
                } else {
                  return `${leftPanelWidth}%`;
                }
              })()
            }}
          >
            <LiveMinutesPanel 
              meeting={meeting}
              isGenerating={isMinutesGenerating || (isUpdating && updateSource === 'manual')}
              isLocked={isUpdating}
              onManualUpdate={handleUpdate}
              isRecording={isRecording}
              showResearchPanel={showResearchPanel}
            />
          </div>
          
          {/* リサイザー1: 議事録とネクストステップの間（ネクストステップ表示時のみ） */}
          {showNextStepsPanel && (
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
                    // 3つのパネルが表示されている場合：最小20%
                    if (deltaX > 0) {
                      // 右に動かす：ネクストステップを小さくする
                      const newMiddleWidth = Math.max(20, startMiddleWidth - deltaX)
                      const newLeftWidth = Math.min(60, startLeftWidth + deltaX)
                      
                      // 合計が80%（リサーチパネル分を除く）を超えないように調整
                      const totalLeftMiddle = 100 - rightPanelWidth
                      if (newLeftWidth + newMiddleWidth <= totalLeftMiddle) {
                        setLeftPanelWidth(newLeftWidth)
                        setMiddlePanelWidth(newMiddleWidth)
                      }
                    } else {
                      // 左に動かす：議事録を小さくする
                      const newLeftWidth = Math.max(20, startLeftWidth + deltaX)
                      const newMiddleWidth = Math.min(60, startMiddleWidth - deltaX)
                      
                      // 合計が80%（リサーチパネル分を除く）を超えないように調整
                      const totalLeftMiddle = 100 - rightPanelWidth
                      if (newLeftWidth + newMiddleWidth <= totalLeftMiddle) {
                        setLeftPanelWidth(newLeftWidth)
                        setMiddlePanelWidth(newMiddleWidth)
                      }
                    }
                  } else {
                    // 2つのパネルが表示されている場合：最小30%、最大70%
                    if (deltaX > 0) {
                      // 右に動かす：議事録を大きく、ネクストステップを小さく
                      const newLeftWidth = Math.min(70, startLeftWidth + deltaX)
                      const newMiddleWidth = Math.max(30, 100 - newLeftWidth)
                      
                      setLeftPanelWidth(newLeftWidth)
                      setMiddlePanelWidth(newMiddleWidth)
                    } else {
                      // 左に動かす：議事録を小さく、ネクストステップを大きく
                      const newLeftWidth = Math.max(30, startLeftWidth + deltaX)
                      const newMiddleWidth = Math.min(70, 100 - newLeftWidth)
                      
                      setLeftPanelWidth(newLeftWidth)
                      setMiddlePanelWidth(newMiddleWidth)
                    }
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
          
          {/* 中央: ネクストステップパネル（表示時のみ） */}
          {showNextStepsPanel && (
            <div 
              className="bg-white rounded-lg shadow-sm overflow-hidden"
              style={{
                width: (() => {
                  if (!showResearchPanel) {
                    // リサーチパネルが非表示の場合、残りの幅を使用
                    return `${middlePanelWidth}%`;
                  } else {
                    return `${middlePanelWidth}%`;
                  }
                })()
              }}
            >
              <LiveNextStepsPanel 
                meeting={meeting}
                isLocked={isUpdating}
              />
            </div>
          )}
          
          {/* リサイザー2: ネクストステップとリサーチの間（両方表示時のみ） */}
          {showNextStepsPanel && showResearchPanel && (
              <div 
                className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startRightWidth = rightPanelWidth
                  const startMiddleWidth = middlePanelWidth
                  const startLeftWidth = leftPanelWidth
                  
                  const handleMouseMove = (e: MouseEvent) => {
                    const deltaX = ((e.clientX - startX) / window.innerWidth) * 100
                    
                    if (deltaX > 0) {
                      // 右に動かす：リサーチパネルを小さくする
                      const newRightWidth = Math.max(20, startRightWidth - deltaX)
                      const newMiddleWidth = Math.min(60, startMiddleWidth + deltaX)
                      
                      // 合計が100%になるように調整
                      const newLeftWidth = 100 - newMiddleWidth - newRightWidth
                      if (newLeftWidth >= 20) {
                        setLeftPanelWidth(newLeftWidth)
                        setMiddlePanelWidth(newMiddleWidth)
                        setRightPanelWidth(newRightWidth)
                      }
                    } else {
                      // 左に動かす：ネクストステップを小さくする
                      const newMiddleWidth = Math.max(20, startMiddleWidth + deltaX)
                      const newRightWidth = Math.min(60, startRightWidth - deltaX)
                      
                      // 合計が100%になるように調整
                      const newLeftWidth = 100 - newMiddleWidth - newRightWidth
                      if (newLeftWidth >= 20) {
                        setLeftPanelWidth(newLeftWidth)
                        setMiddlePanelWidth(newMiddleWidth)
                        setRightPanelWidth(newRightWidth)
                      }
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
          
          {/* リサイザー3: 議事録とリサーチの間（ネクストステップ非表示時のみ） */}
          {!showNextStepsPanel && showResearchPanel && (
            <div 
              className="w-1 bg-gray-300 hover:bg-blue-500 cursor-col-resize transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                const startX = e.clientX
                const startLeftWidth = leftPanelWidth
                const startRightWidth = rightPanelWidth
                
                const handleMouseMove = (e: MouseEvent) => {
                  const deltaX = ((e.clientX - startX) / window.innerWidth) * 100
                  
                  // 2つのパネルが表示されている場合：最小30%
                  const newLeftWidth = Math.max(30, Math.min(70, startLeftWidth + deltaX))
                  const newRightWidth = 100 - newLeftWidth
                  
                  setLeftPanelWidth(newLeftWidth)
                  setRightPanelWidth(newRightWidth)
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
                style={{ 
                  width: (() => {
                    if (!showNextStepsPanel) {
                      // ネクストステップパネルが非表示の場合
                      return `${(rightPanelWidth / (leftPanelWidth + rightPanelWidth)) * 100}%`;
                    } else {
                      // 3つすべて表示されている場合
                      return `${rightPanelWidth}%`;
                    }
                  })()
                }}
              >
                <ResearchPanel 
                  meeting={meeting}
                  isLocked={isUpdating}
                />
              </div>
          )}
        </div>
      )}
      
      {/* ネクストステップ編集モーダル表示 */}
      {aiResponses.map((resp) => (
        <NextStepsEditModal
          key={resp.id}
          meetingId={meeting?.id || ''}
          response={resp.response}
          duration={resp.duration}
          onClose={() => handleCloseAIResponse(resp.id)}
        />
      ))}
    </div>
  )
}