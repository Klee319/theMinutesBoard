import { GoogleGenerativeAI } from '@google/generative-ai'
import { Transcript, Minutes, UserSettings } from '@/types'
import { BaseAIService } from '../ai/base'

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
    meetingInfo?: { startTime?: Date; endTime?: Date }
  ): Promise<Minutes> {
    const modelId = settings.selectedModel || 'gemini-1.5-flash'
    
    if (!this.model && settings.apiKey) {
      this.initialize(settings.apiKey, modelId)
    }
    
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }
    
    // プロンプトファイルを優先的に使用した改善されたプロンプト
    const enhancedPrompt = await this.createEnhancedPrompt(transcripts, settings, meetingInfo)
    
    try {
      const result = await this.model.generateContent(enhancedPrompt)
      const response = await result.response
      const content = response.text()
      
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
    } catch (error) {
      console.error('Failed to generate minutes:', error)
      throw new Error('議事録の生成に失敗しました')
    }
  }
  
  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const tempAI = new GoogleGenerativeAI(apiKey)
      const tempModel = tempAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const result = await tempModel.generateContent('Hello')
      await result.response
      return true
    } catch (error) {
      return false
    }
  }
  
  async checkRateLimit(): Promise<{ 
    remaining: number
    reset: Date
    limit: number 
  }> {
    return {
      remaining: 15,
      reset: new Date(Date.now() + 60000),
      limit: 15
    }
  }

  async generateContent(prompt: string, modelId?: string): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini API key not configured')
    }

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      return response.text()
    } catch (error) {
      console.error('Failed to generate content:', error)
      throw new Error('コンテンツの生成に失敗しました')
    }
  }
  
  private formatTranscripts(transcripts: Transcript[]): string {
    return transcripts
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.speaker}: ${t.content}`)
      .join('\n')
  }

  private async createEnhancedPrompt(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date }
  ): Promise<string> {
    const analysis = this.analyzeTranscriptQuality(transcripts)
    const formattedTranscript = super.formatTranscriptsEnhanced(
      transcripts, 
      meetingInfo?.startTime, 
      meetingInfo?.endTime
    )
    
    // プロンプトファイルを優先的に使用（設定のプロンプトテンプレートより優先）
    const basePrompt = await this.getEnhancedPrompt(settings)
    
    return `${basePrompt}

**会議の詳細情報:**
- 参加者: ${this.getUniqueParticipants(transcripts).join(', ')}
- 発言数: ${transcripts.length}件
- 文字起こし品質: ${analysis.quality}

**注意事項:**
${analysis.issues.length > 0 ? analysis.issues.map(issue => `- ${issue}`).join('\n') : '- 特に問題なし'}

**会議の文字起こし:**
${formattedTranscript}

**出力フォーマット指示:**
- 必ずMarkdown形式で出力してください
- 話者名は正確に記録してください
- 重要な決定事項は**太字**で強調してください
- アクションアイテムがある場合は明確にリストアップしてください`
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

}

export const geminiService = new GeminiService()