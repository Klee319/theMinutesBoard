import { Meeting, Minutes, StorageData, ExportFormat } from '@/types'

export class StorageService {
  private readonly MAX_MEETINGS = 100 // 最大保存会議数
  private readonly MAX_STORAGE_BYTES = 4 * 1024 * 1024 // 4MB制限
  
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
    console.log('Storage check - bytes used:', bytesInUse, 'meetings count:', meetings.length)
    
    // 容量制限に近づいたら古い会議を削除
    if (bytesInUse > this.MAX_STORAGE_BYTES || meetings.length > this.MAX_MEETINGS) {
      console.log('Storage limit approaching, cleaning up old meetings...')
      // 古い順にソートして、半分を削除
      meetings.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      const keepCount = Math.min(Math.floor(meetings.length / 2), 50)
      const removedMeetings = meetings.splice(0, meetings.length - keepCount)
      console.log(`Removed ${removedMeetings.length} old meetings`)
    }
    
    await chrome.storage.local.set({ meetings })
  }
  
  async getMeetings(filter?: {
    startDate?: Date
    endDate?: Date
    hasMinutes?: boolean
  }): Promise<Meeting[]> {
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    
    return meetings.filter((meeting: Meeting) => {
      if (filter?.startDate && new Date(meeting.startTime) < filter.startDate) {
        return false
      }
      if (filter?.endDate && new Date(meeting.startTime) > filter.endDate) {
        return false
      }
      if (filter?.hasMinutes !== undefined && !!meeting.minutes !== filter.hasMinutes) {
        return false
      }
      return true
    })
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
}

export const storageService = new StorageService()