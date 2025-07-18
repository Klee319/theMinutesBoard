import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'
import { MINUTES_GENERATION_PROMPT, NEXTSTEPS_GENERATION_PROMPT, LIVE_MINUTES_GENERATION_PROMPT, HISTORY_MINUTES_GENERATION_PROMPT } from '@/system-prompts'
import { logger } from '@/utils/logger'
import { TIMING_CONSTANTS, API_CONSTANTS } from '../../constants'
import { AI_SERVICE_CONFIG } from '@/constants/config'
import { requestOptimizer } from './request-optimizer'

export abstract class BaseAIService {
  protected apiKey: string
  protected defaultTimeout = TIMING_CONSTANTS.DEFAULT_TIMEOUT
  protected maxRetries = API_CONSTANTS.MAX_RETRIES
  protected retryDelay = API_CONSTANTS.RETRY_DELAY

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }
  
  protected compressTranscripts(
    transcripts: Transcript[], 
    maxCount: number = 500
  ): Transcript[] {
    if (transcripts.length <= maxCount) return transcripts;
    
    const processedTranscripts = transcripts.slice(-maxCount);
    const omittedCount = transcripts.length - maxCount;
    const dummyTranscript: Transcript = {
      id: 'omitted',
      meetingId: transcripts[0].meetingId,
      speaker: 'System',
      content: `[※ ${omittedCount}件の古い発言が省略されました]`,
      timestamp: processedTranscripts[0].timestamp
    };
    
    return [dummyTranscript, ...processedTranscripts];
  }
  
  // トークン数を概算（日本語は1文字約0.5トークン、英語は1単語約1トークン）
  protected estimateTokens(text: string): number {
    const japaneseChars = (text.match(/[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]/g) || []).length
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
    return Math.ceil(japaneseChars * 0.5 + englishWords)
  }

  // キャッシュ付きの議事録生成
  async generateMinutesWithCache(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date },
    promptType?: 'live' | 'history' | 'default'
  ): Promise<Minutes> {
    // キャッシュキーの生成（トランスクリプトの最初と最後のIDを使用）
    const cacheKey = requestOptimizer.generateCacheKey('generateMinutes', {
      firstId: transcripts[0]?.id,
      lastId: transcripts[transcripts.length - 1]?.id,
      count: transcripts.length,
      promptType,
      provider: settings.aiProvider
    })
    
    // キャッシュチェック
    const cached = requestOptimizer.getCachedResponse<Minutes>(cacheKey)
    if (cached) {
      logger.info('Using cached minutes generation result')
      return cached
    }
    
    // リトライ付きで実行
    const result = await requestOptimizer.withRetry(
      () => this.generateMinutes(transcripts, settings, meetingInfo, promptType),
      this.maxRetries,
      this.retryDelay
    )
    
    // 結果をキャッシュ
    requestOptimizer.setCachedResponse(cacheKey, result)
    
    return result
  }

  abstract generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date },
    promptType?: 'live' | 'history' | 'default'
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
    userPrompt?: string,
    userName?: string
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
    // デバッグログ: 入力トランスクリプトの情報
    logger.debug(`formatTranscriptsEnhanced: Processing ${transcripts.length} transcripts`)
    
    // フォーマット前にサイズを確認
    if (transcripts.length > AI_SERVICE_CONFIG.MAX_TRANSCRIPTS_FOR_PROMPT) {
      logger.warn(`formatTranscriptsEnhanced: Large number of transcripts (${transcripts.length})`);
    }
    
    // デバッグログ: 最初と最後のトランスクリプトの内容を確認
    if (transcripts.length > 0) {
      logger.debug(`formatTranscriptsEnhanced: First transcript - Speaker: ${transcripts[0].speaker}, Content: ${transcripts[0].content.substring(0, 50)}...`)
      logger.debug(`formatTranscriptsEnhanced: Last transcript - Speaker: ${transcripts[transcripts.length - 1].speaker}, Content: ${transcripts[transcripts.length - 1].content.substring(0, 50)}...`)
    }
    
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
          currentTime - prevTime < AI_SERVICE_CONFIG.SAME_SPEAKER_MERGE_TIME) {
        // 同一話者の発言統合時間内の発言は統合
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
    
    // デバッグログ: 統合処理の結果
    logger.debug(`formatTranscriptsEnhanced: Consolidated ${sortedTranscripts.length} transcripts into ${consolidatedTranscripts.length} entries`)
    
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
    
    const result = header + transcriptText
    
    // 結果のサイズを確認
    if (result.length > AI_SERVICE_CONFIG.MAX_PROMPT_SIZE) {
      logger.warn(`formatTranscriptsEnhanced: Very large formatted output (${(result.length / 1024).toFixed(1)}KB)`);
    }
    
    return result
  }

  protected getSystemPrompt(type: 'live' | 'history' | 'default' = 'default'): string {
    switch (type) {
      case 'live':
        return LIVE_MINUTES_GENERATION_PROMPT
      case 'history':
        return HISTORY_MINUTES_GENERATION_PROMPT
      default:
        return MINUTES_GENERATION_PROMPT
    }
  }

  // ユーザー設定のプロンプトを取得
  protected async getEnhancedPrompt(
    settings?: UserSettings,
    transcripts?: Transcript[],
    meetingInfo?: { startTime?: Date; endTime?: Date },
    promptType: 'live' | 'history' | 'default' = 'default'
  ): Promise<string> {
    // システムプロンプトを必ず含める
    let combinedPrompt = this.getSystemPrompt(promptType)
    
    // デバッグログ: システムプロンプトの内容
    logger.debug(`getEnhancedPrompt: System prompt loaded (${combinedPrompt.length} chars)`)
    logger.debug(`getEnhancedPrompt: System prompt preview: ${combinedPrompt.substring(0, 200)}...`)
    
    // プロンプトの最大サイズを制限（約200KB - より安全なマージン）
    const MAX_PROMPT_SIZE = AI_SERVICE_CONFIG.MAX_PROMPT_SIZE
    
    // 会議時間の計算
    let duration = 0
    if (promptType === 'history' && meetingInfo?.startTime && meetingInfo?.endTime) {
      // 履歴用議事録の場合は、正確な開始時刻と終了時刻から計算
      const start = meetingInfo.startTime instanceof Date ? meetingInfo.startTime : new Date(meetingInfo.startTime)
      const end = meetingInfo.endTime instanceof Date ? meetingInfo.endTime : new Date(meetingInfo.endTime)
      duration = Math.floor((end.getTime() - start.getTime()) / 1000) // 秒単位
    } else if (meetingInfo?.startTime && !meetingInfo?.endTime) {
      // endTimeがない場合は現在時刻までの経過時間
      const start = meetingInfo.startTime instanceof Date ? meetingInfo.startTime : new Date(meetingInfo.startTime)
      const now = new Date()
      duration = Math.floor((now.getTime() - start.getTime()) / 1000)
    } else {
      // その他の場合は、transcriptsから推定
      duration = transcripts ? this.calculateDuration(transcripts) : 0
    }
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    const durationText = `${hours > 0 ? `${hours}時間` : ''}${minutes}分`
    
    // 参加者リストの作成
    const participants = transcripts ? this.getUniqueParticipants(transcripts) : []
    
    // テンプレート変数を準備（両プロンプト共通）
    const formattedTranscripts = transcripts ? this.formatTranscriptsEnhanced(transcripts, meetingInfo?.startTime, meetingInfo?.endTime) : ''
    
    // デバッグログ: フォーマット済みトランスクリプトの情報
    logger.debug(`getEnhancedPrompt: Formatted transcripts length: ${formattedTranscripts.length} chars`)
    if (transcripts) {
      logger.debug(`getEnhancedPrompt: Original transcripts count: ${transcripts.length}`)
    }
    
    // 安全なDate処理のためのヘルパー関数
    const safeGetDate = (date?: Date | string | number): Date => {
      try {
        if (!date) return new Date()
        const result = date instanceof Date ? date : new Date(date)
        return isNaN(result.getTime()) ? new Date() : result
      } catch {
        return new Date()
      }
    }
    
    const safeFormatLocaleString = (date?: Date | string | number): string => {
      try {
        const safeDate = safeGetDate(date)
        return safeDate.toLocaleString('ja-JP')
      } catch {
        return new Date().toLocaleString('ja-JP')
      }
    }
    
    const safeFormatLocaleDateString = (date?: Date | string | number): string => {
      try {
        const safeDate = safeGetDate(date)
        return safeDate.toLocaleDateString('ja-JP', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit' 
        })
      } catch {
        return new Date().toLocaleDateString('ja-JP', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit' 
        })
      }
    }
    
    const templateVariables: Record<string, any> = {
      userName: settings?.userName || '不明な参加者',
      meetingDate: safeFormatLocaleDateString(meetingInfo?.startTime),
      startTime: safeFormatLocaleString(meetingInfo?.startTime),
      endTime: meetingInfo?.endTime ? safeFormatLocaleString(meetingInfo.endTime) : '',
      participants: participants.join(', '),
      duration: durationText,
      transcripts: formattedTranscripts,
      speakerMap: transcripts ? this.buildSpeakerMap(transcripts) : {},
      currentTime: safeFormatLocaleString(),
      meetingTitle: safeFormatLocaleDateString(meetingInfo?.startTime) + ' の会議',
    }
    
    // デバッグ: startTimeとendTimeの値を確認
    logger.debug(`Template variables - startTime: ${templateVariables.startTime}, endTime: ${templateVariables.endTime}`)
    logger.debug(`MeetingInfo - startTime: ${meetingInfo?.startTime}, endTime: ${meetingInfo?.endTime}`)
    
    // デバッグログ: テンプレート変数の内容（transcriptsフィールドは長さのみ）
    const debugVariables = { ...templateVariables }
    debugVariables.transcripts = `[${formattedTranscripts.length} chars]`
    logger.debug('getEnhancedPrompt: Template variables:', debugVariables)
    
    // テンプレート変数を置換
    const beforeReplaceLength = combinedPrompt.length
    combinedPrompt = this.replaceTemplateVariables(combinedPrompt, templateVariables)
    
    // デバッグログ: 置換処理後の結果
    logger.debug(`getEnhancedPrompt: After template replacement - length changed from ${beforeReplaceLength} to ${combinedPrompt.length} chars`)
    logger.debug(`getEnhancedPrompt: Combined prompt preview after replacement: ${combinedPrompt.substring(0, 300)}...`)
    
    // プロンプトサイズを制限
    if (combinedPrompt.length > MAX_PROMPT_SIZE) {
      logger.warn(`Prompt too large (${(combinedPrompt.length / 1024).toFixed(1)}KB), truncating...`)
      // 末尾をカットして省略マーカーを追加
      combinedPrompt = combinedPrompt.substring(0, MAX_PROMPT_SIZE - 100) + '\n\n[... 以下省略されました ...]'
    }
    
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
  protected buildNextStepsPrompt(meeting: Meeting, userPrompt?: string, userName?: string): string {
    let prompt = NEXTSTEPS_GENERATION_PROMPT

    const duration = meeting.duration || this.calculateDuration(meeting.transcripts)
    const hours = Math.floor(duration / 3600)
    const minutes = Math.floor((duration % 3600) / 60)
    const durationText = `${hours > 0 ? `${hours}時間` : ''}${minutes}分`
    
    // デバッグ: meetingDateの値を確認
    logger.debug(`buildNextStepsPrompt: meeting.startTime = ${meeting.startTime}`)
    logger.debug(`buildNextStepsPrompt: meeting.startTime type = ${typeof meeting.startTime}`)
    logger.debug(`buildNextStepsPrompt: meeting.startTime instanceof Date = ${meeting.startTime instanceof Date}`)
    
    // startTimeを安全にDate型に変換
    let meetingStartTime: Date
    try {
      if (meeting.startTime instanceof Date) {
        meetingStartTime = meeting.startTime
      } else {
        meetingStartTime = new Date(meeting.startTime)
      }
      
      // Invalid Date check
      if (isNaN(meetingStartTime.getTime())) {
        logger.warn('Invalid meeting startTime, using current date')
        meetingStartTime = new Date()
      }
    } catch (error) {
      logger.warn('Error parsing meeting startTime, using current date:', error)
      meetingStartTime = new Date()
    }
    
    // 安全な日付フォーマットのためのヘルパー関数（現在未使用だが将来のために残す）
    // const safeFormatDate = (date: Date, options: Intl.DateTimeFormatOptions): string => {
    //   try {
    //     if (isNaN(date.getTime())) {
    //       logger.warn('Invalid date provided to safeFormatDate, using current date')
    //       return new Date().toLocaleDateString('ja-JP', options)
    //     }
    //     return date.toLocaleDateString('ja-JP', options)
    //   } catch (error) {
    //     logger.error('Error formatting date:', error)
    //     return new Date().toLocaleDateString('ja-JP', options)
    //   }
    // }
    
    const safeFormatDateTime = (date: Date): string => {
      try {
        if (isNaN(date.getTime())) {
          logger.warn('Invalid date provided to safeFormatDateTime, using current date')
          return new Date().toLocaleString('ja-JP')
        }
        return date.toLocaleString('ja-JP')
      } catch (error) {
        logger.error('Error formatting datetime:', error)
        return new Date().toLocaleString('ja-JP')
      }
    }
    
    // テンプレート変数を準備（議事録生成と同じセット）
    const templateVariables: Record<string, any> = {
      userName: userName || '不明な参加者',
      meetingDate: meetingStartTime.toISOString().split('T')[0], // YYYY-MM-DD形式
      startTime: safeFormatDateTime(meetingStartTime),
      participants: meeting.participants.join(', '),
      duration: durationText,
      transcripts: this.formatTranscriptsForNextSteps(meeting.transcripts),
      speakerMap: this.buildSpeakerMap(meeting.transcripts),
      currentTime: safeFormatDateTime(new Date()),
    }
    
    // デバッグ: meetingDateの値を確認
    logger.debug(`buildNextStepsPrompt: meetingDate = ${templateVariables.meetingDate}, startTime = ${templateVariables.startTime}`)
    
    // テンプレート変数を置換
    prompt = this.replaceTemplateVariables(prompt, templateVariables)
    
    // デバッグ: 置換後のプロンプトに含まれるmeetingDateを確認
    const meetingDateMatch = prompt.match(/MEETING_DATE[^\n]*: ([^\n]+)/)
    if (meetingDateMatch) {
      logger.debug(`buildNextStepsPrompt: MEETING_DATE in prompt = ${meetingDateMatch[1]}`)
    } else {
      logger.warn('buildNextStepsPrompt: MEETING_DATE not found in prompt')
    }

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
        logger.warn('Initial JSON parse failed, attempting to fix:', firstError)
        
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
      return []
    }
  }

  private processNextStepsData(parsed: any, meetingId: string): NextStep[] {
    if (!parsed.nextSteps || !Array.isArray(parsed.nextSteps)) {
      throw new Error('Invalid response format')
    }

    return parsed.nextSteps.map((item: any) => {
        let dueDate: Date | undefined

        // デバッグ: AIが返したdueDateをログ出力
        logger.debug(`parseNextStepsResponse: item.dueDate = ${item.dueDate}, task = ${item.task}`)

        // 期限の設定ロジック
        if (item.dueDate && item.dueDate !== 'null' && item.dueDate !== '未定') {
          try {
            // より安全な日付パース処理
            let dateValue: Date
            
            if (typeof item.dueDate === 'string') {
              // 文字列の場合、様々な形式に対応
              if (item.dueDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
                // YYYY-MM-DD形式の場合、タイムゾーンの問題を避けるため時刻を指定
                dateValue = new Date(item.dueDate + 'T00:00:00.000Z')
              } else {
                dateValue = new Date(item.dueDate)
              }
            } else {
              // 文字列以外の場合は直接Dateコンストラクタに渡す
              dateValue = new Date(item.dueDate)
            }
            
            // Invalid Date チェック
            if (isNaN(dateValue.getTime())) {
              logger.warn(`parseNextStepsResponse: Invalid date ${item.dueDate} for task ${item.task}, using default`)
              dueDate = this.getDefaultDueDate(item.priority)
            } else {
              logger.debug(`parseNextStepsResponse: Parsed date ${dateValue.toISOString()} for task ${item.task}`)
              dueDate = dateValue
            }
          } catch (error) {
            logger.warn(`parseNextStepsResponse: Failed to parse date ${item.dueDate} for task ${item.task}, error:`, error)
            dueDate = this.getDefaultDueDate(item.priority)
          }
        } else {
          // AIが期限を設定しなかった場合のフォールバック
          logger.debug(`parseNextStepsResponse: No dueDate provided for task ${item.task}, using default`)
          dueDate = this.getDefaultDueDate(item.priority)
        }

        // createdAtとupdatedAtの安全な生成
        let createdAt: Date
        let updatedAt: Date
        try {
          createdAt = new Date()
          updatedAt = new Date()
          
          // Invalid Date チェック
          if (isNaN(createdAt.getTime()) || isNaN(updatedAt.getTime())) {
            throw new Error('Failed to create valid timestamps')
          }
        } catch (error) {
          logger.error('Failed to create timestamps, using epoch:', error)
          createdAt = new Date(0)
          updatedAt = new Date(0)
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
        createdAt,
        updatedAt,
        source: item.source || 'user' // デフォルトはユーザー指示
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
    
    // デバッグログ: 置換前のテンプレート内の変数を検出
    const variableMatches = template.match(/\{\{[^}]+\}\}/g) || []
    logger.debug(`replaceTemplateVariables: Found ${variableMatches.length} template variables to replace`)
    logger.debug(`replaceTemplateVariables: Template variables found: ${variableMatches.join(', ')}`)
    
    // 各変数を置換
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g')
      const matches = result.match(regex) || []
      
      // 値の型に応じて適切に変換
      let replacementValue: string
      if (value instanceof Date) {
        // 日付の場合はISO形式（YYYY-MM-DD）に変換
        try {
          if (isNaN(value.getTime())) {
            logger.warn(`replaceTemplateVariables: Invalid Date for ${key}, using current date`)
            replacementValue = new Date().toISOString().split('T')[0]
          } else {
            replacementValue = value.toISOString().split('T')[0]
          }
          logger.debug(`replaceTemplateVariables: Converting Date ${key} = ${value} -> ${replacementValue}`)
        } catch (error) {
          logger.error(`replaceTemplateVariables: Error converting Date for ${key}:`, error)
          replacementValue = new Date().toISOString().split('T')[0]
        }
      } else if (typeof value === 'object' && value !== null) {
        // Dateオブジェクトかもしれないが、instanceof Dateでは検出されない場合の対策
        if (value.toString && value.toString().includes('GMT')) {
          // Date-likeオブジェクトの場合
          try {
            const dateValue = new Date(value)
            if (!isNaN(dateValue.getTime())) {
              replacementValue = dateValue.toISOString().split('T')[0]
              logger.debug(`replaceTemplateVariables: Converting Date-like object ${key} = ${value} -> ${replacementValue}`)
            } else {
              // オブジェクトの場合はJSON文字列に変換
              replacementValue = JSON.stringify(value, null, 2)
            }
          } catch (error) {
            logger.error(`replaceTemplateVariables: Error converting Date-like object for ${key}:`, error)
            replacementValue = JSON.stringify(value, null, 2)
          }
        } else {
          // オブジェクトの場合はJSON文字列に変換
          replacementValue = JSON.stringify(value, null, 2)
        }
      } else if (value === undefined || value === null) {
        replacementValue = ''
      } else {
        replacementValue = String(value)
      }
      
      if (matches.length > 0) {
        // デバッグログ: 実際に置換される変数
        const previewValue = key === 'transcripts' 
          ? `[${replacementValue.length} chars]` 
          : replacementValue.length > 100 
            ? replacementValue.substring(0, 100) + '...' 
            : replacementValue
        logger.debug(`replaceTemplateVariables: Replacing ${matches.length} occurrences of {{${key}}} with: ${previewValue}`)
      }
      
      result = result.replace(regex, replacementValue)
    })
    
    // デバッグログ: 置換後に残っている変数をチェック
    const remainingVariables = result.match(/\{\{[^}]+\}\}/g) || []
    if (remainingVariables.length > 0) {
      logger.warn(`replaceTemplateVariables: ${remainingVariables.length} template variables remain unreplaced: ${remainingVariables.join(', ')}`)
    }
    
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