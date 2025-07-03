import { GoogleGenerativeAI } from '@google/generative-ai'
import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'
import { BaseAIService } from '../ai/base'
import { TRANSCRIPT_CONSTANTS, STORAGE_CONSTANTS, API_CONSTANTS } from '../../constants'

export class GeminiService extends BaseAIService {
  private genAI: GoogleGenerativeAI | null = null
  private model: any = null
  
  constructor(apiKey: string = '') {
    super(apiKey)
    if (apiKey) {
      this.initialize(apiKey)
    }
  }
  
  initialize(apiKey: string, modelId: string = 'gemini-1.5-flash') {
    this.apiKey = apiKey
    this.genAI = new GoogleGenerativeAI(apiKey)
    this.model = this.genAI.getGenerativeModel({ 
      model: modelId 
    })
  }
  
  async generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date },
    promptType: 'live' | 'history' | 'default' = 'default'
  ): Promise<Minutes> {
    const modelId = settings.selectedModel || 'gemini-1.5-flash'
    
    if (!this.model && settings.apiKey) {
      this.initialize(settings.apiKey, modelId)
    }
    
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }
    
    // 字幕が多すぎる場合は圧縮する
    const processedTranscripts = this.compressTranscripts(transcripts, TRANSCRIPT_CONSTANTS.MAX_TRANSCRIPTS_FOR_MINUTES)
    
    // プロンプトファイルを優先的に使用した改善されたプロンプト
    const enhancedPrompt = await this.getEnhancedPrompt(settings, processedTranscripts, meetingInfo, promptType)
    
    // リトライとタイムアウト付きで実行
    return await this.callWithRetry(async () => {
      this.reportProgress('generateMinutes', 0, 100)
      
      const result = await this.model.generateContent(enhancedPrompt)
      this.reportProgress('generateMinutes', 50, 100)
      
      const response = await result.response
      const content = response.text()
      this.reportProgress('generateMinutes', 100, 100)
      
      const minutes: Minutes = {
        id: `minutes_${Date.now()}`,
        meetingId: transcripts[0]?.meetingId || '',
        content,
        generatedAt: new Date(),
        format: 'markdown',
        metadata: {
          totalDuration: this.calculateDuration(transcripts),
          participantCount: this.getUniqueParticipants(transcripts).length,
          wordCount: content.split(/\s+/).length
        }
      }
      
      return minutes
    }, 'generateMinutes')
  }
  
  async validateApiKey(apiKey: string): Promise<boolean> {
    return await this.callWithRetry(async () => {
      const tempAI = new GoogleGenerativeAI(apiKey)
      const tempModel = tempAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const result = await tempModel.generateContent('Hello')
      await result.response
      return true
    }, 'validateApiKey', 1).catch(() => false)
  }
  
  async checkRateLimit(): Promise<{ 
    remaining: number
    reset: Date
    limit: number 
  }> {
    return {
      remaining: 15,
      reset: new Date(Date.now() + STORAGE_CONSTANTS.CLEANUP_INTERVAL),
      limit: 15
    }
  }

  async generateContent(prompt: string, modelId?: string): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }

    return await this.callWithRetry(async () => {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text()
    }, 'generateContent')
  }
  

  private analyzeTranscriptQuality(transcripts: Transcript[]): {
    quality: string
    issues: string[]
  } {
    const issues: string[] = []
    let quality = '良好'
    
    // Unknown話者の割合を計算
    const unknownCount = transcripts.filter(t => t.speaker === 'Unknown').length
    const unknownRatio = unknownCount / transcripts.length
    
    if (unknownRatio > 0.5) {
      quality = '低'
      issues.push('話者の特定が困難（50%以上が不明）')
    } else if (unknownRatio > 0.2) {
      quality = '普通'
      issues.push('話者の特定が一部困難（20%以上が不明）')
    }
    
    // 短すぎる発言の検出
    const shortTranscripts = transcripts.filter(t => t.content.length < 10)
    if (shortTranscripts.length > transcripts.length * 0.3) {
      issues.push('短い発言が多く含まれています（文字起こしの断片化の可能性）')
    }
    
    // 重複発言の検出
    const duplicates = transcripts.filter((t, i) => 
      transcripts.findIndex(other => other.content === t.content) !== i
    )
    if (duplicates.length > 0) {
      issues.push('重複した発言が検出されました')
    }
    
    // 連続する同一話者の発言数
    let consecutiveCount = 0
    let maxConsecutive = 0
    let lastSpeaker = ''
    
    transcripts.forEach(t => {
      if (t.speaker === lastSpeaker) {
        consecutiveCount++
        maxConsecutive = Math.max(maxConsecutive, consecutiveCount)
      } else {
        consecutiveCount = 1
        lastSpeaker = t.speaker
      }
    })
    
    if (maxConsecutive > 10) {
      issues.push('同一話者の連続発言が多く検出されました（発言の統合が推奨）')
    }
    
    return { quality, issues }
  }

  // この関数は削除（base.tsのformatTranscriptsEnhancedを使用）

  async generateNextSteps(meeting: Meeting, userPrompt?: string, userName?: string): Promise<NextStep[]> {
    if (!this.model && this.apiKey) {
      this.initialize(this.apiKey)
    }
    
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }

    const prompt = this.buildNextStepsPrompt(meeting, userPrompt, userName)
    
    return await this.callWithRetry(async () => {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const content = response.text()
      
      return this.parseNextStepsResponse(content, meeting.id)
    }, 'generateNextSteps')
  }

  async sendChatMessage(message: string, context: any): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }

    // チャットコンテキストを構築
    let chatPrompt = context.systemPrompt || 'あなたは議事録作成AIアシスタントです。'
    
    if (context.meetingInfo) {
      chatPrompt += `\n\n【会議情報】\n`
      chatPrompt += `- タイトル: ${context.meetingInfo.title}\n`
      chatPrompt += `- 参加者: ${context.meetingInfo.participants?.join(', ') || '不明'}\n`
      chatPrompt += `- 発言数: ${context.meetingInfo.transcriptsCount || 0}件\n`
    }

    if (context.minutes) {
      chatPrompt += `\n\n【議事録】\n${context.minutes}`
    }

    if (context.recentTranscripts && context.recentTranscripts.length > 0) {
      chatPrompt += `\n\n【最近の発言】\n`
      chatPrompt += context.recentTranscripts.map((t: any) => 
        `${t.speaker}: ${t.content}`
      ).join('\n')
    }

    chatPrompt += `\n\n【ユーザーの質問/要求】\n${message}`

    return await this.callWithRetry(async () => {
      const result = await this.model.generateContent(chatPrompt)
      const response = await result.response
      return response.text()
    }, 'sendChatMessage')
  }

  async generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }

    return await this.callWithRetry(async () => {
      // Gemini 1.5では generation configでパラメータを設定
      const genConfig: any = {}
      
      if (options?.maxTokens) {
        genConfig.maxOutputTokens = options.maxTokens
      }
      
      if (options?.temperature !== undefined) {
        genConfig.temperature = options.temperature
      }

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: genConfig
      })
      
      const response = await result.response
      return response.text()
    }, 'generateText')
  }
}

export const geminiService = new GeminiService()