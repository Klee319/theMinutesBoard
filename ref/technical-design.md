# theMinutesBoard 技術設計書（最小変更版）

## 1. 既存システムアーキテクチャの確認

### 1.1 現在の構成
```
┌─────────────────────────────────────────────────────────────┐
│                        Google Meet Page                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐ │
│  │Content Script│◄──►│Background    │◄──►│Chrome Storage │ │
│  │             │    │Service Worker│    │(Local)        │ │
│  └──────┬──────┘    └──────┬───────┘    └───────────────┘ │
│         │                   │                                │
│         ▼                   ▼                                │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │DOM Observer │    │Message Handler│                       │
│  │(字幕監視)    │    │(通信制御)     │                       │
│  └─────────────┘    └──────────────┘                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   AI Services   │
                    │(Gemini/OpenAI等)│
                    └─────────────────┘
```

### 1.2 データフロー
```
1. 字幕取得フロー:
   DOM → MutationObserver → Content Script → Storage

2. 議事録生成フロー:
   Storage → Background Script → Gemini API → Content Script → UI

3. 状態管理フロー:
   UI Action → Content Script → Background Script → Chrome Storage
```

## 2. 最小限の変更で実装するバグ修正

### 2.1 Content Script (src/content/index.ts) の修正

#### 参加者本人の記録バグ（修正箇所）
```typescript
// processCaptions メソッド内に追加
private async getCurrentUserName(): Promise<string> {
  // 1. Chrome storageから設定を確認
  const { settings } = await chrome.storage.sync.get(['settings'])
  if (settings?.userName) return settings.userName
  
  // 2. フォールバック：「あなた」のまま処理し、後で置換
  return 'あなた'
}

// 字幕処理時に「あなた」を実際の名前に置換
if (speaker === 'あなた' || speaker === 'You') {
  speaker = await this.getCurrentUserName()
}
```

#### 状態永続化の修正
```typescript
// 既存のinit()メソッドに追加
private async checkExistingSession() {
  const { currentMeetingId } = await chrome.storage.local.get(['currentMeetingId'])
  if (currentMeetingId) {
    // 既存セッションの復元
    this.isRecording = true
    this.updateUIState()
  }
}
```

### 2.2 Background Service Worker (src/background/index.ts) の修正

#### 議事録更新の継続処理バグ修正
```typescript
// 既存のisMinutesGeneratingフラグの管理を改善
async function handleGenerateMinutes(): Promise<any> {
  if (isMinutesGenerating) {
    return { success: false, error: '議事録を生成中です' }
  }
  
  try {
    isMinutesGenerating = true
    // 処理...
  } finally {
    // 必ずフラグをリセット
    isMinutesGenerating = false
  }
}
```

#### 停止ボタンの動作修正
```typescript
// handleStopRecording に状態同期を追加
async function handleStopRecording(): Promise<void> {
  // 既存処理...
  
  // Content Scriptに停止完了を通知
  if (recordingTabId) {
    chrome.tabs.sendMessage(recordingTabId, {
      type: 'RECORDING_STOPPED'
    })
  }
}
```

### 2.3 APIキー設定の永続化修正

#### Popup Component (src/popup/App.tsx) の修正
```typescript
// 既存のloadData関数を修正
const loadData = async () => {
  chrome.storage.sync.get(['settings'], (syncResult) => {
    // sync storageから設定を確認
    if (syncResult.settings?.apiKey || 
        syncResult.settings?.openaiApiKey ||
        syncResult.settings?.claudeApiKey) {
      setHasApiKey(true)
    } else {
      // localにもフォールバック
      chrome.storage.local.get(['settings'], (localResult) => {
        if (localResult.settings?.apiKey) {
          setHasApiKey(true)
        }
      })
    }
  })
}
```

#### Options Component の修正
```typescript
// 設定保存時にsync storageを使用
const saveSettings = async (settings: UserSettings) => {
  // 暗号化処理
  const encrypted = await encryptApiKey(settings.apiKey)
  
  // sync storageに保存（デバイス間同期）
  await chrome.storage.sync.set({ 
    settings: { ...settings, apiKey: encrypted }
  })
}
```

### 2.4 時刻・会議時間の自動取得実装

#### Meeting型の拡張（最小限の変更）
```typescript
// src/types/index.ts に追加するだけ
interface Meeting {
  // 既存フィールド...
  duration?: number // 会議時間（秒）を追加
}

// background/index.ts の handleStartRecording に追加
const newMeeting: Meeting = {
  // 既存フィールド...
  startTime: new Date(), // 既に実装済み
}

// handleStopRecording に追加
if (meetingIndex !== -1) {
  const endTime = new Date()
  meetings[meetingIndex].endTime = endTime
  meetings[meetingIndex].duration = 
    Math.floor((endTime.getTime() - meetings[meetingIndex].startTime.getTime()) / 1000)
}
```

#### 議事録生成時の時刻情報追加
```typescript
// AI promptに時刻情報を含める（services/ai/base.ts）
protected buildTranscriptContext(meeting: Meeting): string {
  const duration = meeting.duration || 0
  const hours = Math.floor(duration / 3600)
  const minutes = Math.floor((duration % 3600) / 60)
  
  return `
会議情報:
- 開始時刻: ${meeting.startTime.toLocaleString('ja-JP')}
- 終了時刻: ${meeting.endTime?.toLocaleString('ja-JP') || '継続中'}
- 会議時間: ${hours}時間${minutes}分
- 参加者: ${meeting.participants.join(', ')}

発言記録:
${transcriptText}
  `
}
```

## 3. 新機能のための最小限のデータモデル拡張

### 3.1 既存の型定義への追加
```typescript
// src/types/index.ts に追加する型定義のみ

// ユーザー設定の拡張（拡張機能利用者名用）
interface UserSettings {
  // 既存フィールド...
  userName?: string // 利用者名を追加
}

// ネクストステップ（新規追加）
interface NextStep {
  id: string
  task: string
  assignee?: string
  dueDate?: Date
  status: 'pending' | 'confirmed' | 'completed'
  isPending: boolean // 未確定項目は赤字表示
  meetingId: string
}

// AIチャットメッセージ（新規追加）
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  meetingId: string
  context?: {
    currentTranscripts?: Transcript[]
    relatedMeetings?: string[] // 過去の関連会議ID
  }
}

// 会議情報の拡張
interface Meeting {
  // 既存フィールド...
  nextSteps?: NextStep[] // ネクストステップ追加
  chatHistory?: ChatMessage[] // チャット履歴追加
}
```

### 3.2 Chrome Storage構造（最小限の変更）
```typescript
// 既存のstorage構造に最小限の追加

// Local Storage - 既存構造を維持
interface StorageData {
  meetings: Meeting[] // 既存
  settings: UserSettings // 既存
  currentMeetingId?: string // 既存
  
  // 新規追加（オプショナル）
  nextStepsPrompt?: string // ネクストステップ用プロンプト
}

// Sync Storage - APIキーの同期用
interface SyncStorageData {
  settings: {
    apiKey?: string // 暗号化済み
    userName?: string // 利用者名
  }
}
```

## 4. エラーハンドリング設計

### 4.1 エラー分類と対処
```typescript
enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  STORAGE_ERROR = 'STORAGE_ERROR',
  DOM_ERROR = 'DOM_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
}

class ErrorHandler {
  static handle(error: Error, type: ErrorType): void {
    console.error(`[${type}]`, error);
    
    switch (type) {
      case ErrorType.API_ERROR:
        this.handleAPIError(error);
        break;
      case ErrorType.STORAGE_ERROR:
        this.handleStorageError(error);
        break;
      // ...
    }
  }
  
  private static handleAPIError(error: Error): void {
    // リトライロジック、ユーザー通知
  }
}
```

### 4.2 状態整合性の保証
```typescript
class StateValidator {
  static async validateMeetingState(state: MeetingState): Promise<boolean> {
    // 必須フィールドの検証
    if (!state.meetingId || !state.startTime) {
      return false;
    }
    
    // 状態の整合性チェック
    if (state.isRecording && !state.transcripts) {
      return false;
    }
    
    return true;
  }
  
  static async repairState(state: MeetingState): Promise<MeetingState> {
    // 不整合な状態の修復
  }
}
```

## 5. パフォーマンス最適化

### 5.1 メモリ管理
- 大量の字幕データは定期的にストレージに退避
- 不要なDOMリスナーの適切な削除
- WeakMapを使用したキャッシュ管理

### 5.2 レンダリング最適化
- React.memoによるコンポーネントの最適化
- 仮想スクロールによる大量データの表示
- デバウンスによるAPI呼び出しの制御

### 5.3 ストレージ最適化
- IndexedDBを使用した大容量データ管理
- データの圧縮・分割保存
- 古いデータの自動削除機能

## 6. セキュリティ設計

### 6.1 APIキー管理
```typescript
class SecureStorage {
  private static async encrypt(data: string): Promise<string> {
    // Web Crypto APIを使用した暗号化
  }
  
  private static async decrypt(data: string): Promise<string> {
    // 復号化処理
  }
  
  static async saveAPIKey(key: string): Promise<void> {
    const encrypted = await this.encrypt(key);
    await chrome.storage.sync.set({ apiKey: encrypted });
  }
}
```

### 6.2 Content Security Policy
```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'",
    "sandbox": "sandbox allow-scripts; script-src 'self'"
  }
}
```

## 7. テスト戦略

### 7.1 単体テスト
- 各モジュールの独立したテスト
- モックを使用したChrome API のテスト
- エッジケースの網羅

### 7.2 統合テスト
- Content Script と Background Script の連携テスト
- ストレージの永続性テスト
- API連携のテスト

### 7.3 E2Eテスト
- Puppeteerを使用した実際のGoogle Meetでのテスト
- ユーザーシナリオの自動テスト

---

更新日: 2025年1月6日
バージョン: 1.0.0