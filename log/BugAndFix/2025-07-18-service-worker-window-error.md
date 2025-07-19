# Service Worker window is not defined エラーの修正

## 報告日時
2025年7月18日

## 不具合・エラーの概要
Chrome拡張機能のService Worker登録時に以下のエラーが発生：
- `Service worker registration failed. Status code: 15`
- `Uncaught ReferenceError: window is not defined`
- 場所：background.js:17

## 考察した原因
Manifest V3のService WorkerはWeb Workerベースで動作するため、DOM APIやwindowオブジェクトが存在しない。
ServiceWorkerOptimizerクラスで`window.setInterval`、`window.clearInterval`などのDOM API経由でタイマー関数を呼び出していたことが原因。

## 実際に修正した原因
`src/background/service-worker-optimizer.ts`ファイルで以下の問題を確認：
1. `window.setInterval` → グローバル関数として直接呼び出すべき
2. `window.clearInterval` → 同上
3. `window.setTimeout` → 同上
4. `window.clearTimeout` → 同上
5. `window.window.setInterval` → 誤字も含めて修正が必要
6. `global.gc` → `globalThis.gc`にすべき（標準的な記述）

## 修正内容と修正箇所

### 修正ファイル：`/app/theMinutesBoard/src/background/service-worker-optimizer.ts`

1. **64行目と83行目**
   ```typescript
   // 修正前
   window.clearInterval(this.keepAliveTimer)
   // 修正後
   clearInterval(this.keepAliveTimer)
   ```

2. **68行目**
   ```typescript
   // 修正前
   this.keepAliveTimer = window.window.setInterval(() => {
   // 修正後
   this.keepAliveTimer = setInterval(() => {
   ```

3. **100行目、139行目、237行目**
   ```typescript
   // 修正前
   window.setInterval(() => {
   // 修正後
   setInterval(() => {
   ```

4. **124-125行目**
   ```typescript
   // 修正前
   if (global.gc) {
     global.gc()
   // 修正後
   if (globalThis.gc) {
     globalThis.gc()
   ```

5. **172行目**
   ```typescript
   // 修正前
   window.clearTimeout(messageTimer)
   // 修正後
   clearTimeout(messageTimer)
   ```

6. **176行目**
   ```typescript
   // 修正前
   messageTimer = window.setTimeout(() => {
   // 修正後
   messageTimer = setTimeout(() => {
   ```

## 修正結果
- ビルドが正常に完了
- Service Worker互換のコードに修正完了
- windowオブジェクトへの依存を完全に排除

## 今後の対策
- Service Worker環境では、グローバル関数を直接呼び出す
- DOM APIやwindowオブジェクトは使用不可であることを認識
- `globalThis`を使用して環境に依存しないコードを書く