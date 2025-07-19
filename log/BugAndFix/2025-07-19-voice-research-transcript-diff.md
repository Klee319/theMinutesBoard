# 音声リサーチ字幕差分送信バグ修正レポート

日付: 2025-07-19

## 問題の概要
リサーチタブの音声ボタンで、録音中にキャプチャした字幕の差分のみを送信すべきところ、会議全体の字幕が送信されていた。

## 問題の詳細

### 報告された症状
1. 音声ボタンを2度押す間に増えた字幕ではなく、会議の全内容がチャットに送信されてしまう
2. AIへの指示は録音中の差分字幕のみにすべき
3. 現在の議題の要約をコンテキストとして送信する必要がある

### 調査結果

#### 1. ResearchVoiceButton（リサーチタブ）
- **実装状態**: 正しく実装されていた
- `AI_ASSISTANT_STOP`から返される差分字幕を`AI_RESEARCH`に正しく渡していた

#### 2. AIAssistantButton（ネクストステップタブ）
- **実装状態**: 問題があった
- `AI_ASSISTANT_PROCESS`ハンドラーで、セッションの差分字幕を使用せず、会議全体の最後の50件を取得していた

#### 3. AI_ASSISTANT_PROCESSハンドラー
- **問題点**: AIアシスタントセッションから差分字幕を取得するロジックが欠けていた
- 代わりに`meeting.transcripts`から最新50件を取得していた

## 修正内容

### 1. AI_ASSISTANT_PROCESSハンドラーの修正
**ファイル**: `/app/theMinutesBoard/src/background/index.ts`

```typescript
// 修正前
const recentTranscripts = meeting.transcripts
  .slice(-50)
  .map(t => `${t.speaker}: ${t.content}`)
  .join('\n')

// 修正後
// AIアシスタントセッションから差分字幕を取得
const session = aiAssistantSessions.get(meetingId)
let transcriptsForAI = ''

if (session && session.transcripts) {
  // セッションに保存された差分字幕を使用
  transcriptsForAI = session.transcripts
    .map(t => `${t.speaker}: ${t.content}`)
    .join('\n')
  logger.info(`Using session transcripts for next steps: ${session.transcripts.length} transcripts`)
} else {
  // フォールバック: セッションがない場合は録音時間に基づいて推定
  const recordingDuration = payload.recordingDuration || 60
  const endTime = new Date()
  const startTime = new Date(endTime.getTime() - recordingDuration * 1000)
  
  const filteredTranscripts = meeting.transcripts.filter(t => {
    const transcriptTime = new Date(t.timestamp)
    return transcriptTime >= startTime && transcriptTime <= endTime
  })
  
  transcriptsForAI = filteredTranscripts
    .map(t => `${t.speaker}: ${t.content}`)
    .join('\n')
  logger.warn(`Fallback: Using estimated transcripts based on recording duration: ${filteredTranscripts.length} transcripts`)
}
```

### 2. 処理完了後のセッションクリーンアップ追加
```typescript
// 処理完了後、セッションをクリーンアップ
if (session) {
  aiAssistantSessions.delete(meetingId)
  logger.info(`Cleaned up AI assistant session for meeting: ${meetingId}`)
}
```

## 現在の議題要約の送信について
調査の結果、`handleAiResearch`関数では既に現在の議題の要約を取得してコンテキストとして送信する実装が含まれていることを確認：

1. 議事録から現在の議題の要約を取得
   - ライブダイジェストがある場合はその要約を使用
   - ない場合は最新の議題の要約を使用
2. リサーチプロンプトに`[CONTEXT: ${currentTopicSummary}]`として追加

## 修正後の動作フロー

### 音声録音開始時（AI_ASSISTANT_START）
1. 現在の字幕インデックスを記録
2. AIアシスタントセッションを作成

### 音声録音停止時（AI_ASSISTANT_STOP）
1. 開始時のインデックスから現在までの差分字幕を取得
2. セッションに差分字幕を保存
3. 差分字幕を返す

### AI処理時
- **AI_RESEARCH**（リサーチタブ）: 正しく動作していた
- **AI_ASSISTANT_PROCESS**（ネクストステップタブ）: 修正により、セッションから差分字幕を取得するように変更

## 検証ポイント
1. 音声録音中にキャプチャされた字幕のみがAIに送信されることを確認
2. 現在の議題の要約がコンテキストとして含まれることを確認
3. セッションが適切にクリーンアップされることを確認

## 今後の推奨事項
1. 両方のAIハンドラー（`AI_RESEARCH`と`AI_ASSISTANT_PROCESS`）で共通の差分字幕取得ロジックを使用することを検討
2. セッションタイムアウトの実装を検討（長時間放置された場合の自動クリーンアップ）