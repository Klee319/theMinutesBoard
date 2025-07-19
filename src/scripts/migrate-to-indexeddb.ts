/**
 * Chrome StorageからIndexedDBへのデータ移行スクリプト
 * 
 * 使用方法:
 * 1. Chrome拡張機能のバックグラウンドページのコンソールで実行
 * 2. または、専用の移行ページから実行
 */

import { StorageService } from '@/services/storage'
import { Meeting } from '@/types'

interface MigrationResult {
  success: boolean
  totalMeetings: number
  migratedMeetings: number
  failedMeetings: string[]
  errors: Array<{ meetingId: string; error: string }>
  startTime: Date
  endTime: Date
  duration: number
}

export class MigrationService {
  private storageService: StorageService

  constructor() {
    this.storageService = new StorageService()
  }

  /**
   * Chrome StorageからIndexedDBへデータを移行
   */
  async migrate(options: {
    batchSize?: number
    dryRun?: boolean
    onProgress?: (progress: { current: number; total: number; meetingTitle: string }) => void
  } = {}): Promise<MigrationResult> {
    const { batchSize = 10, dryRun = false, onProgress } = options
    const startTime = new Date()
    const result: MigrationResult = {
      success: false,
      totalMeetings: 0,
      migratedMeetings: 0,
      failedMeetings: [],
      errors: [],
      startTime,
      endTime: new Date(),
      duration: 0
    }

    try {
      // IndexedDBサービスを初期化
      await this.storageService.initIndexedDB()

      // Chrome Storageから全会議データを取得
      const { meetings = [] } = await chrome.storage.local.get(['meetings'])
      result.totalMeetings = meetings.length

      console.log(`[Migration] Starting migration of ${meetings.length} meetings...`)

      // バッチ処理で移行
      for (let i = 0; i < meetings.length; i += batchSize) {
        const batch = meetings.slice(i, i + batchSize) as Meeting[]
        
        for (const meeting of batch) {
          try {
            if (onProgress) {
              onProgress({
                current: result.migratedMeetings + 1,
                total: result.totalMeetings,
                meetingTitle: meeting.title
              })
            }

            if (!dryRun) {
              // IndexedDBへ保存
              await this.storageService.enableIndexedDB(false)
              // @ts-ignore - private methodへのアクセス
              await this.storageService.indexedDBService?.saveMeeting(meeting)
            }

            result.migratedMeetings++
            console.log(`[Migration] Migrated meeting: ${meeting.title} (${meeting.id})`)
          } catch (error) {
            result.failedMeetings.push(meeting.id)
            result.errors.push({
              meetingId: meeting.id,
              error: error instanceof Error ? error.message : String(error)
            })
            console.error(`[Migration] Failed to migrate meeting ${meeting.id}:`, error)
          }
        }

        // バッチ間で少し待機（ブラウザの負荷軽減）
        if (i + batchSize < meetings.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      result.success = result.failedMeetings.length === 0
      result.endTime = new Date()
      result.duration = result.endTime.getTime() - result.startTime.getTime()

      console.log(`[Migration] Migration completed:`, {
        success: result.success,
        migrated: result.migratedMeetings,
        failed: result.failedMeetings.length,
        duration: `${result.duration}ms`
      })

      return result
    } catch (error) {
      console.error('[Migration] Fatal error during migration:', error)
      result.endTime = new Date()
      result.duration = result.endTime.getTime() - result.startTime.getTime()
      throw error
    }
  }

  /**
   * 移行の検証
   */
  async verify(): Promise<{
    chromeStorageCount: number
    indexedDBCount: number
    match: boolean
    missingInIndexedDB: string[]
  }> {
    // Chrome Storageのデータ数を確認
    const { meetings: chromeMeetings = [] } = await chrome.storage.local.get(['meetings'])
    const chromeStorageCount = chromeMeetings.length

    // IndexedDBのデータ数を確認
    await this.storageService.enableIndexedDB(false)
    const indexedDBMeetings = await this.storageService.getMeetings()
    const indexedDBCount = indexedDBMeetings.length

    // 不足しているデータを特定
    const chromeMeetingIds = new Set(chromeMeetings.map((m: Meeting) => m.id))
    const indexedDBMeetingIds = new Set(indexedDBMeetings.map(m => m.id))
    const missingInIndexedDB = Array.from(chromeMeetingIds).filter(
      id => !indexedDBMeetingIds.has(id)
    )

    return {
      chromeStorageCount,
      indexedDBCount,
      match: chromeStorageCount === indexedDBCount && missingInIndexedDB.length === 0,
      missingInIndexedDB
    }
  }

  /**
   * ロールバック（IndexedDBのデータをクリア）
   */
  async rollback(): Promise<void> {
    console.log('[Migration] Starting rollback...')
    await this.storageService.enableIndexedDB(false)
    // @ts-ignore - private methodへのアクセス
    await this.storageService.indexedDBService?.clearAllData()
    console.log('[Migration] Rollback completed')
  }

  /**
   * 移行ステータスの取得
   */
  async getStatus(): Promise<{
    isIndexedDBEnabled: boolean
    chromeStorageSize: number
    indexedDBSize: number
    canMigrate: boolean
  }> {
    const { meetings = [] } = await chrome.storage.local.get(['meetings'])
    const bytesInUse = await chrome.storage.local.getBytesInUse()

    let indexedDBSize = 0
    try {
      await this.storageService.enableIndexedDB(false)
      const info = await this.storageService.getStorageInfo()
      indexedDBSize = info.storageUsed
    } catch (error) {
      console.warn('[Migration] Could not get IndexedDB size:', error)
    }

    return {
      // @ts-ignore - private propertyへのアクセス
      isIndexedDBEnabled: this.storageService.useIndexedDB,
      chromeStorageSize: bytesInUse,
      indexedDBSize,
      canMigrate: meetings.length > 0
    }
  }
}

// コンソールから実行できるようにグローバルに公開
if (typeof window !== 'undefined') {
  (window as any).MigrationService = MigrationService
}