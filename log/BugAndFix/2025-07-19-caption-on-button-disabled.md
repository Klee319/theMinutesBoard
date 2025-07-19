# Google Meet字幕ON時にボタンが押せない不具合

## 不具合・エラーの概要
Google Meetで字幕をONにしてもボタンが押せない問題が発生している。以前の修正で字幕OFF時の無効化を実装したが、その影響で字幕ON時でもボタンが押せなくなっている可能性がある。

## STEP1. 不具合発生箇所の調査
content/index.tsの字幕状態チェック関連のコードを調査完了。

### 確認した箇所
1. **ボタンクリックハンドラー** (265-309行目)
   - `isCaptionButtonEnabled()`で字幕ボタンのON/OFF状態をチェック
   - `checkForCaptions()`で字幕コンテナの存在をチェック
   - 両方のチェックが必要

2. **updateRecordingButtonState()** (573-588行目)
   - `checkForCaptions()`の結果でボタンの有効/無効を制御
   - 字幕コンテナが見つからない場合はボタンを無効化

3. **checkForCaptions()** (621-683行目)
   - 字幕要素が`display: none`や`visibility: hidden`でないことを確認
   - 字幕コンテナが見つかった場合のみtrueを返す

## STEP2. 原因の調査
問題の原因は以下の可能性がある：

1. **字幕UIの変更**: Google Meetの字幕UIが更新され、セレクタが変わった可能性
2. **条件の厳しさ**: `checkForCaptions()`の条件が厳しすぎて、字幕がONでも要素を検出できない
3. **タイミングの問題**: 字幕をONにしても、字幕要素が表示されるまでに時間がかかる

### 実際に判明した原因
- `updateRecordingButtonState()`が`checkForCaptions()`を使用してボタンの有効/無効を制御
- `checkForCaptions()`は字幕要素が表示されていることを厳密にチェック
- 字幕ボタンがONでも、実際の字幕要素が表示されるまでにタイムラグがある可能性
- そのため、字幕ボタンがONでも記録開始ボタンが無効化されたままになる

## STEP3. 修正案の検討

### 修正方針
1. `updateRecordingButtonState()`を修正し、`isCaptionButtonEnabled()`を使用するように変更
2. `checkForCaptions()`にforceオプションを追加し、字幕ボタンがONの場合は簡略化したチェックを行う
3. `startCaptionStatusMonitoring()`の定期チェックでも`isCaptionButtonEnabled()`のみを使用

これにより、字幕ボタンのON/OFF状態に基づいてボタンの有効/無効を制御し、字幕要素の表示を待つ必要がなくなる。

## STEP4. 修正案の実装

### 修正内容と修正箇所

1. **updateRecordingButtonState()の修正** (573-588行目)
   - `checkForCaptions()`の代わりに`isCaptionButtonEnabled()`を使用
   - 字幕ボタンの状態のみでボタンの有効/無効を判定

2. **checkForCaptions()メソッドの拡張** (621-683行目)
   - forceパラメータを追加（デフォルトfalse）
   - force=trueかつ字幕ボタンがONの場合は、要素の存在確認のみ行う

3. **ボタンクリックハンドラーの修正** (289-300行目)  
   - `checkForCaptions(true)`を使用して、forceモードで字幕要素を探す

4. **startCaptionStatusMonitoring()の修正** (1883-1897行目)
   - `checkForCaptions()`の呼び出しを削除し、`isCaptionButtonEnabled()`のみを使用

## 追加修正（2回目）

### 問題
前回の修正後も、字幕をONにしてもボタンがホワイトアウト（無効化）したままになっている。

### 原因
1. `isCallActive`が初期化時にfalseのため、`updateRecordingButtonState()`が実行されない
2. `updateRecordingUI()`で記録していない時に`updateRecordingButtonState()`を呼ぶが、`isCallActive`がfalseのため無効化されたまま
3. 字幕状態の定期チェックも`isCallActive`がfalseの間は実行されない

### 修正内容

1. **initメソッドの修正** (120-130行目)
   - Google Meetページにいる場合は`isCallActive = true`に初期化

2. **updateRecordingUIメソッドの修正** (169-172行目)
   - `isCallActive`がtrueの場合のみ`updateRecordingButtonState()`を呼ぶ

3. **updateRecordingButtonStateメソッドの拡張**
   - デバッグログを追加してボタンの状態変更を詳しく追跡
   - 強制的にopacityとcursorスタイルをリセット

4. **isCaptionButtonEnabledメソッドの拡張**
   - デバッグログを追加して字幕ボタンの検出を詳しく追跡

5. **startCaptionStatusMonitoringメソッドの修正**
   - 初回チェックを1秒遅延させてDOMの完全読み込みを待つ
   - デバッグログを追加

これにより、ページ読み込み時から通話がアクティブとみなされ、字幕状態に応じてボタンが適切に有効/無効化されるようになりました。