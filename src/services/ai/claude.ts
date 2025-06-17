import { BaseAIService } from './base'
import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'

export class ClaudeService extends BaseAIService {
  private baseURL = 'https://api.anthropic.com/v1'

  async generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date }
  ): Promise<Minutes> {
    const enhancedPrompt = await this.createEnhancedPrompt(transcripts, settings, meetingInfo)
    
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

  async generateContent(prompt: string, modelId?: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.content[0]?.text || ''
    } catch (error) {
      console.error('Failed to generate content with Claude:', error)
      throw new Error('コンテンツの生成に失敗しました')
    }
  }

  private async createEnhancedPrompt(transcripts: Transcript[], settings: UserSettings, meetingInfo?: { startTime?: Date; endTime?: Date }): Promise<string> {
    const formattedTranscript = this.formatTranscriptsEnhanced(transcripts, meetingInfo?.startTime, meetingInfo?.endTime)
    const basePrompt = await this.getEnhancedPrompt(settings)
    
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

  async generateNextSteps(
    meeting: Meeting,
    userPrompt?: string
  ): Promise<NextStep[]> {
    const prompt = this.buildNextStepsPrompt(meeting, userPrompt)
    
    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.content[0]?.text || ''
      
      return this.parseNextStepsResponse(content, meeting.id)
    } catch (error) {
      console.error('Failed to generate next steps with Claude:', error)
      throw new Error('ネクストステップの生成に失敗しました')
    }
  }

  async sendChatMessage(
    message: string,
    context: any
  ): Promise<string> {
    try {
      const messages = []
      
      // システムプロンプトを設定
      if (context.systemPrompt) {
        messages.push({
          role: 'assistant',
          content: context.systemPrompt
        })
      }
      
      // コンテキスト情報を追加
      let contextMessage = '【現在の会議情報】\n'
      contextMessage += `タイトル: ${context.meetingInfo.title}\n`
      contextMessage += `参加者: ${context.meetingInfo.participants.join(', ')}\n`
      contextMessage += `発言数: ${context.meetingInfo.transcriptsCount}\n\n`
      
      if (context.minutes) {
        contextMessage += '【現在の議事録】\n' + context.minutes + '\n\n'
      }
      
      if (context.recentTranscripts && context.recentTranscripts.length > 0) {
        contextMessage += '【最近の発言】\n'
        context.recentTranscripts.forEach((t: Transcript) => {
          const time = new Date(t.timestamp).toLocaleTimeString('ja-JP')
          contextMessage += `[${time}] ${t.speaker}: ${t.content}\n`
        })
      }
      
      messages.push({
        role: 'user',
        content: contextMessage + '\n\n' + message
      })
      
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 1000,
          messages
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.content[0]?.text || ''
    } catch (error) {
      console.error('Failed to send chat message with Claude:', error)
      throw new Error('チャットメッセージの送信に失敗しました')
    }
  }

  async generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    try {
      const response = await fetch(`${this.baseURL}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: options?.maxTokens || 2000,
          temperature: options?.temperature,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      })

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.content[0]?.text || ''
    } catch (error) {
      console.error('Failed to generate text with Claude:', error)
      throw new Error('テキストの生成に失敗しました')
    }
  }
}