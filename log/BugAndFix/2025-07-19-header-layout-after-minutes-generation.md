# ライブ議事録生成後のヘッダーレイアウト崩れ問題

## 不具合・エラーの概要
ライブ議事録生成後にヘッダーの体裁が崩れる不具合が発生。具体的には、sample.png（正常時：ヘッダー要素が水平に適切に配置）からsample2.png（不具合時：ヘッダー要素が垂直に折り返されて表示）のようになってしまう。

## 調査内容

### 過去の類似バグ確認
- 2025-07-19-header-multiline-fix.md: flex-nowrapの指定不足による折り返し問題
- 2025-07-19-header-layout-after-generate.md: 更新ボタンの幅変動によるレイアウト崩れ
- 2025-07-19-live-display-header-layout.md: 条件付きレンダリングによるレイアウトシフト

### 問題箇所の特定
1. App.tsx（424-602行目）のメインヘッダー部分
   - ライブモード時のトグルスイッチエリアが固定幅を持たない
   - ボタンエリアに横幅の制約がない

2. 各パネルコンポーネントのヘッダー
   - LiveMinutesPanel: 自動更新表示の幅制御が不十分
   - LiveNextStepsPanel: 条件付きレンダリングによる幅変動
   - ResearchPanel: Web検索トグルの状態変化時の影響

## 考察した原因
1. **メインヘッダーの問題**
   - ライブモード時のトグルスイッチエリア（476-520行目）に固定幅がない
   - 議事録生成時に表示内容が変化し、全体の幅が変動する
   - flexコンテナの制約が不十分で、要素が折り返される

2. **動的コンテンツによる幅変動**
   - 「🔄 更新」→「更新中...」の切り替え時のボタン幅変化
   - 自動更新カウントダウンの桁数変化
   - スピナーアイコンの追加による高さの変動

## 実際に修正した原因
メインヘッダー（App.tsx）のライブモードトグルスイッチエリアに固定幅が設定されていないため、議事録生成後の状態変化によりヘッダー全体の幅が変動し、要素が垂直に折り返されてしまう。

## 修正内容と修正箇所

### App.tsx の修正（第1回）
1. **ヘッダーのflexコンテナに`flex-nowrap`を追加**（427行目）
   ```tsx
   <div className="flex items-center justify-between flex-nowrap">
   ```

2. **ライブモードトグルスイッチエリアの修正**（477-524行目）
   - 条件付きレンダリングを`visibility`制御に変更
   - `minWidth: '400px'`を設定してレイアウトシフトを防ぐ
   - 各要素に`whitespace-nowrap`と`flex-shrink-0`を追加

### App.tsx の追加修正（第2回）
問題が継続したため、より強力な制約を追加：

1. **ヘッダー要素自体に高さ制約を追加**（425行目）
   ```tsx
   <header className="bg-white dark:bg-gray-800 shadow-sm border-b dark:border-gray-700 h-16 min-h-[64px] max-h-[64px] overflow-hidden" role="banner">
   ```

2. **ヘッダー内部のコンテナ修正**（426-427行目）
   ```tsx
   <div className="max-w-7xl mx-auto px-4 h-full flex items-center">
     <div className="flex items-center justify-between flex-nowrap w-full">
   ```

3. **右側ボタンエリアの高さ制約削除**（475行目）
   ```tsx
   <div className="flex items-center gap-4 flex-shrink-0">
   ```

4. **「表示/非表示切り替え：」テキストに折り返し防止を追加**（484行目）
   ```tsx
   <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">表示/非表示切り替え：</span>
   ```

これらの修正により、ヘッダー全体が確実に1行の高さに制限され、コンテンツの折り返しが完全に防止されるようになった。