# リサーチ機能のgenerateChatResponseエラー修正記録

## 不具合・エラーの概要
リサーチ機能使用時に以下のエラーが発生：
- `[ERROR] Failed to process voice research: Error: All AI providers failed: openrouter: a.generateChatResponse is not a function, gemini: a.generateChatResponse is not a function`
- 発生場所: src/viewer/viewer.html?meetingId=meeting_1752937604616_8xe1o6u2a

## 考察した原因
1. **メソッド名の誤り**
   - EnhancedAIServiceのgenerateResearchメソッド内でAIプロバイダーの存在しないメソッドを呼び出している
   - generateChatResponseというメソッドは定義されていない可能性

2. **AIプロバイダーインターフェースの不一致**
   - 各AIプロバイダーが提供するメソッド名が異なる可能性

## 実際に修正した原因
EnhancedAIServiceで`generateChatResponse`メソッドを呼び出していたが、BaseAIServiceおよび各AIプロバイダー実装には存在しない。正しいメソッド名は：
- `sendChatMessage()` - チャット機能用
- `generateText()` - テキスト生成用
- `generateContent()` - 汎用コンテンツ生成用

## 修正内容と修正箇所
1. **src/services/ai/enhanced-ai-service.ts:93-105行目**
   - generateChatResponseメソッド内で`service.generateChatResponse()`を`service.sendChatMessage()`に変更
   - 戻り値をAIGenerationResult形式に変換

2. **src/services/ai/enhanced-ai-service.ts:107-124行目**
   - generateTextメソッド内で`service.generateChatResponse()`を`service.generateText()`に変更

3. **src/services/ai/enhanced-ai-service.ts:126-142行目**
   - generateResearchメソッド内で`service.generateChatResponse()`を`service.sendChatMessage()`に変更
   - 戻り値をAIGenerationResult形式に変換