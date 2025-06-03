import { AIProvider, UserSettings } from '@/types'
import { BaseAIService } from './base'
import { GeminiService } from '../gemini'
import { OpenAIService } from './openai'
import { ClaudeService } from './claude'
import { OpenRouterService } from './openrouter'

export class AIServiceFactory {
  static createService(settings: UserSettings): BaseAIService {
    const { aiProvider } = settings
    
    switch (aiProvider) {
      case 'gemini':
        const geminiKey = settings.apiKey || ''
        return new GeminiService(geminiKey) as any
        
      case 'openai':
        const openaiKey = settings.openaiApiKey || ''
        return new OpenAIService(openaiKey)
        
      case 'claude':
        const claudeKey = settings.claudeApiKey || ''
        return new ClaudeService(claudeKey)
        
      case 'openrouter':
        const openrouterKey = settings.openrouterApiKey || ''
        return new OpenRouterService(openrouterKey)
        
      default:
        throw new Error(`Unsupported AI provider: ${aiProvider}`)
    }
  }

  static getCurrentApiKey(settings: UserSettings): string {
    switch (settings.aiProvider) {
      case 'gemini': return settings.apiKey || ''
      case 'openai': return settings.openaiApiKey || ''
      case 'claude': return settings.claudeApiKey || ''
      case 'openrouter': return settings.openrouterApiKey || ''
      default: return ''
    }
  }

  static validateProviderSettings(settings: UserSettings): boolean {
    const apiKey = AIServiceFactory.getCurrentApiKey(settings)
    if (!apiKey) return false
    
    // OpenRouterの場合はモデル選択も必要
    if (settings.aiProvider === 'openrouter' && !settings.selectedModel) {
      return false
    }
    
    return true
  }
}