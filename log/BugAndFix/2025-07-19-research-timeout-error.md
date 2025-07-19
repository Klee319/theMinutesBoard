# 不具合修正レポート 2025-07-19

## 不具合・エラーの概要
リサーチ機能が使用できない。以下のエラーが発生：
1. Message send attempt 1 failed: Error: Message response timeout
2. Failed to send transcript update: Error: Message response timeout
3. Chrome runtime error: A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received
4. Failed to process voice research: Error: Meeting ID and question are required

## STEP0. ゴール地点の確認
- リサーチ機能が正常に動作すること
- メッセージのタイムアウトエラーを解消
- 非同期処理のレスポンスエラーを解消
- Meeting IDとquestionが正しく渡されること

## STEP1. 不具合発生箇所の調査

### 調査結果
1. **ChromeErrorHandler** (/src/utils/chrome-error-handler.ts):
   - sendMessage関数でタイムアウト（30秒）が設定されている（行79-81）
   - "Message response timeout"エラーが発生（行80）

2. **content/index.ts**:
   - flushTranscriptBuffer関数でChrome runtime errorが発生（行1793）
   - メッセージ送信失敗時にバッファに戻す処理がある（行1795）

3. **ResearchVoiceButton** (/src/components/ResearchVoiceButton/index.tsx):
   - handleToggleRecording関数でAI_ASSISTANT_STOP/STARTメッセージを送信（行43-46, 100-103）
   - AI_RESEARCHメッセージを送信（行59-66）

4. **background/index.ts**:
   - handleAiResearch関数でMeeting IDとquestionを必須チェック（行1694-1696）
   - エラーメッセージ「Meeting ID and question are required」が返される
   - 各メッセージハンドラーがreturn trueで非同期レスポンスを示している

## STEP2. 原因の調査

### 分析結果
1. **メッセージタイムアウトの原因**:
   - ChromeErrorHandler.sendMessageで設定された30秒のタイムアウトが発生
   - background scriptがレスポンスを返さないため

2. **非同期レスポンスエラーの原因**:
   - background scriptのメッセージハンドラーが`return true`を返して非同期応答を示している
   - しかし、実際にはsendResponseが呼ばれないままチャネルが閉じる

3. **"Meeting ID and question are required"エラーの原因**:
   - ResearchVoiceButtonからAI_RESEARCHを送信する際、ペイロードのmeeting IDまたはquestionが欠落している

### 根本原因
1. **Service Workerのライフサイクル問題**:
   - ChromeのService Workerがアイドル状態で終了し、メッセージ応答が失われる可能性
   - 特に長時間かかるAI処理でタイムアウトが発生

2. **エラーハンドリングの不備**:
   - handleAiResearchなどの非同期関数内でエラーが発生した場合、sendResponseが呼ばれない可能性

## STEP3. 修正案の検討

### 修正方針
1. **Service Workerのキープアライブ強化**:
   - 既存のServiceWorkerKeepAliveクラスを活用
   - AI処理中はキープアライブの頻度を上げる

2. **エラーハンドリングの改善**:
   - try-catchブロックで確実にsendResponseを呼ぶ
   - エラー発生時でも必ずsendResponseを実行

3. **Meeting IDの確実な取得**:
   - currentMeetingIdを使用して正しいMeeting IDを取得
   - AI_ASSISTANT_START時にmeetingIdの整合性を確認

4. **タイムアウトの調整**:
   - AI処理用の長いタイムアウトを設定（60秒）
   - リトライ機能の強化

### 修正内容
1. background/index.tsのメッセージハンドラーを改善
2. handleAiResearch関数のエラーハンドリングを強化
3. ResearchVoiceButtonのmeetingIdの取得ロジックを確認
4. ChromeErrorHandlerのタイムアウト設定をAI処理用に調整

## STEP4. 修正案の実装

### 実装した修正内容

1. **background/index.ts**:
   - AI_RESEARCHハンドラーにService Workerキープアライブを追加（行394-395）
   - エラーログを追加してデバッグを容易に（行402）
   - AI_ASSISTANT_START/STOPハンドラーにもキープアライブを追加（行421-422, 435-436）
   - handleAiResearch関数のエラーハンドリングを強化（行1710-1831）
   - パラメータ検証を日本語メッセージに変更（行1716, 1721）
   - currentMeetingIdを使用して実際のミーティングIDを取得（行1727-1728）
   - 会議が見つからない場合の詳細ログを追加（行1738）
   - セッション取得時にmeetingIdとactualMeetingIdをチェック（行1753）

2. **ChromeErrorHandler** (/src/utils/chrome-error-handler.ts):
   - timeoutオプションをインターフェースに追加（行12）
   - sendMessage関数でtimeoutオプションを受け取るように変更（行56）
   - タイムアウト変数名をtimeoutIdに変更して正しくクリア（行80, 86, 105）

3. **ResearchVoiceButton** (/src/components/ResearchVoiceButton/index.tsx):
   - AI_RESEARCH送信時に60秒のタイムアウトを設定（行66）

4. **handleAIAssistantStart**関数の改善:
   - エラーログを追加（行2059）
   - actualMeetingIdの取得とログ追加（行2063-2065）

### 修正のポイント
1. Service Workerがアイドル状態で終了しないようにキープアライブを強化
2. AI処理に適した長いタイムアウト（60秒）を設定
3. Meeting IDの不整合問題をcurrentMeetingIdを使用して解決
4. エラーハンドリングを強化し、デバッグ情報を充実
