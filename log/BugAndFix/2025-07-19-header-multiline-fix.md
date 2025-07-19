# ライブ表示画面ヘッダー複数行表示の修正

## 不具合・エラーの概要
- 記録中のライブ表示画面におけるヘッダーが1行分の高さになっていない
- ヘッダーが複数行になってしまっている（sample.pngで確認）

## STEP0. ゴール地点の確認
- ヘッダーを1行の高さに収める
- すべての要素が横並びになるようレイアウトを修正
- レスポンシブ性を保ちつつ、標準的な画面幅では1行表示を維持

## STEP1. 不具合発生箇所の調査
- LiveModeLayoutコンポーネントで各パネル（議事録、ネクストステップ、リサーチ）を表示
- ヘッダー部分は各パネルコンポーネント内で定義されている
- ライブ表示画面はLiveModeLayout内でパネルとして表示されている
- **具体的な問題箇所**: LiveMinutesPanel/index.tsx の238行目
  - ヘッダーの高さが固定されていない
  - flexレイアウトの要素がwrapしている可能性がある

## STEP2. 原因の調査
### 考察した原因
- ヘッダー内の要素が横幅不足で折り返されている
- flexコンテナに`flex-wrap`プロパティがないため、デフォルトで折り返しが許可されている
- 自動更新情報とボタンが同じ行に収まらない
- 最小幅が確保されていない

### 確実な原因
- LiveMinutesPanel:238行目のヘッダーdivにflex-wrapの指定がなく、要素が折り返される
- 画面幅が狭い場合に要素が2行になってしまう

## STEP3. 修正案の検討
### 修正方針
1. ヘッダーに`flex-nowrap`を追加して折り返しを防ぐ
2. タイトルと自動更新情報を短縮して幅を節約
3. 高さを固定して1行に収める
4. overflow処理を追加して要素が確実に1行に収まるようにする

### 選択した方針
- 上記の方針1, 3, 4を採用
- flex-nowrapで折り返しを防ぎ、高さを固定し、必要に応じてoverflow処理を行う
- この方法により1行表示を強制できる

## STEP4. 修正案の実装

### 実際に修正した内容
以下の3つのパネルコンポーネントのヘッダーを修正：

1. **LiveMinutesPanel** (/src/components/LiveMinutesPanel/index.tsx)
   - 238行目：`flex-nowrap`を追加、高さを固定（h-16, min-h-[64px], max-h-[64px]）、`overflow-hidden`を追加
   - 239行目：`flex-shrink-0`を追加
   - 240行目：`whitespace-nowrap`を追加
   - 242行目：自動更新情報に`whitespace-nowrap`を追加
   - 260行目：ボタン部分に`flex-shrink-0`を追加

2. **LiveNextStepsPanel** (/src/components/LiveNextStepsPanel/index.tsx)
   - 183行目：同様のヘッダー修正を適用
   - 187行目：自動更新情報に`whitespace-nowrap`を追加
   - 201行目：ボタン部分に`flex-shrink-0`を追加

3. **ResearchPanel** (/src/components/ResearchPanel/index.tsx)
   - 192行目：同様のヘッダー修正を適用
   - 194行目：タイトルに`whitespace-nowrap`と`flex-shrink-0`を追加
   - 196行目：右側の要素グループに`flex-shrink-0`を追加
   - 198行目：Web検索トグルに`whitespace-nowrap`を追加

### 修正内容と修正箇所
- **修正ポイント**：
  - `flex-nowrap`：要素の折り返しを防ぐ
  - 高さの固定：`h-16 min-h-[64px] max-h-[64px]`で1行の高さを強制
  - `overflow-hidden`：内容がはみ出した場合に隠す
  - `flex-shrink-0`：要素が縮小されるのを防ぐ
  - `whitespace-nowrap`：テキストの折り返しを防ぐ

## 最終結果
- 修正完了：2025-07-19
- ヘッダーが確実に1行に収まるよう修正完了
- すべてのライブ表示パネルで統一されたヘッダー高さを実現