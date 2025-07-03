/**
 * AI Models Constants
 * AIモデル名と制限値の定数定義
 */

export const AI_MODELS = {
  CLAUDE: {
    SONNET: 'claude-3-5-sonnet-20241022',
    HAIKU: 'claude-3-5-haiku-20241022'
  },
  OPENAI: {
    GPT4O_MINI: 'gpt-4o-mini',
    GPT4: 'gpt-4'
  },
  GEMINI: {
    PRO: 'gemini-pro'
  }
} as const;

export const MODEL_LIMITS = {
  'anthropic/claude-3.5-sonnet': 200000,
  'anthropic/claude-3-haiku': 200000,
  'meta-llama/llama-3.1-8b-instruct:free': 8000,
  'google/gemini-pro-1.5': 2000000,
  'openai/gpt-3.5-turbo': 16000,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000
} as const;

export const DEFAULT_MODEL_LIMIT = 128000;