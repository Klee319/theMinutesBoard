# API リファレンス

## 目次
1. [AIサービス](#aiサービス)
2. [A/Bテスト](#abテスト)
3. [アクセシビリティ](#アクセシビリティ)
4. [ストレージ](#ストレージ)
5. [メッセージング](#メッセージング)

## AIサービス

### AIServiceFactory

AIサービスのファクトリークラス。プロバイダーの選択、フォールバック、レート制限管理を行います。

#### メソッド

##### `createService(settings: UserSettings): BaseAIService`

指定された設定に基づいてAIサービスインスタンスを作成します。

**パラメータ:**
- `settings`: ユーザー設定オブジェクト

**戻り値:**
- 作成されたAIサービスインスタンス

**例:**
```typescript
const service = AIServiceFactory.createService({
  aiProvider: 'openai',
  openaiApiKey: 'sk-...',
  // その他の設定
})
```

##### `createServiceWithFallback(settings: UserSettings, fallbackProviders?: AIProvider[]): Promise<{service: BaseAIService, provider: AIProvider}>`

フォールバック機能付きでAIサービスを作成します。

**パラメータ:**
- `settings`: ユーザー設定
- `fallbackProviders`: フォールバックプロバイダーのリスト（オプション）

**戻り値:**
- サービスインスタンスと使用されたプロバイダー

### BaseAIService

すべてのAIサービスの基底クラス。

#### メソッド

##### `generateMinutes(transcripts: Transcript[], options?: MinutesOptions): Promise<string>`

議事録を生成します。

##### `generateNextSteps(transcripts: Transcript[], minutes: string, userPrompt?: string): Promise<NextStep[]>`

ネクストステップを生成します。

##### `processChat(message: string, context: ChatContext): Promise<string>`

チャットメッセージを処理します。

## A/Bテスト

### ABTestManager

A/Bテストの管理を行うシングルトンクラス。

#### メソッド

##### `getInstance(): ABTestManager`

ABTestManagerのインスタンスを取得します。

##### `assignUserToVariant(config: ABTestConfig): string`

ユーザーをテストバリアントに割り当てます。

**パラメータ:**
- `config`: A/Bテスト設定

**戻り値:**
- 割り当てられたバリアントID

##### `recordResult(result: ABTestResult): Promise<void>`

A/Bテストの結果を記録します。

**パラメータ:**
- `result`: テスト結果オブジェクト

##### `exportResults(): Promise<ABTestExportData>`

A/Bテストの結果をエクスポートします。

### 型定義

#### ABTestConfig

```typescript
interface ABTestConfig {
  enabled: boolean
  testId: string
  startDate: string
  endDate?: string
  variants: ABTestVariant[]
  metrics: ABTestMetrics
}
```

#### ABTestVariant

```typescript
interface ABTestVariant {
  id: string
  name: string
  provider: string
  model?: string
  weight: number // 0-100
}
```

## アクセシビリティ

### ユーティリティ関数

#### `announceToScreenReader(message: string, priority?: 'polite' | 'assertive'): void`

スクリーンリーダーにメッセージをアナウンスします。

**パラメータ:**
- `message`: アナウンスするメッセージ
- `priority`: アナウンスの優先度（デフォルト: 'polite'）

#### `generateId(prefix: string): string`

アクセシブルなIDを生成します。

### React Hooks

#### `useFocusTrap(isActive: boolean): RefObject<HTMLDivElement>`

フォーカストラップを実装するフック。

**パラメータ:**
- `isActive`: トラップの有効/無効

**戻り値:**
- コンテナ要素のref

#### `useEscapeKey(onEscape: () => void, isActive?: boolean): void`

Escapeキーのハンドラーを設定するフック。

#### `useKeyboardNavigation(items: any[], onSelect: (index: number) => void, isActive?: boolean): number`

キーボードナビゲーションを実装するフック。

## ストレージ

### StorageService

Chrome拡張機能のストレージを管理するサービス。

#### メソッド

##### `getMeeting(meetingId: string): Promise<Meeting | null>`

指定されたIDの会議を取得します。

##### `saveMeeting(meeting: Meeting): Promise<void>`

会議を保存します。

##### `exportMeeting(meetingId: string, format: ExportFormat): Promise<Blob>`

会議をエクスポートします。

**パラメータ:**
- `meetingId`: 会議ID
- `format`: エクスポート形式（'markdown' | 'txt' | 'json' | 'csv'）

## メッセージング

### ChromeMessage

Chrome拡張機能のメッセージング用の型定義。

```typescript
interface ChromeMessage {
  type: MessageType
  payload?: any
  reason?: string
  timestamp?: string
}
```

### MessageType

サポートされているメッセージタイプの一覧：

- `START_RECORDING`: 録音開始
- `STOP_RECORDING`: 録音停止
- `GENERATE_MINUTES`: 議事録生成
- `TRANSCRIPT_UPDATE`: 文字起こし更新
- `AI_REQUEST`: AI処理リクエスト
- `AI_RESPONSE`: AI処理レスポンス
- その他多数

### ChromeErrorHandler

Chrome拡張機能のエラーハンドリングユーティリティ。

#### メソッド

##### `sendMessage(message: ChromeMessage): Promise<any>`

メッセージを送信し、エラーをハンドリングします。

##### `getUserFriendlyMessage(error: Error): string`

ユーザーフレンドリーなエラーメッセージを取得します。

## 使用例

### 議事録生成の完全な例

```typescript
import { AIServiceFactory } from '@/services/ai/factory'
import { storageService } from '@/services/storage'

async function generateMinutesForMeeting(meetingId: string) {
  try {
    // 会議データを取得
    const meeting = await storageService.getMeeting(meetingId)
    if (!meeting) throw new Error('Meeting not found')

    // ユーザー設定を取得
    const settings = await storageService.getSettings()

    // AIサービスを作成（A/Bテスト対応）
    const { service, provider } = await AIServiceFactory.createServiceWithFallback(
      settings,
      ['claude', 'openai'] // フォールバックプロバイダー
    )

    // 議事録を生成
    const minutesContent = await service.generateMinutes(
      meeting.transcripts,
      { format: 'live' }
    )

    // 議事録を保存
    const minutes: Minutes = {
      id: generateId('minutes'),
      meetingId,
      content: minutesContent,
      generatedAt: new Date(),
      format: 'markdown'
    }

    meeting.minutes = minutes
    await storageService.saveMeeting(meeting)

    // スクリーンリーダーに通知
    announceToScreenReader('議事録が生成されました')

    return minutes
  } catch (error) {
    console.error('Failed to generate minutes:', error)
    announceToScreenReader('議事録の生成に失敗しました', 'assertive')
    throw error
  }
}
```