# theMinutesBoard 仕様書

## 1. プロジェクト概要

### 1.1 製品名
theMinutesBoard

### 1.2 製品概要
Google Meet の会議内容を自動的に記録し、Gemini AI を使用してリアルタイムで議事録を生成する Chrome 拡張機能。

### 1.3 主要機能
- Google Meet の参加者発言をリアルタイムで記録
- Gemini AI による自動議事録生成
- カスタマイズ可能な議事録フォーマット
- 議事録のエクスポート機能
- 過去の議事録管理

## 2. ユースケース

### 2.1 基本的な使用フロー
1. ユーザーが Google Meet に参加
2. 拡張機能が自動的に字幕をキャプチャ開始
3. ユーザーが「議事録生成」ボタンをクリック
4. Gemini AI が現在までの会話を分析し、議事録を生成
5. 画面中央のパネルに議事録が表示される
6. 必要に応じて「再生成」ボタンで議事録を更新
7. 会議終了後、議事録をエクスポート

### 2.2 初期設定フロー
1. Chrome ウェブストアから拡張機能をインストール
2. 設定画面で Gemini API キーを入力
3. 議事録生成プロンプトをカスタマイズ（任意）
4. Google Meet で使用開始

## 3. 技術仕様

### 3.1 技術スタック
- **フロントエンド**: React 18.x + TypeScript 5.x
- **ビルドツール**: Vite 5.x
- **Chrome Extension**: Manifest V3
- **CSS フレームワーク**: Tailwind CSS 3.x
- **データベース**: 
  - 開発環境: SQLite (better-sqlite3)
  - 本番環境対応: PostgreSQL/MySQL 互換の ORM (Prisma)
- **AI API**: Google Gemini API (gemini-1.5-flash)
- **状態管理**: Zustand
- **テスト**: Vitest + React Testing Library

### 3.2 プロジェクト構成
```
theMinutesBoard/
├── src/
│   ├── background/          # Service Worker
│   ├── content/            # Content Scripts
│   ├── popup/              # 拡張機能ポップアップ
│   ├── options/            # 設定画面
│   ├── components/         # 共通コンポーネント
│   │   ├── MinutesPanel/   # 議事録表示パネル
│   │   ├── ControlBar/     # 操作ボタン群
│   │   └── Settings/       # 設定コンポーネント
│   ├── hooks/              # カスタムフック
│   ├── services/           # ビジネスロジック
│   │   ├── transcript/     # 文字起こし処理
│   │   ├── gemini/         # Gemini API 連携
│   │   ├── storage/        # データ永続化
│   │   └── export/         # エクスポート機能
│   ├── utils/              # ユーティリティ関数
│   ├── types/              # TypeScript 型定義
│   └── styles/             # グローバルスタイル
├── public/
│   └── manifest.json       # Chrome Extension マニフェスト
├── prisma/
│   └── schema.prisma       # データベーススキーマ
├── tests/                  # テストファイル
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── package.json
```

## 4. 機能詳細

### 4.1 文字起こし機能
- **実装方法**: Google Meet の字幕機能を DOM 監視で取得
- **技術詳細**:
  - MutationObserver で字幕要素の変更を監視
  - 発言者名と発言内容を構造化データとして保存
  - タイムスタンプ付きで記録
- **データ形式**:
  ```typescript
  interface Transcript {
    id: string;
    speaker: string;
    content: string;
    timestamp: Date;
    meetingId: string;
  }
  ```

### 4.2 議事録生成機能
- **API 設定**:
  - モデル: gemini-1.5-flash（無料枠：15 req/分、100万トークン/分）
  - レート制限: 1分間に10回まで生成可能
  - エラーハンドリング: 指数バックオフでリトライ
- **プロンプト管理**:
  - デフォルトプロンプトを提供
  - ユーザーカスタマイズ可能
  - プロンプトテンプレート機能

### 4.3 UI/UX 設計
- **議事録パネル**:
  - 画面中央に半透明オーバーレイで表示
  - ドラッグで位置調整可能
  - リサイズ可能
  - 最小化/最大化機能
- **コントロールバー**:
  - 議事録生成ボタン
  - 再生成ボタン（完全再生成）
  - エクスポートボタン
  - 設定ボタン

### 4.4 データ管理
- **ローカルストレージ構造**:
  ```typescript
  interface StorageSchema {
    meetings: Meeting[];
    settings: UserSettings;
    apiKeys: EncryptedAPIKeys;
  }
  ```
- **セキュリティ**:
  - API キーは Web Crypto API で暗号化
  - 議事録データは IndexedDB に保存
  - 機密データのメモリ内暗号化

### 4.5 エクスポート機能
- **対応フォーマット**:
  - Markdown (.md)
  - PDF
  - Plain Text (.txt)
  - JSON (構造化データ)
- **エクスポート内容**:
  - 議事録本文
  - メタデータ（日時、参加者、会議時間）
  - 発言ログ（オプション）

## 5. セキュリティ要件

### 5.1 データ保護
- API キーの暗号化保存
- HTTPS 通信の強制
- Content Security Policy の適用
- XSS 対策の実装

### 5.2 プライバシー
- 会議データのローカル処理優先
- 外部送信時の暗号化
- データ保持期間の明示
- GDPR 準拠の同意管理

### 5.3 権限管理
- 最小権限の原則
- 必要な Chrome API のみ要求
- ホスト権限は meet.google.com のみ

## 6. 開発ガイドライン

### 6.1 コーディング規約
- ESLint + Prettier 設定に従う
- TypeScript の strict モードを使用
- 関数型プログラミングを優先
- コンポーネントは単一責任の原則に従う

### 6.2 テスト戦略
- ユニットテスト: 全てのサービス層
- 統合テスト: API 連携部分
- E2E テスト: 主要ユーザーフロー
- カバレッジ目標: 80%以上

### 6.3 CI/CD
- GitHub Actions でビルド自動化
- Chrome Web Store への自動デプロイ
- セマンティックバージョニング

## 7. 将来の拡張性考慮

### 7.1 アーキテクチャ設計
- **クリーンアーキテクチャの採用**:
  - ドメイン層とインフラ層の分離
  - 依存性逆転の原則
  - インターフェースによる疎結合
- **プラグインシステム**:
  - 新機能追加のためのフック機構
  - カスタムプロセッサーの登録

### 7.2 拡張ポイント
- **AI プロバイダー**: Gemini 以外の AI API 対応
- **会議プラットフォーム**: Zoom, Teams 対応
- **ストレージ**: クラウドストレージ連携
- **コラボレーション**: リアルタイム共同編集

## 8. 開発環境セットアップ

### 8.1 必要条件
- Node.js 20.x 以上
- npm 10.x 以上
- Chrome 120 以上

### 8.2 初期設定手順
```bash
# リポジトリのクローン
git clone [repository-url]
cd theMinutesBoard

# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env.local
# .env.local に Gemini API キーを設定

# 開発サーバーの起動
npm run dev

# ビルド
npm run build

# テストの実行
npm run test
```

### 8.3 Chrome 拡張機能の読み込み
1. Chrome で `chrome://extensions/` を開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」
4. `dist` フォルダを選択

## 9. API リファレンス

### 9.1 Gemini API 統合
```typescript
interface GeminiService {
  generateMinutes(transcripts: Transcript[]): Promise<Minutes>;
  validateApiKey(key: string): Promise<boolean>;
  checkRateLimit(): Promise<RateLimitStatus>;
}
```

### 9.2 ストレージ API
```typescript
interface StorageService {
  saveMeeting(meeting: Meeting): Promise<void>;
  getMeetings(filter?: MeetingFilter): Promise<Meeting[]>;
  deleteMeeting(id: string): Promise<void>;
  exportMeeting(id: string, format: ExportFormat): Promise<Blob>;
}
```

## 10. トラブルシューティング

### 10.1 よくある問題
- 字幕が取得できない → Google Meet の字幕を有効化
- API エラー → API キーの確認、レート制限の確認
- 議事録が生成されない → ネットワーク接続の確認

### 10.2 デバッグ方法
- Chrome DevTools でのデバッグ
- バックグラウンドスクリプトのログ確認
- ネットワークタブでの API 通信確認

---

この仕様書は theMinutesBoard の初期バージョン (v1.0.0) を対象としています。
更新日: 2024年3月6日