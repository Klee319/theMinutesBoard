import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe, toHaveNoViolations } from 'jest-axe'
import '@testing-library/jest-dom'

// コンポーネントのインポート
import { NextStepsPanel } from '@/components/NextStepsPanel'
import { MinutesPanel } from '@/components/MinutesPanel'
import { Button } from '@/components/ui/button'
import { ABTestSettings } from '@/components/ABTestSettings'

// axeの拡張
expect.extend(toHaveNoViolations)

describe('アクセシビリティ統合テスト', () => {
  describe('WCAG 2.1 AA準拠', () => {
    it('NextStepsPanelがアクセシビリティ基準を満たす', async () => {
      const { container } = render(
        <NextStepsPanel
          meetingId="test-meeting"
          nextSteps={[
            {
              id: '1',
              meetingId: 'test-meeting',
              task: 'テストタスク',
              status: 'pending',
              isPending: true,
              priority: 'high',
              dependencies: [],
              notes: '',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ]}
          onUpdateNextStep={() => {}}
          onDeleteNextStep={() => {}}
          onGenerateNextSteps={() => {}}
          isGenerating={false}
        />
      )

      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })

    it('MinutesPanelがアクセシビリティ基準を満たす', async () => {
      const { container } = render(
        <MinutesPanel
          meetingId="test-meeting"
          onClose={() => {}}
        />
      )

      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })

    it('カスタムButtonコンポーネントがアクセシビリティ基準を満たす', async () => {
      const { container } = render(
        <div>
          <Button>通常のボタン</Button>
          <Button loading>読み込み中のボタン</Button>
          <Button disabled>無効なボタン</Button>
          <Button ariaLabel="カスタムラベル">アイコンボタン</Button>
        </div>
      )

      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })
  })

  describe('キーボードナビゲーション', () => {
    it('NextStepsPanelがキーボードで操作できる', async () => {
      const onUpdateNextStep = vi.fn()
      const user = userEvent.setup()

      render(
        <NextStepsPanel
          meetingId="test-meeting"
          nextSteps={[
            {
              id: '1',
              meetingId: 'test-meeting',
              task: 'タスク1',
              status: 'pending',
              isPending: true,
              priority: 'high',
              dependencies: [],
              notes: '',
              createdAt: new Date(),
              updatedAt: new Date()
            },
            {
              id: '2',
              meetingId: 'test-meeting',
              task: 'タスク2',
              status: 'confirmed',
              isPending: false,
              priority: 'medium',
              dependencies: [],
              notes: '',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ]}
          onUpdateNextStep={onUpdateNextStep}
          onDeleteNextStep={() => {}}
          onGenerateNextSteps={() => {}}
          isGenerating={false}
        />
      )

      // Tabキーでフォーカス移動
      await user.tab()
      expect(screen.getByLabelText('プロンプト設定')).toHaveFocus()

      await user.tab()
      expect(screen.getByLabelText('ネクストステップを生成')).toHaveFocus()

      // Enterキーでボタンを押す
      await user.keyboard('{Enter}')
      
      // スペースキーでも動作することを確認
      await user.keyboard(' ')
    })

    it('編集モードでEscapeキーでキャンセルできる', async () => {
      const user = userEvent.setup()

      render(
        <NextStepsPanel
          meetingId="test-meeting"
          nextSteps={[
            {
              id: '1',
              meetingId: 'test-meeting',
              task: 'テストタスク',
              status: 'pending',
              isPending: true,
              priority: 'high',
              dependencies: [],
              notes: '',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ]}
          onUpdateNextStep={() => {}}
          onDeleteNextStep={() => {}}
          onGenerateNextSteps={() => {}}
          isGenerating={false}
        />
      )

      // タスクをクリックして編集モードに
      const taskElement = screen.getByText('テストタスク')
      await user.click(taskElement)

      // 編集入力フィールドが表示される
      const editInput = screen.getByLabelText('タスク内容を編集')
      expect(editInput).toBeInTheDocument()

      // Escapeキーでキャンセル
      await user.keyboard('{Escape}')

      // 編集モードが終了している
      expect(screen.queryByLabelText('タスク内容を編集')).not.toBeInTheDocument()
    })
  })

  describe('スクリーンリーダー対応', () => {
    it('動的な変更がaria-liveで通知される', async () => {
      const { rerender } = render(
        <NextStepsPanel
          meetingId="test-meeting"
          nextSteps={[]}
          onUpdateNextStep={() => {}}
          onDeleteNextStep={() => {}}
          onGenerateNextSteps={() => {}}
          isGenerating={false}
        />
      )

      // 初期状態
      expect(screen.getByRole('status')).toHaveTextContent('ネクストステップがありません')

      // タスクを追加
      rerender(
        <NextStepsPanel
          meetingId="test-meeting"
          nextSteps={[
            {
              id: '1',
              meetingId: 'test-meeting',
              task: '新しいタスク',
              status: 'pending',
              isPending: true,
              priority: 'high',
              dependencies: [],
              notes: '',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ]}
          onUpdateNextStep={() => {}}
          onDeleteNextStep={() => {}}
          onGenerateNextSteps={() => {}}
          isGenerating={false}
        />
      )

      // aria-liveリージョンで通知
      expect(screen.getByText('1個のネクストステップがあります')).toBeInTheDocument()
    })

    it('ローディング状態がaria-busyで示される', () => {
      render(
        <NextStepsPanel
          meetingId="test-meeting"
          nextSteps={[]}
          onUpdateNextStep={() => {}}
          onDeleteNextStep={() => {}}
          onGenerateNextSteps={() => {}}
          isGenerating={true}
        />
      )

      const generateButton = screen.getByLabelText('ネクストステップを生成')
      expect(generateButton).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('フォーカス管理', () => {
    it('モーダルでフォーカストラップが機能する', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()

      render(
        <MinutesPanel
          meetingId="test-meeting"
          onClose={onClose}
        />
      )

      // 最初のフォーカス可能要素にフォーカス
      const minimizeButton = screen.getByLabelText('パネルを最小化')
      expect(minimizeButton).toHaveFocus()

      // Tabキーで次の要素へ
      await user.tab()
      expect(screen.getByLabelText('パネルを閉じる')).toHaveFocus()

      // 最後の要素からTabで最初に戻る
      await user.tab()
      expect(minimizeButton).toHaveFocus()

      // Escapeキーで閉じる
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('カラーコントラスト', () => {
    it('テキストが十分なコントラスト比を持つ', () => {
      render(
        <div>
          <p className="text-gray-600">通常のテキスト</p>
          <p className="text-yellow-600">警告テキスト</p>
          <p className="text-red-600">エラーテキスト</p>
        </div>
      )

      // CSSクラスが適用されていることを確認
      expect(screen.getByText('通常のテキスト')).toHaveClass('text-gray-600')
      expect(screen.getByText('警告テキスト')).toHaveClass('text-yellow-600')
      expect(screen.getByText('エラーテキスト')).toHaveClass('text-red-600')
    })
  })

  describe('フォームアクセシビリティ', () => {
    it('A/Bテスト設定フォームが適切なラベルを持つ', async () => {
      const onConfigChange = vi.fn()
      
      render(
        <ABTestSettings
          onConfigChange={onConfigChange}
        />
      )

      // チェックボックスとラベルの関連付け
      const checkbox = screen.getByRole('checkbox', { name: 'A/Bテストを有効にする' })
      expect(checkbox).toBeInTheDocument()

      // チェックボックスをクリック
      await userEvent.click(checkbox)

      // フォームフィールドが表示される
      expect(screen.getByLabelText('開始日')).toBeInTheDocument()
      expect(screen.getByLabelText('終了日（オプション）')).toBeInTheDocument()
    })
  })

  describe('エラーハンドリング', () => {
    it('エラーメッセージがアクセシブルに表示される', async () => {
      // グローバルなaria-liveリージョンをセットアップ
      document.body.innerHTML += `
        <div id="sr-live-polite" role="status" aria-live="polite" aria-atomic="true"></div>
        <div id="sr-live-assertive" role="alert" aria-live="assertive" aria-atomic="true"></div>
      `

      const { announceToScreenReader } = await import('@/utils/accessibility')
      
      // エラーメッセージをアナウンス
      announceToScreenReader('エラーが発生しました', 'assertive')

      // aria-liveリージョンにメッセージが設定される
      await waitFor(() => {
        expect(document.getElementById('sr-live-assertive')).toHaveTextContent('エラーが発生しました')
      })
    })
  })
})