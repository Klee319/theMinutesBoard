# Web検索ガイド - geminiコマンドの使い方

## 概要
geminiコマンドはAIモデルを活用したツールで、web検索機能を含む様々なタスクを実行できます。
このドキュメントでは、geminiコマンドを使用したweb検索の方法とコツを記載します。

## 基本的な使い方

### 1. 基本構文
```bash
echo "検索したい内容" | gemini -p "この情報についてweb検索して教えてください"
```

### 2. 直接プロンプトで検索
```bash
gemini -p "最新の[技術名]について検索して教えてください"
```

## 使用例

### 技術情報の検索
```bash
# React 19の新機能を調べる
echo "React 19の新機能" | gemini -p "この技術について最新の情報をweb検索して教えてください"

# Next.js 14の変更点を調べる
gemini -p "Next.js 14の主要な変更点について検索して教えてください"
```

### エラー解決の検索
```bash
# エラーメッセージを検索
echo "TypeError: Cannot read property 'map' of undefined" | gemini -p "このエラーの一般的な原因と解決方法を検索してください"
```

### ライブラリの使い方を検索
```bash
# 特定のライブラリの使用方法
gemini -p "Prisma ORMの基本的な使い方とベストプラクティスを検索してください"
```

## 効果的な検索のコツ

### 1. 具体的なキーワードを使用
- ❌ 悪い例: "プログラミング エラー"
- ✅ 良い例: "React useEffect infinite loop 解決方法"

### 2. バージョン情報を含める
- ❌ 悪い例: "Vue.jsの機能"
- ✅ 良い例: "Vue 3 Composition APIの新機能"

### 3. 検索目的を明確にする
```bash
# 問題解決を求める場合
gemini -p "[エラー内容]の解決方法を検索してください"

# 比較情報を求める場合
gemini -p "[技術A]と[技術B]の違いを検索して比較してください"

# 実装方法を求める場合
gemini -p "[機能]を[フレームワーク]で実装する方法を検索してください"
```

### 4. 時系列を意識する
```bash
# 最新情報を求める場合
gemini -p "2024年の[技術名]の最新動向を検索してください"

# 特定の期間の情報
gemini -p "[技術名]の2023年から2024年にかけての主要な変更点を検索してください"
```

## 注意事項

### 1. 検索結果の検証
- geminiの回答は最新の情報を含んでいますが、重要な実装の前には公式ドキュメントで確認することを推奨

### 2. パフォーマンス
- geminiコマンドの実行には時間がかかる場合があるため、タイムアウト設定を考慮
```bash
# タイムアウトを30秒に設定（Bashツールで実行する場合）
timeout: 30000
```

### 3. 複数の検索を組み合わせる
複雑な調査の場合は、段階的に検索を行う：
1. まず概要を検索
2. 具体的な実装方法を検索
3. エラーやトラブルシューティング情報を検索

## 実用的なテンプレート

### 技術調査テンプレート
```bash
gemini -p "以下について検索してください：
1. [技術名]の概要と主な特徴
2. 最新バージョンの新機能
3. 他の類似技術との比較
4. 実装時の注意点"
```

### エラー解決テンプレート
```bash
echo "[エラーメッセージ全文]" | gemini -p "このエラーについて：
1. エラーの原因を検索
2. 一般的な解決方法を検索
3. 同様のエラーの事例を検索"
```

### ベストプラクティス調査テンプレート
```bash
gemini -p "[技術/フレームワーク]のベストプラクティスについて検索：
1. 公式推奨の実装パターン
2. パフォーマンス最適化の方法
3. セキュリティ上の注意点
4. よくある間違いとその回避方法"
```

## まとめ
geminiコマンドは強力なweb検索ツールとして活用できます。適切なプロンプトと具体的なキーワードを使用することで、効率的に必要な情報を取得できます。