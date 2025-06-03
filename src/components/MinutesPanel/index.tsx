import React, { useState, useEffect, useRef } from 'react'
import { Minutes, ExportFormat } from '@/types'
import { storageService } from '@/services/storage'
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
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  
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
      console.error('Failed to load minutes:', error)
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
    } catch (error) {
      console.error('Export failed:', error)
      alert('エクスポートに失敗しました')
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
    chrome.runtime.sendMessage({ type: 'GENERATE_MINUTES' })
    setIsLoading(true)
  }
  
  return (
    <div 
      ref={panelRef}
      className={`minutes-panel ${isMinimized ? 'minimized' : ''}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onMouseDown={handleMouseDown}
    >
      <div className="panel-header">
        <h3 className="panel-title">議事録</h3>
        <div className="panel-controls">
          <button 
            onClick={() => setIsMinimized(!isMinimized)}
            className="control-button"
            title={isMinimized ? '最大化' : '最小化'}
          >
            {isMinimized ? '□' : '_'}
          </button>
          <button 
            onClick={onClose}
            className="control-button close"
            title="閉じる"
          >
            ×
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <div className="panel-body">
          {isLoading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>議事録を生成中...</p>
            </div>
          ) : minutes ? (
            <>
              <div className="minutes-content">
                <div dangerouslySetInnerHTML={{ __html: formatMarkdown(minutes.content) }} />
              </div>
              <div className="panel-footer">
                <div className="footer-info">
                  <span>生成日時: {new Date(minutes.generatedAt).toLocaleString()}</span>
                  {minutes.metadata && (
                    <span>単語数: {minutes.metadata.wordCount}</span>
                  )}
                </div>
                <div className="footer-actions">
                  <button onClick={handleRegenerate} className="action-button">
                    再生成
                  </button>
                  <div className="export-dropdown">
                    <button className="action-button">エクスポート ▼</button>
                    <div className="dropdown-content">
                      <button onClick={() => handleExport('markdown')}>Markdown</button>
                      <button onClick={() => handleExport('txt')}>テキスト</button>
                      <button onClick={() => handleExport('json')}>JSON</button>
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