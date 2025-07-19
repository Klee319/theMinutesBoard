import { BaseAIService } from './base'
import { Transcript, Minutes, UserSettings, Meeting, NextStep } from '@/types'
import { MODEL_LIMITS, DEFAULT_MODEL_LIMIT } from '../../constants/ai-models'
import { API_CONSTANTS, TEMPERATURE_SETTINGS, STORAGE_CONSTANTS } from '../../constants'

export class OpenRouterService extends BaseAIService {
  private baseURL = 'https://openrouter.ai/api/v1'
  
  // 古いモデル名から新しいモデル名へのマッピング
  private modelMapping: Record<string, string> = {
    'google/gemini-2.5-flash-preview': 'google/gemini-2.5-flash',
    'google/gemini-2.5-flash-preview:thinking': 'google/gemini-2.5-flash:thinking'
  }
  
  // モデル名を正規化する関数
  private normalizeModelName(modelName: string): string {
    return this.modelMapping[modelName] || modelName
  }

  async generateMinutes(
    transcripts: Transcript[], 
    settings: UserSettings,
    meetingInfo?: { startTime?: Date; endTime?: Date },
    promptType: 'live' | 'history' | 'default' = 'default'
  ): Promise<Minutes> {
    // 字幕の量を動的に調整
    let processedTranscripts = transcripts
    
    // プロンプトテンプレートのトークン数を概算（約5000トークン）
    const basePromptTokens = 5000
    
    // 出力用のトークンを確保（4000トークン）
    const outputTokens = 4000
    
    const rawSelectedModel = settings.selectedModel || 'anthropic/claude-3.5-sonnet'
    const selectedModel = this.normalizeModelName(rawSelectedModel)
    
    // モデル名が変換された場合はログを出力
    if (rawSelectedModel !== selectedModel) {
      console.log(`OpenRouter: Model name normalized from '${rawSelectedModel}' to '${selectedModel}'`)
    }
    const maxContextTokens = MODEL_LIMITS[selectedModel as keyof typeof MODEL_LIMITS] || DEFAULT_MODEL_LIMIT
    
    // 安全なマージンを含めた利用可能トークン数
    const availableTokensForTranscripts = Math.floor((maxContextTokens - basePromptTokens - outputTokens) * 0.8)
    
    // 現在のトランスクリプトのトークン数を計算
    let totalTokens = 0
    let includedTranscripts: Transcript[] = []
    
    // 最新の発言から順に追加
    for (let i = transcripts.length - 1; i >= 0; i--) {
      const transcript = transcripts[i]
      const transcriptTokens = this.estimateTokens(`${transcript.speaker}: ${transcript.content}`)
      
      if (totalTokens + transcriptTokens > availableTokensForTranscripts) {
        break
      }
      
      includedTranscripts.unshift(transcript)
      totalTokens += transcriptTokens
    }
    
    // 省略された発言がある場合
    if (includedTranscripts.length < transcripts.length) {
      const omittedCount = transcripts.length - includedTranscripts.length
      console.warn(`Too many transcripts for model ${selectedModel} (${transcripts.length} total, ${includedTranscripts.length} included, estimated ${totalTokens} tokens)`)
      
      const dummyTranscript: Transcript = {
        id: 'omitted',
        meetingId: transcripts[0].meetingId,
        speaker: 'System',
        content: `[※ ${omittedCount}件の古い発言が省略されました]`,
        timestamp: includedTranscripts[0].timestamp
      }
      processedTranscripts = [dummyTranscript, ...includedTranscripts]
    } else {
      processedTranscripts = includedTranscripts
    }
    
    const enhancedPrompt = await this.getEnhancedPrompt(settings, processedTranscripts, meetingInfo, promptType)
    
    try {
      // リクエストボディを事前に作成してサイズを確認
      const requestBody = {
        model: selectedModel,
        messages: [
          {
            role: 'user',
            content: enhancedPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.7
      }
      
      const requestBodyStr = JSON.stringify(requestBody)
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://theminutesboard.com/',
          'X-Title': 'theMinutesBoard'
        },
        body: requestBodyStr
      })

      if (!response.ok) {
        const errorData = await response.text()
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
          reset: new Date(Date.now() + STORAGE_CONSTANTS.CLEANUP_INTERVAL),
          limit: data.usage?.requests_limit || 1000
        }
      }
    } catch (error) {
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
          'HTTP-Referer': 'https://theminutesboard.com/',
          'X-Title': 'theMinutesBoard'
        },
        body: JSON.stringify({
          model: this.normalizeModelName(modelId || 'anthropic/claude-3.5-haiku'),
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: API_CONSTANTS.MAX_TOKENS.CONTENT_GENERATION,
          temperature: TEMPERATURE_SETTINGS.CREATIVE
        })
      })

      if (!response.ok) {
        const errorData = await response.text()
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorData}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      throw new Error('コンテンツの生成に失敗しました')
    }
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
          model: this.normalizeModelName('anthropic/claude-3.5-haiku'),
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: API_CONSTANTS.MAX_TOKENS.CONTENT_GENERATION,
          temperature: TEMPERATURE_SETTINGS.CREATIVE
        })
      })

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.choices[0]?.message?.content || ''
      
      return this.parseNextStepsResponse(content, meeting.id)
    } catch (error) {
      throw new Error('ネクストステップの生成に失敗しました')
    }
  }

  async sendChatMessage(
    message: string,
    context: any
  ): Promise<string> {
    try {
      const messages = []
      
      // contextがundefinedの場合はデフォルト値を設定
      if (!context) {
        context = {}
      }
      
      // システムプロンプトを設定
      if (context.systemPrompt) {
        messages.push({
          role: 'system',
          content: context.systemPrompt
        })
      }
      
      // コンテキスト情報を追加
      let contextMessage = '【現在の会議情報】\n'
      
      // meetingInfo または meetingContext をサポート
      const meetingInfo = context.meetingInfo || context.meetingContext
      if (meetingInfo) {
        contextMessage += `タイトル: ${meetingInfo.title || '不明'}\n`
        contextMessage += `参加者: ${meetingInfo.participants?.join(', ') || '不明'}\n`
        contextMessage += `発言数: ${meetingInfo.transcriptsCount || 0}\n\n`
      } else {
        contextMessage += 'タイトル: 不明\n参加者: 不明\n発言数: 0\n\n'
      }
      
      if (context.minutes || (context.meetingContext && context.meetingContext.minutesContent)) {
        const minutesContent = context.minutes || context.meetingContext.minutesContent
        contextMessage += '【現在の議事録】\n' + minutesContent + '\n\n'
      }
      
      if (context.currentTopicSummary) {
        contextMessage += '【現在の議題】\n' + context.currentTopicSummary + '\n\n'
      }
      
      if (context.recentTranscripts && context.recentTranscripts.length > 0) {
        contextMessage += '【最近の発言】\n'
        context.recentTranscripts.forEach((t: Transcript) => {
          const time = new Date(t.timestamp).toLocaleTimeString('ja-JP')
          contextMessage += `[${time}] ${t.speaker}: ${t.content}\n`
        })
      }
      
      if (context.differenceTranscripts && context.differenceTranscripts.length > 0) {
        contextMessage += '【音声入力中の発言】\n'
        context.differenceTranscripts.forEach((t: any) => {
          const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString('ja-JP') : ''
          contextMessage += time ? `[${time}] ${t.speaker}: ${t.content || t.text}\n` : `${t.speaker}: ${t.content || t.text}\n`
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
          model: this.normalizeModelName('openai/gpt-4o-mini'),
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
          model: this.normalizeModelName('anthropic/claude-3.5-haiku'),
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
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorData}`)
      }

      const data = await response.json()
      return data.choices[0]?.message?.content || ''
    } catch (error) {
      throw new Error('テキストの生成に失敗しました')
    }
  }
}