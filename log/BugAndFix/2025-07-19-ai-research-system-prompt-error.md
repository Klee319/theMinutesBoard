# AIリサーチ機能のsystemPromptエラー修正記録

## 不具合・エラーの概要
AIリサーチ機能でエラーが発生し、すべてのAIプロバイダーが失敗している：
1. **openrouter**: `チャットメッセージの送信に失敗しました`
2. **gemini**: `Cannot read properties of undefined (reading 'systemPrompt')`
3. 両方のプロバイダーが失敗し、`All AI providers failed`エラーが発生

エラーメッセージ：
```
[ERROR] handleAiResearch error: Error: All AI providers failed: openrouter: チャットメッセージの送信に失敗しました, gemini: Cannot read properties of undefined (reading 'systemPrompt')
[ERROR] Failed to process voice research: Error: All AI providers failed: openrouter: チャットメッセージの送信に失敗しました, gemini: Cannot read properties of undefined (reading 'systemPrompt')
```

## STEP0: ゴール地点の確認
目標：AIリサーチ機能のエラーを根本的に解消する
- openrouterのチャットメッセージ送信エラーを解消
- geminiのsystemPrompt未定義エラーを解消
- AIリサーチ機能（handleAiResearch）が正常に動作するようにする

## STEP1: 不具合発生箇所の調査
- handleAiResearch関数（/src/background/index.ts:1709）でAIリサーチ処理を実行
- enhancedService.generateResearch（/src/background/index.ts:1812）を呼び出し
- EnhancedAIService.generateResearch（/src/services/ai/enhanced-ai-service.ts:128）内で問題発生
- service.sendChatMessage(prompt, undefined)でcontextにundefinedを渡している（enhanced-ai-service.ts:140）
- GeminiService.sendChatMessage（/src/services/gemini/index.ts:187）でcontext.systemPromptを参照（gemini/index.ts:193）
- contextがundefinedのため、「Cannot read properties of undefined (reading 'systemPrompt')」エラーが発生

## 考察した原因
1. **generateResearchメソッドの実装ミス**
   - EnhancedAIService.generateResearchメソッドが不適切にsendChatMessageを呼び出している
   - contextを適切に構築せず、第2引数にundefinedを渡している
   - handleAiResearchから受け取ったcontextオブジェクトをpromptに埋め込んでいるが、sendChatMessageの第2引数として渡していない

2. **openrouterエラーの原因**
   - 同様にOpenRouterServiceのsendChatMessageメソッドでもcontextを期待している可能性
   - チャットメッセージの送信に失敗しているのは、同じ原因である可能性が高い

## STEP2: 原因の詳細調査結果
1. **EnhancedAIService.generateResearchメソッドの実装ミス**が根本原因
   - generateResearchメソッドでは、受け取ったcontextオブジェクトをJSON文字列化してpromptに埋め込んでいる
   - しかし、service.sendChatMessageの第2引数にundefinedを渡している
   - 各AIサービス（Gemini、OpenRouter）のsendChatMessageメソッドは、contextオブジェクトを必須で期待している

2. **各AIサービスのsendChatMessageメソッドの期待値**
   - GeminiService: context.systemPrompt、context.meetingInfo、context.minutes、context.recentTranscriptsを参照
   - OpenRouterService: context.systemPrompt、context.meetingInfo.title、context.meetingInfo.participants、context.meetingInfo.transcriptsCountを参照
   - contextがundefinedの場合、これらのプロパティアクセスでエラーが発生

## 実際に修正した原因
EnhancedAIService.generateResearchメソッドが、各AIサービスのsendChatMessageメソッドに対して適切なcontextオブジェクトを渡していないことが原因

## STEP3: 修正案の検討
**解消方針**
1. EnhancedAIService.generateResearchメソッドを修正
   - service.sendChatMessageの第2引数にcontextオブジェクトを適切に渡す
   - 第1引数のpromptはqueryのみにする（contextの内容は第2引数で渡す）

2. 修正により期待される効果
   - GeminiServiceとOpenRouterServiceのsendChatMessageメソッドがcontextオブジェクトに正しくアクセスできる
   - systemPromptエラーが解消される
   - チャットメッセージ送信エラーが解消される

3. 影響範囲の確認
   - generateResearchメソッドを使用している箇所は、handleAiResearch関数のみ
   - 他の部分への影響はない

## 修正内容と修正箇所

### 1. EnhancedAIService.generateResearchメソッドの修正
**ファイル**: `/app/theMinutesBoard/src/services/ai/enhanced-ai-service.ts`（行128-145）

修正前：
```typescript
const prompt = `${JSON.stringify(context)}\n\nQuery: ${query}`
const response = await service.sendChatMessage(prompt, undefined)
```

修正後：
```typescript
// contextオブジェクトを適切に渡す
const response = await service.sendChatMessage(query, context)
```

### 2. GeminiService.sendChatMessageメソッドの修正
**ファイル**: `/app/theMinutesBoard/src/services/gemini/index.ts`（行187-232）

修正内容：
- contextがundefinedの場合のデフォルト値設定
- meetingInfoとmeetingContextの両方をサポート
- currentTopicSummaryとdifferenceTranscriptsの処理を追加

### 3. OpenRouterService.sendChatMessageメソッドの修正
**ファイル**: `/app/theMinutesBoard/src/services/ai/openrouter.ts`（行254-310）

修正内容：
- contextがundefinedの場合のデフォルト値設定
- meetingInfoとmeetingContextの両方をサポート
- currentTopicSummaryとdifferenceTranscriptsの処理を追加

## 修正結果
これらの修正により、AIリサーチ機能でのsystemPromptエラーが解消され、contextが適切に各AIサービスに渡されるようになります。