import React, { useState } from 'react'
import { ABTestConfig, ABTestVariant } from '@/types/ab-test'
import { AIProvider } from '@/types'

interface ABTestSettingsProps {
  config?: ABTestConfig
  onConfigChange: (config: ABTestConfig) => void
}

export const ABTestSettings: React.FC<ABTestSettingsProps> = ({
  config,
  onConfigChange
}) => {
  const availableProviders: AIProvider[] = ['gemini', 'openai', 'claude', 'openrouter']
  const [localConfig, setLocalConfig] = useState<ABTestConfig>(config || {
    enabled: false,
    testId: `test-${Date.now()}`,
    startDate: new Date().toISOString().split('T')[0],
    variants: [
      { id: 'variant-a', name: 'バリアントA', provider: 'gemini', weight: 50 },
      { id: 'variant-b', name: 'バリアントB', provider: 'openai', weight: 50 }
    ],
    metrics: {
      variantMetrics: {},
      totalSamples: 0
    }
  })

  const handleToggle = () => {
    const newConfig = { ...localConfig, enabled: !localConfig.enabled }
    setLocalConfig(newConfig)
    onConfigChange(newConfig)
  }

  const handleVariantChange = (index: number, field: keyof ABTestVariant, value: any) => {
    const newVariants = [...localConfig.variants]
    newVariants[index] = { ...newVariants[index], [field]: value }
    setLocalConfig(prev => ({ ...prev, variants: newVariants }))
  }

  const addVariant = () => {
    const newVariant: ABTestVariant = {
      id: `variant-${Date.now()}`,
      name: `バリアント${localConfig.variants.length + 1}`,
      provider: availableProviders[0],
      weight: 0
    }
    setLocalConfig(prev => ({
      ...prev,
      variants: [...prev.variants, newVariant]
    }))
  }

  const removeVariant = (index: number) => {
    if (localConfig.variants.length <= 2) return // 最低2つのバリアントが必要
    const newVariants = localConfig.variants.filter((_, i) => i !== index)
    setLocalConfig(prev => ({ ...prev, variants: newVariants }))
  }

  const handleSave = () => {
    // 重みの合計を100%に正規化
    const totalWeight = localConfig.variants.reduce((sum, v) => sum + v.weight, 0)
    if (totalWeight > 0) {
      const normalizedVariants = localConfig.variants.map(v => ({
        ...v,
        weight: (v.weight / totalWeight) * 100
      }))
      onConfigChange({ ...localConfig, variants: normalizedVariants })
    } else {
      onConfigChange(localConfig)
    }
  }

  return (
    <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
      <h3 className="text-lg font-semibold mb-4">A/Bテスト設定</h3>
      
      <div className="mb-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={localConfig.enabled}
            onChange={handleToggle}
            className="w-4 h-4"
          />
          <span>A/Bテストを有効にする</span>
        </label>
      </div>

      {localConfig.enabled && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">開始日</label>
            <input
              type="date"
              value={localConfig.startDate}
              onChange={(e) => setLocalConfig(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">終了日（オプション）</label>
            <input
              type="date"
              value={localConfig.endDate || ''}
              onChange={(e) => setLocalConfig(prev => ({ ...prev, endDate: e.target.value || undefined }))}
              className="w-full px-3 py-2 border rounded"
            />
          </div>

          <div className="mb-4">
            <h4 className="text-sm font-medium mb-2">バリアント設定</h4>
            {localConfig.variants.map((variant, index) => (
              <div key={variant.id} className="mb-3 p-3 border rounded bg-white dark:bg-gray-700">
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={variant.name}
                    onChange={(e) => handleVariantChange(index, 'name', e.target.value)}
                    placeholder="名前"
                    className="px-2 py-1 border rounded"
                  />
                  <select
                    value={variant.provider}
                    onChange={(e) => handleVariantChange(index, 'provider', e.target.value)}
                    className="px-2 py-1 border rounded"
                  >
                    {availableProviders.map(provider => (
                      <option key={provider} value={provider}>{provider}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={variant.weight}
                    onChange={(e) => handleVariantChange(index, 'weight', Number(e.target.value))}
                    placeholder="重み"
                    min="0"
                    max="100"
                    className="px-2 py-1 border rounded"
                  />
                  <button
                    onClick={() => removeVariant(index)}
                    className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                    disabled={localConfig.variants.length <= 2}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={addVariant}
              className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              バリアントを追加
            </button>
          </div>

          <button
            onClick={handleSave}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            保存
          </button>
        </>
      )}
    </div>
  )
}