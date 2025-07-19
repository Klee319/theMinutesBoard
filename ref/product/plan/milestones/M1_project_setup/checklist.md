# M1: プロジェクトセットアップ チェックリスト

## 開発環境構築
- [x] Node.js v18以上のインストール確認
- [x] パッケージ依存関係の最新化（npm audit実行）
- [x] 開発用Chrome拡張機能のロード手順書作成（READMEに記載）
- [x] VS Code推奨拡張機能リストの共有（.vscode/extensions.json作成）

## テスト環境整備
- [x] Jest設定ファイルの作成・最適化（jest.config.js存在）
- [x] React Testing Library環境構築（test-utils.tsx作成）
- [x] カバレッジレポート設定（目標80%以上）（vitest.config.ts更新）
- [x] E2Eテスト用Playwright環境構築（playwright.config.ts作成）
- [x] モックデータ・フィクスチャの整理（src/test/fixtures/作成）

## CI/CD設定
- [x] GitHub Actions ワークフロー作成（CI/CD, E2E）
- [x] 自動テスト実行（PR作成時）（GitHub Actions設定）
- [x] コードカバレッジレポート自動生成（CI設定）
- [x] ビルド成功/失敗の通知設定（GitHub Actions）
- [x] Chrome拡張機能の自動パッケージング（release job）

## コード品質管理
- [x] ESLint設定の見直し・強化（.eslintrc.json存在）
- [x] Prettier設定の統一（.prettierrc存在）
- [x] pre-commitフックの設定（husky + lint-staged）
- [x] TypeScript strictモードの有効化（tsconfig.jsonで設定済み）
- [x] コードレビューガイドライン作成（CodingRule.md作成済み）

## ドキュメント整備
- [x] README.mdの更新（セットアップ手順）
- [ ] CONTRIBUTING.mdの作成
- [ ] アーキテクチャ図の作成
- [x] API仕様書テンプレートの準備（仕様書v1.1作成済み）

## プロジェクト管理
- [ ] GitHubプロジェクトボードの設定
- [ ] イシューテンプレートの作成
- [ ] PRテンプレートの作成
- [x] ブランチ戦略の文書化（タスク管理書で言及）

## 承認
- [ ] 開発リーダー承認
- [ ] 全開発メンバーの環境構築完了確認
- [ ] プロジェクトマネージャー最終承認