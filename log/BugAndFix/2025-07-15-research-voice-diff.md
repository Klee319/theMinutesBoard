# 不具合修正レポート 2025-07-15 (5)

## 不具合・エラーの概要
- リサーチタブの音声入力で、差分ではなくすべての会話履歴が送信されている
- sample.pngに示されるように、チャット欄に長い字幕の全文が表示されている

## STEP0. ゴール地点の確認
- 音声ボタンを押してから停止するまでの字幕差分のみをAIに送信
- チャット表示にはユーザー発言（差分）のみを表示
- API送信時は差分＋現在の議題の要約をコンテキストとして送信
- ボタンが押された時点で基準となる字幕を記録

## STEP1. 不具合発生箇所の調査

### 調査結果
- **ResearchVoiceButton** (/src/components/ResearchVoiceButton/index.tsx):
  - stopResponse.transcriptsを表示に使用している
- **background/index.ts**:
  - handleAIAssistantStop関数で差分計算は実装済み
  - startTranscriptIndexを使用してsliceで差分を取得
  - しかし、meetingIdの不一致により差分が正しく計算されていない可能性

### 原因の可能性
1. meetingIdとcurrentMeetingIdが異なる
2. startTranscriptIndexが0になっている
3. 実際の会議と異なるmeetingIdでセッションが作成されている

## STEP2. 原因の調査

### 根本原因
- viewerから渡されるmeetingIdと、実際に記録中のcurrentMeetingIdが異なる可能性が高い
- これにより、間違った会議のtranscriptsを参照し、startIndexが0になる

## STEP3. 修正案の検討

### 修正案
1. handleAIAssistantStartでcurrentMeetingIdを使用して正しいインデックスを取得
2. セッションにactualMeetingIdを保存
3. handleAIAssistantStopでもactualMeetingIdを使用

## STEP4. 修正案の実装

### 実装した修正内容

1. **background/index.ts**:
   - handleAIAssistantStart: currentMeetingIdを使用してインデックスを取得（行1998）
   - セッション定義にactualMeetingIdを追加（行1915）
   - セッション作成時にactualMeetingIdを保存（行2032）
   - handleAIAssistantStop: actualMeetingIdを使用して差分を計算（行2064）
   - デバッグログの強化