import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IndexedDBStorageService } from './indexeddb-storage'
import { Meeting, Transcript, Minutes } from '@/types'
import 'fake-indexeddb/auto'

describe('IndexedDBStorageService', () => {
  let service: IndexedDBStorageService

  beforeEach(async () => {
    service = new IndexedDBStorageService()
    await service.init()
  })

  afterEach(async () => {
    await service.clearAllData()
  })

  const createMockMeeting = (id: string): Meeting => ({
    id,
    title: `Meeting ${id}`,
    startTime: new Date('2025-01-15T10:00:00'),
    endTime: new Date('2025-01-15T11:00:00'),
    participants: ['Alice', 'Bob'],
    transcripts: [
      {
        id: `${id}-t1`,
        timestamp: new Date('2025-01-15T10:00:00'),
        speaker: 'Alice',
        content: 'Hello everyone'
      },
      {
        id: `${id}-t2`,
        timestamp: new Date('2025-01-15T10:01:00'),
        speaker: 'Bob',
        content: 'Hi Alice'
      }
    ],
    isRecording: false
  })

  const createMockMinutes = (meetingId: string): Minutes => ({
    id: meetingId,
    meetingId,
    content: `Minutes for meeting ${meetingId}`,
    generatedAt: new Date('2025-01-15T11:00:00'),
    provider: 'gemini',
    model: 'gemini-1.5-flash'
  })

  describe('saveMeeting', () => {
    it('should save a meeting with transcripts', async () => {
      const meeting = createMockMeeting('test-1')
      await service.saveMeeting(meeting)

      const retrieved = await service.getMeeting('test-1')
      expect(retrieved).toBeTruthy()
      expect(retrieved?.id).toBe('test-1')
      expect(retrieved?.title).toBe('Meeting test-1')
      expect(retrieved?.transcripts).toHaveLength(2)
    })

    it('should save a meeting with minutes', async () => {
      const meeting = createMockMeeting('test-2')
      meeting.minutes = createMockMinutes('test-2')
      
      await service.saveMeeting(meeting)

      const retrieved = await service.getMeeting('test-2')
      expect(retrieved?.minutes).toBeTruthy()
      expect(retrieved?.minutes?.content).toBe('Minutes for meeting test-2')
    })

    it('should update existing meeting', async () => {
      const meeting = createMockMeeting('test-3')
      await service.saveMeeting(meeting)

      meeting.title = 'Updated Meeting'
      await service.saveMeeting(meeting)

      const retrieved = await service.getMeeting('test-3')
      expect(retrieved?.title).toBe('Updated Meeting')
    })
  })

  describe('getMeetings', () => {
    beforeEach(async () => {
      // Create test meetings
      for (let i = 1; i <= 5; i++) {
        const meeting = createMockMeeting(`meeting-${i}`)
        meeting.startTime = new Date(`2025-01-${10 + i}T10:00:00`)
        if (i % 2 === 0) {
          meeting.minutes = createMockMinutes(`meeting-${i}`)
        }
        await service.saveMeeting(meeting)
      }
    })

    it('should get all meetings', async () => {
      const meetings = await service.getMeetings()
      expect(meetings).toHaveLength(5)
    })

    it('should filter by date range', async () => {
      const meetings = await service.getMeetings({
        startDate: new Date('2025-01-12'),
        endDate: new Date('2025-01-14')
      })
      expect(meetings).toHaveLength(3)
    })

    it('should filter by hasMinutes', async () => {
      const withMinutes = await service.getMeetings({ hasMinutes: true })
      expect(withMinutes).toHaveLength(2)

      const withoutMinutes = await service.getMeetings({ hasMinutes: false })
      expect(withoutMinutes).toHaveLength(3)
    })

    it('should filter by keyword in title', async () => {
      const meetings = await service.getMeetings({ keyword: 'meeting-3' })
      expect(meetings).toHaveLength(1)
      expect(meetings[0].id).toBe('meeting-3')
    })

    it('should support pagination', async () => {
      const page1 = await service.getMeetings({ limit: 2, offset: 0 })
      expect(page1).toHaveLength(2)

      const page2 = await service.getMeetings({ limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)

      const page3 = await service.getMeetings({ limit: 2, offset: 4 })
      expect(page3).toHaveLength(1)
    })
  })

  describe('deleteMeeting', () => {
    it('should delete meeting and its data', async () => {
      const meeting = createMockMeeting('to-delete')
      meeting.minutes = createMockMinutes('to-delete')
      await service.saveMeeting(meeting)

      await service.deleteMeeting('to-delete')

      const retrieved = await service.getMeeting('to-delete')
      expect(retrieved).toBeNull()
    })
  })

  describe('saveMinutes', () => {
    it('should save minutes for existing meeting', async () => {
      const meeting = createMockMeeting('test-minutes')
      await service.saveMeeting(meeting)

      const minutes = createMockMinutes('test-minutes')
      await service.saveMinutes('test-minutes', minutes)

      const retrieved = await service.getMeeting('test-minutes')
      expect(retrieved?.minutes).toBeTruthy()
      expect(retrieved?.minutes?.content).toBe('Minutes for meeting test-minutes')
    })
  })

  describe('exportMeeting', () => {
    beforeEach(async () => {
      const meeting = createMockMeeting('export-test')
      meeting.minutes = createMockMinutes('export-test')
      await service.saveMeeting(meeting)
    })

    it('should export as markdown', async () => {
      const blob = await service.exportMeeting('export-test', 'markdown')
      const content = await blob.text()
      
      expect(blob.type).toBe('text/markdown')
      expect(content).toContain('# Meeting export-test')
      expect(content).toContain('## 議事録')
      expect(content).toContain('## 発言記録')
    })

    it('should export as text', async () => {
      const blob = await service.exportMeeting('export-test', 'txt')
      const content = await blob.text()
      
      expect(blob.type).toBe('text/plain')
      expect(content).toContain('Meeting export-test')
      expect(content).toContain('議事録')
      expect(content).toContain('発言記録')
    })

    it('should export as JSON', async () => {
      const blob = await service.exportMeeting('export-test', 'json')
      const content = await blob.text()
      const data = JSON.parse(content)
      
      expect(blob.type).toBe('application/json')
      expect(data.id).toBe('export-test')
      expect(data.exportedAt).toBeTruthy()
    })

    it('should export as CSV', async () => {
      const blob = await service.exportMeeting('export-test', 'csv')
      const content = await blob.text()
      
      expect(blob.type).toBe('text/csv')
      expect(content).toContain('時刻,話者,発言内容')
      expect(content).toContain('Alice')
      expect(content).toContain('Bob')
    })
  })

  describe('getStorageInfo', () => {
    it('should return storage information', async () => {
      const meeting1 = createMockMeeting('info-1')
      const meeting2 = createMockMeeting('info-2')
      await service.saveMeeting(meeting1)
      await service.saveMeeting(meeting2)

      const info = await service.getStorageInfo()
      
      expect(info.meetingCount).toBe(2)
      expect(info.totalTranscripts).toBe(4) // 2 meetings × 2 transcripts each
      expect(info.storageUsed).toBeGreaterThan(0)
    })
  })
})