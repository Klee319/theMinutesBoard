# 不具合修正レポート 2025-07-15

## 不具合・エラーの概要
1. 字幕がOFFでも記録が開始できてしまう不具合
2. リサーチタブのチャットで音声入力時に全ての文字起こしが送信される問題
3. リサーチタブの見出しが「リサーチ」と「リサーチ&チャット」で重複している問題

## STEP0. ゴール地点の確認
- 字幕OFF時は記録開始を防止し、ユーザーにポップアップで通知
- 音声入力は開始から終了までの差分のみを取得
- 議事録の要約をコンテキストとして送信
- リサーチタブの見出しを「リサーチ」に統一

## STEP1. 不具合発生箇所の調査

### 1. 字幕OFF時の記録開始防止機能
- **VoiceInputPanel** (/src/components/VoiceInputPanel/index.tsx): 音声入力パネルの録音開始時に字幕チェックなし
- **ResearchVoiceButton** (/src/components/ResearchVoiceButton/index.tsx): リサーチ音声入力開始時に字幕チェックなし
- **background/index.ts** handleAIAssistantStart関数: AI_ASSISTANT_START処理時に字幕チェックなし

### 2. リサーチタブのチャット音声入力差分処理
- **ResearchVoiceButton** (/src/components/ResearchVoiceButton/index.tsx): 
  - 録音停止時に全ての字幕が送信されている
  - startTranscriptIndexを使用した差分計算がAI_RESEARCH送信時に行われていない

### 3. リサーチタブの見出し重複問題
- **ResearchPanel** (/src/components/ResearchPanel/index.tsx): 
  - 見出しが「リサーチ & チャット」になっている（行210）
  - LiveModeLayoutのタブは「リサーチ」となっている

## STEP2. 原因の調査

### 1. 字幕OFF時の記録開始防止機能の原因
- VoiceInputPanelとResearchVoiceButtonからの音声入力開始時に字幕チェックが実装されていない
- popupからの記録開始では字幕チェックが実装されているが、サイドパネルからの音声入力では未実装
- AI_ASSISTANT_STARTメッセージハンドラーで字幕状態の確認を行っていない

### 2. リサーチタブのチャット音声入力差分処理の原因
- handleAIAssistantStop関数で差分字幕を計算しているが、セッションに保存されていない
- handleAiResearch関数でセッションの字幕を参照しているが、削除済みで空になっている

### 3. リサーチタブの見出し重複問題の原因
- ResearchPanelコンポーネント内の見出しとタブ表示の名称が異なっている

## STEP3. 修正案の検討

### 1. 字幕OFF時の記録開始防止機能の修正案
- background/index.tsのhandleAIAssistantStart関数で字幕チェックを追加
  - content scriptに字幕チェックリクエストを送信
  - 字幕が無効な場合はエラーレスポンスを返す
- ResearchVoiceButtonとVoiceInputPanelでエラー時の適切なメッセージ表示

### 2. リサーチタブのチャット音声入力差分処理の修正案
- handleAIAssistantStop関数でセッションに差分字幕を保存
- handleAiResearch関数の処理後にセッションを削除

### 3. リサーチタブの見出し重複問題の修正案
- ResearchPanelの見出しを「リサーチ」に統一

## STEP4. 修正案の実装

### 実装した修正内容

1. **字幕OFF時の記録開始防止機能**
   - background/index.ts: handleAIAssistantStart関数に字幕チェック追加（行1955-1979）
   - content/index.ts: CHECK_CAPTIONSハンドラーのsuccess値を修正（行398）

2. **リサーチタブのチャット音声入力差分処理**
   - background/index.ts: handleAIAssistantStop関数でセッションに差分字幕を保存（行2057）
   - background/index.ts: handleAiResearch関数でリサーチ処理後にセッション削除（行1734-1737）

3. **リサーチタブの見出し重複問題**
   - ResearchPanel/index.tsx: 見出しを「リサーチ」に修正（行210）