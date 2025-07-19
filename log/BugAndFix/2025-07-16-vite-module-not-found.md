# バグ修正報告書: Viteモジュールが見つからないエラー

**日付**: 2025-07-16  
**エラータイプ**: MODULE_NOT_FOUND

## 不具合・エラーの概要

ビルドコマンド実行時に以下のエラーが発生：
```
Error: Cannot find module '/app/theMinutesBoard/node_modules/vite/bin/vite.js'
```

## STEP0: ゴール地点の確認

目標：ビルドコマンド `npm run build` が正常に実行され、Chrome拡張機能のビルドが完了すること。

## STEP1: 不具合発生箇所の調査

エラーメッセージから、node_modules/vite/bin/vite.js が存在しないことが原因と特定。

調査結果：
- node_modulesディレクトリは存在するが、中身が空の状態
- node_modules/.binディレクトリも存在しない
- package.jsonにはviteが依存関係として記載されている
- package-lock.jsonが存在しない

## STEP2: 原因の調査

考察した原因：
1. node_modulesディレクトリは作成されているが、実際のパッケージがインストールされていない
2. package-lock.jsonが存在しないため、npm installが完全に実行されていない可能性がある
3. Dockerコンテナ環境での初回セットアップ時の問題の可能性

## STEP3: 修正案の検討

修正方針：
1. npm installを実行して、package.jsonに記載されているすべての依存関係をインストールする
2. これにより、viteを含むすべての必要なパッケージがnode_modulesにインストールされる
3. package-lock.jsonも生成され、依存関係のバージョンがロックされる

この方針は以下の要件を満たしている：
- 解消可能性：極めて高い（標準的なNode.jsプロジェクトのセットアップ手順）
- 仕様通りの動作：ビルドコマンドが正常に実行可能になる
- 影響範囲：node_modulesのインストールのみで、既存コードへの影響なし
- 実装可能性：npmコマンドの実行のみで実装可能

## STEP4: 修正案の実装

1. npm installを実行して依存関係をインストール
   - 実行結果：成功
   - node_modules/.bin/viteが正しく作成された
   - package-lock.jsonは生成されなかった（huskyのprepareスクリプトの影響か）

## 修正結果

元のエラー「Cannot find module '/app/theMinutesBoard/node_modules/vite/bin/vite.js'」は解決されました。

npm installを実行することで、すべての依存関係が正しくインストールされ、viteモジュールも利用可能になりました。

## 実際に修正した原因

node_modulesディレクトリは存在していたが、実際のパッケージがインストールされていない状態だった。これはDockerコンテナの初期化時に何らかの理由でnpm installが完全に実行されなかったことが原因と考えられる。

## 修正内容と修正箇所

- 修正内容：npm installコマンドの実行
- 修正箇所：プロジェクトルートディレクトリ（/app/theMinutesBoard）でのコマンド実行
- 影響範囲：node_modulesディレクトリの内容のみ（コードの変更なし）

注：ビルド実行時に新たなエラー（HTMLタグの不整合）が発見されましたが、これは元の問題とは別の問題です。