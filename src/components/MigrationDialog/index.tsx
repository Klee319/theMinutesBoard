import React, { useState } from 'react'
import { MigrationService } from '@/scripts/migrate-to-indexeddb'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react'

interface MigrationDialogProps {
  isOpen: boolean
  onClose: () => void
  onMigrationComplete?: () => void
}

export const MigrationDialog: React.FC<MigrationDialogProps> = ({
  isOpen,
  onClose,
  onMigrationComplete
}) => {
  const [isVerifying, setIsVerifying] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState(0)
  const [currentMeeting, setCurrentMeeting] = useState('')
  const [verificationResult, setVerificationResult] = useState<{
    chromeStorageCount: number
    indexedDBCount: number
    match: boolean
  } | null>(null)
  const [migrationResult, setMigrationResult] = useState<{
    success: boolean
    migratedMeetings: number
    failedMeetings: string[]
    duration: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const migrationService = new MigrationService()

  const handleVerify = async () => {
    setIsVerifying(true)
    setError(null)
    try {
      const result = await migrationService.verify()
      setVerificationResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '検証中にエラーが発生しました')
    } finally {
      setIsVerifying(false)
    }
  }

  const handleMigrate = async () => {
    setIsMigrating(true)
    setError(null)
    setMigrationProgress(0)
    
    try {
      const result = await migrationService.migrate({
        onProgress: (progress) => {
          setMigrationProgress((progress.current / progress.total) * 100)
          setCurrentMeeting(progress.meetingTitle)
        }
      })
      
      setMigrationResult(result)
      
      if (result.success && onMigrationComplete) {
        onMigrationComplete()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '移行中にエラーが発生しました')
    } finally {
      setIsMigrating(false)
    }
  }

  const handleRollback = async () => {
    if (confirm('IndexedDBのデータをすべて削除します。よろしいですか？')) {
      try {
        await migrationService.rollback()
        setVerificationResult(null)
        setMigrationResult(null)
        alert('ロールバックが完了しました')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ロールバック中にエラーが発生しました')
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">データ移行ツール</h2>
        
        {/* エラー表示 */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <XCircle className="h-4 w-4" />
            <AlertTitle>エラー</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* ステップ1: 検証 */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">ステップ1: データの検証</h3>
          <p className="text-sm text-gray-600 mb-3">
            現在のデータ状況を確認します
          </p>
          
          <Button 
            onClick={handleVerify}
            disabled={isVerifying || isMigrating}
          >
            {isVerifying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                検証中...
              </>
            ) : (
              '検証を実行'
            )}
          </Button>

          {verificationResult && (
            <div className="mt-4 p-4 bg-gray-50 rounded">
              <div className="space-y-2">
                <p>Chrome Storage: {verificationResult.chromeStorageCount}件</p>
                <p>IndexedDB: {verificationResult.indexedDBCount}件</p>
                {verificationResult.match ? (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      データは既に同期されています
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {verificationResult.chromeStorageCount - verificationResult.indexedDBCount}件の
                      データが未移行です
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ステップ2: 移行 */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">ステップ2: データ移行</h3>
          <p className="text-sm text-gray-600 mb-3">
            Chrome StorageからIndexedDBへデータを移行します
          </p>
          
          <Button 
            onClick={handleMigrate}
            disabled={isMigrating || !verificationResult || verificationResult.match}
            variant={verificationResult && !verificationResult.match ? 'default' : 'secondary'}
          >
            {isMigrating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                移行中...
              </>
            ) : (
              '移行を実行'
            )}
          </Button>

          {isMigrating && (
            <div className="mt-4">
              <Progress value={migrationProgress} className="mb-2" />
              <p className="text-sm text-gray-600">
                処理中: {currentMeeting}
              </p>
            </div>
          )}

          {migrationResult && (
            <div className="mt-4">
              {migrationResult.success ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>移行完了</AlertTitle>
                  <AlertDescription>
                    {migrationResult.migratedMeetings}件のデータを正常に移行しました
                    （処理時間: {migrationResult.duration}ms）
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>移行に一部失敗</AlertTitle>
                  <AlertDescription>
                    {migrationResult.migratedMeetings}件を移行、
                    {migrationResult.failedMeetings.length}件が失敗しました
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        {/* アクションボタン */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handleRollback}
            disabled={isMigrating}
          >
            ロールバック
          </Button>
          
          <Button onClick={onClose}>
            閉じる
          </Button>
        </div>
      </div>
    </div>
  )
}