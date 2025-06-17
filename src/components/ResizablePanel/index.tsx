import React, { useState, useRef, useEffect } from 'react'

interface ResizablePanelProps {
  children: React.ReactNode
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  position: 'left' | 'right'
  className?: string
  onWidthChange?: (width: number) => void
}

export default function ResizablePanel({
  children,
  defaultWidth = 320,
  minWidth = 200,
  maxWidth = 600,
  position,
  className = '',
  onWidthChange
}: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return

      const diff = position === 'left' 
        ? e.clientX - startXRef.current
        : startXRef.current - e.clientX

      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidthRef.current + diff))
      setWidth(newWidth)
      onWidthChange?.(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, position, minWidth, maxWidth, onWidthChange])

  const handleResizeStart = (e: React.MouseEvent) => {
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width
  }

  return (
    <div
      ref={panelRef}
      className={`relative flex-shrink-0 ${className}`}
      style={{ width: `${width}px` }}
    >
      {children}
      <div
        className={`absolute top-0 ${position === 'left' ? 'right-0' : 'left-0'} w-1 h-full cursor-col-resize bg-transparent hover:bg-blue-400 hover:opacity-50 transition-colors`}
        onMouseDown={handleResizeStart}
        style={{ 
          touchAction: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none' 
        }}
      >
        <div className="absolute inset-0 -left-1 -right-1" />
      </div>
    </div>
  )
}