import React from 'react'

// 遅延読み込みのためのユーティリティ関数
export function lazyLoadComponent<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  componentName: string
) {
  return React.lazy(async () => {
    try {
      const module = await importFn()
      return { default: module.default }
    } catch (error) {
      console.error(`Failed to load component: ${componentName}`, error)
      // エラー時のフォールバックコンポーネント
      return {
        default: (() => (
          <div className="error-fallback">
            <p>コンポーネントの読み込みに失敗しました</p>
          </div>
        )) as T
      }
    }
  })
}

// Suspenseのフォールバックコンポーネント
export const LoadingFallback: React.FC = () => (
  <div className="loading-fallback flex items-center justify-center p-4">
    <div className="spinner"></div>
    <span className="ml-2">読み込み中...</span>
  </div>
)

// エラーバウンダリコンポーネント
interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary p-4 bg-red-50 border border-red-200 rounded">
          <h2 className="text-red-700 font-bold mb-2">エラーが発生しました</h2>
          <p className="text-red-600">{this.state.error?.message || '不明なエラー'}</p>
        </div>
      )
    }

    return this.props.children
  }
}