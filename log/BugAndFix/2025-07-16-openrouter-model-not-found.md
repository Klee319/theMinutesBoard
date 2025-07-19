# OpenRouter モデル名エラー修正レポート

## 不具合・エラーの概要
日時: 2025-07-16
エラー内容:
- OpenRouter API error: 404 - No endpoints found for google/gemini-2.5-flash-preview
- 設定画面ではAPIキーが有効と表示されているが、実際のAPI呼び出しで404エラーが発生

## STEP0. ゴール地点の確認
- エラーの解消：正しいモデル名を使用してOpenRouter APIを正常に呼び出せるようにする
- 根本的な解決：ハードコードや単純な削除ではなく、適切なモデル名への修正を行う

## STEP1. 不具合発生箇所の調査
エラー発生箇所：
- factory.js:809 (ビルド後のソースマップ)
- 実際のソース：src/services/ai/openrouter.ts
- 具体的な箇所：generateMinutes関数内のAPI呼び出し（69行目でモデル名を設定）

## STEP2. 原因の調査
### 考察した原因
1. 存在しないモデル名「google/gemini-2.5-flash-preview」を使用していることが原因
2. OpenRouterで実際に利用可能なモデル名は「google/gemini-2.5-flash」
3. 過去に同様の修正が行われたが、まだ修正されていない箇所がある可能性

### 確認事項
- src/options/App.tsx の50-51行目：正しいモデル名「google/gemini-2.5-flash」が定義されている
- src/services/ai/openrouter.ts の24行目：デフォルトモデルは「anthropic/claude-3.5-sonnet」
- 実際のエラーでは「google/gemini-2.5-flash-preview」が使用されている

## STEP3. 修正案の検討

### 修正方針
1. OpenRouterService内で古いモデル名を新しいモデル名にマッピングする機能を追加
2. 「google/gemini-2.5-flash-preview」を「google/gemini-2.5-flash」に自動変換
3. この方法により：
   - 既存のユーザー設定を破壊しない
   - エラーを確実に解消する
   - 他の部分への影響を最小限にする
   - 将来的な同様の問題にも対応可能

### 要件の確認
- ✓ 解消する可能性が極めて高い：モデル名を正しいものに変換するため確実
- ✓ ユーザーの求める仕様通り：議事録生成機能が正常に動作する
- ✓ 修正箇所以外に影響が生じない：OpenRouterServiceクラス内のみの修正
- ✓ 実装可能：単純なマッピング処理の追加

## STEP4. 修正案の実装

### 実際に修正した原因
ユーザーの設定に古いモデル名「google/gemini-2.5-flash-preview」が保存されていたことが原因でした。
ユーザーが設定をリセットしたことで問題は解決しましたが、将来的な同様の問題を防ぐため、モデル名のマッピング機能を実装しました。

### 修正内容と修正箇所
1. **src/services/ai/openrouter.ts**
   - モデル名マッピング機能を追加（8-18行目）
   - generateMinutes関数でモデル名を正規化（29-35行目）
   - リクエストボディでselectedModelを使用するように修正（76行目）
   - generateContent関数でモデル名を正規化（186行目）
   - generateNextSteps関数でモデル名を正規化（244行目、257行目）
   - sendChatMessage関数でモデル名を正規化（315行目）
   - generateText関数でモデル名を正規化（347行目）

### 修正の効果
- 古いモデル名が設定に残っていても自動的に新しいモデル名に変換される
- 将来的にモデル名が変更された場合も、マッピングテーブルを更新するだけで対応可能
- ユーザーの既存設定を破壊することなく問題を解決

### 最終的な解決
ユーザーが設定をリセットしたことで、即座に問題は解決しました。
実装した修正により、今後同様の問題が発生することを防ぐことができます。