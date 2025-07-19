# メモリ推定とOpenRouterエラー修正（更新版）

## 不具合・エラーの概要
1. **TRANSCRIPT_UPDATEエラー**: getMemoryEstimate関数で'length'プロパティ読み取りエラー
   - エラー: `Cannot read properties of undefined (reading 'length')`
   - 発生箇所: TranscriptBufferクラスのgetMemoryEstimate関数

2. **OpenRouterエラー**: selectedModelプロパティ読み取りエラー
   - エラー: `Cannot read properties of undefined (reading 'selectedModel')`
   - 発生箇所: AIServiceFactoryのvalidateProviderSettings関数

## 考察した原因
1. **getMemoryEstimateエラー**
   - transcript.textがundefinedの場合にlengthプロパティにアクセスしている
   - transcript.speakerもundefinedの可能性がある
   - TranscriptBufferに不完全なtranscriptオブジェクトが追加されている

2. **OpenRouterエラー**
   - settings.selectedModelがundefinedまたは存在しない
   - OpenRouterの設定検証が厳密すぎる

## 実際に修正した原因
上記の考察通り

## 修正内容と修正箇所

### 1. TranscriptBufferのgetMemoryEstimate修正
**修正ファイル**: src/utils/transcript-buffer.ts:85-102

```typescript
// 修正前
page.forEach(transcript => {
  totalSize += transcript.text.length * 2
  totalSize += (transcript.speaker?.length || 0) * 2
  totalSize += 100
})

// 修正後
page.forEach(transcript => {
  if (!transcript) return
  
  totalSize += (transcript.text?.length || 0) * 2
  totalSize += (transcript.speaker?.length || 0) * 2
  totalSize += 100
})
```

修正内容：
- pageとtranscriptのnullチェックを追加
- transcript.textとtranscript.speakerのオプショナルチェイニングを使用
- undefinedの場合は0を使用

### 2. AIServiceFactoryのOpenRouter設定検証の緩和
**修正ファイル**: src/services/ai/factory.ts

#### validateProviderSettings関数（行155-163）
```typescript
// 修正前
if (settings.aiProvider === 'openrouter' && !settings.selectedModel) {
  return false
}

// 修正後
// OpenRouterの場合、selectedModelがなくてもデフォルトで動作するため検証を緩和
// generateMinutes内でデフォルトモデルが使用される
```

#### getAvailableProviders関数（行252-262）
```typescript
// 修正前
if (settings.openrouterApiKey && settings.selectedModel) providers.push('openrouter')

// 修正後
if (settings.openrouterApiKey) providers.push('openrouter')
```

修正理由：
- OpenRouterServiceのgenerateMinutes関数でデフォルトモデル（'anthropic/claude-3.5-sonnet'）が設定されている
- selectedModelがundefinedでも動作可能なため、検証を緩和

## 追加修正（2025-07-16 追記）

### 3. 再発したOpenRouterエラーの調査
**問題**: 議事録生成時にselectedModelエラーが再発
```
Error generating minutes: Error: All AI providers failed: openrouter: Cannot read properties of undefined (reading 'selectedModel')
```

**原因分析**:
- 議事録生成時は`chrome.storage.local`と`chrome.storage.sync`の設定をマージして使用
- 他の処理では`chrome.storage.local`のみから設定を取得
- selectedModelは`chrome.storage.sync`に保存されている可能性が高い
- 設定取得の不整合により、selectedModelが含まれない設定がEnhancedAIServiceに渡される

**解決策**:
OpenRouterServiceで直接selectedModelを参照している箇所を確認し、デフォルト値処理を強化する必要がある

### 4. EnhancedAIServiceの修正実装
**修正ファイル**: src/services/ai/enhanced-ai-service.ts

#### generateMinutes関数の修正（行33-51）
```typescript
// 修正前
return this.executeWithFallback(
  (service) => service.generateMinutes(transcripts),
  options
)

// 修正後
return this.executeWithFallback(
  (service) => service.generateMinutes(
    transcripts, 
    this.settings,  // settingsを渡すように修正
    options?.meetingInfo,
    options?.promptType
  ),
  options
)
```

**修正理由**:
- BaseAIServiceのgenerateMinutesメソッドはUserSettings型の`settings`パラメータを必須で受け取る
- EnhancedAIServiceがこのパラメータを渡していなかったため、OpenRouterService内でsettings.selectedModelにアクセスする際にエラーが発生
- 各AIサービスが適切にsettingsにアクセスできるよう、EnhancedAIServiceから確実に渡すように修正