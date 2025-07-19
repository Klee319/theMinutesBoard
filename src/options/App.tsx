import React, { useState, useEffect } from 'react'
import { UserSettings, ExportFormat, AIProvider, AIModel, ABTestConfig } from '@/types'
import { geminiService } from '@/services/gemini'
import { AIServiceFactory } from '@/services/ai/factory'
import { MigrationDialog } from '@/components/MigrationDialog'
import { ABTestSettings } from '@/components/ABTestSettings'
import { ABTestMetrics } from '@/components/ABTestMetrics'

const DEFAULT_PROMPT = '' // カスタムプロンプトのデフォルトは空

const AI_MODELS: Record<AIProvider, AIModel[]> = {
  gemini: [
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'gemini', contextLength: 1000000 },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'gemini', contextLength: 2000000 },
    { id: 'gemini-1.0-pro', name: 'Gemini 1.0 Pro', provider: 'gemini', contextLength: 32000 }
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', contextLength: 128000 },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', contextLength: 128000 },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai', contextLength: 128000 },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai', contextLength: 16385 }
  ],
  claude: [
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'claude', contextLength: 200000 },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'claude', contextLength: 200000 },
    { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', provider: 'claude', contextLength: 200000 }
  ],
  openrouter: [
    // Latest Anthropic Claude Models (2025)
    { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', provider: 'openrouter', contextLength: 500000 },
    { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'openrouter', contextLength: 200000 },
    { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'openrouter', contextLength: 200000 },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter', contextLength: 200000 },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'openrouter', contextLength: 200000 },
    
    // Latest OpenAI GPT Models (2025)
    { id: 'openai/gpt-4.1', name: 'GPT-4.1', provider: 'openrouter', contextLength: 128000 },
    { id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openrouter', contextLength: 128000 },
    { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openrouter', contextLength: 128000 },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openrouter', contextLength: 128000 },
    
    // OpenAI o-series Reasoning Models
    { id: 'openai/o3', name: 'OpenAI o3', provider: 'openrouter', contextLength: 128000 },
    { id: 'openai/o3-mini', name: 'OpenAI o3-mini', provider: 'openrouter', contextLength: 128000 },
    { id: 'openai/o1', name: 'OpenAI o1', provider: 'openrouter', contextLength: 128000 },
    { id: 'openai/o1-mini', name: 'OpenAI o1-mini', provider: 'openrouter', contextLength: 128000 },
    
    // Latest Google Gemini Models (2025)
    { id: 'google/gemini-2.5-pro-preview-03-25', name: 'Gemini 2.5 Pro Preview', provider: 'openrouter', contextLength: 1000000 },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'openrouter', contextLength: 1000000 },
    { id: 'google/gemini-2.5-flash:thinking', name: 'Gemini 2.5 Flash (Thinking)', provider: 'openrouter', contextLength: 1000000 },
    { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'openrouter', contextLength: 1000000 },
    { id: 'google/gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', provider: 'openrouter', contextLength: 1000000 },
    { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'openrouter', contextLength: 2800000 },
    { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', provider: 'openrouter', contextLength: 1000000 },
    
    // Popular Meta Llama Models
    { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B Instruct', provider: 'openrouter', contextLength: 131072 },
    { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct', provider: 'openrouter', contextLength: 131072 },
    { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct', provider: 'openrouter', contextLength: 131072 },
    
    // Popular Mistral Models
    { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'openrouter', contextLength: 128000 },
    { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B Instruct', provider: 'openrouter', contextLength: 65536 },
    { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B Instruct', provider: 'openrouter', contextLength: 32768 },
    
    // Other Popular Models
    { id: 'cohere/command-r-plus', name: 'Command R+', provider: 'openrouter', contextLength: 128000 },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'openrouter', contextLength: 32768 },
    { id: 'x-ai/grok-beta', name: 'Grok Beta', provider: 'openrouter', contextLength: 131072 }
  ]
}

function App() {
  const [settings, setSettings] = useState<UserSettings>({
    aiProvider: 'gemini',
    apiKey: '',
    openaiApiKey: '',
    claudeApiKey: '',
    openrouterApiKey: '',
    selectedModel: '',
    promptTemplate: DEFAULT_PROMPT,
    autoUpdateInterval: 2, // 自動更新間隔（分）、0はOFF
    exportFormat: 'markdown',
    userName: '', // ユーザー名を追加
    abTestEnabled: false,
    abTestConfig: undefined
  })
  const [saved, setSaved] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState<'unchecked' | 'checking' | 'valid' | 'invalid'>('unchecked')
  const [checkingApiKey, setCheckingApiKey] = useState(false)
  const [availableModels, setAvailableModels] = useState<AIModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [showMigrationDialog, setShowMigrationDialog] = useState(false)
  
  useEffect(() => {
    loadSettings()
  }, [])

  useEffect(() => {
    const models = AI_MODELS[settings.aiProvider] || []
    setAvailableModels(models)
    
    // デフォルトモデルが設定されていない場合は最初のモデルを選択
    if (!settings.selectedModel && models.length > 0) {
      setSettings(prev => ({ ...prev, selectedModel: models[0].id }))
    }
  }, [settings.aiProvider])
  
  const loadSettings = () => {
    // localとsyncの両方から設定を読み込む
    chrome.storage.local.get(['settings'], (localResult) => {
      chrome.storage.sync.get(['settings'], (syncResult) => {
        // sync storageの設定を優先（ユーザー名とAPIキー）
        const mergedSettings = {
          ...(localResult.settings || {}),
          ...(syncResult.settings || {})
        }
        if (Object.keys(mergedSettings).length > 0) {
          setSettings(mergedSettings as UserSettings)
          // APIキーがある場合は自動的に検証
          const apiKey = getCurrentApiKeyFromSettings(mergedSettings)
          if (apiKey) {
            validateApiKey(apiKey, mergedSettings)
          }
        }
      })
    })
  }
  
  const getCurrentApiKeyFromSettings = (settings: any) => {
    switch (settings.aiProvider) {
      case 'gemini': return settings.apiKey
      case 'openai': return settings.openaiApiKey
      case 'claude': return settings.claudeApiKey
      case 'openrouter': return settings.openrouterApiKey
      default: return ''
    }
  }
  
  const validateApiKey = async (apiKey: string, passedSettings?: any) => {
    if (!apiKey) {
      setApiKeyStatus('unchecked')
      return
    }
    
    setCheckingApiKey(true)
    setApiKeyStatus('checking')
    
    try {
      // 渡された設定を使用するか、現在の設定を使用
      const settingsToUse = passedSettings || settings
      const tempSettings = { ...settingsToUse }
      
      // APIキーを適切なフィールドに設定
      switch (tempSettings.aiProvider) {
        case 'gemini':
          tempSettings.apiKey = apiKey
          break
        case 'openai':
          tempSettings.openaiApiKey = apiKey
          break
        case 'claude':
          tempSettings.claudeApiKey = apiKey
          break
        case 'openrouter':
          tempSettings.openrouterApiKey = apiKey
          break
      }
      
      const aiService = AIServiceFactory.createService(tempSettings)
      const isValid = await aiService.validateApiKey(apiKey)
      setApiKeyStatus(isValid ? 'valid' : 'invalid')
    } catch (error) {
      console.error('API key validation error:', error)
      setApiKeyStatus('invalid')
    } finally {
      setCheckingApiKey(false)
    }
  }
  
  const handleProviderChange = (provider: AIProvider) => {
    const models = AI_MODELS[provider]
    const defaultModel = models[0]?.id || ''
    
    setSettings(prev => ({
      ...prev,
      aiProvider: provider,
      selectedModel: defaultModel
    }))
    
    setAvailableModels(models)
    setApiKeyStatus('unchecked')
  }

  const getCurrentApiKey = () => {
    switch (settings.aiProvider) {
      case 'gemini': return settings.apiKey
      case 'openai': return settings.openaiApiKey
      case 'claude': return settings.claudeApiKey
      case 'openrouter': return settings.openrouterApiKey
      default: return ''
    }
  }

  const updateCurrentApiKey = (apiKey: string) => {
    switch (settings.aiProvider) {
      case 'gemini':
        setSettings(prev => ({ ...prev, apiKey }))
        break
      case 'openai':
        setSettings(prev => ({ ...prev, openaiApiKey: apiKey }))
        break
      case 'claude':
        setSettings(prev => ({ ...prev, claudeApiKey: apiKey }))
        break
      case 'openrouter':
        setSettings(prev => ({ ...prev, openrouterApiKey: apiKey }))
        break
    }
  }

  const handleSave = () => {
    // localとsyncの両方に保存（syncにはユーザー名とAPIキーのみ）
    const syncSettings = {
      userName: settings.userName,
      apiKey: settings.apiKey,
      openaiApiKey: settings.openaiApiKey,
      claudeApiKey: settings.claudeApiKey,
      openrouterApiKey: settings.openrouterApiKey
    }
    
    chrome.storage.local.set({ settings }, () => {
      chrome.storage.sync.set({ settings: syncSettings }, () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      })
    })
  }
  
  const handleReset = () => {
    if (confirm('設定をリセットしてもよろしいですか？')) {
      setSettings({
        aiProvider: 'gemini',
        apiKey: '',
        openaiApiKey: '',
        claudeApiKey: '',
        openrouterApiKey: '',
        selectedModel: 'gemini-1.5-flash',
        promptTemplate: DEFAULT_PROMPT,
        autoUpdateInterval: 2, // 自動更新間隔（分）、0はOFF
        exportFormat: 'markdown',
        userName: '' // リセット時もユーザー名を含める
      })
      setApiKeyStatus('unchecked')
    }
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">theMinutesBoard 設定</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">AI設定</h2>
            <div className="space-y-6">
              {/* AIプロバイダー選択 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AIプロバイダー
                </label>
                <select
                  value={settings.aiProvider}
                  onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
                  className="input"
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="claude">Anthropic Claude</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              {/* モデル選択（OpenRouter時のみ） */}
              {settings.aiProvider === 'openrouter' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    モデル選択
                    <span className="text-xs text-gray-500 ml-2">
                      ({availableModels.length}個のモデルが利用可能)
                    </span>
                  </label>
                  <select
                    value={settings.selectedModel || ''}
                    onChange={(e) => setSettings(prev => ({ ...prev, selectedModel: e.target.value }))}
                    className="input"
                  >
                    <option value="">モデルを選択してください</option>
                    
                    <optgroup label="🤖 Latest Claude Models (2025 - 推奨)">
                      <option value="anthropic/claude-4-sonnet">Claude 4 Sonnet (Context: 500,000) ⭐ NEW</option>
                      <option value="anthropic/claude-3.7-sonnet">Claude 3.7 Sonnet (Context: 200,000) ⭐ 人気</option>
                      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet (Context: 200,000)</option>
                      <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku (Context: 200,000)</option>
                    </optgroup>
                    
                    <optgroup label="🚀 Latest GPT Models (2025 - 推奨)">
                      <option value="openai/gpt-4.1">GPT-4.1 (Context: 128,000) ⭐ NEW</option>
                      <option value="openai/gpt-4.1-mini">GPT-4.1 Mini (Context: 128,000) ⭐ NEW</option>
                      <option value="openai/gpt-4o">GPT-4o (Context: 128,000)</option>
                      <option value="openai/gpt-4o-mini">GPT-4o Mini (Context: 128,000)</option>
                    </optgroup>
                    
                    <optgroup label="🧠 OpenAI Reasoning Models (2025)">
                      <option value="openai/o3">OpenAI o3 (Context: 128,000) ⭐ 最新推論</option>
                      <option value="openai/o3-mini">OpenAI o3-mini (Context: 128,000) ⭐ 高速推論</option>
                      <option value="openai/o1">OpenAI o1 (Context: 128,000)</option>
                      <option value="openai/o1-mini">OpenAI o1-mini (Context: 128,000)</option>
                    </optgroup>
                    
                    <optgroup label="🔍 Latest Gemini Models (2025 - 推奨)">
                      <option value="google/gemini-2.5-pro-preview-03-25">Gemini 2.5 Pro Preview (Context: 1,000,000) ⭐ 最新 + 思考機能</option>
                      <option value="google/gemini-2.5-flash">Gemini 2.5 Flash (Context: 1,000,000) ⭐ 最新高速</option>
                      <option value="google/gemini-2.5-flash:thinking">Gemini 2.5 Flash (Thinking) (Context: 1,000,000) ⭐ 思考特化</option>
                      <option value="google/gemini-2.0-flash">Gemini 2.0 Flash (Context: 1,000,000)</option>
                      <option value="google/gemini-2.0-flash-lite">Gemini 2.0 Flash Lite (Context: 1,000,000)</option>
                      <option value="google/gemini-pro-1.5">Gemini Pro 1.5 (Context: 2,800,000) ⭐ 大コンテキスト</option>
                      <option value="google/gemini-flash-1.5">Gemini Flash 1.5 (Context: 1,000,000)</option>
                    </optgroup>
                    
                    <optgroup label="🦙 Meta Llama (オープンソース)">
                      <option value="meta-llama/llama-3.1-405b-instruct">Llama 3.1 405B Instruct (Context: 131,072)</option>
                      <option value="meta-llama/llama-3.1-70b-instruct">Llama 3.1 70B Instruct (Context: 131,072)</option>
                      <option value="meta-llama/llama-3.1-8b-instruct">Llama 3.1 8B Instruct (Context: 131,072)</option>
                    </optgroup>
                    
                    <optgroup label="⚡ Mistral (効率的)">
                      <option value="mistralai/mistral-large">Mistral Large (Context: 128,000)</option>
                      <option value="mistralai/mixtral-8x22b-instruct">Mixtral 8x22B Instruct (Context: 65,536)</option>
                      <option value="mistralai/mixtral-8x7b-instruct">Mixtral 8x7B Instruct (Context: 32,768)</option>
                    </optgroup>
                    
                    <optgroup label="🏢 Other Popular Models">
                      <option value="cohere/command-r-plus">Command R+ (Context: 128,000)</option>
                      <option value="deepseek/deepseek-chat">DeepSeek Chat (Context: 32,768)</option>
                      <option value="x-ai/grok-beta">Grok Beta (Context: 131,072)</option>
                    </optgroup>
                  </select>
                  
                  {settings.selectedModel && (
                    <div className="mt-2 p-3 bg-blue-50 rounded-md">
                      <p className="text-sm text-blue-800">
                        <strong>選択中:</strong> {availableModels.find(m => m.id === settings.selectedModel)?.name}
                      </p>
                      <p className="text-xs text-blue-600 mt-1">
                        コンテキスト長: {availableModels.find(m => m.id === settings.selectedModel)?.contextLength?.toLocaleString()} tokens
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* APIキー設定 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {settings.aiProvider === 'gemini' && 'Gemini API キー'}
                  {settings.aiProvider === 'openai' && 'OpenAI API キー'}
                  {settings.aiProvider === 'claude' && 'Claude API キー'}
                  {settings.aiProvider === 'openrouter' && 'OpenRouter API キー'}
                </label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={getCurrentApiKey()}
                        onChange={(e) => {
                          updateCurrentApiKey(e.target.value)
                          setApiKeyStatus('unchecked')
                        }}
                        className={`input pr-10 ${
                          apiKeyStatus === 'valid' ? 'border-green-500' : 
                          apiKeyStatus === 'invalid' ? 'border-red-500' : ''
                        }`}
                        placeholder={
                          settings.aiProvider === 'gemini' ? 'AIzaSy...' :
                          settings.aiProvider === 'openai' ? 'sk-...' :
                          settings.aiProvider === 'claude' ? 'sk-ant-...' :
                          'sk-or-...'
                        }
                      />
                      {/* ステータスインジケーター */}
                      <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                        {apiKeyStatus === 'checking' && (
                          <div className="animate-spin h-5 w-5 border-2 border-primary-600 border-t-transparent rounded-full"></div>
                        )}
                        {apiKeyStatus === 'valid' && (
                          <div className="text-green-500 text-xl">✓</div>
                        )}
                        {apiKeyStatus === 'invalid' && (
                          <div className="text-red-500 text-xl">✗</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="px-3 py-2 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors"
                      title={showApiKey ? 'APIキーを隠す' : 'APIキーを表示'}
                    >
                      {showApiKey ? '👁️' : '👁️‍🗨️'}
                    </button>
                    <button
                      onClick={() => validateApiKey(getCurrentApiKey() || '')}
                      disabled={!getCurrentApiKey() || checkingApiKey}
                      className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                      title="APIキーの有効性を確認"
                    >
                      {checkingApiKey ? '確認中...' : '確認'}
                    </button>
                  </div>
                  {/* ステータスメッセージ */}
                  <div className="text-sm">
                    {apiKeyStatus === 'valid' && (
                      <p className="text-green-600">✓ APIキーは有効です</p>
                    )}
                    {apiKeyStatus === 'invalid' && (
                      <p className="text-red-600">✗ APIキーが無効です。正しいキーを入力してください</p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  <a 
                    href="https://makersuite.google.com/app/apikey" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-primary-600 hover:underline"
                  >
                    Google AI Studio
                  </a>
                  でAPIキーを取得できます
                </p>
              </div>
            </div>
          </div>
          
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">議事録生成設定</h2>
            <div className="space-y-4">
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  自動更新間隔
                </label>
                <select
                  value={settings.autoUpdateInterval}
                  onChange={(e) => setSettings({ ...settings, autoUpdateInterval: parseInt(e.target.value) })}
                  className="input w-48"
                >
                  <option value="0">OFF（自動更新しない）</option>
                  <option value="1">1分</option>
                  <option value="2">2分（推奨）</option>
                  <option value="3">3分</option>
                  <option value="4">4分</option>
                  <option value="5">5分</option>
                  <option value="6">6分</option>
                  <option value="7">7分</option>
                  <option value="8">8分</option>
                  <option value="9">9分</option>
                  <option value="10">10分</option>
                  <option value="11">11分</option>
                  <option value="12">12分</option>
                  <option value="13">13分</option>
                  <option value="14">14分</option>
                  <option value="15">15分</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  録音中に議事録とネクストステップを自動的に更新します
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  カスタムプロンプト
                </label>
                <textarea
                  value={settings.promptTemplate}
                  onChange={(e) => setSettings({ ...settings, promptTemplate: e.target.value })}
                  className="input min-h-[200px]"
                  placeholder="カスタムプロンプトを入力（空欄の場合はシステムプロンプトを使用）"
                />
                <p className="text-xs text-gray-500 mt-1">
                  空欄の場合は、システムが用意した最適なプロンプトが使用されます
                </p>
              </div>
            </div>
          </div>
          
          {/* A/Bテスト設定 */}
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">A/Bテスト設定</h2>
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="abTestEnabled"
                  checked={settings.abTestEnabled || false}
                  onChange={(e) => setSettings({ ...settings, abTestEnabled: e.target.checked })}
                  className="h-4 w-4 text-primary-600 rounded"
                />
                <label htmlFor="abTestEnabled" className="text-sm font-medium text-gray-700">
                  A/Bテストを有効にする
                </label>
              </div>
              
              {settings.abTestEnabled && (
                <ABTestSettings
                  config={settings.abTestConfig}
                  onConfigChange={(config) => setSettings({ ...settings, abTestConfig: config })}
                />
              )}
              
              {settings.abTestEnabled && settings.abTestConfig && (
                <div className="mt-4">
                  <ABTestMetrics />
                </div>
              )}
            </div>
          </div>
          
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">エクスポート設定</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  デフォルトのエクスポート形式
                </label>
                <select
                  value={settings.exportFormat}
                  onChange={(e) => setSettings({ ...settings, exportFormat: e.target.value as ExportFormat })}
                  className="input w-48"
                >
                  <option value="markdown">Markdown (.md)</option>
                  <option value="pdf">PDF</option>
                  <option value="txt">テキスト (.txt)</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            </div>
          </div>
          
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">ユーザー設定</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  あなたの名前
                </label>
                <input
                  type="text"
                  value={settings.userName || ''}
                  onChange={(e) => setSettings({ ...settings, userName: e.target.value })}
                  className="input"
                  placeholder="例: 田中太郎"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Google Meetで「あなた」と表示される部分がこの名前に置き換わります
                </p>
              </div>
            </div>
          </div>
          
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-4">システム設定</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  データストレージ
                </label>
                <p className="text-sm text-gray-600 mb-2">
                  現在Chrome Storageを使用していますが、より大容量のデータを保存できるIndexedDBへ移行できます。
                </p>
                <button
                  onClick={() => setShowMigrationDialog(true)}
                  className="btn-secondary"
                >
                  データ移行ツールを開く
                </button>
              </div>
            </div>
          </div>
          
          
          <div className="flex justify-end pt-4 border-t">
            <button
              onClick={handleSave}
              className="btn-primary"
            >
              {saved ? '✓ 保存しました' : '保存'}
            </button>
          </div>
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>theMinutesBoard v1.0.0</p>
          <p className="mt-1">
            <a 
              href="https://github.com/anthropics/theMinutesBoard" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline"
            >
              GitHub
            </a>
            {' • '}
            <a 
              href="#" 
              className="text-primary-600 hover:underline"
            >
              お問い合わせ
            </a>
          </p>
        </div>
      </div>
      
      {/* Migration Dialog */}
      <MigrationDialog
        isOpen={showMigrationDialog}
        onClose={() => setShowMigrationDialog(false)}
        onMigrationComplete={() => {
          console.log('Migration completed successfully')
          // 必要に応じて設定を更新
        }}
      />
    </div>
  )
}

export default App