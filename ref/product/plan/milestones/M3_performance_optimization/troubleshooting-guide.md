# theMinutesBoard トラブルシューティングガイド

## 1. パフォーマンス関連の問題

### 1.1 議事録生成が遅い

#### 症状
- 議事録の生成に30秒以上かかる
- ブラウザが応答しなくなる

#### 診断手順
1. Chrome DevTools Performance タブで記録
2. ボトルネックの特定（Main Thread の占有時間確認）
3. Console でエラーメッセージ確認

#### 解決方法
```typescript
// 1. バッチサイズの調整
const BATCH_SIZE = 50; // 100から50に減少

// 2. API タイムアウトの確認
const response = await fetch(url, {
  timeout: 30000 // 30秒に延長
});

// 3. キャッシュの活用
const cached = await cache.get(key);
if (cached) return cached;
```

### 1.2 メモリ使用量が増加し続ける

#### 症状
- 長時間使用でブラウザが重くなる
- Chrome Task Manager でメモリ使用量が増加

#### 診断手順
1. Chrome DevTools Memory タブで Heap Snapshot 取得
2. 時間を置いて再度 Snapshot 取得
3. 比較して増加しているオブジェクトを特定

#### 解決方法
```typescript
// 1. イベントリスナーの確実な削除
useEffect(() => {
  const handler = (e) => { /* ... */ };
  window.addEventListener('event', handler);
  return () => window.removeEventListener('event', handler);
}, []);

// 2. 大規模配列の制限
const transcripts = transcripts.slice(-1000); // 最新1000件のみ保持

// 3. 定期的なガベージコレクション促進
setInterval(() => {
  if (transcripts.length > 1000) {
    transcripts.splice(0, transcripts.length - 1000);
  }
}, 60000);
```

## 2. Chrome拡張機能固有の問題

### 2.1 Service Worker が頻繁に停止する

#### 症状
- 拡張機能アイコンが無効化される
- バックグラウンド処理が中断される

#### 診断手順
1. chrome://extensions でエラー確認
2. Service Worker のログ確認
3. chrome://extensions で「Service Worker」をクリック

#### 解決方法
```typescript
// ServiceWorkerOptimizer を使用
import { ServiceWorkerOptimizer } from '@/utils/service-worker-optimizer';

const optimizer = new ServiceWorkerOptimizer();
optimizer.start(); // Keep-alive 機能を有効化
```

### 2.2 Content Script が注入されない

#### 症状
- Google Meet で字幕が取得できない
- 拡張機能が反応しない

#### 診断手順
1. Console でエラー確認
2. manifest.json の permissions 確認
3. Content Security Policy エラーの確認

#### 解決方法
```json
// manifest.json
{
  "content_scripts": [{
    "matches": ["https://meet.google.com/*"],
    "js": ["content.js"],
    "run_at": "document_idle",
    "all_frames": true // iframe 内でも実行
  }]
}
```

## 3. API関連の問題

### 3.1 API レート制限エラー

#### 症状
- 429 Too Many Requests エラー
- AI 応答が得られない

#### 診断手順
1. Network タブでレスポンス確認
2. エラーレスポンスの詳細確認
3. API 使用量の確認

#### 解決方法
```typescript
// RequestOptimizer でバッチ処理
const optimizer = new RequestOptimizer({
  maxBatchSize: 10,
  batchDelay: 1000, // 1秒遅延
  retryAttempts: 3,
  retryDelay: 2000
});
```

### 3.2 API キーエラー

#### 症状
- 401 Unauthorized エラー
- Invalid API key メッセージ

#### 診断手順
1. 設定画面で API キー確認
2. API プロバイダーのダッシュボードで有効性確認
3. 権限とクォータ確認

#### 解決方法
```typescript
// 設定画面へ誘導
if (error.status === 401) {
  chrome.runtime.openOptionsPage();
  throw new Error('APIキーを設定してください');
}
```

## 4. UI/UX の問題

### 4.1 レンダリングが遅い

#### 症状
- スクロールがカクつく
- UIの更新が遅延する

#### 診断手順
1. React DevTools Profiler で分析
2. 再レンダリング回数の確認
3. コンポーネントツリーの深さ確認

#### 解決方法
```typescript
// 1. メモ化の適用
const MemoizedList = memo(List, (prev, next) => 
  prev.items.length === next.items.length
);

// 2. 仮想スクロールの使用
import { FixedSizeList } from 'react-window';

// 3. debounce の適用
const debouncedSearch = useMemo(
  () => debounce(handleSearch, 300),
  []
);
```

### 4.2 データが表示されない

#### 症状
- 議事録が空白
- ローディングが終わらない

#### 診断手順
1. Chrome Storage の内容確認
2. Console エラー確認
3. Network タブで通信確認

#### 解決方法
```typescript
// ストレージのデバッグ
chrome.storage.local.get(null, (items) => {
  console.log('Storage contents:', items);
});

// エラーバウンダリーの実装
class ErrorBoundary extends Component {
  componentDidCatch(error, info) {
    console.error('UI Error:', error, info);
  }
}
```

## 5. デバッグツール

### 5.1 パフォーマンスプロファイリング

```typescript
// カスタムパフォーマンス計測
class PerformanceDebugger {
  static measure(name: string, fn: Function) {
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    console.log(`${name}: ${duration.toFixed(2)}ms`);
    return result;
  }
}
```

### 5.2 メモリリーク検出

```typescript
// メモリ使用量モニター
class MemoryMonitor {
  static start() {
    setInterval(() => {
      if (performance.memory) {
        const mb = performance.memory.usedJSHeapSize / 1048576;
        console.log(`Memory: ${mb.toFixed(2)} MB`);
      }
    }, 5000);
  }
}
```

### 5.3 ログレベル管理

```typescript
// 環境別ログ設定
const logger = {
  debug: (...args) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG]', ...args);
    }
  },
  error: (...args) => console.error('[ERROR]', ...args)
};
```

## 6. よくある質問（FAQ）

### Q1: 拡張機能が突然動作しなくなった
**A**: 以下を確認してください：
1. Chrome の再起動
2. 拡張機能の再インストール
3. Chrome のバージョン確認（最新版へ更新）
4. 他の拡張機能との競合確認

### Q2: データが消えてしまった
**A**: 以下の復旧手順を試してください：
1. Chrome の同期設定確認
2. IndexedDB の内容確認
3. バックアップからの復元（実装予定）

### Q3: 特定のサイトで動作しない
**A**: 以下を確認してください：
1. サイトの CSP（Content Security Policy）
2. manifest.json の permissions
3. サイト固有の DOM 構造変更

## 7. エスカレーション手順

### レベル1: セルフサービス
- このガイドで解決を試みる
- Chrome 拡張機能の設定確認
- ブラウザの再起動

### レベル2: コミュニティサポート
- GitHub Issues で既知の問題確認
- 同様の問題がない場合は新規 Issue 作成
- 詳細なエラー情報を含める

### レベル3: 開発者サポート
- 重大なバグや脆弱性の報告
- プルリクエストでの修正提案
- セキュリティ問題は非公開で報告

## 8. ログ収集方法

### 拡張機能のログ
```javascript
// Background Script のログ
chrome://extensions → 該当拡張機能 → 「Service Worker」をクリック

// Content Script のログ
対象ページで F12 → Console タブ
```

### エクスポート用スクリプト
```typescript
// 診断情報の収集
async function collectDiagnostics() {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    browser: navigator.userAgent,
    extension: chrome.runtime.getManifest().version,
    storage: await chrome.storage.local.getBytesInUse(),
    memory: performance.memory,
    errors: [] // Console から収集
  };
  
  // ダウンロード
  const blob = new Blob([JSON.stringify(diagnostics, null, 2)]);
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url,
    filename: `minutesboard-diagnostics-${Date.now()}.json`
  });
}
```

## 9. 予防的メンテナンス

### 定期チェックリスト
- [ ] 週次: パフォーマンステスト実行
- [ ] 月次: ストレージ使用量確認
- [ ] 四半期: 依存関係の更新
- [ ] 年次: セキュリティ監査

### 自動化スクリプト
```bash
# パフォーマンスチェック
npm run test:performance

# ビルドサイズ確認
npm run build:analyze

# 依存関係の脆弱性チェック
npm audit
```

## 10. 連絡先

- **GitHub Issues**: https://github.com/[your-repo]/issues
- **ドキュメント**: https://[your-docs-site]
- **緊急連絡**: security@[your-domain]

---

最終更新: 2025年7月18日