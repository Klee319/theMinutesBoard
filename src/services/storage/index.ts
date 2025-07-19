import { Meeting, Minutes, StorageData, ExportFormat } from '@/types'
import { IndexedDBStorageService } from './indexeddb-storage'
import { STORAGE_CONFIG } from '@/constants/config'
import { logger } from '@/utils/logger'

export class StorageService {
  private readonly MAX_MEETINGS = STORAGE_CONFIG.MAX_MEETINGS
  private readonly MAX_STORAGE_BYTES = STORAGE_CONFIG.MAX_STORAGE_BYTES
  private indexedDBService?: IndexedDBStorageService
  private useIndexedDB = true // IndexedDB機能を有効化
  
  async saveMeeting(meeting: Meeting): Promise<void> {
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    const existingIndex = meetings.findIndex((m: Meeting) => m.id === meeting.id)
    
    if (existingIndex >= 0) {
      meetings[existingIndex] = meeting
    } else {
      meetings.push(meeting)
    }
    
    // ストレージサイズをチェック
    const bytesInUse = await chrome.storage.local.getBytesInUse(['meetings'])
    logger.debug('Storage check - bytes used:', bytesInUse, 'meetings count:', meetings.length)
    
    // 容量制限に近づいたら古い会議を削除
    if (bytesInUse > this.MAX_STORAGE_BYTES || meetings.length > this.MAX_MEETINGS) {
      logger.info('Storage limit approaching, cleaning up old meetings...')
      // 古い順にソートして、半分を削除
      meetings.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      const keepCount = Math.min(Math.floor(meetings.length / 2), 50)
      const removedMeetings = meetings.splice(0, meetings.length - keepCount)
      logger.info(`Removed ${removedMeetings.length} old meetings`)
    }
    
    await chrome.storage.local.set({ meetings })
  }
  
  async getMeetings(filter?: {
    startDate?: Date
    endDate?: Date
    hasMinutes?: boolean
    keyword?: string
    limit?: number
    offset?: number
  }): Promise<Meeting[]> {
    // IndexedDBを使用する場合
    if (this.useIndexedDB && this.indexedDBService) {
      return await this.indexedDBService.getMeetings(filter)
    }

    // Chrome Storageを使用する場合（既存実装）
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    
    let filteredMeetings = meetings.filter((meeting: Meeting) => {
      if (filter?.startDate && new Date(meeting.startTime) < filter.startDate) {
        return false
      }
      if (filter?.endDate && new Date(meeting.startTime) > filter.endDate) {
        return false
      }
      if (filter?.hasMinutes !== undefined && !!meeting.minutes !== filter.hasMinutes) {
        return false
      }
      if (filter?.keyword) {
        const keyword = filter.keyword.toLowerCase()
        const searchText = [
          meeting.title,
          meeting.minutes?.content || '',
          meeting.transcripts.map(t => t.content).join(' '),
          meeting.participants.join(' ')
        ].join(' ').toLowerCase()
        
        if (!searchText.includes(keyword)) {
          return false
        }
      }
      return true
    })

    // ページネーション機能の追加
    if (filter?.offset !== undefined) {
      filteredMeetings = filteredMeetings.slice(filter.offset)
    }
    if (filter?.limit !== undefined) {
      filteredMeetings = filteredMeetings.slice(0, filter.limit)
    }

    return filteredMeetings
  }
  
  async getMeeting(id: string): Promise<Meeting | null> {
    const meetings = await this.getMeetings()
    return meetings.find(m => m.id === id) || null
  }
  
  async deleteMeeting(id: string): Promise<void> {
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    const filtered = meetings.filter((m: Meeting) => m.id !== id)
    await chrome.storage.local.set({ meetings: filtered })
  }
  
  async saveMinutes(meetingId: string, minutes: Minutes): Promise<void> {
    const meeting = await this.getMeeting(meetingId)
    if (!meeting) {
      throw new Error('Meeting not found')
    }
    
    meeting.minutes = minutes
    await this.saveMeeting(meeting)
  }
  
  async exportMeeting(id: string, format: ExportFormat): Promise<Blob> {
    const meeting = await this.getMeeting(id)
    if (!meeting) {
      throw new Error('Meeting not found')
    }
    
    switch (format) {
      case 'markdown':
        return this.exportAsMarkdown(meeting)
      case 'txt':
        return this.exportAsText(meeting)
      case 'json':
        return this.exportAsJSON(meeting)
      case 'csv':
        return this.exportAsCSV(meeting)
      case 'pdf':
        throw new Error('PDF export not yet implemented')
      default:
        throw new Error('Unsupported export format')
    }
  }
  
  private exportAsMarkdown(meeting: Meeting): Blob {
    let content = `# ${meeting.title}\n\n`
    content += `**日時**: ${new Date(meeting.startTime).toLocaleString()}\n`
    content += `**参加者**: ${meeting.participants.join(', ')}\n\n`
    
    if (meeting.minutes) {
      content += `## 議事録\n\n${meeting.minutes.content}\n\n`
    }
    
    content += `## 発言記録\n\n`
    meeting.transcripts.forEach(t => {
      content += `**${t.speaker}** (${new Date(t.timestamp).toLocaleTimeString()}): ${t.content}\n\n`
    })
    
    return new Blob([content], { type: 'text/markdown' })
  }
  
  private exportAsText(meeting: Meeting): Blob {
    let content = `${meeting.title}\n${'='.repeat(meeting.title.length)}\n\n`
    content += `日時: ${new Date(meeting.startTime).toLocaleString()}\n`
    content += `参加者: ${meeting.participants.join(', ')}\n\n`
    
    if (meeting.minutes) {
      content += `議事録\n${'-'.repeat(6)}\n${meeting.minutes.content}\n\n`
    }
    
    content += `発言記録\n${'-'.repeat(8)}\n`
    meeting.transcripts.forEach(t => {
      content += `${t.speaker} (${new Date(t.timestamp).toLocaleTimeString()}): ${t.content}\n`
    })
    
    return new Blob([content], { type: 'text/plain' })
  }
  
  private exportAsJSON(meeting: Meeting): Blob {
    const data = {
      ...meeting,
      exportedAt: new Date().toISOString()
    }
    
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  }
  
  private exportAsCSV(meeting: Meeting): Blob {
    const headers = ['時刻', '話者', '発言内容']
    const csvRows = [headers.join(',')]
    
    // 会議情報を最初の行に追加
    csvRows.push(`会議タイトル,${meeting.title},`)
    csvRows.push(`開始時刻,${new Date(meeting.startTime).toLocaleString()},`)
    csvRows.push(`終了時刻,${meeting.endTime ? new Date(meeting.endTime).toLocaleString() : ''},`)
    csvRows.push(`参加者,"${meeting.participants.join(', ')}",`)
    csvRows.push('') // 空行
    
    // 議事録がある場合は追加
    if (meeting.minutes) {
      csvRows.push('議事録,,')
      csvRows.push(`,"${(meeting.minutes.content || '').replace(/"/g, '""')}",`)
      csvRows.push('') // 空行
    }
    
    // 発言記録のヘッダー
    csvRows.push(headers.join(','))
    
    // 発言記録を追加
    meeting.transcripts.forEach(transcript => {
      const time = new Date(transcript.timestamp).toLocaleTimeString()
      const speaker = transcript.speaker.replace(/"/g, '""')
      const content = transcript.content.replace(/"/g, '""').replace(/\n/g, ' ')
      csvRows.push(`"${time}","${speaker}","${content}"`)
    })
    
    const csvContent = csvRows.join('\n')
    return new Blob([csvContent], { type: 'text/csv' })
  }
  
  async clearAllData(): Promise<void> {
    await chrome.storage.local.clear()
  }
  
  async getStorageInfo(): Promise<{
    meetingCount: number
    totalTranscripts: number
    storageUsed: number
  }> {
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    const totalTranscripts = meetings.reduce(
      (sum: number, m: Meeting) => sum + m.transcripts.length, 
      0
    )
    
    const bytesInUse = await chrome.storage.local.getBytesInUse()
    
    return {
      meetingCount: meetings.length,
      totalTranscripts,
      storageUsed: bytesInUse
    }
  }

  // IndexedDBストレージサービスの初期化と移行機能
  async initIndexedDB(): Promise<void> {
    try {
      this.indexedDBService = new IndexedDBStorageService()
      await this.indexedDBService.init()
      logger.info('IndexedDB storage service initialized')
    } catch (error) {
      logger.warn('Failed to initialize IndexedDB, falling back to Chrome Storage:', error)
      this.indexedDBService = undefined
    }
  }

  async enableIndexedDB(migrate: boolean = false): Promise<void> {
    if (!this.indexedDBService) {
      await this.initIndexedDB()
    }
    
    if (this.indexedDBService) {
      this.useIndexedDB = true
      
      if (migrate) {
        await this.migrateToIndexedDB()
      }
    }
  }

  async migrateToIndexedDB(): Promise<void> {
    if (!this.indexedDBService) {
      throw new Error('IndexedDB service not initialized')
    }

    logger.info('Starting migration to IndexedDB...')
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    
    for (const meeting of meetings) {
      try {
        await this.indexedDBService.saveMeeting(meeting)
      } catch (error) {
        logger.error(`Failed to migrate meeting ${meeting.id}:`, error)
      }
    }
    
    logger.info(`Migrated ${meetings.length} meetings to IndexedDB`)
  }

  async getMeetingCount(filter?: {
    startDate?: Date
    endDate?: Date
    hasMinutes?: boolean
    keyword?: string
  }): Promise<number> {
    if (this.useIndexedDB && this.indexedDBService) {
      // IndexedDBの場合は全件取得してカウント（将来的にはcountクエリに最適化）
      const meetings = await this.indexedDBService.getMeetings(filter)
      return meetings.length
    }

    // Chrome Storageの場合
    const meetings = await this.getMeetings(filter)
    return meetings.length
  }

  async getMeetingsWithPagination(
    page: number = 1,
    pageSize: number = 10,
    filter?: {
      startDate?: Date
      endDate?: Date
      hasMinutes?: boolean
      keyword?: string
    }
  ): Promise<{
    meetings: Meeting[]
    totalCount: number
    totalPages: number
    currentPage: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }> {
    const totalCount = await this.getMeetingCount(filter)
    const totalPages = Math.ceil(totalCount / pageSize)
    const offset = (page - 1) * pageSize

    const meetings = await this.getMeetings({
      ...filter,
      limit: pageSize,
      offset: offset
    })

    return {
      meetings,
      totalCount,
      totalPages,
      currentPage: page,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  }
}

export const storageService = new StorageService()