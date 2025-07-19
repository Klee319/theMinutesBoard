import { describe, it, expect, vi, beforeEach } from 'vitest'
import { storageService } from './index'
import { Meeting, Minutes, ExportFormat } from '@/types'

describe('StorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Chrome storage APIのモックをリセット
    vi.mocked(chrome.storage.local.get).mockReset()
    vi.mocked(chrome.storage.local.set).mockReset()
    vi.mocked(chrome.storage.local.remove).mockReset()
  })

  describe('getMeeting', () => {
    it('会議データを正しく取得できる', async () => {
      const mockMeeting: Meeting = {
        id: 'test-123',
        title: 'テスト会議',
        startTime: new Date(),
        endTime: new Date(),
        participants: ['参加者1', '参加者2'],
        transcripts: [
          { id: '1', speaker: '話者1', content: 'こんにちは', timestamp: new Date(), meetingId: 'test-123' }
        ],
        minutes: {
          id: 'minutes-123',
          meetingId: 'test-123',
          content: '要約',
          generatedAt: new Date(),
          format: 'markdown'
        }
      }

      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [mockMeeting] })
        return Promise.resolve({ meetings: [mockMeeting] })
      })

      const result = await storageService.getMeeting('test-123')
      expect(result).toEqual(mockMeeting)
    })

    it('存在しない会議の場合nullを返す', async () => {
      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [] })
        return Promise.resolve({ meetings: [] })
      })

      const result = await storageService.getMeeting('non-existent')
      expect(result).toBeNull()
    })
  })

  describe('saveMeeting', () => {
    it('会議データを正しく保存できる', async () => {
      const mockMeeting: Meeting = {
        id: 'test-123',
        title: 'テスト会議',
        startTime: new Date(),
        endTime: new Date(),
        participants: ['参加者1'],
        transcripts: []
      }

      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [] })
        return Promise.resolve({ meetings: [] })
      })

      vi.mocked(chrome.storage.local.set).mockImplementation((data, callback) => {
        callback?.()
        return Promise.resolve()
      })

      // getBytesInUseのモック
      vi.mocked(chrome.storage.local.getBytesInUse).mockImplementation(() => 
        Promise.resolve(1000)
      )

      await storageService.saveMeeting(mockMeeting)

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        meetings: [mockMeeting]
      })
    })
  })

  describe('deleteMeeting', () => {
    it('会議データを正しく削除できる', async () => {
      const mockMeeting: Meeting = {
        id: 'test-123',
        title: 'テスト会議',
        startTime: new Date(),
        endTime: new Date(),
        participants: ['参加者1'],
        transcripts: []
      }

      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [mockMeeting] })
        return Promise.resolve({ meetings: [mockMeeting] })
      })

      vi.mocked(chrome.storage.local.set).mockImplementation((data, callback) => {
        callback?.()
        return Promise.resolve()
      })

      await storageService.deleteMeeting('test-123')

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        meetings: []
      })
    })
  })

  describe('getMeetings', () => {
    it('すべての会議データを取得できる', async () => {
      const mockMeetings = [
        {
          id: 'test1',
          title: '会議1',
          startTime: new Date(),
          endTime: new Date(),
          participants: ['参加者1'],
          transcripts: []
        },
        {
          id: 'test2',
          title: '会議2',
          startTime: new Date(),
          endTime: new Date(),
          participants: ['参加者2'],
          transcripts: []
        }
      ]

      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: mockMeetings })
        return Promise.resolve({ meetings: mockMeetings })
      })

      const result = await storageService.getMeetings()
      
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('test1')
      expect(result[1].id).toBe('test2')
    })
  })

  describe('exportMeeting', () => {
    const mockMeeting: Meeting = {
      id: 'test-123',
      title: 'エクスポートテスト会議',
      startTime: new Date('2025-01-15T10:00:00Z'),
      endTime: new Date('2025-01-15T11:00:00Z'),
      participants: ['参加者A', '参加者B'],
      transcripts: [
        { id: '1', speaker: '話者A', content: 'テスト発言', timestamp: new Date(), meetingId: 'test-123' }
      ],
      minutes: {
        id: 'minutes-123',
        meetingId: 'test-123',
        content: 'テスト要約',
        generatedAt: new Date('2025-01-15T11:00:00Z'),
        format: 'markdown'
      }
    }

    // 大規模データ用のモック作成ヘルパー
    const createLargeMeeting = (transcriptCount: number): Meeting => {
      const transcripts = Array.from({ length: transcriptCount }, (_, i) => ({
        id: `transcript-${i}`,
        speaker: `話者${i % 10}`,
        content: `これは${i}番目のテスト発言です。`.repeat(10), // 長い発言をシミュレート
        timestamp: new Date(Date.now() + i * 1000),
        meetingId: 'large-meeting'
      }))

      return {
        id: 'large-meeting',
        title: '大規模会議テスト',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T14:00:00Z'),
        participants: Array.from({ length: 50 }, (_, i) => `参加者${i}`),
        transcripts,
        minutes: {
          id: 'large-minutes',
          meetingId: 'large-meeting',
          content: '非常に長い議事録コンテンツ'.repeat(1000),
          generatedAt: new Date('2025-01-15T14:00:00Z'),
          format: 'markdown'
        }
      }
    }

    beforeEach(() => {
      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [mockMeeting] })
        return Promise.resolve({ meetings: [mockMeeting] })
      })
    })

    it('Markdown形式でエクスポートできる', async () => {
      const blob = await storageService.exportMeeting('test-123', 'markdown')
      const text = await blob.text()

      expect(blob.type).toBe('text/markdown')
      expect(text).toContain('# エクスポートテスト会議')
      expect(text).toContain('## 議事録')
      expect(text).toContain('テスト要約')
      expect(text).toContain('## 発言記録')
      expect(text).toContain('話者A')
    })

    it('JSON形式でエクスポートできる', async () => {
      const blob = await storageService.exportMeeting('test-123', 'json')
      const text = await blob.text()
      const data = JSON.parse(text)

      expect(blob.type).toBe('application/json')
      expect(data.id).toBe('test-123')
      expect(data.title).toBe('エクスポートテスト会議')
      expect(data.minutes.content).toBe('テスト要約')
    })

    it('Text形式でエクスポートできる', async () => {
      const blob = await storageService.exportMeeting('test-123', 'txt')
      const text = await blob.text()

      expect(blob.type).toBe('text/plain')
      expect(text).toContain('エクスポートテスト会議')
      expect(text).toContain('テスト要約')
    })
    
    it('CSV形式でエクスポートできる', async () => {
      const blob = await storageService.exportMeeting('test-123', 'csv')
      const text = await blob.text()

      expect(blob.type).toBe('text/csv')
      expect(text).toContain('エクスポートテスト会議')
      expect(text).toContain('時刻,話者,発言内容')
      expect(text).toContain('参加者A')
      expect(text).toContain('テスト発言')
    })

    it('議事録がない場合でもエクスポートできる', async () => {
      const meetingWithoutMinutes = { ...mockMeeting, minutes: undefined }
      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [meetingWithoutMinutes] })
        return Promise.resolve({ meetings: [meetingWithoutMinutes] })
      })

      const blob = await storageService.exportMeeting('test-123', 'markdown')
      const text = await blob.text()

      expect(text).toContain('## 発言記録')
      expect(text).not.toContain('## 議事録')
    })

    it('存在しない会議のエクスポート時はエラーを投げる', async () => {
      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: [] })
        return Promise.resolve({ meetings: [] })
      })

      await expect(storageService.exportMeeting('non-existent', 'markdown'))
        .rejects.toThrow('Meeting not found')
    })

    it('サポートされていない形式でのエクスポート時はエラーを投げる', async () => {
      await expect(storageService.exportMeeting('test-123', 'pdf' as ExportFormat))
        .rejects.toThrow('PDF export not yet implemented')
    })

    describe('パフォーマンステスト', () => {
      it('大規模データ（1000発言）でも5秒以内にエクスポートが完了する', async () => {
        const largeMeeting = createLargeMeeting(1000)
        vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
          callback?.({ meetings: [largeMeeting] })
          return Promise.resolve({ meetings: [largeMeeting] })
        })

        const startTime = performance.now()
        const blob = await storageService.exportMeeting('large-meeting', 'markdown')
        const endTime = performance.now()

        expect(endTime - startTime).toBeLessThan(5000) // 5秒以内
        expect(blob.size).toBeGreaterThan(100000) // 十分なデータサイズ
      }, 10000) // 10秒のタイムアウト

      it('超大規模データ（10000発言）でも10秒以内にJSONエクスポートが完了する', async () => {
        const hugeMeeting = createLargeMeeting(10000)
        vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
          callback?.({ meetings: [hugeMeeting] })
          return Promise.resolve({ meetings: [hugeMeeting] })
        })

        const startTime = performance.now()
        const blob = await storageService.exportMeeting('large-meeting', 'json')
        const endTime = performance.now()

        expect(endTime - startTime).toBeLessThan(10000) // 10秒以内
        expect(blob.size).toBeGreaterThan(1000000) // 1MB以上のデータサイズ
      }, 15000) // 15秒のタイムアウト

      it('メモリ効率を確認 - 大規模エクスポート後にオブジェクトが適切に解放される', async () => {
        const largeMeeting = createLargeMeeting(5000)
        vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
          callback?.({ meetings: [largeMeeting] })
          return Promise.resolve({ meetings: [largeMeeting] })
        })

        // 複数回実行してメモリリークをチェック
        for (let i = 0; i < 5; i++) {
          const blob = await storageService.exportMeeting('large-meeting', 'csv')
          expect(blob.size).toBeGreaterThan(500000)
          // Blobを明示的に解放
          blob.stream().cancel?.()
        }
      }, 30000)
    })

    describe('エッジケース', () => {
      it('空の発言記録の会議でもエクスポートできる', async () => {
        const emptyMeeting = { ...mockMeeting, transcripts: [] }
        vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
          callback?.({ meetings: [emptyMeeting] })
          return Promise.resolve({ meetings: [emptyMeeting] })
        })

        const blob = await storageService.exportMeeting('test-123', 'csv')
        const text = await blob.text()

        expect(text).toContain('時刻,話者,発言内容')
        expect(text).toContain('エクスポートテスト会議')
      })

      it('特殊文字を含む内容でもエクスポートできる', async () => {
        const specialCharMeeting = {
          ...mockMeeting,
          title: '特殊文字テスト"<>&',
          transcripts: [
            {
              id: '1',
              speaker: '話者"quotes"',
              content: 'カンマ,セミコロン;改行\n文字&特殊<>記号',
              timestamp: new Date(),
              meetingId: 'test-123'
            }
          ]
        }
        vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
          callback?.({ meetings: [specialCharMeeting] })
          return Promise.resolve({ meetings: [specialCharMeeting] })
        })

        const csvBlob = await storageService.exportMeeting('test-123', 'csv')
        const csvText = await csvBlob.text()
        
        expect(csvText).toContain('特殊文字テスト"<>&')
        expect(csvText).toContain('話者""quotes""') // CSVエスケープ後の形式
        
        const jsonBlob = await storageService.exportMeeting('test-123', 'json')
        const jsonData = JSON.parse(await jsonBlob.text())
        
        expect(jsonData.title).toBe('特殊文字テスト"<>&')
      })

      it('非常に長いタイトルでもエクスポートできる', async () => {
        const longTitleMeeting = {
          ...mockMeeting,
          title: 'A'.repeat(1000)
        }
        vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
          callback?.({ meetings: [longTitleMeeting] })
          return Promise.resolve({ meetings: [longTitleMeeting] })
        })

        const blob = await storageService.exportMeeting('test-123', 'txt')
        const text = await blob.text()

        expect(text).toContain('A'.repeat(1000))
      })
    })
  })

  describe('ページネーション機能', () => {
    beforeEach(() => {
      // 複数の会議データを作成
      const multipleMeetings = Array.from({ length: 25 }, (_, i) => ({
        id: `meeting-${i}`,
        title: `会議${i}`,
        startTime: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)), // i日前
        endTime: new Date(Date.now() - (i * 24 * 60 * 60 * 1000) + 60 * 60 * 1000),
        participants: [`参加者${i}`],
        transcripts: [
          { 
            id: `t-${i}`, 
            speaker: `話者${i}`, 
            content: `発言${i}`, 
            timestamp: new Date(), 
            meetingId: `meeting-${i}` 
          }
        ]
      }))

      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings: multipleMeetings })
        return Promise.resolve({ meetings: multipleMeetings })
      })
    })

    it('limitパラメータで結果数を制限できる', async () => {
      const result = await storageService.getMeetings({ limit: 5 })
      expect(result).toHaveLength(5)
    })

    it('offsetパラメータで開始位置を指定できる', async () => {
      const result = await storageService.getMeetings({ offset: 10, limit: 5 })
      expect(result).toHaveLength(5)
      expect(result[0].id).toBe('meeting-10')
    })

    it('getMeetingsWithPaginationが正しいページネーション情報を返す', async () => {
      const result = await storageService.getMeetingsWithPagination(1, 10)
      
      expect(result.meetings).toHaveLength(10)
      expect(result.totalCount).toBe(25)
      expect(result.totalPages).toBe(3)
      expect(result.currentPage).toBe(1)
      expect(result.hasNextPage).toBe(true)
      expect(result.hasPreviousPage).toBe(false)
    })

    it('2ページ目のデータを正しく取得できる', async () => {
      const result = await storageService.getMeetingsWithPagination(2, 10)
      
      expect(result.meetings).toHaveLength(10)
      expect(result.currentPage).toBe(2)
      expect(result.hasNextPage).toBe(true)
      expect(result.hasPreviousPage).toBe(true)
    })

    it('最後のページで正しい数の結果を返す', async () => {
      const result = await storageService.getMeetingsWithPagination(3, 10)
      
      expect(result.meetings).toHaveLength(5) // 25 - 20 = 5
      expect(result.currentPage).toBe(3)
      expect(result.hasNextPage).toBe(false)
      expect(result.hasPreviousPage).toBe(true)
    })

    it('フィルターと組み合わせてページネーションが機能する', async () => {
      const result = await storageService.getMeetingsWithPagination(1, 5, {
        keyword: '会議'
      })
      
      expect(result.meetings).toHaveLength(5)
      expect(result.totalCount).toBe(25) // 全ての会議がマッチ
    })
  })

  describe('会議数カウント機能', () => {
    beforeEach(() => {
      const meetings = [
        { id: '1', title: '議事録あり', startTime: new Date(), endTime: new Date(), participants: [], transcripts: [], minutes: { id: '1', meetingId: '1', content: 'test', generatedAt: new Date(), format: 'markdown' } },
        { id: '2', title: '議事録なし', startTime: new Date(), endTime: new Date(), participants: [], transcripts: [] },
        { id: '3', title: 'キーワードテスト', startTime: new Date(), endTime: new Date(), participants: [], transcripts: [] }
      ]

      vi.mocked(chrome.storage.local.get).mockImplementation((key, callback) => {
        callback?.({ meetings })
        return Promise.resolve({ meetings })
      })
    })

    it('全会議数を正しく取得できる', async () => {
      const count = await storageService.getMeetingCount()
      expect(count).toBe(3)
    })

    it('フィルター条件に基づいて会議数を取得できる', async () => {
      const count = await storageService.getMeetingCount({ hasMinutes: true })
      expect(count).toBe(1)
    })

    it('キーワード検索での会議数を取得できる', async () => {
      const count = await storageService.getMeetingCount({ keyword: 'キーワード' })
      expect(count).toBe(1)
    })
  })
})