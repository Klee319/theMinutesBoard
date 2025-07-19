import React, { ReactElement, ReactNode } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { vi } from 'vitest'

// カスタムレンダー関数
const AllTheProviders = ({ children }: { children: ReactNode }) => {
  return <>{children}</>
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllTheProviders, ...options })

// Chrome API のモックヘルパー
export const mockChromeStorage = {
  local: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}

export const mockChromeRuntime = {
  sendMessage: vi.fn().mockResolvedValue({}),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
  getURL: vi.fn((path: string) => `chrome-extension://mock-extension-id/${path}`),
}

// テストデータ生成ヘルパー
export const createMockTranscript = (overrides = {}) => ({
  id: 'test-id',
  speaker: 'Test Speaker',
  content: 'Test content',
  timestamp: new Date().toISOString(),
  meetingId: 'test-meeting-id',
  ...overrides,
})

export const createMockNextStep = (overrides = {}) => ({
  id: 'test-step-id',
  task: 'Test task',
  assignee: 'Test assignee',
  deadline: '2025-12-31',
  priority: 'medium' as const,
  status: 'pending' as const,
  ...overrides,
})

export const createMockMeeting = (overrides = {}) => ({
  id: 'test-meeting-id',
  title: 'Test Meeting',
  startTime: new Date().toISOString(),
  endTime: new Date(Date.now() + 3600000).toISOString(),
  participants: ['participant1', 'participant2'],
  ...overrides,
})

// 時間関連のモックヘルパー
export const mockDate = (date: string) => {
  const mockedDate = new Date(date)
  vi.setSystemTime(mockedDate)
  return mockedDate
}

// 非同期処理のテストヘルパー
export const waitForNextTick = () => new Promise(resolve => setTimeout(resolve, 0))

// LocalStorage モック
export const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}

// AI プロバイダーのモック
export const mockAIProvider = {
  generateMinutes: vi.fn().mockResolvedValue('Generated minutes'),
  generateDigest: vi.fn().mockResolvedValue('Generated digest'),
  processChat: vi.fn().mockResolvedValue('AI response'),
  processResearch: vi.fn().mockResolvedValue('Research results'),
}

// re-export everything
export * from '@testing-library/react'
export { customRender as render }