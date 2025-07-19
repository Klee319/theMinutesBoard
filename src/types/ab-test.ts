export interface ABTestConfig {
  enabled: boolean
  testId: string
  startDate: string
  endDate?: string
  variants: ABTestVariant[]
  metrics: ABTestMetrics
}

export interface ABTestVariant {
  id: string
  name: string
  provider: string
  model?: string
  weight: number // 0-100, 各バリアントの割合
}

export interface ABTestMetrics {
  variantMetrics: Record<string, VariantMetrics>
  totalSamples: number
}

export interface VariantMetrics {
  samples: number
  avgResponseTime: number
  successRate: number
  avgTokenCount: number
  errorCount: number
  userRatings?: number[]
}

export interface ABTestResult {
  variantId: string
  responseTime: number
  success: boolean
  tokenCount?: number
  error?: string
  userRating?: number
}

export interface ABTestState {
  activeTest?: ABTestConfig
  userVariant?: string
  sessionId: string
  results: ABTestResult[]
}