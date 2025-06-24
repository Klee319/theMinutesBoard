import { BaseAIService } from './base'
import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'

export class OpenRouterService extends BaseAIService {
  private baseURL = 'https://openrouter.ai/api/v1'

  async generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date }
  ): Promise<Minutes> {
    const enhancedPrompt = await this.createEnhancedPrompt(transcripts, settings, meetingInfo)
    
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://localhost:3000/',
          'X-Title': 'theMinutesBoard'
        },
        body: JSON.stringify({
          model: settings.selectedModel || 'anthropic/claude-3.5-sonnet',
          messages: [
            {
              role: 'user',
              content: enhancedPrompt
            }
          ],
          max_tokens: 4000,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        const errorData = await response.text()
        console.error('OpenRouter API error details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        })
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorData}`)
      }

      const data = await response.json()
      const content = data.choices[0]?.message?.content || ''
      
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
      console.error('Failed to generate minutes with OpenRouter:', error)
      throw new Error('議事録の生成に失敗しました')
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/auth/key`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      })
      return response.ok
    } catch (error) {
      return false
    }
  }

  async checkRateLimit(): Promise<{ remaining: number; reset: Date; limit: number }> {
    try {
      const response = await fetch(`${this.baseURL}/auth/key`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        return {
          remaining: data.usage?.requests_remaining || 1000,
          reset: new Date(Date.now() + 60000),
          limit: data.usage?.requests_limit || 1000
        }
      }
    } catch (error) {
      console.error('Failed to check OpenRouter rate limit:', error)
    }
    
    return {
      remaining: 1000,
      reset: new Date(Date.now() + 60000),
      limit: 1000
    }
  }

  async generateContent(prompt: string, modelId?: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://localhost:3000/',
          'X-Title': 'theMinutesBoard'
        },
        body: JSON.stringify({
          model: modelId || 'anthropic/claude-3.5-haiku',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        const errorData = await response.text()
        console.error('OpenRouter API error details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        })
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorData}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      console.error('Failed to generate content with OpenRouter:', error)
      throw new Error('コンテンツの生成に失敗しました')
    }
  }

  private async createEnhancedPrompt(transcripts: Transcript[], settings: UserSettings, meetingInfo?: { startTime?: Date; endTime?: Date }): Promise<string> {
    const formattedTranscript = this.formatTranscriptsEnhanced(transcripts, meetingInfo?.startTime, meetingInfo?.endTime)
    const basePrompt = await this.getEnhancedPrompt(settings, transcripts, meetingInfo)
    
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
    userPrompt?: string,
    userName?: string
  ): Promise<NextStep[]> {
    const prompt = this.buildNextStepsPrompt(meeting, userPrompt, userName)
    
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://theminutesboard.com',
          'X-Title': 'theMinutesBoard'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3.5-haiku',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.choices[0]?.message?.content || ''
      
      return this.parseNextStepsResponse(content, meeting.id)
    } catch (error) {
      console.error('Failed to generate next steps with OpenRouter:', error)
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
          role: 'system',
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
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://theminutesboard.com',
          'X-Title': 'theMinutesBoard'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages,
          max_tokens: 1000,
          temperature: 0.7
        })
      })

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      console.error('Failed to send chat message with OpenRouter:', error)
      throw new Error('チャットメッセージの送信に失敗しました')
    }
  }

  async generateText(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://theminutesboard.com',
          'X-Title': 'theMinutesBoard'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3.5-haiku',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: options?.maxTokens || 2000,
          temperature: options?.temperature ?? 0.7
        })
      })

      if (!response.ok) {
        const errorData = await response.text()
        console.error('OpenRouter API error details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        })
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorData}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      console.error('Failed to generate text with OpenRouter:', error)
      throw new Error('テキストの生成に失敗しました')
    }
  }
}