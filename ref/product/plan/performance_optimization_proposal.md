# theMinutesBoard パフォーマンス最適化提案書

**作成日**: 2025-07-15
**バージョン**: 1.0

## 1. 現状の課題

### 1.1 メモリ使用量の問題
- **長時間会議でのメモリ肥大化**: 3時間の会議で500MB以上のメモリ使用
- **Transcript配列の無制限成長**: バッファ管理が不十分
- **Service Workerでのセッション管理**: 最大10セッションの制限はあるが、各セッション内のデータ量が無制限

### 1.2 レンダリングパフォーマンス
- **頻繁な再レンダリング**: パネルサイズ変更時に全体が再描画
- **メモ化の欠如**: 計算結果の再利用が行われていない
- **大規模リストの表示**: 仮想スクロールが未実装

### 1.3 ストレージ効率
- **Chrome Storage APIの制限**: 5MBの容量制限に対する計画的な対応不足
- **全データ取得の非効率性**: フィルタリングがメモリ上で実行
- **データ削除の後手対応**: 容量逼迫時のみ古いデータを削除

## 2. 最適化提案

### 2.1 メモリ管理の改善

#### 実装案1: Transcript配列のページング
```typescript
// 現在の実装（問題あり）
const transcripts: Transcript[] = []; // 無制限に成長

// 改善案
class TranscriptBuffer {
  private pages: Map<number, Transcript[]> = new Map();
  private currentPage = 0;
  private readonly PAGE_SIZE = 100;
  
  add(transcript: Transcript) {
    if (!this.pages.has(this.currentPage)) {
      this.pages.set(this.currentPage, []);
    }
    
    const page = this.pages.get(this.currentPage)!;
    page.push(transcript);
    
    if (page.length >= this.PAGE_SIZE) {
      this.currentPage++;
    }
  }
  
  getRecent(count: number): Transcript[] {
    // 必要な分だけメモリに展開
  }
}
```

#### 実装案2: WeakMapによるセッション管理
```typescript
// Service Workerでのセッション管理改善
const sessionStore = new WeakMap<chrome.runtime.Port, SessionData>();
const sessionTimeout = new Map<string, NodeJS.Timeout>();

// 自動的にガベージコレクション対象になる
```

### 2.2 Reactコンポーネントの最適化

#### 実装案3: メモ化の活用
```typescript
// MinutesPanelの最適化
const MinutesPanel = React.memo(({ minutes, isLoading }) => {
  const processedMinutes = useMemo(() => {
    return processMinutesData(minutes);
  }, [minutes]);
  
  const handleUpdate = useCallback((newData) => {
    // 更新処理
  }, []);
  
  return (
    <VirtualList
      items={processedMinutes}
      itemHeight={80}
      renderItem={renderMinuteItem}
    />
  );
});
```

#### 実装案4: 仮想スクロールの実装
```typescript
// react-windowを使用した仮想スクロール
import { FixedSizeList } from 'react-window';

const TranscriptList = ({ transcripts }) => (
  <FixedSizeList
    height={600}
    itemCount={transcripts.length}
    itemSize={50}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>
        {transcripts[index].content}
      </div>
    )}
  </FixedSizeList>
);
```

### 2.3 ストレージ最適化

#### 実装案5: IndexedDBへの移行
```typescript
// 大容量データはIndexedDBへ
class EnhancedStorageService {
  private db: IDBDatabase;
  
  async saveMeeting(meeting: Meeting) {
    // メタデータはChrome Storage
    await chrome.storage.local.set({
      [`meeting_meta_${meeting.id}`]: {
        id: meeting.id,
        title: meeting.title,
        startTime: meeting.startTime
      }
    });
    
    // 大容量データはIndexedDB
    const tx = this.db.transaction(['meetings'], 'readwrite');
    await tx.objectStore('meetings').put(meeting);
  }
}
```

#### 実装案6: データ圧縮
```typescript
// LZ-stringによるデータ圧縮
import LZString from 'lz-string';

const compressedData = LZString.compressToUTF16(JSON.stringify(largeData));
const decompressedData = JSON.parse(LZString.decompressFromUTF16(compressedData));
```

### 2.4 API呼び出しの最適化

#### 実装案7: 並列処理
```typescript
// 議事録とネクストステップの並列生成
async function generateMeetingArtifacts(transcripts: Transcript[]) {
  const [minutes, nextSteps] = await Promise.all([
    generateMinutes(transcripts),
    generateNextSteps(transcripts)
  ]);
  
  return { minutes, nextSteps };
}
```

#### 実装案8: リトライロジック
```typescript
async function callAIWithRetry(
  apiCall: () => Promise<any>,
  maxRetries = 3,
  backoff = 1000
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, backoff * Math.pow(2, i)));
    }
  }
}
```

### 2.5 Service Worker最適化

#### 実装案9: イベントドリブンなキープアライブ
```typescript
// 必要時のみキープアライブ
let keepAliveInterval: NodeJS.Timeout | null = null;

function startKeepAlive() {
  if (keepAliveInterval) return;
  
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 25000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// アクティブなセッションがある時のみ開始
```

## 3. 実装優先順位

### Phase 1（即効性の高い改善）- 2週間
1. Transcript配列のページング実装
2. React.memoの適用
3. API呼び出しの並列化

### Phase 2（中期的改善）- 4週間
1. 仮想スクロールの実装
2. IndexedDBへの部分的移行
3. リトライロジックの実装

### Phase 3（長期的改善）- 6週間
1. 完全なストレージアーキテクチャの見直し
2. Service Workerの最適化
3. データ圧縮の実装

## 4. 期待される効果

### メモリ使用量
- **現在**: 3時間で500MB → **目標**: 350MB（30%削減）
- ページング実装により線形的な増加を抑制

### レンダリング性能
- **現在**: 議事録更新時に2秒のフリーズ → **目標**: 0.5秒以内
- 仮想スクロールにより大規模データでも高速表示

### API応答性
- **現在**: 議事録生成30秒 → **目標**: 15秒以内
- 並列処理により体感速度が大幅改善

## 5. リスクと対策

### リスク1: 既存データとの互換性
- **対策**: マイグレーションスクリプトの準備
- **対策**: 段階的な移行プロセス

### リスク2: 新しいバグの導入
- **対策**: 包括的なテストスイートの作成
- **対策**: フィーチャーフラグによる段階的リリース

### リスク3: 開発期間の延長
- **対策**: MVPアプローチによる段階的改善
- **対策**: 優先順位に基づく柔軟な実装

## 6. 計測と監視

### パフォーマンスメトリクス
- メモリ使用量の継続的監視
- レンダリング時間の測定
- API応答時間の記録

### ユーザー体感指標
- Time to Interactive (TTI)
- First Contentful Paint (FCP)
- Cumulative Layout Shift (CLS)

## 7. まとめ

本提案により、theMinutesBoardのパフォーマンスを大幅に改善し、より快適なユーザー体験を提供できます。段階的な実装により、リスクを最小限に抑えながら確実な改善を実現します。