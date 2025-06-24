import React, { useState, useEffect } from 'react'
import { Meeting } from '@/types'
import { logger } from '@/utils/logger'

interface VoiceInputPanelProps {
  meeting: Meeting | null
  isLocked: boolean
  onAiEdit: (data: { instruction: string; transcriptData: string; mode: 'edit' | 'research' }) => void
  onStopRecording: () => void
}

interface RecordingState {
  isRecording: boolean
  mode: 'edit' | 'research' | null
  startTime: Date | null
  capturedTranscripts: string[]
}

interface ConfirmationDialogState {
  isOpen: boolean
  transcripts: string[]
  mode: 'edit' | 'research' | null
}

export default function VoiceInputPanel({
  meeting,
  isLocked,
  onAiEdit,
  onStopRecording
}: VoiceInputPanelProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>({
    isRecording: false,
    mode: null,
    startTime: null,
    capturedTranscripts: []
  })
  
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState>({
    isOpen: false,
    transcripts: [],
    mode: null
  })

  // 字幕更新の監視
  useEffect(() => {
    const handleTranscriptUpdate = (message: any) => {
      if (message.type === 'REALTIME_TRANSCRIPT' && recordingState.isRecording) {
        const transcript = `[${message.payload.speaker}]: ${message.payload.content}`
        setRecordingState(prev => ({
          ...prev,
          capturedTranscripts: [...prev.capturedTranscripts, transcript]
        }))
      }
    }

    // Content scriptからのリアルタイム字幕を監視
    chrome.runtime.onMessage.addListener(handleTranscriptUpdate)
    
    return () => {
      chrome.runtime.onMessage.removeListener(handleTranscriptUpdate)
    }
  }, [recordingState.isRecording])

  const startRecording = (mode: 'edit' | 'research') => {
    if (isLocked) return
    
    setRecordingState({
      isRecording: true,
      mode,
      startTime: new Date(),
      capturedTranscripts: []
    })
    
    logger.debug(`Started ${mode} recording`)
  }

  const stopRecording = async () => {
    if (!recordingState.isRecording || !recordingState.mode) return

    const transcriptData = recordingState.capturedTranscripts.join('\n')
    const mode = recordingState.mode

    // 録音状態をリセット
    setRecordingState({
      isRecording: false,
      mode: null,
      startTime: null,
      capturedTranscripts: []
    })

    if (transcriptData.trim()) {
      // 確認ダイアログを表示
      setConfirmationDialog({
        isOpen: true,
        transcripts: recordingState.capturedTranscripts,
        mode
      })
    } else {
      alert('記録された内容がありません')
    }

    logger.debug(`Stopped ${mode} recording, captured ${transcriptData.length} characters`)
  }

  const handleConfirmEdit = () => {
    if (!confirmationDialog.mode || confirmationDialog.transcripts.length === 0) return

    const transcriptData = confirmationDialog.transcripts.join('\n')
    
    // AI処理を実行
    onAiEdit({
      instruction: transcriptData,
      transcriptData,
      mode: confirmationDialog.mode
    })

    // ダイアログを閉じる
    setConfirmationDialog({
      isOpen: false,
      transcripts: [],
      mode: null
    })
  }

  const handleCancelEdit = () => {
    // ダイアログを閉じて入力を破棄
    setConfirmationDialog({
      isOpen: false,
      transcripts: [],
      mode: null
    })
    
    logger.debug('User cancelled voice input')
  }

  const getButtonStyle = (mode: 'edit' | 'research') => {
    const isActive = recordingState.isRecording && recordingState.mode === mode
    const isDisabled = isLocked || (recordingState.isRecording && recordingState.mode !== mode)
    
    if (isDisabled) {
      return 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-300'
    }
    
    if (isActive) {
      return mode === 'edit' 
        ? 'bg-red-500 text-white border-red-600 shadow-lg animate-pulse'
        : 'bg-orange-500 text-white border-orange-600 shadow-lg animate-pulse'
    }
    
    return mode === 'edit'
      ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'
      : 'bg-green-600 text-white border-green-700 hover:bg-green-700'
  }

  const getRecordingDuration = () => {
    if (!recordingState.startTime) return '00:00'
    
    const now = new Date()
    const diff = Math.floor((now.getTime() - recordingState.startTime.getTime()) / 1000)
    const minutes = Math.floor(diff / 60)
    const seconds = diff % 60
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="bg-white rounded-lg shadow-sm h-full flex flex-col">
      <div className="p-4 border-b bg-purple-50">
        <h2 className="text-lg font-semibold text-purple-900 flex items-center gap-2">
          AIアシスタント
          {meeting && (
            <button
              onClick={onStopRecording}
              className="ml-auto px-3 py-1 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors text-sm"
            >
              ⏹ 記録停止
            </button>
          )}
        </h2>
      </div>

      <div className="flex-1 p-4 flex flex-col justify-center">
        {meeting ? (
          <>
            {/* 録音ボタンエリア */}
            <div className="flex gap-4 items-center">
              <button
                onClick={() => recordingState.isRecording ? stopRecording() : startRecording('edit')}
                disabled={isLocked || (recordingState.isRecording && recordingState.mode !== 'edit')}
                className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${getButtonStyle('edit')}`}
              >
                {recordingState.isRecording && recordingState.mode === 'edit' 
                  ? '⏹ 停止して編集' 
                  : '✏️ 議事録編集'}
              </button>
              <span className="text-xs text-gray-600">字幕で編集指示</span>

              <button
                onClick={() => recordingState.isRecording ? stopRecording() : startRecording('research')}
                disabled={isLocked || (recordingState.isRecording && recordingState.mode !== 'research')}
                className={`flex-1 py-3 px-4 rounded-lg border-2 font-medium transition-all ${getButtonStyle('research')}`}
              >
                {recordingState.isRecording && recordingState.mode === 'research' 
                  ? '⏹ 停止してリサーチ' 
                  : '🔍 リサーチ'}
              </button>
              <span className="text-xs text-gray-600">会議内容を質問</span>
            </div>

            {/* 録音状態表示 */}
            {recordingState.isRecording && (
              <div className="mt-4 flex items-center justify-center">
                <div className="flex items-center gap-2 text-sm">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-gray-700">
                    {recordingState.mode === 'edit' ? '編集指示を記録中' : '質問を記録中'}
                  </span>
                  <span className="font-mono text-gray-600">
                    {getRecordingDuration()}
                  </span>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      {isLocked && (
        <div className="absolute inset-0 bg-gray-200 bg-opacity-50 flex items-center justify-center rounded-lg">
          <div className="bg-white rounded-lg p-4 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-700">AI処理中...</span>
            </div>
          </div>
        </div>
      )}

      {/* 確認ダイアログ */}
      {confirmationDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {confirmationDialog.mode === 'edit' ? '編集内容の確認' : 'リサーチ内容の確認'}
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                この内容で{confirmationDialog.mode === 'edit' ? '議事録を編集' : 'リサーチを実行'}しますか？
              </p>
            </div>
            
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                {confirmationDialog.transcripts.length > 0 ? (
                  confirmationDialog.transcripts.map((transcript, index) => (
                    <div key={index} className="text-sm text-gray-700 leading-relaxed">
                      {transcript}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-500 italic">
                    記録された内容がありません
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={handleCancelEdit}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmEdit}
                className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}