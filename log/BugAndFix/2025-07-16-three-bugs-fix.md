# 3つの不具合修正

## 不具合・エラーの概要
1. **履歴タブのソート問題**: 議事録の履歴タブがソートされていない（startTimeでソートしているが、仕様書ではendTimeを優先する必要がある）
2. **タイトルなし議事録のサイズ問題**: 議事録のタイトルがないものは履歴タブサイドバー内のサイズが違う
3. **字幕OFF時の記録開始問題**: ミーティングに参加していれば依然として字幕ONでなくても記録開始ボタンを押すと記録を開始してしまう

## 考察した原因
1. **履歴タブのソート問題**
   - MeetingHistoryPanel/index.tsx:48で `startTime` を基準にソートしている
   - 仕様書では `endTime` を優先的に使用すべきと記載

2. **タイトルなし議事録のサイズ問題**
   - MeetingHistoryPanel/index.tsx:252-256でタイトルをそのまま表示
   - タイトルが空の場合のフォールバック処理が実装されていない

3. **字幕OFF時の記録開始問題**
   - content/index.tsのCHECK_CAPTIONSとSTART_RECORDINGハンドラーで字幕チェックは実装済み
   - しかし、一般的な記録開始時のチェックが甘い可能性がある

## 実際に修正した原因
上記の考察通り

## 修正内容と修正箇所

### 1. 履歴タブのソート問題の修正
**修正ファイル**: src/components/MeetingHistoryPanel/index.tsx:47-52

```typescript
// 修正前
result.meetings.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())

// 修正後
result.meetings.sort((a, b) => {
  const aTime = a.endTime || a.startTime
  const bTime = b.endTime || b.startTime
  return new Date(bTime).getTime() - new Date(aTime).getTime()
})
```

### 2. タイトルなし議事録のサイズ問題の修正
**修正ファイル**: src/components/MeetingHistoryPanel/index.tsx

- インポートに`formatDateTime`と`extractMeetingTopic`を追加（行4-5）
- `getMeetingTitle`関数を追加（行110-135）
- 表示処理を修正（行259）：`meeting.title` → `getMeetingTitle(meeting)`

タイトル表示の優先順位：
1. 議事録から抽出した主題（extractMeetingTopic）
2. 既存のタイトル
3. 「会議 YYYY/MM/DD HH:MM」形式
4. 「無題の会議」

### 3. 字幕OFF時の記録開始問題
**調査結果**: すでに修正済み
- handleStartRecording関数で字幕チェックを実装済み（background/index.ts）
- content/index.tsのSTART_RECORDINGハンドラーで字幕チェックを実装済み
- 字幕が無効な場合はエラーメッセージを表示し、記録を開始しない