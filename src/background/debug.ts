// デバッグ用のユーティリティ関数

export async function debugStorageInfo() {
  const result = await chrome.storage.local.get(['meetings', 'currentMeetingId', 'settings'])
  console.log('=== Storage Debug Info ===')
  console.log('Meetings count:', result.meetings?.length || 0)
  console.log('Current meeting ID:', result.currentMeetingId || 'none')
  console.log('Has settings:', !!result.settings)
  
  if (result.meetings && result.meetings.length > 0) {
    console.log('Meeting details:')
    result.meetings.forEach((meeting: any, index: number) => {
      console.log(`[${index}] ID: ${meeting.id}`)
      console.log(`    Title: ${meeting.title}`)
      console.log(`    Start: ${meeting.startTime}`)
      console.log(`    End: ${meeting.endTime || 'ongoing'}`)
      console.log(`    Participants: ${meeting.participants?.length || 0}`)
      console.log(`    Transcripts: ${meeting.transcripts?.length || 0}`)
      console.log(`    Has minutes: ${!!meeting.minutes}`)
    })
  }
  
  // ストレージ使用量
  const bytesInUse = await chrome.storage.local.getBytesInUse()
  console.log('Total storage used:', bytesInUse, 'bytes')
  console.log('=========================')
}

// グローバルに公開（開発者コンソールから呼び出し可能）
(globalThis as any).debugStorage = debugStorageInfo

// テスト用のダミーデータ生成
export async function createTestMeeting() {
  const testMeeting = {
    id: `test_${Date.now()}`,
    title: 'テスト会議 ' + new Date().toLocaleString('ja-JP'),
    startTime: new Date(Date.now() - 3600000), // 1時間前
    endTime: new Date(),
    participants: ['田中太郎', '佐藤花子', '鈴木一郎'],
    transcripts: [
      {
        id: 'trans_1',
        speaker: '田中太郎',
        content: 'それでは、本日の会議を始めさせていただきます。',
        timestamp: new Date(Date.now() - 3500000)
      },
      {
        id: 'trans_2',
        speaker: '佐藤花子',
        content: 'プロジェクトの進捗について報告します。',
        timestamp: new Date(Date.now() - 3400000)
      },
      {
        id: 'trans_3',
        speaker: '鈴木一郎',
        content: '了解しました。質問があります。',
        timestamp: new Date(Date.now() - 3300000)
      }
    ],
    minutes: {
      id: 'minutes_1',
      content: `# テスト会議議事録

## 概要
- **参加者**: 田中太郎、佐藤花子、鈴木一郎
- **会議の目的**: プロジェクト進捗確認

## 決定事項
- **次回の会議は来週月曜日に実施**
- **プロジェクトの期限は予定通り**

## アクションアイテム
| No. | タスク | 担当者 | 期限 |
|-----|--------|--------|------|
| 1   | 資料の更新 | 田中太郎 | 今週金曜日 |
| 2   | レビューの実施 | 佐藤花子 | 来週火曜日 |`,
      generatedAt: new Date(),
      format: 'markdown'
    }
  }
  
  const result = await chrome.storage.local.get(['meetings'])
  const meetings = result.meetings || []
  meetings.push(testMeeting)
  await chrome.storage.local.set({ meetings })
  
  console.log('Test meeting created:', testMeeting.id)
  await debugStorageInfo()
}

(globalThis as any).createTestMeeting = createTestMeeting