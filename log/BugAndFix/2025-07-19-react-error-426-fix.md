# React Error #426 修正レポート

## 不具合・エラーの概要
React Error #426が`src/viewer/viewer.html?mode=history`で発生。
このエラーは「コンポーネントが同期的な入力に応答している間にサスペンド（一時停止）した」ことを示す。

エラーメッセージ：
```
Error: Minified React error #426; visit https://reactjs.org/docs/error-decoder.html?invariant=426 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
```

## STEP0: ゴール地点の確認
- React Error #426を解消する
- NextStepsBoardコンポーネントが正常にレンダリングされるようにする
- 同期的な入力処理中のサスペンドを防ぐ

## STEP1: 不具合発生箇所の調査
調査結果：
- 発生場所：`src/viewer/viewer.html?mode=history`
- NextStepsBoardコンポーネントがReact.memoでラップされている
- handleStatusChangeメソッド内での状態更新がサスペンドを引き起こしている可能性

## STEP2: 原因の調査
考察した原因：
1. NextStepsBoardコンポーネント内のhandleStatusChange関数で、同期的なボタンクリック処理中に状態更新が行われている
2. setAllNextStepsとsetFilterの状態更新が同期的に実行されている
3. React 18の並行レンダリング機能により、これらの更新がサスペンドを引き起こしている

## STEP3: 修正案の検討
修正方針：
1. startTransitionを使用して、状態更新を低優先度の更新として扱う
2. handleStatusChange、handleDeletePermanently内の状態更新をstartTransitionでラップ
3. 既存のReact.memoは維持（パフォーマンス最適化のため）

## STEP4: 修正案の実装

### 実際に修正した内容

**NextStepsBoard/index.tsx**

1. ReactからstartTransitionをインポート：
```typescript
import React, { useState, useEffect, startTransition } from 'react'
```

2. handleStatusChange内の状態更新をstartTransitionでラップ（136-156行目）：
```typescript
if (response.success) {
  // ローカル状態を更新をstartTransitionでラップ
  startTransition(() => {
    setAllNextSteps(prev => prev.map(s => 
      s.id === stepId && s.meetingId === meetingId 
        ? { ...s, ...updates, updatedAt: new Date() }
        : s
    ))
    
    // 新しい状態に応じてフィルターを自動切り替え
    switch (newStatus) {
      case 'pending':
        setFilter('pending')
        break
      case 'in_progress':
        setFilter('in_progress')
        break
      case 'completed':
        setFilter('completed')
        break
    }
  })
}
```

3. handleDeletePermanently内の状態更新をstartTransitionでラップ（279-284行目）：
```typescript
if (response.success) {
  // ローカル状態から削除をstartTransitionでラップ
  startTransition(() => {
    setAllNextSteps(prev => prev.filter(s => 
      !(s.id === stepId && s.meetingId === meetingId)
    ))
  })
}
```

## 修正内容と修正箇所

- **React Error #426の解決**: startTransitionを使用して同期的な入力処理中のコンポーネントサスペンドを回避
- **修正箇所**: NextStepsBoard/index.tsx
  - startTransitionのインポート追加
  - handleStatusChange関数内の状態更新処理
  - handleDeletePermanently関数内の状態更新処理

これにより、ユーザーがボタンをクリックした際の状態更新が低優先度の更新として扱われ、UIのサスペンドを防ぐことができます。

## 追加調査と修正（2回目）

前回の修正では解決されなかったため、さらに調査を実施。

### 根本原因の特定
- NextStepsBoardコンポーネントが動的インポート（React.lazy）で読み込まれている
- viewer/App.tsx内でNextStepsBoardがSuspenseでラップされていない
- これにより、コンポーネントのロード中にサスペンドが発生し、Error #426が発生

### 修正方針
すべての動的インポートされたコンポーネントをSuspenseでラップして、適切なフォールバックUIを提供する。

### 実際に修正した内容（2回目）

**viewer/App.tsx**

1. NextStepsBoardをSuspenseでラップ（612-614行目）：
```tsx
{!isLiveMode && currentTab === 'nextsteps' && (
  <div className="h-[calc(100vh-120px)]">
    <Suspense fallback={<LoadingFallback />}>
      <NextStepsBoard meetings={allMeetings} />
    </Suspense>
  </div>
)}
```

2. LiveModeLayoutをSuspenseでラップ（621-631行目）：
```tsx
<ErrorBoundary>
  <Suspense fallback={<LoadingFallback />}>
    <LiveModeLayout ... />
  </Suspense>
</ErrorBoundary>
```

3. ResizablePanelをSuspenseでラップ（639-693行目、770-781行目）：
- 履歴サイドバーのResizablePanel
- ネクストステップパネルのResizablePanel

4. KeyboardShortcutsHelpをSuspenseでラップ（790-796行目）

これにより、すべての動的インポートコンポーネントが適切にSuspenseでラップされ、ロード中のサスペンドが正しく処理されるようになりました。