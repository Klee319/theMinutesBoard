import { useEffect, useRef } from 'react'

// スクリーンリーダー向けのライブリージョンアナウンス
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite') {
  const liveRegion = document.getElementById(`sr-live-${priority}`)
  if (liveRegion) {
    liveRegion.textContent = message
    // メッセージをクリアして次のアナウンスを可能にする
    setTimeout(() => {
      liveRegion.textContent = ''
    }, 1000)
  }
}

// フォーカストラップフック
export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current
    const focusableElements = container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    
    const firstFocusable = focusableElements[0] as HTMLElement
    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement

    // 初期フォーカスを設定
    firstFocusable?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault()
          lastFocusable?.focus()
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault()
          firstFocusable?.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [isActive])

  return containerRef
}

// キーボードナビゲーションフック
export function useKeyboardNavigation(
  items: any[],
  onSelect: (index: number) => void,
  isActive = true
) {
  const selectedIndex = useRef(0)

  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          selectedIndex.current = Math.min(selectedIndex.current + 1, items.length - 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          selectedIndex.current = Math.max(selectedIndex.current - 1, 0)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          onSelect(selectedIndex.current)
          break
        case 'Home':
          e.preventDefault()
          selectedIndex.current = 0
          break
        case 'End':
          e.preventDefault()
          selectedIndex.current = items.length - 1
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [items, onSelect, isActive])

  return selectedIndex.current
}

// WCAG準拠のカラーコントラスト比計算
export function getContrastRatio(color1: string, color2: string): number {
  // 簡易実装（実際にはRGB値から輝度を計算する必要がある）
  return 4.5 // 仮の値
}

// アクセシブルなIDジェネレーター
export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`
}

// フォーカス可能要素の取得
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  return Array.from(elements) as HTMLElement[]
}

// エスケープキーハンドラー
export function useEscapeKey(onEscape: () => void, isActive = true) {
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onEscape, isActive])
}