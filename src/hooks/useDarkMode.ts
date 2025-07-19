import { useState, useEffect } from 'react'

export const useDarkMode = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false)

  useEffect(() => {
    // ローカルストレージから設定を読み込む
    const storedMode = localStorage.getItem('darkMode')
    if (storedMode !== null) {
      setIsDarkMode(storedMode === 'true')
    } else {
      // システムの設定を確認
      const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches
      setIsDarkMode(prefersDarkMode)
    }
  }, [])

  useEffect(() => {
    // ダークモードの状態に応じてクラスを追加/削除
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    
    // ローカルストレージに保存
    localStorage.setItem('darkMode', isDarkMode.toString())
  }, [isDarkMode])

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode)
  }

  return { isDarkMode, toggleDarkMode }
}

// システムのテーマ変更を監視するフック
export const useSystemThemeListener = (onThemeChange: (isDark: boolean) => void) => {
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      onThemeChange(e.matches)
    }
    
    // 初回チェック
    onThemeChange(mediaQuery.matches)
    
    // リスナー登録
    mediaQuery.addEventListener('change', handleChange)
    
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [onThemeChange])
}