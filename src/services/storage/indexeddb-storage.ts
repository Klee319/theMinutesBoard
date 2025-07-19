import { Meeting, Minutes, ExportFormat } from '@/types'

export class IndexedDBStorageService {
  private dbName = 'theMinutesBoard'
  private dbVersion = 1
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Meetings object store
        const meetingsStore = db.createObjectStore('meetings', { keyPath: 'id' })
        meetingsStore.createIndex('startTime', 'startTime')
        meetingsStore.createIndex('hasMinutes', 'hasMinutes')
        meetingsStore.createIndex('title', 'title')

        // Minutes object store
        const minutesStore = db.createObjectStore('minutes', { keyPath: 'id' })
        minutesStore.createIndex('meetingId', 'meetingId')
        minutesStore.createIndex('generatedAt', 'generatedAt')

        // Transcripts object store
        const transcriptsStore = db.createObjectStore('transcripts', { keyPath: 'id' })
        transcriptsStore.createIndex('meetingId', 'meetingId')
        transcriptsStore.createIndex('timestamp', 'timestamp')
        transcriptsStore.createIndex('speaker', 'speaker')
      }
    })
  }

  async saveMeeting(meeting: Meeting): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'minutes', 'transcripts'], 'readwrite')
    const meetingsStore = transaction.objectStore('meetings')
    const minutesStore = transaction.objectStore('minutes')
    const transcriptsStore = transaction.objectStore('transcripts')

    // Save meeting basic info
    const meetingData = {
      ...meeting,
      hasMinutes: !!meeting.minutes,
      transcripts: undefined, // Don't store transcripts in meeting object
      minutes: undefined      // Don't store minutes in meeting object
    }
    
    await this.putInStore(meetingsStore, meetingData)

    // Save minutes if exists
    if (meeting.minutes) {
      await this.putInStore(minutesStore, meeting.minutes)
    }

    // Save transcripts with meetingId
    for (const transcript of meeting.transcripts) {
      const transcriptData = {
        ...transcript,
        meetingId: meeting.id
      }
      await this.putInStore(transcriptsStore, transcriptData)
    }
  }

  async getMeeting(id: string): Promise<Meeting | null> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'minutes', 'transcripts'], 'readonly')
    const meetingsStore = transaction.objectStore('meetings')
    const minutesStore = transaction.objectStore('minutes')
    const transcriptsStore = transaction.objectStore('transcripts')

    const meeting = await this.getFromStore(meetingsStore, id)
    if (!meeting) return null

    // Get minutes
    const minutes = await this.getFromStore(minutesStore, meeting.id)
    
    // Get transcripts
    const transcripts = await this.getFromIndex(transcriptsStore, 'meetingId', id)

    return {
      ...meeting,
      minutes,
      transcripts: transcripts || []
    }
  }

  async getMeetings(filter?: {
    startDate?: Date
    endDate?: Date
    hasMinutes?: boolean
    keyword?: string
    limit?: number
    offset?: number
  }): Promise<Meeting[]> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'minutes', 'transcripts'], 'readonly')
    const meetingsStore = transaction.objectStore('meetings')
    const minutesStore = transaction.objectStore('minutes')
    const transcriptsStore = transaction.objectStore('transcripts')

    let meetings = await this.getAllFromStore(meetingsStore)

    // Apply filters
    if (filter) {
      meetings = meetings.filter(meeting => {
        if (filter.startDate && new Date(meeting.startTime) < filter.startDate) return false
        if (filter.endDate && new Date(meeting.startTime) > filter.endDate) return false
        if (filter.hasMinutes !== undefined && meeting.hasMinutes !== filter.hasMinutes) return false
        if (filter.keyword) {
          const keyword = filter.keyword.toLowerCase()
          return meeting.title.toLowerCase().includes(keyword) ||
                 meeting.participants.some(p => p.toLowerCase().includes(keyword))
        }
        return true
      })

      // Keyword search in transcripts and minutes
      if (filter.keyword) {
        const keyword = filter.keyword.toLowerCase()
        const matchingMeetings = new Set<string>()

        for (const meeting of meetings) {
          // Search in minutes
          if (meeting.hasMinutes) {
            const minutes = await this.getFromStore(minutesStore, meeting.id)
            if (minutes?.content.toLowerCase().includes(keyword)) {
              matchingMeetings.add(meeting.id)
            }
          }

          // Search in transcripts
          const transcripts = await this.getFromIndex(transcriptsStore, 'meetingId', meeting.id)
          if (transcripts?.some(t => t.content.toLowerCase().includes(keyword))) {
            matchingMeetings.add(meeting.id)
          }
        }

        meetings = meetings.filter(m => matchingMeetings.has(m.id))
      }

      // Pagination
      if (filter.offset !== undefined) {
        meetings = meetings.slice(filter.offset)
      }
      if (filter.limit !== undefined) {
        meetings = meetings.slice(0, filter.limit)
      }
    }

    // Load full meeting data
    const fullMeetings = await Promise.all(
      meetings.map(async (meeting) => {
        const minutes = meeting.hasMinutes ? await this.getFromStore(minutesStore, meeting.id) : null
        const transcripts = await this.getFromIndex(transcriptsStore, 'meetingId', meeting.id)
        return {
          ...meeting,
          minutes,
          transcripts: transcripts || []
        }
      })
    )

    return fullMeetings
  }

  async deleteMeeting(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'minutes', 'transcripts'], 'readwrite')
    const meetingsStore = transaction.objectStore('meetings')
    const minutesStore = transaction.objectStore('minutes')
    const transcriptsStore = transaction.objectStore('transcripts')

    await this.deleteFromStore(meetingsStore, id)
    await this.deleteFromStore(minutesStore, id)
    
    // Delete all transcripts for this meeting
    const transcripts = await this.getFromIndex(transcriptsStore, 'meetingId', id)
    if (transcripts) {
      for (const transcript of transcripts) {
        await this.deleteFromStore(transcriptsStore, transcript.id)
      }
    }
  }

  async saveMinutes(meetingId: string, minutes: Minutes): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'minutes'], 'readwrite')
    const meetingsStore = transaction.objectStore('meetings')
    const minutesStore = transaction.objectStore('minutes')

    // Update meeting to mark it has minutes
    const meeting = await this.getFromStore(meetingsStore, meetingId)
    if (meeting) {
      meeting.hasMinutes = true
      await this.putInStore(meetingsStore, meeting)
    }

    // Save minutes
    await this.putInStore(minutesStore, minutes)
  }

  async exportMeeting(id: string, format: ExportFormat): Promise<Blob> {
    const meeting = await this.getMeeting(id)
    if (!meeting) {
      throw new Error('Meeting not found')
    }

    // Use the same export logic as the original storage service
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
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'minutes', 'transcripts'], 'readwrite')
    const meetingsStore = transaction.objectStore('meetings')
    const minutesStore = transaction.objectStore('minutes')
    const transcriptsStore = transaction.objectStore('transcripts')

    await this.clearStore(meetingsStore)
    await this.clearStore(minutesStore)
    await this.clearStore(transcriptsStore)
  }

  async getStorageInfo(): Promise<{
    meetingCount: number
    totalTranscripts: number
    storageUsed: number
  }> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['meetings', 'transcripts'], 'readonly')
    const meetingsStore = transaction.objectStore('meetings')
    const transcriptsStore = transaction.objectStore('transcripts')

    const meetings = await this.getAllFromStore(meetingsStore)
    const transcripts = await this.getAllFromStore(transcriptsStore)

    // IndexedDB doesn't provide storage size directly, estimate based on data
    const estimatedSize = JSON.stringify({ meetings, transcripts }).length

    return {
      meetingCount: meetings.length,
      totalTranscripts: transcripts.length,
      storageUsed: estimatedSize
    }
  }

  // Helper methods for IndexedDB operations
  private putInStore(store: IDBObjectStore, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.put(data)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  private getFromStore(store: IDBObjectStore, key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = store.get(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  private getFromIndex(store: IDBObjectStore, indexName: string, key: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const index = store.index(indexName)
      const request = index.getAll(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  private getAllFromStore(store: IDBObjectStore): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  private deleteFromStore(store: IDBObjectStore, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.delete(key)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }

  private clearStore(store: IDBObjectStore): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.clear()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  }
}

export const indexedDBStorageService = new IndexedDBStorageService()