# デバッグと修正方針
STEP0~STEP4に示す内容はユーザに提示されたエラーや不具合の修正を行うための手順である。エラー・不具合などのバグ修正は必ずこの手順に従って修正を行うこと。
また./log/BugAndFix内に類似の報告が既に存在していないか確認し、既にあればその報告書を踏まえた考察・修正を行え。

# 報告とログの保存：
今回行う修正や分析に関して下記の内容を./log/BugAndFixディレクトリに.mdで保存してください。
各ステップ完了ごとに随時追記しておくこと。
- 不具合・エラーの概要
- 考察した原因
- 実際に修正した原因
- 修正内容と修正箇所

## STEP0. ゴール地点の確認：
提示された内容をもとにユーザが求めている修正を次の指示に従って分析せよ。
- エラーや不具合の修正を行う際は根本的な解消を図ってください。すなわちコードやエラーの強制削除、ハードコード、代替・簡易的な対応を禁止する。
- エラーが与えられた場合はエラーの解消を行うことを目標としてください。
- ユーザから望まない動作（不具合）の状況が報告された場合は./refディレクトリから最新の仕様書を取得し、正常な場合の動作を確認してください。
- ユーザから望まない動作（不具合）の状況がと正常な動作の差異があれば正しい仕様通りの動作になることを目標としてください。
- 上記において動作の差異がなかった場合、仕様の変更やあなたの誤解が考えられるので正しい仕様とユーザに認められるまでユーザと意志のすり合わせを行ってください。
- 仕様書から変更があった場合は正しい仕様（現在すり合わせた新しい仕様）になるように仕様書を更新してください。

## STEP1. 不具合発生箇所の調査：
提示された不具合・エラーについて次の指示に従って分析せよ。
- エラーが発生している場合はエラーを発生させているコード内の具体的な箇所をを探してください。
- ユーザから不具合の内容が提示された場合は、その意図していない動作を発生させているコード内の具体的な箇所をを探してください。
- エラー・不具合の要因となっている具体的な箇所が見つからなければ、想定される箇所にデバッグコードを挿入してください。その後ユーザからデバッグログの出力結果を得てください。
- 確実に、エラー・不具合の原因となっている箇所が判明するまでこのSTEPを繰り返してください。
- エラー・不具合の原因となる箇所が判明したらSTEP2に進んでください。

## STEP2. 原因の調査：
STEP1で得たエラー・不具合の原因となっている箇所について次の指示に従って分析せよ。
- まず、ユーザの提示した不具合やエラーがなぜ生じているのか考察してください。
- 考察した原因に確実性がない場合は、STEP1で得た箇所の前後のコード・依存している関数をしっかり読み込んでください。
- 追加で読み込んだコード及び、環境や依存関係などの外的要因を考慮し再度不具合やエラーがなぜ生じているのか考察してください。
- 必要があれば gemini コマンドを用いてweb上で不具合に関連する情報のリサーチを行ってください。
- 依然として考察した原因に確実性がなく、ユーザからの情報が少しでも必要だと判断したらユーザに必要な情報を質問し回答を得てください。
- 確実に、エラー・不具合の原因となっている箇所が判明するまでこのSTEPを繰り返してください。1つでも不具合に影響しているか定かでない原因、または原因不明の箇所があれば繰り返してください。
- 考察したすべての原因が確実に不具合・エラーに影響していると判断した場合はSTEP3に進んでください。

## STEP3. 修正案の検討：
STEP2で得られた原因をもとに、不具合・エラーを解消する方法を次の指示に従って分析せよ。
- まず不具合・エラーの解消方針を検討してください
- 解消方針が立たなければ gemini コマンドを用いてweb上で解消方法や必要な技術の調査を行ってください。
- 解消方針がたったら、その方針が下記の要件を満たしているか確認してください。満たしていればSTEP4に進んでください。
  - その方針により解消する可能性が極めて高いこと
  - 解消後ユーザの求める仕様（STEP0で定義した目標）通りの動作をすること
  - 修正を行いたい箇所以外に影響が生じないこと
  - あなたが実装可能である修正であること
- 解消方針が上記要件を満たすまでこのSTEPを繰り返してください。
- 技術的に厳しい場合やライブラリ（外部の依存関係）の修正が必要な場合はその旨をユーザに遠慮なく伝えてください。


## STEP4. 修正案の実装：
STEP3で得られた修正案をもとに次の指示に従って修正を実行してください。
- 修正を開始する前に./ref/product/cacheディレクトリ内に、今回の修正のタスク管理書と設計書を作成してください。
- ./ref/systemディレクトリ内のCodingRule.mdに従ってプログラムの修正をしてください。
- プログラムの修正が完了したらCodingRule.mdに従い作成・テストを行えているか確認してください。タスク管理書と仕様・設計書を作成した場合はこれにも従っているか確認してください。
- 修正が完了したらgit pushを行ってください。その後、修正完了の旨と最終的な原因・修正内容をユーザに報告してください。./ref/product/cacheにファイルが残っていたら削除してください。