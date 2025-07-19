import React, { useEffect, useState } from 'react'
import { ABTestConfig, VariantMetrics } from '@/types/ab-test'
import { AIServiceFactory } from '@/services/ai/factory'

interface ABTestMetricsProps {
  config?: ABTestConfig
}

export const ABTestMetrics: React.FC<ABTestMetricsProps> = ({ config }) => {
  const [metrics, setMetrics] = useState<Record<string, VariantMetrics>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadMetrics()
    const interval = setInterval(loadMetrics, 30000) // 30秒ごとに更新
    return () => clearInterval(interval)
  }, [])

  const loadMetrics = async () => {
    try {
      const results = await AIServiceFactory.getABTestMetrics()
      if (results && results.metrics) {
        setMetrics(results.metrics)
      }
    } catch (error) {
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="p-4">メトリクスを読み込み中...</div>
  }

  if (!config || Object.keys(metrics).length === 0) {
    return <div className="p-4 text-gray-500">まだデータがありません</div>
  }

  const calculateImprovement = (baseValue: number, testValue: number): string => {
    if (baseValue === 0) return '0%'
    const improvement = ((testValue - baseValue) / baseValue) * 100
    return improvement > 0 ? `+${improvement.toFixed(1)}%` : `${improvement.toFixed(1)}%`
  }

  const getVariantName = (variantId: string): string => {
    return config.variants.find(v => v.id === variantId)?.name || variantId
  }

  const sortedVariants = Object.entries(metrics).sort((a, b) => b[1].samples - a[1].samples)
  const [baselineId, baselineMetrics] = sortedVariants[0] || [null, null]

  return (
    <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
      <h3 className="text-lg font-semibold mb-4">A/Bテスト結果</h3>
      
      <div className="grid gap-4">
        {sortedVariants.map(([variantId, variantMetrics]) => {
          const isBaseline = variantId === baselineId
          const variant = config.variants.find(v => v.id === variantId)
          
          return (
            <div
              key={variantId}
              className={`p-4 border rounded ${
                isBaseline ? 'border-blue-500 bg-blue-50 dark:bg-blue-900' : ''
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-medium">
                  {getVariantName(variantId)} ({variant?.provider})
                  {isBaseline && <span className="ml-2 text-sm text-blue-600">基準</span>}
                </h4>
                <span className="text-sm text-gray-500">
                  サンプル数: {variantMetrics.samples}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-600">成功率</div>
                  <div className="text-lg font-semibold">
                    {variantMetrics.successRate.toFixed(1)}%
                    {!isBaseline && baselineMetrics && (
                      <span className={`text-sm ml-1 ${
                        variantMetrics.successRate > baselineMetrics.successRate 
                          ? 'text-green-600' 
                          : 'text-red-600'
                      }`}>
                        ({calculateImprovement(baselineMetrics.successRate, variantMetrics.successRate)})
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">平均応答時間</div>
                  <div className="text-lg font-semibold">
                    {(variantMetrics.avgResponseTime / 1000).toFixed(2)}秒
                    {!isBaseline && baselineMetrics && (
                      <span className={`text-sm ml-1 ${
                        variantMetrics.avgResponseTime < baselineMetrics.avgResponseTime 
                          ? 'text-green-600' 
                          : 'text-red-600'
                      }`}>
                        ({calculateImprovement(baselineMetrics.avgResponseTime, variantMetrics.avgResponseTime)})
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-600">エラー数</div>
                  <div className="text-lg font-semibold">
                    {variantMetrics.errorCount}
                  </div>
                </div>

                {variantMetrics.userRatings && variantMetrics.userRatings.length > 0 && (
                  <div>
                    <div className="text-sm text-gray-600">平均評価</div>
                    <div className="text-lg font-semibold">
                      {(variantMetrics.userRatings.reduce((a, b) => a + b, 0) / 
                        variantMetrics.userRatings.length).toFixed(1)}/5
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={loadMetrics}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          更新
        </button>
      </div>
    </div>
  )
}