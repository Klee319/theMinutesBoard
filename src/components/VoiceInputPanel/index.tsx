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
      // AI処理を実行
      onAiEdit({
        instruction: transcriptData,
        transcriptData,
        mode
      })
    } else {
      alert('録音された内容がありません')
    }

    logger.debug(`Stopped ${mode} recording, captured ${transcriptData.length} characters`)
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
          🎙️ 音声入力
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

      <div className="flex-1 p-4 flex flex-col">
        {meeting ? (
          <>
            {/* 録音ボタンエリア */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <button
                onClick={() => recordingState.isRecording ? stopRecording() : startRecording('edit')}
                disabled={isLocked || (recordingState.isRecording && recordingState.mode !== 'edit')}
                className={`py-4 px-6 rounded-lg border-2 font-medium transition-all ${getButtonStyle('edit')}`}
              >
                <div className="flex flex-col items-center gap-2">
                  <span className="text-2xl">✏️</span>
                  <span className="text-sm">
                    {recordingState.isRecording && recordingState.mode === 'edit' 
                      ? '停止して編集' 
                      : '議事録編集'}
                  </span>
                </div>
              </button>

              <button
                onClick={() => recordingState.isRecording ? stopRecording() : startRecording('research')}
                disabled={isLocked || (recordingState.isRecording && recordingState.mode !== 'research')}
                className={`py-4 px-6 rounded-lg border-2 font-medium transition-all ${getButtonStyle('research')}`}
              >
                <div className="flex flex-col items-center gap-2">
                  <span className="text-2xl">🔍</span>
                  <span className="text-sm">
                    {recordingState.isRecording && recordingState.mode === 'research' 
                      ? '停止してリサーチ' 
                      : 'リサーチ'}
                  </span>
                </div>
              </button>
            </div>

            {/* 録音状態表示 */}
            {recordingState.isRecording && (
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    {recordingState.mode === 'edit' ? '📝 編集指示を録音中' : '🔍 質問を録音中'}
                  </span>
                  <span className="text-sm font-mono text-gray-600">
                    {getRecordingDuration()}
                  </span>
                </div>
                
                <div className="text-xs text-gray-500 mb-2">
                  キャプチャした発言: {recordingState.capturedTranscripts.length}件
                </div>
                
                {recordingState.capturedTranscripts.length > 0 && (
                  <div className="max-h-20 overflow-y-auto">
                    <div className="text-xs text-gray-600 bg-white p-2 rounded border">
                      {recordingState.capturedTranscripts.slice(-3).map((transcript, index) => (
                        <div key={index} className="truncate">
                          {transcript}
                        </div>
                      ))}
                      {recordingState.capturedTranscripts.length > 3 && (
                        <div className="text-gray-400">
                          ...他 {recordingState.capturedTranscripts.length - 3}件
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 使用方法説明 */}
            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <h4 className="font-medium text-blue-900 mb-2">使用方法</h4>
              <ul className="text-blue-800 space-y-1 text-xs">
                <li>• <strong>議事録編集</strong>: 音声で議事録の修正指示を出す</li>
                <li>• <strong>リサーチ</strong>: 会議内容について質問する</li>
                <li>• ボタンを押して録音開始、再度押して処理実行</li>
              </ul>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">🎙️</div>
            <p className="text-gray-600 mb-2">記録中の会議がありません</p>
            <p className="text-sm text-gray-500">Google Meetで記録を開始してください</p>
          </div>
        )}
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
    </div>
  )
}