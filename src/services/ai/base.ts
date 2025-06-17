import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'
import { MINUTES_GENERATION_PROMPT, NEXTSTEPS_GENERATION_PROMPT } from '@/system-prompts'

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

  // ネクストステップ生成メソッド
  abstract generateNextSteps(
    meeting: Meeting,
    userPrompt?: string
  ): Promise<NextStep[]>

  // チャットメッセージ送信メソッド
  abstract sendChatMessage(
    message: string,
    context: any
  ): Promise<string>

  // 汎用テキスト生成メソッド
  abstract generateText(
    prompt: string,
    options?: {
      maxTokens?: number
      temperature?: number
    }
  ): Promise<string>

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
    
    // ユーザー名のプレースホルダーを置換
    if (settings?.userName) {
      combinedPrompt = combinedPrompt.replace(/\{\{userName\}\}/g, settings.userName)
    } else {
      // ユーザー名が設定されていない場合は「不明な参加者」とする
      combinedPrompt = combinedPrompt.replace(/\{\{userName\}\}/g, '不明な参加者')
    }
    
    // カスタムプロンプトがある場合は追加
    if (settings?.promptTemplate && settings.promptTemplate.trim()) {
      combinedPrompt += '\n\n## 追加のカスタム指示\n\n' + settings.promptTemplate
    }
    
    return combinedPrompt
  }

  // ネクストステップ生成用のプロンプトを構築
  protected buildNextStepsPrompt(meeting: Meeting, userPrompt?: string): string {
    let prompt = NEXTSTEPS_GENERATION_PROMPT

    // プレースホルダーの置換
    prompt = prompt.replace('{{startTime}}', meeting.startTime.toLocaleString('ja-JP'))
    prompt = prompt.replace('{{participants}}', meeting.participants.join(', '))
    
    const duration = meeting.duration || this.calculateDuration(meeting.transcripts)
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    const durationText = `${hours > 0 ? `${hours}時間` : ''}${minutes}分`
    prompt = prompt.replace('{{duration}}', durationText)

    // 発言記録の整形
    const transcriptsText = this.formatTranscriptsForNextSteps(meeting.transcripts)
    prompt = prompt.replace('{{transcripts}}', transcriptsText)

    // ユーザープロンプトの追加
    if (userPrompt && userPrompt.trim()) {
      prompt += '\n\n## 追加の指示\n\n' + userPrompt
    }

    return prompt
  }

  // ネクストステップ抽出用の発言記録整形
  protected formatTranscriptsForNextSteps(transcripts: Transcript[]): string {
    return transcripts
      .sort((a, b) => {
        const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime()
        const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime()
        return aTime - bTime
      })
      .map(t => {
        const timestamp = t.timestamp instanceof Date ? t.timestamp : new Date(t.timestamp)
        const time = timestamp.toLocaleTimeString('ja-JP', { 
          hour: '2-digit', 
          minute: '2-digit'
        })
        return `[${time}] ${t.speaker}: ${t.content} (ID: ${t.id})`
      })
      .join('\n')
  }

  // AI応答をNextStep配列に変換
  protected parseNextStepsResponse(response: string, meetingId: string): NextStep[] {
    try {
      // JSONコードブロックを抽出
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/)
      let jsonStr = jsonMatch ? jsonMatch[1] : response
      
      // JSONの一般的な問題を修正
      try {
        // まず直接パースを試みる
        const parsed = JSON.parse(jsonStr)
        return this.processNextStepsData(parsed, meetingId)
      } catch (firstError) {
        // パースに失敗した場合、修正を試みる
        console.warn('Initial JSON parse failed, attempting to fix:', firstError)
        
        // プロパティ名の修正（ただし既にクォートされているものは除外）
        jsonStr = jsonStr
          .replace(/,\s*}/g, '}') // 末尾のカンマを削除
          .replace(/,\s*]/g, ']') // 配列の末尾のカンマを削除
          // プロパティ名をクォートで囲む（既にクォートされていないもののみ）
          .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
          // true/false/nullの値を正しくする
          .replace(/:\s*True\b/gi, ':true')
          .replace(/:\s*False\b/gi, ':false')
          .replace(/:\s*None\b/gi, ':null')
          // 日付文字列の修正（YYYY-MM-DD形式）
          .replace(/:\s*"?(\d{4}-\d{2}-\d{2})"?\s*([,}])/g, ':"$1"$2')
          // 余分なカンマを再度削除
          .replace(/,(\s*[}\]])/g, '$1')
      }
      
      const parsed = JSON.parse(jsonStr)
      return this.processNextStepsData(parsed, meetingId)
    } catch (error) {
      console.error('Failed to parse NextSteps response:', error)
      console.error('Original response:', response)
      return []
    }
  }

  private processNextStepsData(parsed: any, meetingId: string): NextStep[] {
    if (!parsed.nextSteps || !Array.isArray(parsed.nextSteps)) {
      throw new Error('Invalid response format')
    }

    return parsed.nextSteps.map((item: any) => {
        let dueDate: Date | undefined

        // 期限の設定ロジック
        if (item.dueDate && item.dueDate !== 'null' && item.dueDate !== '未定') {
          try {
            dueDate = new Date(item.dueDate)
            // Invalid Date チェック
            if (isNaN(dueDate.getTime())) {
              dueDate = this.getDefaultDueDate(item.priority)
            }
          } catch {
            dueDate = this.getDefaultDueDate(item.priority)
          }
        } else {
          // AIが期限を設定しなかった場合のフォールバック
          dueDate = this.getDefaultDueDate(item.priority)
        }

      return {
        id: this.generateId(),
        meetingId,
        task: item.task || '',
        assignee: item.assignee || undefined,
        dueDate,
        status: item.isPending ? 'pending' : 'confirmed',
        isPending: item.isPending || false,
        priority: item.priority || 'medium',
        dependencies: [],
        notes: item.notes || '',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })
  }

  // 優先度に基づくデフォルト期限を生成
  protected getDefaultDueDate(priority?: string): Date {
    const today = new Date()
    const defaultDate = new Date(today)
    
    switch (priority) {
      case 'high':
        defaultDate.setDate(today.getDate() + 3) // 3日後
        break
      case 'low':
        defaultDate.setDate(today.getDate() + 14) // 2週間後
        break
      default: // medium
        defaultDate.setDate(today.getDate() + 7) // 1週間後
        break
    }
    
    return defaultDate
  }

  // ランダムIDの生成
  protected generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2)
  }
}