import React from 'react'
import { KeyboardShortcut } from '@/hooks/useKeyboardShortcuts'

interface KeyboardShortcutsHelpProps {
  isOpen: boolean
  onClose: () => void
  shortcuts: KeyboardShortcut[]
}

export const KeyboardShortcutsHelp: React.FC<KeyboardShortcutsHelpProps> = ({
  isOpen,
  onClose,
  shortcuts
}) => {
  if (!isOpen) return null

  const formatKey = (shortcut: KeyboardShortcut): string => {
    const keys = []
    if (shortcut.ctrl) keys.push('Ctrl')
    if (shortcut.alt) keys.push('Alt')
    if (shortcut.shift) keys.push('Shift')
    keys.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key)
    return keys.join('+')
  }

  const groupedShortcuts = shortcuts.reduce((groups, shortcut) => {
    const category = getCategory(shortcut)
    if (!groups[category]) {
      groups[category] = []
    }
    groups[category].push(shortcut)
    return groups
  }, {} as Record<string, KeyboardShortcut[]>)

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">キーボードショートカット</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {Object.entries(groupedShortcuts).map(([category, categoryShortcuts]) => (
            <div key={category}>
              <h3 className="text-lg font-semibold mb-2 text-gray-700">
                {category}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {categoryShortcuts.map((shortcut, index) => (
                  <div 
                    key={index}
                    className="flex justify-between items-center p-2 hover:bg-gray-50 rounded"
                  >
                    <span className="text-sm text-gray-600">
                      {shortcut.description}
                    </span>
                    <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded">
                      {formatKey(shortcut)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 pt-4 border-t text-sm text-gray-500">
          <p>ヒント: テキスト入力中はショートカットが無効になります</p>
        </div>
      </div>
    </div>
  )
}

function getCategory(shortcut: KeyboardShortcut): string {
  const description = shortcut.description.toLowerCase()
  
  if (description.includes('検索') || description.includes('フィルタ')) {
    return '検索とフィルタ'
  }
  if (description.includes('移動') || description.includes('パネル') || description.includes('ナビゲーション')) {
    return 'ナビゲーション'
  }
  if (description.includes('新規') || description.includes('作成') || description.includes('追加')) {
    return '作成'
  }
  if (description.includes('編集') || description.includes('保存') || description.includes('削除')) {
    return '編集'
  }
  if (description.includes('エクスポート') || description.includes('インポート')) {
    return 'インポート/エクスポート'
  }
  if (description.includes('拡大') || description.includes('縮小') || description.includes('表示')) {
    return '表示'
  }
  
  return 'その他'
}