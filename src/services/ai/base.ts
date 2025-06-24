import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'
import { MINUTES_GENERATION_PROMPT, NEXTSTEPS_GENERATION_PROMPT } from '@/system-prompts'
import { logger } from '@/utils/logger'

export abstract class BaseAIService {
  protected apiKey: string
  protected defaultTimeout = 30000 // 30秒のデフォルトタイムアウト
  protected maxRetries = 3
  protected retryDelay = 1000 // 初期リトライ遅延（ミリ秒）

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
  protected async getEnhancedPrompt(
    settings?: UserSettings,
    transcripts?: Transcript[],
    meetingInfo?: { startTime?: Date; endTime?: Date }
  ): Promise<string> {
    // システムプロンプトを必ず含める
    let combinedPrompt = this.getSystemPrompt()
    
    // テンプレート変数を準備
    const templateVariables: Record<string, any> = {
      userName: settings?.userName || '不明な参加者',
      meetingDate: meetingInfo?.startTime || new Date(),
      speakerMap: transcripts ? this.buildSpeakerMap(transcripts) : {},
    }
    
    // テンプレート変数を置換
    combinedPrompt = this.replaceTemplateVariables(combinedPrompt, templateVariables)
    
    // カスタムプロンプトがある場合は追加
    if (settings?.promptTemplate && settings.promptTemplate.trim()) {
      const customPrompt = this.replaceTemplateVariables(
        settings.promptTemplate,
        templateVariables
      )
      combinedPrompt += '\n\n## 追加のカスタム指示\n\n' + customPrompt
    }
    
    return combinedPrompt
  }

  // ネクストステップ生成用のプロンプトを構築
  protected buildNextStepsPrompt(meeting: Meeting, userPrompt?: string): string {
    let prompt = NEXTSTEPS_GENERATION_PROMPT

    const duration = meeting.duration || this.calculateDuration(meeting.transcripts)
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    const durationText = `${hours > 0 ? `${hours}時間` : ''}${minutes}分`
    
    // テンプレート変数を準備
    const templateVariables: Record<string, any> = {
      meetingDate: meeting.startTime,
      speakerMap: this.buildSpeakerMap(meeting.transcripts),
      startTime: meeting.startTime.toLocaleString('ja-JP'),
      participants: meeting.participants.join(', '),
      duration: durationText,
      transcripts: this.formatTranscriptsForNextSteps(meeting.transcripts)
    }
    
    // テンプレート変数を置換
    prompt = this.replaceTemplateVariables(prompt, templateVariables)

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

  // トランスクリプトから話者マップを構築
  protected buildSpeakerMap(transcripts: Transcript[]): Record<string, string> {
    const speakerMap: Record<string, string> = {}
    const speakers = new Set<string>()
    
    // 全ての話者を収集
    transcripts.forEach(t => {
      speakers.add(t.speaker)
    })
    
    // 話者IDを生成（Unknown以外）
    Array.from(speakers).forEach((speaker, index) => {
      if (speaker !== 'Unknown') {
        speakerMap[`speaker_${index + 1}`] = speaker
      }
    })
    
    return speakerMap
  }

  // プロンプトテンプレートの変数を置換
  protected replaceTemplateVariables(
    template: string,
    variables: Record<string, any>
  ): string {
    let result = template
    
    // 各変数を置換
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\{\{${key}\}\}`, 'g')
      
      // 値の型に応じて適切に変換
      let replacementValue: string
      if (value instanceof Date) {
        // 日付の場合はISO形式（YYYY-MM-DD）に変換
        replacementValue = value.toISOString().split('T')[0]
      } else if (typeof value === 'object' && value !== null) {
        // オブジェクトの場合はJSON文字列に変換
        replacementValue = JSON.stringify(value, null, 2)
      } else if (value === undefined || value === null) {
        replacementValue = ''
      } else {
        replacementValue = String(value)
      }
      
      result = result.replace(regex, replacementValue)
    })
    
    return result
  }
  
  // リトライ機能付きのAPIコール
  protected async callWithRetry<T>(
    apiCall: () => Promise<T>,
    operation: string,
    retries = this.maxRetries
  ): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        logger.debug(`${operation}: Attempt ${attempt + 1}/${retries + 1}`)
        
        // タイムアウト付きでAPIコールを実行
        const result = await this.withTimeout(apiCall(), operation)
        
        if (attempt > 0) {
          logger.info(`${operation}: Succeeded after ${attempt} retries`)
        }
        
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        logger.warn(`${operation}: Attempt ${attempt + 1} failed: ${lastError.message}`)
        
        // リトライ可能なエラーかチェック
        if (!this.isRetryableError(lastError) || attempt === retries) {
          break
        }
        
        // エクスポネンシャルバックオフ
        const delay = this.retryDelay * Math.pow(2, attempt)
        logger.debug(`${operation}: Waiting ${delay}ms before retry`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    logger.error(`${operation}: All attempts failed`)
    throw lastError || new Error(`${operation} failed`)
  }
  
  // タイムアウト処理
  protected async withTimeout<T>(
    promise: Promise<T>,
    operation: string,
    timeout = this.defaultTimeout
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeout}ms`))
      }, timeout)
    })
    
    return Promise.race([promise, timeoutPromise])
  }
  
  // リトライ可能なエラーかチェック
  protected isRetryableError(error: Error): boolean {
    // ネットワークエラー
    if (error.message.includes('network') || 
        error.message.includes('fetch') ||
        error.message.includes('Failed to fetch')) {
      return true
    }
    
    // タイムアウトエラー
    if (error.message.includes('timeout') || 
        error.message.includes('timed out')) {
      return true
    }
    
    // レート制限エラー
    if (error.message.includes('rate limit') || 
        error.message.includes('429') ||
        error.message.includes('too many requests')) {
      return true
    }
    
    // 一時的なサーバーエラー
    if (error.message.includes('500') || 
        error.message.includes('502') ||
        error.message.includes('503') ||
        error.message.includes('504')) {
      return true
    }
    
    return false
  }
  
  // API呼び出しの進捗報告
  protected reportProgress(operation: string, progress: number, total: number): void {
    const percentage = Math.round((progress / total) * 100)
    logger.debug(`${operation}: Progress ${percentage}% (${progress}/${total})`)
    
    // Chrome拡張のメッセージングAPIを使用して進捗を通知
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'API_PROGRESS',
        payload: {
          operation,
          progress,
          total,
          percentage
        }
      }).catch(() => {
        // エラーは無視（ポップアップが開いていない可能性）
      })
    }
  }
}