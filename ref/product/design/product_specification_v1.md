# プロダクト仕様書: theMinutesBoard

**バージョン**: 1.0
**最終更新日**: 2025-07-15

## 1. 目的とスコープ
- **解決する課題**: オンライン会議での議事録作成の手間と、会議内容の把握・共有の困難さを解決する。
- **ターゲットユーザー**: Google Meetを利用するビジネスユーザー、チームメンバー、プロジェクトマネージャー。
- **この仕様書の読者**: 開発者、QAエンジニア、プロダクトマネージャー、ステークホルダー。

## 2. 機能一覧
- `F-01`: リアルタイム文字起こし記録 — Google Meetの字幕から発言内容を自動記録する
- `F-02`: AI議事録生成 — 記録された発言内容からAIが議事録を自動生成する
- `F-03`: ライブダイジェスト — 会議中のリアルタイム要約を表示する
- `F-04`: ネクストステップ管理 — ToDoを自動抽出し管理する
- `F-05`: AIチャットアシスタント — 会議内容に関する質問応答と編集支援を行う
- `F-06`: リサーチ機能 — 会議内容に基づくAI調査を実行する
- `F-07`: 自動更新 — 議事録とネクストステップを定期的に更新する
- `F-08`: データエクスポート — 議事録とタスクを外部形式で出力する（部分実装）
- `F-09`: 会議履歴管理 — 過去の会議記録を保存・検索する（部分実装）
- `F-10`: ユーザー設定管理 — AIプロバイダーやUIオプションを設定する
- `F-11`: チャットヒストリー表示 — 過去のチャット履歴を表示する
- `F-12`: パネルリサイズ — 各パネルの幅を動的に調整する
- `F-13`: 会議トピック自動抽出 — 議事録から会議タイトルを自動生成する
- `F-14`: Service Worker管理 — 拡張機能の安定動作を維持する

## 3. 機能詳細

### F-01: リアルタイム文字起こし記録
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | Google Meet字幕 | テキスト / UTF-8 | 自動取得 |
| **入力** | 話者名 | 文字列 / 50文字以内 | 字幕から抽出 |
| **処理** | 字幕キャプチャ | Google Meetの字幕DOMを監視し、新しい発言を検出・記録する | |
| **処理** | 話者名変換 | 「あなた」を実際のユーザー名に変換する | |
| **出力 (正常時)** | 発言記録 | Transcriptオブジェクト（speaker、content、timestamp、meetingId） | ストレージに保存 |
| **出力 (異常時)** | エラーログ | "字幕の取得に失敗しました" | コンソールに出力 |

### F-02: AI議事録生成
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | 発言記録リスト | Transcript[] | 最新の発言記録 |
| **入力** | 生成オプション | format: "live" \| "history" | 用途に応じた形式 |
| **処理** | 議事録生成ボタン押下時 | 選択されたAIプロバイダーのAPIを呼び出し、プロンプトと発言記録を送信する | |
| **処理** | AI応答の解析 | 返されたテキストをマークダウン形式として処理する | |
| **出力 (正常時)** | 議事録 | マークダウン形式のテキスト（見出し、箇条書き、時系列情報を含む） | |
| **出力 (異常時)** | エラーメッセージ | "議事録の生成に失敗しました: [エラー詳細]" | トースト通知で表示 |

### F-03: ライブダイジェスト
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | 前回更新時刻 | ISO 8601形式の日時 | |
| **入力** | 最新の発言記録 | Transcript[] | 前回更新以降の発言 |
| **処理** | 差分抽出 | 前回更新以降の発言のみを抽出する | |
| **処理** | 要約生成 | AIにより会話の要点を階層的に生成する | |
| **出力 (正常時)** | ダイジェスト | JSON形式（要約、詳細、発言記録の階層構造） | |
| **出力 (異常時)** | 前回の表示を維持 | - | エラー時は更新しない |

### F-04: ネクストステップ管理
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | タスク内容 | 文字列 / 200文字以内 | 必須 |
| **入力** | 担当者 | 文字列 / 50文字以内 | オプション |
| **入力** | 期限 | 日付 / YYYY-MM-DD | オプション |
| **入力** | 優先度 | "high" \| "medium" \| "low" | デフォルト: "medium" |
| **処理** | 追加ボタン押下時 | 入力されたタスク情報を検証し、NextStepオブジェクトとして保存する | |
| **処理** | 相対日付変換 | 「来週まで」等の相対表現を絶対日付に変換する | |
| **処理** | ステータス更新 | ドロップダウンから選択されたステータスに更新する | |
| **出力 (正常時)** | タスクリスト | NextStep[]（タスク、担当者、期限、ステータス、優先度を含む） | |
| **出力 (異常時)** | エラーメッセージ | "タスクの保存に失敗しました" | トースト通知 |

### F-05: AIチャットアシスタント
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | ユーザー質問 | 文字列 / 1000文字以内 | 必須 |
| **入力** | 会議コンテキスト | 議事録 + 発言記録 | 自動付与 |
| **処理** | 送信ボタン押下時 | 質問と会議コンテキストをAIに送信する | |
| **処理** | 応答の解析 | AIの回答をマークダウンとして処理する | |
| **出力 (正常時)** | 回答 | マークダウン形式のテキスト | チャット履歴に追加 |
| **出力 (異常時)** | エラーメッセージ | "回答の生成に失敗しました" | チャット内に表示 |

### F-06: リサーチ機能
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | リサーチクエリ | 文字列 / 500文字以内 | テキストまたは音声 |
| **入力** | Web検索有効化 | boolean | デフォルト: false |
| **処理** | リサーチ実行 | AIにクエリと会議コンテキストを送信し、調査を実行する | |
| **処理** | 音声入力 | 録画ボタン押下で音声認識を開始する | |
| **出力 (正常時)** | リサーチ結果 | マークダウン形式（関連情報、参考リンク等） | |
| **出力 (異常時)** | エラーメッセージ | "リサーチの実行に失敗しました" | パネル内に表示 |

### F-07: 自動更新
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | 更新間隔 | 0(OFF) \| 1 \| 2 \| 3 \| 5 \| 10 \| 15 (分) | 設定画面で選択 |
| **処理** | タイマー処理 | 指定間隔で議事録とネクストステップの再生成を実行する | |
| **処理** | カウントダウン表示 | 次回更新までの残り時間を表示する | |
| **出力 (正常時)** | 更新済み議事録 | 最新の発言内容を反映した議事録 | |
| **出力 (異常時)** | 更新スキップ | 前回の内容を維持し、次回更新を待つ | |

### F-08: データエクスポート
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | エクスポート形式 | "markdown" \| "json" \| "csv" | ドロップダウンで選択 |
| **処理** | エクスポートボタン押下時 | 現在の議事録とタスクを指定形式に変換する | |
| **出力 (正常時)** | ファイルダウンロード | 指定形式のファイル | ブラウザのダウンロード |
| **出力 (異常時)** | エラーメッセージ | "エクスポートに失敗しました" | トースト通知 |

### F-09: 会議履歴管理
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | 検索キーワード | 文字列 / 100文字以内 | オプション |
| **入力** | 日付範囲 | 開始日～終了日 | オプション |
| **処理** | 検索実行 | キーワードと日付で会議履歴をフィルタリングする | |
| **出力 (正常時)** | 会議リスト | Meeting[]（タイトル、日時、参加者を含む） | |
| **出力 (異常時)** | 空のリスト | [] | 該当なしの場合 |

### F-10: ユーザー設定管理
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | AIプロバイダー | "gemini" \| "openai" \| "claude" \| "openrouter" | ラジオボタン |
| **入力** | APIキー | 文字列 / 暗号化保存 | 必須 |
| **入力** | UIテーマ | "light" \| "dark" \| "auto" | デフォルト: "auto"（未実装） |
| **処理** | 保存ボタン押下時 | 設定をchrome.storage.syncに保存する | |
| **出力 (正常時)** | 成功メッセージ | "設定を保存しました" | トースト通知 |
| **出力 (異常時)** | エラーメッセージ | "設定の保存に失敗しました" | トースト通知 |

### F-11: チャットヒストリー表示
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | 会議ID | 文字列 | 自動取得 |
| **処理** | パネル表示時 | 過去のチャット履歴を取得・表示する | |
| **出力 (正常時)** | チャット履歴 | メッセージリスト（時系列） | |
| **出力 (異常時)** | 空のリスト | [] | 履歴なしの場合 |

### F-12: パネルリサイズ
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | ドラッグ操作 | マウス/タッチ操作 | |
| **処理** | リサイザードラッグ時 | パネル幅を動的に調整する | |
| **出力 (正常時)** | パネル幅更新 | ピクセル/パーセント | |
| **出力 (異常時)** | 最小/最大幅で制限 | - | 極端なサイズは制限 |

### F-13: 会議トピック自動抽出
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | 議事録内容 | マークダウンテキスト | |
| **処理** | 議事録生成後 | 最初の議題をタイトルとして抽出する | |
| **出力 (正常時)** | 会議タイトル | 文字列 / 100文字以内 | |
| **出力 (異常時)** | デフォルトタイトル | "会議 - [日時]" | |

### F-14: Service Worker管理
| 区分 | 名称/説明 | 型/制約/フォーマット | 備考 |
|:---|:---|:---|:---|
| **入力** | - | - | 自動実行 |
| **処理** | キープアライブ | 24秒ごとにアラームでService Workerを維持 | |
| **処理** | セッション回復 | エラー時に自動でセッション復旧を試行 | |
| **出力 (正常時)** | 継続動作 | - | |
| **出力 (異常時)** | エラー回復 | セッション再確立 | |

## 4. ビジネスルール
- **発言記録の保持期間**: 会議終了後30日間は自動削除されない（実装では100会議まで保持）
- **ストレージ制限**: Chrome Storage APIの5MB制限、超過時は古い会議から自動削除
- **議事録の編集権限**: 会議参加者のみが編集可能
- **タスクの自動確定**: AIが提案したタスクは、ユーザーが確認するまで「pending」状態
- **相対日付の解釈**: 「来週」は次の月曜日、「今月末」は当月最終日として処理
- **API利用制限**: 各AIプロバイダーのレート制限に準拠（エラー時は適切に通知）
- **字幕バッファリング**: 50件ごとまたは5秒ごとにバッファをフラッシュ
- **議事録の時系列**: 最新の議題を上部に表示（逆時系列）

## 5. 設定ファイル・環境変数
| 項目名 | デフォルト値 | 必須 | 説明 |
|:---|:---:|:---:|:---|
| `AI_PROVIDER` | `gemini` | Yes | 使用するAIプロバイダー |
| `API_KEY` | - | Yes | AIサービスのAPIキー |
| `AUTO_UPDATE_INTERVAL` | `2` | No | 自動更新間隔（分） |
| `ENABLE_WEB_SEARCH` | `false` | No | リサーチ機能でのWeb検索有効化 |
| `UI_THEME` | `auto` | No | UIテーマ設定 |
| `MAX_TRANSCRIPT_LENGTH` | `10000` | No | 保持する発言記録の最大件数 |

## 6. 非機能要件
| 項目 | 要求レベル | 備考 |
|:---|:---|:---|
| **パフォーマンス** | 議事録生成は30秒以内 | 5000文字の発言記録の場合 |
| **可用性** | Chrome拡張機能として99%以上 | Google Meet利用中 |
| **セキュリティ** | APIキーは暗号化保存 | chrome.storage.sync使用 |
| **スケーラビリティ** | 3時間の会議に対応 | 約20,000文字の発言記録 |
| **ユーザビリティ** | レスポンシブデザイン | PC/タブレット/スマホ対応 |
| **ログ** | エラーログのみ記録 | プライバシー保護のため最小限 |

## 7. 用語集
- **議事録**: AIが生成した会議の要約と決定事項
- **発言記録（Transcript）**: 参加者の実際の発言内容
- **ネクストステップ**: 会議で決定されたタスクやアクションアイテム
- **ライブダイジェスト**: リアルタイムで更新される会議の要約
- **pending**: AIが提案したがユーザー未確認のタスク状態

## 8. 外部依存
- **Google Meet**: 字幕機能を利用した発言取得
- **Chrome Extension API**: 拡張機能の基盤
- **Gemini API**: Google AIサービス（デフォルト）
- **OpenAI API**: ChatGPT/GPT-4サービス
- **Claude API**: Anthropic AIサービス
- **OpenRouter API**: 複数AIモデルへのゲートウェイ

## 9. 改訂履歴
| 版 | 日付 | 変更内容 | 担当者 |
|:---|:---|:---|:---|
| 1.0 | 2025-07-15 | 初版作成（実装済み機能の仕様化） | システム |
| 1.1 | 2025-07-15 | 実装済み機能（F-11〜F-14）を追加、ビジネスルール更新 | システム |