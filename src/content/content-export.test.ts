import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { JSDOM } from 'jsdom'

// Blob と URL のモック
global.Blob = class Blob {
  content: string[]
  type: string

  constructor(content: string[], options?: { type?: string }) {
    this.content = content
    this.type = options?.type || ''
  }

  text() {
    return Promise.resolve(this.content.join(''))
  }

  get size() {
    return this.content.join('').length
  }
}

global.URL = {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn()
} as any

describe('ContentScript エクスポート機能', () => {
  let dom: JSDOM
  let document: Document
  let createElementSpy: Mock
  let clickSpy: Mock

  beforeEach(() => {
    // DOM環境のセットアップ
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://meet.google.com/xxx-yyyy-zzz'
    })
    document = dom.window.document
    global.document = document as any
    global.window = dom.window as any

    // createElementのモック
    clickSpy = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement')
    createElementSpy.mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName)
      if (tagName === 'a') {
        element.click = clickSpy
      }
      return element
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('exportMinutes', () => {
    // ContentScriptクラスの簡易実装
    class ContentScriptMock {
      private showNotification(message: string, type: string) {
        // 通知のモック実装
      }

      private exportMinutes(minutes: any, format: string) {
        let content = ''
        let filename = `minutes_${new Date().toISOString().split('T')[0]}`
        let mimeType = ''
        
        switch (format) {
          case 'markdown':
            content = minutes.content
            filename += '.md'
            mimeType = 'text/markdown'
            break
          case 'txt':
            content = minutes.content.replace(/[#*`]/g, '')
            filename += '.txt'
            mimeType = 'text/plain'
            break
        }
        
        const blob = new Blob([content], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        
        this.showNotification(`${format.toUpperCase()}ファイルをダウンロードしました`, 'success')
      }

      // テスト用のpublicメソッド
      testExportMinutes(minutes: any, format: string) {
        this.exportMinutes(minutes, format)
      }
    }

    let contentScript: ContentScriptMock

    beforeEach(() => {
      contentScript = new ContentScriptMock()
    })

    it('Markdown形式でエクスポートできる', () => {
      const minutes = {
        content: '# 会議議事録\n\n## 議題\n- テスト項目1\n- テスト項目2',
        title: 'テスト会議'
      }

      contentScript.testExportMinutes(minutes, 'markdown')

      // Blobが正しく作成されたか
      expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
      
      // リンク要素が作成されたか
      expect(createElementSpy).toHaveBeenCalledWith('a')
      
      // ダウンロードがトリガーされたか
      expect(clickSpy).toHaveBeenCalled()
      
      // URLが解放されたか
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })

    it('テキスト形式でエクスポートできる', () => {
      const minutes = {
        content: '# 会議議事録\n\n## 議題\n- テスト項目1\n- テスト項目2',
        title: 'テスト会議'
      }

      contentScript.testExportMinutes(minutes, 'txt')

      // Blobが正しく作成されたか
      const blobCall = (URL.createObjectURL as Mock).mock.calls[0][0]
      expect(blobCall).toBeInstanceOf(Blob)
      expect(blobCall.type).toBe('text/plain')
      
      // Markdownの記号が除去されているか
      const content = blobCall.content[0]
      expect(content).not.toContain('#')
      expect(content).not.toContain('*')
      expect(content).not.toContain('`')
    })

    it('ファイル名に正しい日付が含まれる', () => {
      const minutes = {
        content: 'テスト内容',
        title: 'テスト会議'
      }

      const today = new Date().toISOString().split('T')[0]
      contentScript.testExportMinutes(minutes, 'markdown')

      // 作成されたリンク要素を取得
      const lastCall = createElementSpy.mock.calls.find(call => call[0] === 'a')
      expect(lastCall).toBeTruthy()
      
      const anchorElement = createElementSpy.mock.results.find(
        result => result.value.tagName === 'A'
      )?.value

      expect(anchorElement.download).toContain(today)
      expect(anchorElement.download).toContain('.md')
    })

    it('大量のテキストでもエクスポートできる', () => {
      const largeContent = 'A'.repeat(100000) // 100KB のテキスト
      const minutes = {
        content: largeContent,
        title: 'Large Meeting'
      }

      contentScript.testExportMinutes(minutes, 'markdown')

      const blobCall = (URL.createObjectURL as Mock).mock.calls[0][0]
      expect(blobCall.size).toBe(100000)
      expect(clickSpy).toHaveBeenCalled()
    })

    it('特殊文字を含む内容でもエクスポートできる', () => {
      const minutes = {
        content: '特殊文字テスト: <>&"\'\\n改行\tタブ',
        title: 'Special Chars'
      }

      contentScript.testExportMinutes(minutes, 'txt')

      const blobCall = (URL.createObjectURL as Mock).mock.calls[0][0]
      const content = blobCall.content[0]
      
      // 特殊文字が保持されているか
      expect(content).toContain('<>&"\'')
      expect(content).toContain('改行')
      expect(content).toContain('タブ')
    })

    it('空の議事録でもエクスポートできる', () => {
      const minutes = {
        content: '',
        title: 'Empty Meeting'
      }

      expect(() => {
        contentScript.testExportMinutes(minutes, 'markdown')
      }).not.toThrow()

      expect(clickSpy).toHaveBeenCalled()
    })
  })

  describe('パフォーマンステスト', () => {
    class ContentScriptMock {
      private exportMinutes(minutes: any, format: string) {
        let content = ''
        let filename = `minutes_${new Date().toISOString().split('T')[0]}`
        let mimeType = ''
        
        switch (format) {
          case 'markdown':
            content = minutes.content
            filename += '.md'
            mimeType = 'text/markdown'
            break
          case 'txt':
            content = minutes.content.replace(/[#*`]/g, '')
            filename += '.txt'
            mimeType = 'text/plain'
            break
        }
        
        const blob = new Blob([content], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      }

      testExportMinutes(minutes: any, format: string) {
        this.exportMinutes(minutes, format)
      }
    }

    it('1MBの議事録を100ms以内にエクスポートできる', () => {
      const contentScript = new ContentScriptMock()
      const largeContent = 'A'.repeat(1024 * 1024) // 1MB
      const minutes = {
        content: largeContent,
        title: 'Large Meeting'
      }

      const startTime = performance.now()
      contentScript.testExportMinutes(minutes, 'markdown')
      const endTime = performance.now()

      expect(endTime - startTime).toBeLessThan(100)
      expect(clickSpy).toHaveBeenCalled()
    })

    it('10MBの議事録を1秒以内にエクスポートできる', () => {
      const contentScript = new ContentScriptMock()
      const largeContent = 'A'.repeat(10 * 1024 * 1024) // 10MB
      const minutes = {
        content: largeContent,
        title: 'Very Large Meeting'
      }

      const startTime = performance.now()
      contentScript.testExportMinutes(minutes, 'txt')
      const endTime = performance.now()

      expect(endTime - startTime).toBeLessThan(1000)
      expect(clickSpy).toHaveBeenCalled()
    })
  })
})