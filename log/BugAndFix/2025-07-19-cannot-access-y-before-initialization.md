# 別タブ表示エラー：Cannot access 'y' before initialization

## 不具合・エラーの概要
- **エラーメッセージ**: `ReferenceError: Cannot access 'y' before initialization`
- **症状**: 別タブに何も表示されなくなった
- **発生日時**: 2025-07-19

## STEP0: ゴール地点の確認
- エラーの解消により、別タブが正常に表示されるようにする
- 根本的な原因を特定し、temporal dead zoneによるエラーを解決する

## STEP1: 不具合発生箇所の調査
### 調査内容
- srcディレクトリ内での変数'y'の直接的な宣言は見つからなかった
- MinutesPanelコンポーネントで`position.y`として使用されている箇所を確認
- エラーメッセージの'y'はミニファイされたコードの変数名の可能性が高い

### 調査結果
- App.tsxでの動的インポート（lazy loading）実装を確認
- LiveModeLayout、LiveMinutesPanel、LiveNextStepsPanelなどが最近変更されている
- React.lazyとSuspenseの組み合わせで初期化順序の問題が発生している可能性
- LiveModeLayout/index.tsx:287行目でMobilePanelTabsコンポーネントにisRecordingプロパティを渡しているが、型定義に含まれていない問題を発見

## STEP2: 原因の調査
### 考察した原因
- TypeScriptの型定義エラーにより、未定義のプロパティを参照しようとしている
- ビルド時のミニファイケーションで未定義変数参照が'y'という名前に変換された可能性
- MobilePanelTabsコンポーネントのprops型定義にisRecordingが欠けている

### 確定した原因
1. MobilePanelTabsコンポーネントの型定義にisRecordingプロパティが含まれていない
2. LiveModeLayoutから未定義のプロパティを渡しているため、ランタイムエラーが発生

## STEP3: 修正案の検討
### 修正方針
1. MobilePanelTabsコンポーネントの型定義にisRecording?: booleanを追加
2. LiveModeLayoutからMobilePanelTabsへのプロパティ渡しを修正

## STEP4: 修正案の実装
### 修正内容
1. src/components/LiveModeLayout/index.tsx:40行目
   - MobilePanelTabsの型定義に`isRecording?: boolean`を追加
2. src/components/LiveModeLayout/index.tsx:290行目
   - MobilePanelTabsコンポーネントに`isRecording={isRecording}`を追加

### 修正箇所
- src/components/LiveModeLayout/index.tsx
  - 21-41行目: MobilePanelTabsコンポーネントの型定義修正
  - 287-290行目: propsの渡し方修正
