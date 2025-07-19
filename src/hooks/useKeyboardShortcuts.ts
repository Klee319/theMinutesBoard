import { useEffect, useRef } from 'react'

export interface KeyboardShortcut {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  description: string
  handler: () => void
}

export const useKeyboardShortcuts = (shortcuts: KeyboardShortcut[]) => {
  const shortcutsRef = useRef(shortcuts)

  useEffect(() => {
    shortcutsRef.current = shortcuts
  }, [shortcuts])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // テキスト入力中は無視
      const target = event.target as HTMLElement
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.contentEditable === 'true'
      ) {
        return
      }

      const activeShortcuts = shortcutsRef.current

      for (const shortcut of activeShortcuts) {
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase()
        const ctrlMatches = !shortcut.ctrl || event.ctrlKey === shortcut.ctrl
        const altMatches = !shortcut.alt || event.altKey === shortcut.alt
        const shiftMatches = !shortcut.shift || event.shiftKey === shortcut.shift

        if (keyMatches && ctrlMatches && altMatches && shiftMatches) {
          event.preventDefault()
          shortcut.handler()
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])
}

// 共通のショートカット定義
export const commonShortcuts = {
  search: {
    key: '/',
    description: '検索',
  },
  newMeeting: {
    key: 'n',
    ctrl: true,
    description: '新規会議',
  },
  export: {
    key: 'e',
    ctrl: true,
    description: 'エクスポート',
  },
  settings: {
    key: ',',
    ctrl: true,
    description: '設定',
  },
  help: {
    key: '?',
    description: 'ヘルプ',
  },
  close: {
    key: 'Escape',
    description: '閉じる/キャンセル',
  },
  save: {
    key: 's',
    ctrl: true,
    description: '保存',
  },
  refresh: {
    key: 'r',
    ctrl: true,
    description: '更新',
  },
  delete: {
    key: 'Delete',
    description: '削除',
  },
  selectAll: {
    key: 'a',
    ctrl: true,
    description: 'すべて選択',
  },
  nextPanel: {
    key: 'Tab',
    description: '次のパネル',
  },
  previousPanel: {
    key: 'Tab',
    shift: true,
    description: '前のパネル',
  },
  zoomIn: {
    key: '=',
    ctrl: true,
    description: '拡大',
  },
  zoomOut: {
    key: '-',
    ctrl: true,
    description: '縮小',
  },
}