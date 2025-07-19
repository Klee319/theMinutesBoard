# 議事録が表示されない不具合の修正レポート

## 不具合・エラーの概要
- 議事録生成は成功しているが、UIに表示されない
- ライブモードで議事録を生成しても、LiveMinutesPanelに議事録が表示されない

## 考察した原因
1. 議事録生成後の`MINUTES_GENERATED`メッセージは正しく送信されている
2. Viewer App.tsxで`loadData()`が呼び出されている
3. しかし、`loadData`関数内で`isLiveMode`がfalseの場合、`currentMeeting`が更新されない
4. ログから`isLiveMode: false`の状態でデータ読み込みが行われていることを確認

## 実際に修正した原因
1. 初回修正：`src/viewer/App.tsx`の`loadData`関数において、`isLiveMode`の条件を削除
2. 追加調査で判明した問題：
   - デバッグログから`hasMinutes: true`だが`minutesContentLength: 0`と判明
   - 議事録オブジェクトは存在するが、contentプロパティが空
3. 根本原因：
   - `background/index.ts`の959行目で`result.text`を使用
   - 実際のAIサービスは`Minutes`オブジェクトを返すため、`result.content`を使うべき

## 修正内容と修正箇所

### 修正箇所
`/app/theMinutesBoard/src/viewer/App.tsx` - 282行目付近

### 修正前
```typescript
if (result.currentMeetingId && isLiveMode) {
  const current = meetings.find((m: Meeting) => m.id === result.currentMeetingId)
  if (current) {
    logger.debug('Current meeting found:', current.id)
    setCurrentMeeting(current)
    setLastUpdated(new Date())
    // 議事録生成完了を検知
    if (current.minutes && isMinutesGenerating) {
      setIsMinutesGenerating(false)
    }
  }
}
```

### 修正後
```typescript
if (result.currentMeetingId) {
  const current = meetings.find((m: Meeting) => m.id === result.currentMeetingId)
  if (current) {
    logger.debug('Current meeting found:', current.id)
    setCurrentMeeting(current)
    setLastUpdated(new Date())
    // 議事録生成完了を検知
    if (current.minutes && isMinutesGenerating) {
      setIsMinutesGenerating(false)
    }
  }
}
```

### 修正内容の詳細
1. `isLiveMode`の条件を削除し、`currentMeetingId`が存在する場合は常に`currentMeeting`を更新するように変更
2. これにより、議事録生成後のデータ再読み込み時に、モードに関わらず最新のデータがUIに反映される

## 追加調査（第2回）

### デバッグログの追加
議事録データのフローを追跡するため、以下の箇所にデバッグログを追加：

1. `/app/theMinutesBoard/src/viewer/App.tsx` - 619-623行目
   - LiveModeLayoutレンダリング時のcurrentMeetingの状態をログ出力

2. `/app/theMinutesBoard/src/viewer/App.tsx` - 286-291行目
   - loadData関数で読み込まれたcurrentMeetingの議事録データをログ出力

3. `/app/theMinutesBoard/src/components/LiveMinutesPanel/index.tsx` - 149-154行目
   - LiveMinutesPanelのuseEffectでmeetingプロパティの状態をログ出力

### デバッグログの目的
- 議事録データが正しくロードされているか確認
- コンポーネント間でデータが正しく渡されているか確認
- データが存在するのに表示されない原因を特定

## 最終修正内容

### 修正箇所2
`/app/theMinutesBoard/src/background/index.ts` - 960行目

### 修正前
```typescript
const minutes = {
  content: result.text,
  generatedAt: new Date(),
  provider: mergedSettings.aiProvider
}
```

### 修正後
```typescript
const minutes = {
  content: result.content,
  generatedAt: new Date(),
  provider: mergedSettings.aiProvider
}
```

### 修正内容の詳細
1. AIサービスから返される`Minutes`オブジェクトのプロパティ名が`content`であるのに、`text`を参照していた
2. これにより議事録オブジェクトは作成されるが、content が undefined になっていた
3. `result.content`に修正することで、正しく議事録内容が保存される

## 修正完了
- 初回修正実施日時：2025-07-19
- 修正ファイル：`/app/theMinutesBoard/src/viewer/App.tsx`
- 修正内容：`loadData`関数の条件分岐を修正
- 最終修正実施日時：2025-07-19
- 修正ファイル：`/app/theMinutesBoard/src/background/index.ts`
- 修正内容：議事録保存時のプロパティ名を`result.text`から`result.content`に修正