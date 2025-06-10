import { Transcript, Minutes, UserSettings } from '@/types'
import { MINUTES_GENERATION_PROMPT } from '@/system-prompts'

export abstract class BaseAIService {
  protected apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  abstract generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date }
  ): Promise<Minutes>

  abstract validateApiKey(apiKey: string): Promise<boolean>

  abstract checkRateLimit(): Promise<{
    remaining: number
    reset: Date
    limit: number
  }>

  // AIアシスタント用の汎用コンテンツ生成メソッド
  abstract generateContent(prompt: string, modelId?: string): Promise<string>

  protected calculateDuration(transcripts: Transcript[]): number {
    if (transcripts.length === 0) return 0
    
    const timestamps = transcripts.map(t => {
      return t.timestamp instanceof Date ? t.timestamp.getTime() : new Date(t.timestamp).getTime()
    })
    const start = Math.min(...timestamps)
    const end = Math.max(...timestamps)
    
    return Math.floor((end - start) / 1000)
  }

  protected getUniqueParticipants(transcripts: Transcript[]): string[] {
    const participants = new Set(transcripts.map(t => t.speaker))
    return Array.from(participants)
  }

  protected formatTranscriptsEnhanced(transcripts: Transcript[], startTime?: Date, endTime?: Date): string {
    const sortedTranscripts = transcripts.sort((a, b) => {
      const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
      const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
      return aTime - bTime
    })
    
    // 連続する同一話者の発言を統合
    const consolidatedTranscripts: Transcript[] = []
    let currentTranscript: Transcript | null = null
    
    sortedTranscripts.forEach(transcript => {
      const currentTime = transcript.timestamp instanceof Date ? transcript.timestamp.getTime() : new Date(transcript.timestamp).getTime()
      const prevTime = currentTranscript ? 
        (currentTranscript.timestamp instanceof Date ? currentTranscript.timestamp.getTime() : new Date(currentTranscript.timestamp).getTime()) : 
        0
      
      if (currentTranscript && 
          currentTranscript.speaker === transcript.speaker &&
          currentTime - prevTime < 30000) {
        // 30秒以内の同一話者の発言は統合
        currentTranscript.content += ' ' + transcript.content
      } else {
        if (currentTranscript) {
          consolidatedTranscripts.push(currentTranscript)
        }
        currentTranscript = { ...transcript }
      }
    })
    
    if (currentTranscript) {
      consolidatedTranscripts.push(currentTranscript)
    }
    
    // 会議の時間情報を追加
    let header = ''
    if (startTime || endTime) {
      header = '## 会議情報\n'
      if (startTime) {
        header += `- 開始時刻: ${startTime.toLocaleString('ja-JP')}\n`
      }
      if (endTime) {
        header += `- 終了時刻: ${endTime.toLocaleString('ja-JP')}\n`
        if (startTime) {
          const duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000)
          const hours = Math.floor(duration / 3600)
          const minutes = Math.floor((duration % 3600) / 60)
          header += `- 会議時間: ${hours > 0 ? `${hours}時間` : ''}${minutes}分\n`
        }
      }
      header += '\n## 発言記録\n'
    }
    
    const transcriptText = consolidatedTranscripts
      .map(t => {
        const timestamp = t.timestamp instanceof Date ? t.timestamp : new Date(t.timestamp)
        const time = timestamp.toLocaleTimeString('ja-JP', { 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit'
        })
        return `[${time}] **${t.speaker}**: ${t.content}`
      })
      .join('\n\n')
      
    return header + transcriptText
  }

  protected getSystemPrompt(): string {
    return MINUTES_GENERATION_PROMPT
  }

  // ユーザー設定のプロンプトを取得
  protected async getEnhancedPrompt(settings?: UserSettings): Promise<string> {
    // システムプロンプトを必ず含める
    let combinedPrompt = this.getSystemPrompt()
    
    // カスタムプロンプトがある場合は追加
    if (settings?.promptTemplate && settings.promptTemplate.trim()) {
      combinedPrompt += '\n\n## 追加のカスタム指示\n\n' + settings.promptTemplate
    }
    
    return combinedPrompt
  }
}