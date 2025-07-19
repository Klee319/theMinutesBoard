import React, { useState, useEffect, useRef } from 'react'
import { Minutes, ExportFormat } from '@/types'
import { storageService } from '@/services/storage'
import { ChromeErrorHandler } from '@/utils/chrome-error-handler'
import { announceToScreenReader, useFocusTrap, useEscapeKey, generateId } from '@/utils/accessibility'
import { VirtualizedMinutes } from './VirtualizedMinutes'
import './styles.css'

interface MinutesPanelProps {
  meetingId: string
  onClose: () => void
}

export const MinutesPanel: React.FC<MinutesPanelProps> = ({ meetingId, onClose }) => {
  const [minutes, setMinutes] = useState<Minutes | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [position, setPosition] = useState({ x: window.innerWidth / 2 - 300, y: 100 })
  const [isDragging, setIsDragging] = useState(false)
  const [useVirtualScroll, setUseVirtualScroll] = useState(true)
  const [contentDimensions, setContentDimensions] = useState({ width: 552, height: 500 })
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const panelId = useRef(generateId('minutes-panel')).current
  
  // フォーカストラップとEscapeキーハンドラー
  const focusTrapRef = useFocusTrap(!isMinimized)
  useEscapeKey(onClose, !isMinimized)
  
  // コンテンツエリアのサイズを監視
  useEffect(() => {
    if (contentRef.current) {
      const updateDimensions = () => {
        if (contentRef.current) {
          setContentDimensions({
            width: contentRef.current.offsetWidth,
            height: Math.min(500, window.innerHeight - 250)
          })
        }
      }
      
      updateDimensions()
      window.addEventListener('resize', updateDimensions)
      return () => window.removeEventListener('resize', updateDimensions)
    }
  }, [minutes, isMinimized])
  
  useEffect(() => {
    loadMinutes()
    const handleMessage = (message: any) => {
      if (message.type === 'MINUTES_GENERATED' && message.payload.meetingId === meetingId) {
        setMinutes(message.payload.minutes)
      }
    }
    
    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [meetingId])
  
  const loadMinutes = async () => {
    setIsLoading(true)
    try {
      const meeting = await storageService.getMeeting(meetingId)
      if (meeting?.minutes) {
        setMinutes(meeting.minutes)
      }
    } catch (error) {
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleExport = async (format: ExportFormat) => {
    try {
      const blob = await storageService.exportMeeting(meetingId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `minutes_${new Date().toISOString().split('T')[0]}.${format}`
      a.click()
      URL.revokeObjectURL(url)
      announceToScreenReader(`議事録を${format}形式でエクスポートしました`)
    } catch (error) {
      announceToScreenReader('エクスポートに失敗しました', 'assertive')
    }
  }
  
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains('panel-header')) {
      setIsDragging(true)
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPosX: position.x,
        startPosY: position.y
      }
    }
  }
  
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging && dragRef.current) {
        const deltaX = e.clientX - dragRef.current.startX
        const deltaY = e.clientY - dragRef.current.startY
        setPosition({
          x: dragRef.current.startPosX + deltaX,
          y: dragRef.current.startPosY + deltaY
        })
      }
    }
    
    const handleMouseUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }
    
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])
  
  const handleRegenerate = () => {
    ChromeErrorHandler.sendMessage({ type: 'GENERATE_MINUTES' })
      .then(() => {
        setIsLoading(true)
      })
      .catch(error => {
        alert(ChromeErrorHandler.getUserFriendlyMessage(error))
      })
  }
  
  return (
    <div 
      ref={(el) => {
        panelRef.current = el
        if (focusTrapRef.current && el) {
          focusTrapRef.current = el
        }
      }}
      className={`minutes-panel ${isMinimized ? 'minimized' : ''}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onMouseDown={handleMouseDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${panelId}-title`}
      aria-describedby={`${panelId}-content`}
    >
      <div className="panel-header">
        <h3 id={`${panelId}-title`} className="panel-title">議事録</h3>
        <div className="panel-controls">
          <button 
            onClick={() => setIsMinimized(!isMinimized)}
            className="control-button"
            aria-label={isMinimized ? 'パネルを最大化' : 'パネルを最小化'}
            aria-expanded={!isMinimized}
          >
            <span aria-hidden="true">{isMinimized ? '□' : '_'}</span>
          </button>
          <button 
            onClick={onClose}
            className="control-button close"
            aria-label="パネルを閉じる"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <div className="panel-body" id={`${panelId}-content`}>
          {isLoading ? (
            <div className="loading" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true"></div>
              <p>議事録を生成中...</p>
            </div>
          ) : minutes ? (
            <>
              <div className="minutes-content" role="article" ref={contentRef}>
                {useVirtualScroll ? (
                  <VirtualizedMinutes 
                    minutes={minutes}
                    height={contentDimensions.height}
                    width={contentDimensions.width}
                  />
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: formatMarkdown(minutes.content) }} />
                )}
              </div>
              <div className="panel-footer">
                <div className="footer-info">
                  <span>生成日時: {new Date(minutes.generatedAt).toLocaleString()}</span>
                  {minutes.metadata && (
                    <span>単語数: {minutes.metadata.wordCount}</span>
                  )}
                </div>
                <div className="footer-actions">
                  <button 
                    onClick={() => setUseVirtualScroll(!useVirtualScroll)}
                    className="action-button"
                    aria-label={useVirtualScroll ? "通常表示に切り替え" : "仮想スクロールに切り替え"}
                    title={useVirtualScroll ? "通常表示に切り替え" : "仮想スクロールに切り替え"}
                  >
                    {useVirtualScroll ? "📜" : "⚡"}
                  </button>
                  <button 
                    onClick={handleRegenerate} 
                    className="action-button"
                    aria-label="議事録を再生成"
                  >
                    再生成
                  </button>
                  <div className="export-dropdown" role="group" aria-label="エクスポートオプション">
                    <button 
                      className="action-button"
                      aria-label="エクスポートメニューを開く"
                      aria-haspopup="true"
                    >エクスポート ▼</button>
                    <div className="dropdown-content" role="menu">
                      <button 
                        onClick={() => handleExport('markdown')}
                        role="menuitem"
                      >Markdown</button>
                      <button 
                        onClick={() => handleExport('txt')}
                        role="menuitem"
                      >テキスト</button>
                      <button onClick={() => handleExport('json')}>JSON</button>
                      <button onClick={() => handleExport('csv')}>CSV</button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="no-minutes">
              <p>議事録がまだ生成されていません</p>
              <button onClick={handleRegenerate} className="action-button primary">
                議事録を生成
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatMarkdown(content: string): string {
  // contentがundefinedまたはnullの場合は空文字列を返す
  if (!content) {
    return ''
  }
  
  return content
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\* (.+)$/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\*\*(.*)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}