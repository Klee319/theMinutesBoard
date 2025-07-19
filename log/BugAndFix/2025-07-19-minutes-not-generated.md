# 議事録が生成されない不具合の修正レポート

## 不具合・エラーの概要
- ネクストステップは生成されるが、MTG終了後議事録及びMTG中の議事録（セクション別時系列表記）が作成されない
- 以前は正常に動作していたが、現在は議事録が表示されない

## 考察した原因
1. 議事録生成のロジックに問題がある可能性
2. ストレージへの保存処理に問題がある可能性
3. AI処理のエラーハンドリングに問題がある可能性

## 実際に修正した原因
`background/index.ts`の`handleGenerateMinutes`関数において、`promptType`パラメータを受け取っているにも関わらず、実際のAIサービス呼び出し時（`enhancedService.generateMinutes`）に渡していないため、常にデフォルトプロンプトが使用されていた。

これにより：
- MTG中の議事録（live形式）が適切な形式で生成されない
- MTG終了後の議事録（history形式）も適切な形式で生成されない
- 結果として議事録が表示されない状態になっていた

## 修正内容と修正箇所

### 修正箇所
`/app/theMinutesBoard/src/background/index.ts` - 945-955行目

### 修正前
```typescript
const result = await enhancedService.generateMinutes(
  currentMeeting.transcripts,
  {
    enableFallback: true,
    retryConfig: {
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true
    }
  }
)
```

### 修正後
```typescript
const result = await enhancedService.generateMinutes(
  currentMeeting.transcripts,
  {
    enableFallback: true,
    retryConfig: {
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true
    },
    promptType: payload?.promptType || 'default'
  }
)
```

### 修正内容の詳細
1. `handleGenerateMinutes`関数が受け取った`payload.promptType`を`enhancedService.generateMinutes`のオプションに追加
2. これにより、ライブモード時は`LIVE_MINUTES_GENERATION_PROMPT`が使用される
3. 履歴モード時は`HISTORY_MINUTES_GENERATION_PROMPT`が使用される
4. 各プロンプトは異なる形式で議事録を生成するため、適切な表示が可能になる

## 追加調査（2025-07-19）

ログ分析により、以下の問題が判明：
1. promptTypeは正しく渡されており、LIVE_MINUTES_GENERATION_PROMPTが選択されている
2. しかし、プロンプト内のプレースホルダー説明にバッククォートが使用されているため、置換後に不正なマークダウンになっている
   - 例：`\`{{userName}}\`` → `\`不明な参加者\``
3. これによりAIが正しくプロンプトを解釈できず、期待される形式の議事録が生成されない可能性がある

## 追加修正案

### 問題点
1. system-prompts/index.tsのプロンプト内でバッククォートが使われているため、プレースホルダー置換後に不正なマークダウンになる
2. LiveMinutesPanelの正規表現が「▼」を期待しているが、生成される議事録に含まれない可能性

### 修正方針
1. プロンプトファイルを修正してバッククォートを削除
2. LiveMinutesPanelの正規表現をより柔軟にする（▼がなくても動作するように）

## 追加修正内容（2025-07-19）

### 修正ファイル
1. `/app/theMinutesBoard/src/system-prompts/live-minutes-generation.md`
2. `/app/theMinutesBoard/src/system-prompts/history-minutes-generation.md`
3. `/app/theMinutesBoard/src/system-prompts/minutes-generation.md`
4. `/app/theMinutesBoard/src/components/LiveMinutesPanel/index.tsx`

### 修正内容
1. **プロンプトファイルのバッククォート削除**
   - `\`{{userName}}\`` → `{{userName}}`
   - すべてのプレースホルダーからバッククォートを削除

2. **LiveMinutesPanelの正規表現修正**
   - topicRegex: `(.+?) ▼` → `(.+?)(?: ▼)?` （▼をオプショナルに）
   - digestMatch: `発言[▼▽]` → `発言[▼▽]?` （▼▽をオプショナルに）
   - statementsMatch: `発言[▼▽]` → `発言[▼▽]?` （▼▽をオプショナルに）
