import React, { useState, useEffect } from 'react'
import { storageService } from '@/services/storage'

export function ClearStorageButton() {
  const [storageInfo, setStorageInfo] = useState<{ used: number; total: number; percentage: number } | null>(null)
  const [isClearing, setIsClearing] = useState(false)

  useEffect(() => {
    checkStorage()
  }, [])

  const checkStorage = async () => {
    try {
      const info = await storageService.getStorageInfo()
      setStorageInfo(info)
    } catch (error) {
      console.error('Failed to get storage info:', error)
    }
  }

  const handleClearOldData = async () => {
    if (!confirm('古い会議データを削除しますか？この操作は取り消せません。')) {
      return
    }

    setIsClearing(true)
    try {
      // 30日以上前の会議を削除
      const meetings = await storageService.getMeetings()
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      
      let deletedCount = 0
      for (const meeting of meetings) {
        const meetingDate = meeting.startTime instanceof Date ? meeting.startTime : new Date(meeting.startTime || Date.now())
        if (meetingDate < thirtyDaysAgo) {
          await storageService.deleteMeeting(meeting.id)
          deletedCount++
        }
      }

      alert(`${deletedCount}件の古い会議データを削除しました。`)
      await checkStorage() // ストレージ情報を更新
    } catch (error) {
      console.error('Failed to clear old data:', error)
      alert('データの削除中にエラーが発生しました。')
    } finally {
      setIsClearing(false)
    }
  }

  if (!storageInfo) return null

  const isHighUsage = storageInfo.percentage > 0.7
  const isCritical = storageInfo.percentage > 0.85

  return (
    <div className="space-y-2">
      {(isHighUsage || isCritical) && (
        <div className={`rounded-lg p-3 border ${isCritical ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <div className="flex items-start gap-2">
            <span className={`text-lg ${isCritical ? 'text-red-600' : 'text-yellow-600'}`}>⚠️</span>
            <div className="flex-1">
              <p className={`text-sm font-medium ${isCritical ? 'text-red-800' : 'text-yellow-800'}`}>
                ストレージ使用率: {(storageInfo.percentage * 100).toFixed(1)}%
                {isCritical && " - 容量が逼迫しています"}
              </p>
            </div>
          </div>
        </div>
      )}
      
      <div className="text-xs text-gray-500">
        ストレージ: {(storageInfo.used / 1024 / 1024).toFixed(2)}MB / {(storageInfo.total / 1024 / 1024).toFixed(2)}MB
      </div>

      {isHighUsage && (
        <button 
          onClick={handleClearOldData}
          disabled={isClearing}
          className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
        >
          <span>🗑️</span>
          <span>{isClearing ? '削除中...' : '古いデータを削除'}</span>
        </button>
      )}
    </div>
  )
}