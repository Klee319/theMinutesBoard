import { BaseAIService } from './base'
import { Transcript, Minutes, UserSettings } from '@/types'

export class ClaudeService extends BaseAIService {
  private baseURL = 'https://api.anthropic.com/v1'

  async generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings
  ): Promise<Minutes> {
    const enhancedPrompt = this.createEnhancedPrompt(transcripts, settings)
    
    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: settings.selectedModel || 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: enhancedPrompt
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.content[0]?.text || ''
      
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
      console.error('Failed to generate minutes with Claude:', error)
      throw new Error('議事録の生成に失敗しました')
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 10,
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ]
        })
      })
      return response.ok
    } catch (error) {
      return false
    }
  }

  async checkRateLimit(): Promise<{ remaining: number; reset: Date; limit: number }> {
    return {
      remaining: 100,
      reset: new Date(Date.now() + 60000),
      limit: 100
    }
  }

  private createEnhancedPrompt(transcripts: Transcript[], settings: UserSettings): string {
    const formattedTranscript = this.formatTranscriptsEnhanced(transcripts)
    const basePrompt = settings.promptTemplate || this.getDefaultPrompt()
    
    return `${basePrompt}

**会議の詳細情報:**
- 参加者: ${this.getUniqueParticipants(transcripts).join(', ')}
- 発言数: ${transcripts.length}件
- 会議時間: ${Math.floor(this.calculateDuration(transcripts) / 60)}分

**会議の文字起こし:**
${formattedTranscript}

**出力フォーマット指示:**
- 必ずMarkdown形式で出力してください
- 話者名は正確に記録してください
- 重要な決定事項は**太字**で強調してください
- アクションアイテムがある場合は明確にリストアップしてください`
  }
}