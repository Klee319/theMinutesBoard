import React, { useState, useEffect } from 'react'
import { storageService } from '@/services/storage'
import { Meeting } from '@/types'
import { formatDate, formatDateTime } from '@/utils/dateFormatter'
import { extractMeetingTopic } from '@/utils/meeting-utils'

interface MeetingHistoryPanelProps {
  onMeetingSelect?: (meeting: Meeting) => void
  onClose?: () => void
}

export const MeetingHistoryPanel: React.FC<MeetingHistoryPanelProps> = ({
  onMeetingSelect,
  onClose
}) => {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [searchFilters, setSearchFilters] = useState({
    keyword: '',
    startDate: '',
    endDate: '',
    hasMinutes: undefined as boolean | undefined
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [totalMeetings, setTotalMeetings] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [hasPreviousPage, setHasPreviousPage] = useState(false)
  const itemsPerPage = 10

  const loadMeetings = async () => {
    try {
      setLoading(true)
      const filter = {
        keyword: searchFilters.keyword || undefined,
        startDate: searchFilters.startDate ? new Date(searchFilters.startDate) : undefined,
        endDate: searchFilters.endDate ? new Date(searchFilters.endDate) : undefined,
        hasMinutes: searchFilters.hasMinutes
      }
      
      // 新しいページネーション機能を使用
      const result = await storageService.getMeetingsWithPagination(
        currentPage,
        itemsPerPage,
        filter
      )
      
      // 結果をソート（新しい順）- endTimeを優先、なければstartTimeを使用
      result.meetings.sort((a, b) => {
        const aTime = a.endTime || a.startTime
        const bTime = b.endTime || b.startTime
        return new Date(bTime).getTime() - new Date(aTime).getTime()
      })
      
      setMeetings(result.meetings)
      setTotalMeetings(result.totalCount)
      setTotalPages(result.totalPages)
      setHasNextPage(result.hasNextPage)
      setHasPreviousPage(result.hasPreviousPage)
    } catch (error) {
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMeetings()
  }, [currentPage])

  const handleSearch = () => {
    setCurrentPage(1) // 検索時は1ページ目に戻る
    loadMeetings()
  }

  const handleClearSearch = () => {
    setSearchFilters({
      keyword: '',
      startDate: '',
      endDate: '',
      hasMinutes: undefined
    })
    setCurrentPage(1) // クリア時は1ページ目に戻る
    setTimeout(() => {
      loadMeetings()
    }, 0)
  }

  const handleExportMeeting = async (meeting: Meeting, format: 'markdown' | 'json' | 'csv' | 'txt') => {
    try {
      const blob = await storageService.exportMeeting(meeting.id, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${getMeetingTitle(meeting)}_${formatDate(meeting.startTime)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      alert('エクスポートに失敗しました')
    }
  }

  const highlightKeyword = (text: string, keyword: string) => {
    if (!keyword) return text
    const regex = new RegExp(`(${keyword})`, 'gi')
    return text.replace(regex, '<mark>$1</mark>')
  }

  const getMeetingTitle = (meeting: Meeting): string => {
    // 1. 議事録がある場合：extractMeetingTopicの結果
    if (meeting.minutes) {
      const topic = extractMeetingTopic(meeting)
      if (topic && topic !== meeting.title) {
        return topic
      }
    }
    
    // 2. タイトルがある場合：そのまま使用
    if (meeting.title && meeting.title.trim()) {
      return meeting.title
    }
    
    // 3. タイトルがない場合：「会議 YYYY/MM/DD HH:MM」形式
    const dateTime = meeting.endTime || meeting.startTime
    if (dateTime) {
      const date = new Date(dateTime)
      const formattedDate = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
      const formattedTime = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      return `会議 ${formattedDate} ${formattedTime}`
    }
    
    // 4. フォールバック
    return '無題の会議'
  }

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    }
  }

  const renderPagination = () => {
    if (totalPages <= 1) return null

    const pages: (number | string)[] = []
    const maxVisiblePages = 5
    
    if (totalPages <= maxVisiblePages) {
      // 総ページ数が少ない場合は全て表示
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // ページ数が多い場合は省略して表示
      const startPage = Math.max(1, currentPage - 2)
      const endPage = Math.min(totalPages, currentPage + 2)
      
      if (startPage > 1) {
        pages.push(1)
        if (startPage > 2) pages.push('...')
      }
      
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i)
      }
      
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) pages.push('...')
        pages.push(totalPages)
      }
    }

    return (
      <div className="pagination">
        <button
          onClick={() => handlePageChange(currentPage - 1)}
          disabled={!hasPreviousPage}
          className="pagination-button"
        >
          前へ
        </button>
        
        {pages.map((page, index) => (
          <button
            key={index}
            onClick={() => typeof page === 'number' ? handlePageChange(page) : undefined}
            className={`pagination-button ${currentPage === page ? 'active' : ''} ${typeof page === 'string' ? 'ellipsis' : ''}`}
            disabled={typeof page === 'string'}
          >
            {page}
          </button>
        ))}
        
        <button
          onClick={() => handlePageChange(currentPage + 1)}
          disabled={!hasNextPage}
          className="pagination-button"
        >
          次へ
        </button>
      </div>
    )
  }

  return (
    <div className="meeting-history-panel">
      <div className="panel-header">
        <h3>会議履歴</h3>
        {onClose && (
          <button onClick={onClose} className="close-button">
            ×
          </button>
        )}
      </div>

      <div className="search-section">
        <div className="search-row">
          <input
            type="text"
            placeholder="キーワードで検索..."
            value={searchFilters.keyword}
            onChange={(e) => setSearchFilters(prev => ({ ...prev, keyword: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="search-input"
          />
          <button onClick={handleSearch} className="search-button">
            検索
          </button>
        </div>

        <div className="filters-row">
          <div className="filter-group">
            <label>開始日:</label>
            <input
              type="date"
              value={searchFilters.startDate}
              onChange={(e) => setSearchFilters(prev => ({ ...prev, startDate: e.target.value }))}
              className="date-input"
            />
          </div>
          <div className="filter-group">
            <label>終了日:</label>
            <input
              type="date"
              value={searchFilters.endDate}
              onChange={(e) => setSearchFilters(prev => ({ ...prev, endDate: e.target.value }))}
              className="date-input"
            />
          </div>
          <div className="filter-group">
            <label>議事録:</label>
            <select
              value={searchFilters.hasMinutes === undefined ? '' : searchFilters.hasMinutes.toString()}
              onChange={(e) => setSearchFilters(prev => ({ 
                ...prev, 
                hasMinutes: e.target.value === '' ? undefined : e.target.value === 'true'
              }))}
              className="select-input"
            >
              <option value="">すべて</option>
              <option value="true">あり</option>
              <option value="false">なし</option>
            </select>
          </div>
          <button onClick={handleClearSearch} className="clear-button">
            クリア
          </button>
        </div>
      </div>

      <div className="meeting-list">
        {loading ? (
          <div className="loading">読み込み中...</div>
        ) : meetings.length === 0 ? (
          <div className="no-meetings">
            {Object.values(searchFilters).some(v => v) ? '検索結果がありません' : '会議履歴がありません'}
          </div>
        ) : (
          meetings.map(meeting => (
            <div key={meeting.id} className="meeting-item">
              <div className="meeting-header">
                <h4 
                  className="meeting-title"
                  dangerouslySetInnerHTML={{
                    __html: highlightKeyword(getMeetingTitle(meeting), searchFilters.keyword)
                  }}
                />
                <div className="meeting-meta">
                  <span className="meeting-date">
                    {formatDate(meeting.startTime)}
                  </span>
                  {meeting.minutes && (
                    <span className="has-minutes">議事録あり</span>
                  )}
                </div>
              </div>

              <div className="meeting-details">
                <div className="participants">
                  参加者: {meeting.participants.join(', ')}
                </div>
                {meeting.transcripts.length > 0 && (
                  <div className="transcript-preview">
                    <span className="transcript-count">
                      発言記録: {meeting.transcripts.length}件
                    </span>
                  </div>
                )}
              </div>

              <div className="meeting-actions">
                {onMeetingSelect && (
                  <button
                    onClick={() => onMeetingSelect(meeting)}
                    className="action-button primary"
                  >
                    詳細を見る
                  </button>
                )}
                
                <div className="export-dropdown">
                  <button className="action-button">エクスポート ▼</button>
                  <div className="dropdown-content">
                    <button onClick={() => handleExportMeeting(meeting, 'markdown')}>
                      Markdown
                    </button>
                    <button onClick={() => handleExportMeeting(meeting, 'txt')}>
                      テキスト
                    </button>
                    <button onClick={() => handleExportMeeting(meeting, 'json')}>
                      JSON
                    </button>
                    <button onClick={() => handleExportMeeting(meeting, 'csv')}>
                      CSV
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      
      {/* ページネーション */}
      {totalMeetings > 0 && (
        <div className="pagination-container">
          <div className="pagination-info">
            {totalMeetings}件中 {Math.min((currentPage - 1) * itemsPerPage + 1, totalMeetings)}～{Math.min(currentPage * itemsPerPage, totalMeetings)}件を表示
          </div>
          {renderPagination()}
        </div>
      )}
    </div>
  )
}