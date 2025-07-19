import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MigrationService } from './migrate-to-indexeddb'
import { Meeting } from '@/types'
import 'fake-indexeddb/auto'

// Mock chrome.storage API
const mockChromeStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
    getBytesInUse: vi.fn()
  }
}

// @ts-ignore
global.chrome = {
  storage: mockChromeStorage
}

describe('MigrationService', () => {
  let service: MigrationService
  
  const createMockMeetings = (count: number): Meeting[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `meeting-${i + 1}`,
      title: `Meeting ${i + 1}`,
      startTime: new Date(`2025-01-${10 + i}T10:00:00`),
      endTime: new Date(`2025-01-${10 + i}T11:00:00`),
      participants: ['Alice', 'Bob'],
      transcripts: [
        {
          id: `meeting-${i + 1}-t1`,
          timestamp: new Date(`2025-01-${10 + i}T10:00:00`),
          speaker: 'Alice',
          content: `Hello from meeting ${i + 1}`
        }
      ],
      isRecording: false
    }))
  }

  beforeEach(() => {
    service = new MigrationService()
    vi.clearAllMocks()
  })

  describe('migrate', () => {
    it('should migrate all meetings successfully', async () => {
      const mockMeetings = createMockMeetings(3)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      const result = await service.migrate()

      expect(result.success).toBe(true)
      expect(result.totalMeetings).toBe(3)
      expect(result.migratedMeetings).toBe(3)
      expect(result.failedMeetings).toHaveLength(0)
      expect(result.duration).toBeGreaterThan(0)
    })

    it('should handle dry run correctly', async () => {
      const mockMeetings = createMockMeetings(2)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      const result = await service.migrate({ dryRun: true })

      expect(result.success).toBe(true)
      expect(result.migratedMeetings).toBe(2)
      // In dry run, data should not be actually saved
    })

    it('should call progress callback', async () => {
      const mockMeetings = createMockMeetings(2)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })
      
      const progressCallback = vi.fn()
      await service.migrate({ onProgress: progressCallback })

      expect(progressCallback).toHaveBeenCalledTimes(2)
      expect(progressCallback).toHaveBeenCalledWith({
        current: 1,
        total: 2,
        meetingTitle: 'Meeting 1'
      })
      expect(progressCallback).toHaveBeenCalledWith({
        current: 2,
        total: 2,
        meetingTitle: 'Meeting 2'
      })
    })

    it('should handle batch processing', async () => {
      const mockMeetings = createMockMeetings(5)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      const result = await service.migrate({ batchSize: 2 })

      expect(result.success).toBe(true)
      expect(result.migratedMeetings).toBe(5)
      // Should process in 3 batches: 2, 2, 1
    })

    it('should handle migration errors gracefully', async () => {
      const mockMeetings = createMockMeetings(3)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      // Mock IndexedDB save to fail on second meeting
      const originalInit = service['storageService'].initIndexedDB
      service['storageService'].initIndexedDB = vi.fn().mockImplementation(async () => {
        await originalInit.call(service['storageService'])
        // @ts-ignore
        const originalSave = service['storageService'].indexedDBService.saveMeeting
        // @ts-ignore
        service['storageService'].indexedDBService.saveMeeting = vi.fn()
          .mockImplementation(async (meeting: Meeting) => {
            if (meeting.id === 'meeting-2') {
              throw new Error('Save failed')
            }
            return originalSave.call(service['storageService'].indexedDBService, meeting)
          })
      })

      const result = await service.migrate()

      expect(result.success).toBe(false)
      expect(result.migratedMeetings).toBe(2)
      expect(result.failedMeetings).toContain('meeting-2')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({
        meetingId: 'meeting-2',
        error: 'Save failed'
      })
    })
  })

  describe('verify', () => {
    it('should verify matching data', async () => {
      const mockMeetings = createMockMeetings(3)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      // First migrate the data
      await service.migrate()

      // Then verify
      const verification = await service.verify()

      expect(verification.chromeStorageCount).toBe(3)
      expect(verification.indexedDBCount).toBe(3)
      expect(verification.match).toBe(true)
      expect(verification.missingInIndexedDB).toHaveLength(0)
    })

    it('should detect missing data', async () => {
      const mockMeetings = createMockMeetings(3)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      // Don't migrate, just verify
      const verification = await service.verify()

      expect(verification.chromeStorageCount).toBe(3)
      expect(verification.indexedDBCount).toBe(0)
      expect(verification.match).toBe(false)
      expect(verification.missingInIndexedDB).toHaveLength(3)
    })
  })

  describe('rollback', () => {
    it('should clear IndexedDB data', async () => {
      const mockMeetings = createMockMeetings(2)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })

      // Migrate data
      await service.migrate()

      // Verify data exists
      let verification = await service.verify()
      expect(verification.indexedDBCount).toBe(2)

      // Rollback
      await service.rollback()

      // Verify data is cleared
      verification = await service.verify()
      expect(verification.indexedDBCount).toBe(0)
    })
  })

  describe('getStatus', () => {
    it('should return migration status', async () => {
      const mockMeetings = createMockMeetings(2)
      mockChromeStorage.local.get.mockResolvedValue({ meetings: mockMeetings })
      mockChromeStorage.local.getBytesInUse.mockResolvedValue(1024 * 1024) // 1MB

      const status = await service.getStatus()

      expect(status.chromeStorageSize).toBe(1024 * 1024)
      expect(status.canMigrate).toBe(true)
      expect(status.isIndexedDBEnabled).toBe(false)
    })

    it('should handle empty storage', async () => {
      mockChromeStorage.local.get.mockResolvedValue({ meetings: [] })
      mockChromeStorage.local.getBytesInUse.mockResolvedValue(0)

      const status = await service.getStatus()

      expect(status.chromeStorageSize).toBe(0)
      expect(status.canMigrate).toBe(false)
    })
  })
})