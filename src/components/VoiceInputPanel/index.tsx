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
          音声入力
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
              <span className="text-xs text-gray-600">音声で編集指示</span>

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
                    {recordingState.mode === 'edit' ? '編集指示を録音中' : '質問を録音中'}
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
    </div>
  )
}