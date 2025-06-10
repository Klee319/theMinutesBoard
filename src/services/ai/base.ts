import { Transcript, Minutes, UserSettings } from '@/types'

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
    
    const timestamps = transcripts.map(t => new Date(t.timestamp).getTime())
    const start = Math.min(...timestamps)
    const end = Math.max(...timestamps)
    
    return Math.floor((end - start) / 1000)
  }

  protected getUniqueParticipants(transcripts: Transcript[]): string[] {
    const participants = new Set(transcripts.map(t => t.speaker))
    return Array.from(participants)
  }

  protected formatTranscriptsEnhanced(transcripts: Transcript[], startTime?: Date, endTime?: Date): string {
    const sortedTranscripts = transcripts.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    
    // 連続する同一話者の発言を統合
    const consolidatedTranscripts: Transcript[] = []
    let currentTranscript: Transcript | null = null
    
    sortedTranscripts.forEach(transcript => {
      if (currentTranscript && 
          currentTranscript.speaker === transcript.speaker &&
          new Date(transcript.timestamp).getTime() - new Date(currentTranscript.timestamp).getTime() < 30000) {
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
        const time = new Date(t.timestamp).toLocaleTimeString('ja-JP', { 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit'
        })
        return `[${time}] **${t.speaker}**: ${t.content}`
      })
      .join('\n\n')
      
    return header + transcriptText
  }

  protected getDefaultPrompt(): string {
    return `あなたは会議の議事録作成の専門家です。以下の文字起こしから、構造化された議事録を作成してください。

**議事録作成の指針:**
1. 会議の目的と主要な議題を特定
2. 各参加者の主要な発言を要約
3. 重要な決定事項やアクションアイテムを明確に記録
4. 日本語として自然で読みやすい文章に整理
5. 文字起こしの不完全な部分は適切に補完

**出力構造:**
# 会議議事録
## 概要
## 参加者
## 主要議題と討議内容
## 決定事項
## アクションアイテム
## その他・備考`
  }

  // ユーザー設定のプロンプトを取得
  protected async getEnhancedPrompt(settings?: UserSettings): Promise<string> {
    const defaultPrompt = this.getDefaultPrompt()
    
    // ユーザー設定のプロンプトがあればそれを使用、なければデフォルト
    if (settings?.promptTemplate && settings.promptTemplate.trim()) {
      return settings.promptTemplate
    }
    
    return defaultPrompt
  }
}