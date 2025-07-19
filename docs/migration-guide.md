# 移行ガイド

## v1.0からv2.0への移行

このガイドでは、theMinutesBoard v1.0からv2.0への移行手順を説明します。

## 主な変更点

### 1. A/Bテスト機能の追加

v2.0では、AIプロバイダーのA/Bテスト機能が追加されました。

#### 設定の移行

既存の設定は自動的に移行されますが、A/Bテストを有効にする場合は以下の手順を実行してください：

1. 設定画面を開く
2. 「A/Bテスト設定」セクションに移動
3. 「A/Bテストを有効にする」をチェック
4. テストバリアントを設定

#### コードの変更

カスタム実装をしている場合は、以下の変更が必要です：

**Before:**
```typescript
const service = new OpenAIService(apiKey)
```

**After:**
```typescript
const service = AIServiceFactory.createService(settings)
```

### 2. アクセシビリティの改善

v2.0では、WCAG 2.1 AA準拠のアクセシビリティ改善が行われました。

#### HTMLの変更

##### セマンティックHTML

**Before:**
```html
<div class="header">
  <div class="title">議事録</div>
</div>
```

**After:**
```html
<header role="banner">
  <h1 id="page-title">議事録</h1>
</header>
```

##### ARIA属性

すべてのインタラクティブ要素にARIA属性を追加：

**Before:**
```html
<button onClick={handleClick}>
  生成
</button>
```

**After:**
```html
<button 
  onClick={handleClick}
  aria-label="議事録を生成"
  aria-busy={isLoading}
>
  生成
</button>
```

#### CSSの変更

##### フォーカススタイル

カスタムCSSを使用している場合は、以下のフォーカススタイルを追加してください：

```css
*:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
```

##### カラーコントラスト

低コントラストの色を以下のように変更：

- `#9ca3af` (gray-400) → `#6b7280` (gray-500)
- `#fbbf24` (yellow-400) → `#d97706` (amber-600)

### 3. 型定義の更新

#### UserSettings

A/Bテスト関連のプロパティが追加されました：

```typescript
interface UserSettings {
  // 既存のプロパティ...
  
  // 新規追加
  abTestEnabled?: boolean
  abTestConfig?: ABTestConfig
}
```

#### NextStep

依存関係とソースプロパティが追加されました：

```typescript
interface NextStep {
  // 既存のプロパティ...
  
  // 新規追加
  dependencies: string[]
  source?: 'user' | 'ai'
}
```

## 移行手順

### ステップ1: バックアップ

移行前に必ずデータをバックアップしてください：

1. Chrome拡張機能の設定画面を開く
2. 「システム設定」→「データ管理」に移動
3. 「すべてのデータをエクスポート」をクリック

### ステップ2: 拡張機能の更新

1. Chrome Web Storeから最新版に更新
2. または、開発版の場合は最新のビルドをインストール

### ステップ3: 設定の確認

更新後、以下を確認してください：

1. APIキーが正しく移行されているか
2. カスタムプロンプトが保持されているか
3. エクスポート設定が正しいか

### ステップ4: 機能テスト

以下の機能が正常に動作することを確認：

- [ ] 議事録の生成
- [ ] ネクストステップの生成
- [ ] データのエクスポート
- [ ] キーボードショートカット
- [ ] スクリーンリーダーでのナビゲーション

## トラブルシューティング

### 問題: APIキーが消えた

**解決方法:**
1. Chrome同期が有効か確認
2. `chrome://extensions`で拡張機能の権限を確認
3. 設定画面で再度APIキーを入力

### 問題: カスタムスタイルが崩れた

**解決方法:**
新しいCSSクラスを使用するように更新：

```css
/* 旧クラス */
.panel-header → .nextsteps-header
.task-item → .nextstep-item

/* 新しいアクセシビリティクラス */
.sr-only /* スクリーンリーダー専用 */
.sr-only-focusable /* フォーカス時のみ表示 */
```

### 問題: A/Bテストが機能しない

**解決方法:**
1. 設定でA/Bテストが有効になっているか確認
2. 複数のAPIキーが設定されているか確認
3. テスト期間が正しく設定されているか確認

## 非推奨となった機能

### 1. 直接的なAIサービスインスタンス化

**非推奨:**
```typescript
const service = new GeminiService(apiKey)
```

**推奨:**
```typescript
const service = AIServiceFactory.createService(settings)
```

### 2. alert()によるエラー表示

**非推奨:**
```typescript
alert('エラーが発生しました')
```

**推奨:**
```typescript
announceToScreenReader('エラーが発生しました', 'assertive')
// またはトースト通知を使用
```

## サポート

移行に関する質問や問題がある場合は：

1. [GitHubのIssues](https://github.com/your-repo/issues)で報告
2. [ドキュメント](./README.md)を参照
3. [FAQ](./faq.md)を確認

## 今後の予定

### v2.1で予定されている機能

- リアルタイム協調編集
- 高度な検索機能
- カスタムAIモデルのサポート
- モバイルアプリ対応

### 廃止予定の機能

- 旧形式のエクスポート（v3.0で削除予定）
- レガシーAPIのサポート（v3.0で削除予定）