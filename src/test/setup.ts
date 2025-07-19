import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Chrome API のモックを設定
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    },
    getURL: vi.fn((path) => `chrome-extension://mock-extension-id/${path}`)
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      getBytesInUse: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      getBytesInUse: vi.fn()
    }
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  },
  windows: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn()
  }
} as any

// Blobのモック
global.Blob = class MockBlob {
  constructor(public parts: any[], public options: any = {}) {}
  
  get type() {
    return this.options.type || ''
  }
  
  get size() {
    return this.parts.join('').length
  }
  
  async text() {
    return this.parts.join('')
  }
  
  async arrayBuffer() {
    return new ArrayBuffer(this.size)
  }
  
  stream() {
    return {
      getReader() {
        return {
          read() {
            return Promise.resolve({ done: true, value: undefined })
          }
        }
      }
    }
  }
} as any

// テストごとにクリーンアップ
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})