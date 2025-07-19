import React, { useMemo, useCallback, forwardRef } from 'react'
import { VariableSizeList as List } from 'react-window'
import { Minutes } from '@/types'

interface VirtualizedMinutesProps {
  minutes: Minutes
  height: number
  width: number
}

interface RowData {
  sections: Section[]
  expandedSections: Set<string>
  toggleSection: (sectionId: string) => void
}

interface Section {
  id: string
  title: string
  content: string
  level: number
  isExpandable: boolean
  isExpanded?: boolean
}

// 議事録を仮想スクロール用のセクションに分割
const parseMinutesToSections = (content: string): Section[] => {
  const sections: Section[] = []
  const lines = content.split('\n')
  let currentSection: Section | null = null
  let sectionContent: string[] = []
  
  lines.forEach((line, index) => {
    // ヘッダー行の判定
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/)
    
    if (headerMatch) {
      // 前のセクションを保存
      if (currentSection && sectionContent.length > 0) {
        currentSection.content = sectionContent.join('\n').trim()
        sections.push(currentSection)
      }
      
      // 新しいセクションを開始
      const level = headerMatch[1].length
      currentSection = {
        id: `section-${index}`,
        title: headerMatch[2],
        content: '',
        level,
        isExpandable: level <= 3 // h1-h3は折りたたみ可能
      }
      sectionContent = []
    } else {
      // コンテンツ行
      sectionContent.push(line)
    }
  })
  
  // 最後のセクションを保存
  if (currentSection) {
    currentSection.content = sectionContent.join('\n').trim()
    sections.push(currentSection)
  }
  
  return sections
}

// 各行の高さを計算
const getItemSize = (index: number, data: RowData): number => {
  const section = data.sections[index]
  
  // タイトル行の高さ
  const titleHeight = section.level <= 2 ? 48 : 36
  
  // コンテンツが展開されている場合
  if (section.isExpandable && data.expandedSections.has(section.id)) {
    // コンテンツの推定高さ（行数 × 行の高さ + パディング）
    const lines = section.content.split('\n').length
    const contentHeight = Math.max(lines * 24 + 16, 50)
    return titleHeight + contentHeight
  }
  
  // 折りたたまれている場合はタイトルのみ
  return titleHeight
}

// 各行のレンダリング
const Row = ({ index, style, data }: { index: number; style: React.CSSProperties; data: RowData }) => {
  const section = data.sections[index]
  const isExpanded = data.expandedSections.has(section.id)
  
  const handleClick = () => {
    if (section.isExpandable) {
      data.toggleSection(section.id)
    }
  }
  
  return (
    <div style={style} className="minutes-section">
      <div
        className={`section-header level-${section.level} ${section.isExpandable ? 'expandable' : ''}`}
        onClick={handleClick}
        role={section.isExpandable ? 'button' : undefined}
        aria-expanded={section.isExpandable ? isExpanded : undefined}
        tabIndex={section.isExpandable ? 0 : undefined}
      >
        {section.isExpandable && (
          <span className="expand-icon" aria-hidden="true">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        <span className="section-title">{section.title}</span>
      </div>
      
      {isExpanded && section.content && (
        <div className="section-content">
          <div dangerouslySetInnerHTML={{ __html: formatSectionContent(section.content) }} />
        </div>
      )}
    </div>
  )
}

// セクションコンテンツのフォーマット
const formatSectionContent = (content: string): string => {
  // nullチェック
  if (!content) return ''
  
  // 簡易的なマークダウン変換
  return content
    .replace(/^\* (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br />')
}

export const VirtualizedMinutes = forwardRef<HTMLDivElement, VirtualizedMinutesProps>(
  ({ minutes, height, width }, ref) => {
    const sections = useMemo(() => parseMinutesToSections(minutes.content), [minutes.content])
    const [expandedSections, setExpandedSections] = React.useState<Set<string>>(() => {
      // デフォルトでは最初のいくつかのセクションを展開
      const defaultExpanded = new Set<string>()
      sections.slice(0, 3).forEach(section => {
        if (section.isExpandable) {
          defaultExpanded.add(section.id)
        }
      })
      return defaultExpanded
    })
    
    // リストの参照を保持
    const listRef = React.useRef<List>(null)
    
    // セクションの展開/折りたたみ
    const toggleSection = useCallback((sectionId: string) => {
      setExpandedSections(prev => {
        const next = new Set(prev)
        if (next.has(sectionId)) {
          next.delete(sectionId)
        } else {
          next.add(sectionId)
        }
        return next
      })
      
      // 高さが変わったことをreact-windowに通知
      if (listRef.current) {
        listRef.current.resetAfterIndex(0)
      }
    }, [])
    
    const rowData: RowData = {
      sections,
      expandedSections,
      toggleSection
    }
    
    return (
      <div ref={ref} className="virtualized-minutes">
        <List
          ref={listRef}
          height={height}
          itemCount={sections.length}
          itemSize={(index) => getItemSize(index, rowData)}
          width={width}
          itemData={rowData}
        >
          {Row}
        </List>
      </div>
    )
  }
)

VirtualizedMinutes.displayName = 'VirtualizedMinutes'