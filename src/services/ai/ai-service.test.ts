import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIService } from './factory'
import { AIProvider, AIServiceFactory } from './types'
import { ClaudeService } from './claude'
import { OpenRouterService } from './openrouter'
import { getConfig } from '@/services/config'

// モックの設定
vi.mock('@/services/config', () => ({
  getConfig: vi.fn()
}))

vi.mock('./claude', () => ({
  ClaudeService: vi.fn().mockImplementation(() => ({
    generateMinutes: vi.fn(),
    analyzeChat: vi.fn(),
    isConfigured: vi.fn()
  }))
}))

vi.mock('./openrouter', () => ({
  OpenRouterService: vi.fn().mockImplementation(() => ({
    generateMinutes: vi.fn(),
    analyzeChat: vi.fn(),
    isConfigured: vi.fn()
  }))
}))

describe('AIService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // シングルトンインスタンスをリセット
    (AIService as any).instance = null
  })

  it('シングルトンインスタンスが正しく動作する', () => {
    const instance1 = AIService.getInstance()
    const instance2 = AIService.getInstance()
    
    expect(instance1).toBe(instance2)
  })

  it('設定に基づいて正しいプロバイダーを選択する', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      aiProvider: 'claude' as AIProvider,
      claudeApiKey: 'test-key',
      openRouterApiKey: '',
      enableAI: true,
      enableMeetingList: true,
      enableRealTimeTranscription: true,
      hideWatermark: false
    })

    const service = AIService.getInstance()
    await service.initializeProvider()

    expect(ClaudeService).toHaveBeenCalled()
  })

  it('議事録生成が正しく動作する', async () => {
    const mockMinutes = {
      id: 'test-123',
      meetingId: 'meeting-123',
      content: 'テスト要約',
      generatedAt: new Date(),
      format: 'markdown'
    }

    vi.mocked(getConfig).mockResolvedValue({
      aiProvider: 'claude' as AIProvider,
      claudeApiKey: 'test-key',
      openRouterApiKey: '',
      enableAI: true,
      enableMeetingList: true,
      enableRealTimeTranscription: true,
      hideWatermark: false
    })

    const service = AIService.getInstance()
    await service.initializeProvider()
    
    const mockClaudeInstance = (ClaudeService as any).mock.results[0].value
    mockClaudeInstance.generateMinutes.mockResolvedValue(mockMinutes)

    const result = await service.generateMinutes(['文字起こし1', '文字起こし2'])
    
    expect(result).toEqual(mockMinutes)
    expect(mockClaudeInstance.generateMinutes).toHaveBeenCalledWith(['文字起こし1', '文字起こし2'])
  })

  it('プロバイダーが未設定の場合エラーをスローする', async () => {
    vi.mocked(getConfig).mockResolvedValue({
      aiProvider: 'claude' as AIProvider,
      claudeApiKey: '',
      openRouterApiKey: '',
      enableAI: true,
      enableMeetingList: true,
      enableRealTimeTranscription: true,
      hideWatermark: false
    })

    const service = AIService.getInstance()
    
    await expect(service.generateMinutes(['文字起こし'])).rejects.toThrow('No AI provider configured')
  })

  it('フォールバック機能が動作する', async () => {
    const mockMinutes = {
      id: 'test-123',
      meetingId: 'meeting-123',
      content: 'フォールバック要約',
      generatedAt: new Date(),
      format: 'markdown'
    }

    vi.mocked(getConfig).mockResolvedValue({
      aiProvider: 'claude' as AIProvider,
      claudeApiKey: 'test-key',
      openRouterApiKey: 'backup-key',
      enableAI: true,
      enableMeetingList: true,
      enableRealTimeTranscription: true,
      hideWatermark: false
    })

    const service = AIService.getInstance()
    await service.initializeProvider()
    
    const mockClaudeInstance = (ClaudeService as any).mock.results[0].value
    const mockOpenRouterInstance = (OpenRouterService as any).mock.results[0].value
    
    // Claudeサービスがエラーをスロー
    mockClaudeInstance.generateMinutes.mockRejectedValue(new Error('API Error'))
    mockOpenRouterInstance.generateMinutes.mockResolvedValue(mockMinutes)

    const result = await service.generateMinutes(['文字起こし'])
    
    expect(result).toEqual(mockMinutes)
    expect(mockOpenRouterInstance.generateMinutes).toHaveBeenCalled()
  })
})