import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeetingHistoryPanel } from './index'
import { storageService } from '@/services/storage'
import { mockMeetings } from '@/test/fixtures'

// storageServiceのモック
vi.mock('@/services/storage', () => ({
  storageService: {
    getMeetings: vi.fn(),
    exportMeeting: vi.fn()
  }
}))

// formatDateのモック
vi.mock('@/utils/dateFormatter', () => ({
  formatDate: vi.fn((date) => new Date(date).toLocaleDateString())
}))

describe('MeetingHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storageService.getMeetings).mockResolvedValue(mockMeetings)
    vi.mocked(storageService.exportMeeting).mockResolvedValue(new Blob(['test'], { type: 'text/plain' }))
  })

  it('should render meeting history panel', async () => {
    render(<MeetingHistoryPanel />)
    
    expect(screen.getByText('会議履歴')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('キーワードで検索...')).toBeInTheDocument()
    
    await waitFor(() => {
      expect(screen.getByText('プロジェクトキックオフ会議')).toBeInTheDocument()
    })
  })

  it('should perform keyword search', async () => {
    render(<MeetingHistoryPanel />)
    
    const searchInput = screen.getByPlaceholderText('キーワードで検索...')
    const searchButton = screen.getByText('検索')
    
    fireEvent.change(searchInput, { target: { value: 'キックオフ' } })
    fireEvent.click(searchButton)
    
    await waitFor(() => {
      expect(storageService.getMeetings).toHaveBeenCalledWith({
        keyword: 'キックオフ',
        startDate: undefined,
        endDate: undefined,
        hasMinutes: undefined
      })
    })
  })

  it('should perform search with Enter key', async () => {
    render(<MeetingHistoryPanel />)
    
    const searchInput = screen.getByPlaceholderText('キーワードで検索...')
    
    fireEvent.change(searchInput, { target: { value: 'テスト' } })
    fireEvent.keyDown(searchInput, { key: 'Enter' })
    
    await waitFor(() => {
      expect(storageService.getMeetings).toHaveBeenCalledWith({
        keyword: 'テスト',
        startDate: undefined,
        endDate: undefined,
        hasMinutes: undefined
      })
    })
  })

  it('should filter by date range', async () => {
    render(<MeetingHistoryPanel />)
    
    const startDateInput = screen.getByLabelText('開始日:')
    const endDateInput = screen.getByLabelText('終了日:')
    const searchButton = screen.getByText('検索')
    
    fireEvent.change(startDateInput, { target: { value: '2025-07-01' } })
    fireEvent.change(endDateInput, { target: { value: '2025-07-31' } })
    fireEvent.click(searchButton)
    
    await waitFor(() => {
      expect(storageService.getMeetings).toHaveBeenCalledWith({
        keyword: undefined,
        startDate: new Date('2025-07-01'),
        endDate: new Date('2025-07-31'),
        hasMinutes: undefined
      })
    })
  })

  it('should filter by hasMinutes', async () => {
    render(<MeetingHistoryPanel />)
    
    const minutesSelect = screen.getByLabelText('議事録:')
    const searchButton = screen.getByText('検索')
    
    fireEvent.change(minutesSelect, { target: { value: 'true' } })
    fireEvent.click(searchButton)
    
    await waitFor(() => {
      expect(storageService.getMeetings).toHaveBeenCalledWith({
        keyword: undefined,
        startDate: undefined,
        endDate: undefined,
        hasMinutes: true
      })
    })
  })

  it('should clear all filters', async () => {
    render(<MeetingHistoryPanel />)
    
    const searchInput = screen.getByPlaceholderText('キーワードで検索...')
    const startDateInput = screen.getByLabelText('開始日:')
    const clearButton = screen.getByText('クリア')
    
    // フィルターを設定
    fireEvent.change(searchInput, { target: { value: 'テスト' } })
    fireEvent.change(startDateInput, { target: { value: '2025-07-01' } })
    
    // クリアボタンをクリック
    fireEvent.click(clearButton)
    
    expect(searchInput).toHaveValue('')
    expect(startDateInput).toHaveValue('')
    
    await waitFor(() => {
      expect(storageService.getMeetings).toHaveBeenCalledWith({
        keyword: undefined,
        startDate: undefined,
        endDate: undefined,
        hasMinutes: undefined
      })
    })
  })

  it('should call onMeetingSelect when meeting is selected', async () => {
    const mockOnMeetingSelect = vi.fn()
    render(<MeetingHistoryPanel onMeetingSelect={mockOnMeetingSelect} />)
    
    await waitFor(() => {
      const detailButton = screen.getByText('詳細を見る')
      fireEvent.click(detailButton)
      
      expect(mockOnMeetingSelect).toHaveBeenCalledWith(mockMeetings[0])
    })
  })

  it('should export meeting in different formats', async () => {
    // URL.createObjectURL と URL.revokeObjectURL のモック
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test-url')
    const mockRevokeObjectURL = vi.fn()
    global.URL.createObjectURL = mockCreateObjectURL
    global.URL.revokeObjectURL = mockRevokeObjectURL
    
    // document.createElement のモック
    const mockClick = vi.fn()
    const mockAnchor = { href: '', download: '', click: mockClick }
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any)
    
    render(<MeetingHistoryPanel />)
    
    await waitFor(() => {
      const exportButton = screen.getByText('エクスポート ▼')
      fireEvent.mouseEnter(exportButton)
      
      const csvButton = screen.getByText('CSV')
      fireEvent.click(csvButton)
      
      expect(storageService.exportMeeting).toHaveBeenCalledWith(mockMeetings[0].id, 'csv')
      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockClick).toHaveBeenCalled()
      expect(mockRevokeObjectURL).toHaveBeenCalled()
    })
  })

  it('should highlight search keywords in meeting titles', async () => {
    vi.mocked(storageService.getMeetings).mockResolvedValue([
      { ...mockMeetings[0], title: 'プロジェクトキックオフ会議' }
    ])
    
    render(<MeetingHistoryPanel />)
    
    const searchInput = screen.getByPlaceholderText('キーワードで検索...')
    const searchButton = screen.getByText('検索')
    
    fireEvent.change(searchInput, { target: { value: 'キックオフ' } })
    fireEvent.click(searchButton)
    
    await waitFor(() => {
      const titleElement = screen.getByText((content, element) => {
        return element?.innerHTML.includes('<mark>キックオフ</mark>') || false
      })
      expect(titleElement).toBeInTheDocument()
    })
  })

  it('should display no meetings message when no results', async () => {
    vi.mocked(storageService.getMeetings).mockResolvedValue([])
    
    render(<MeetingHistoryPanel />)
    
    await waitFor(() => {
      expect(screen.getByText('会議履歴がありません')).toBeInTheDocument()
    })
  })

  it('should display no search results message when filtered', async () => {
    vi.mocked(storageService.getMeetings).mockResolvedValue([])
    
    render(<MeetingHistoryPanel />)
    
    const searchInput = screen.getByPlaceholderText('キーワードで検索...')
    const searchButton = screen.getByText('検索')
    
    fireEvent.change(searchInput, { target: { value: '存在しない' } })
    fireEvent.click(searchButton)
    
    await waitFor(() => {
      expect(screen.getByText('検索結果がありません')).toBeInTheDocument()
    })
  })

  it('should call onClose when close button is clicked', () => {
    const mockOnClose = vi.fn()
    render(<MeetingHistoryPanel onClose={mockOnClose} />)
    
    const closeButton = screen.getByText('×')
    fireEvent.click(closeButton)
    
    expect(mockOnClose).toHaveBeenCalled()
  })
})