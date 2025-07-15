次に記載されている備考を踏まえ下記の指示に従って自立駆動開発によりプロダクトを完成させよ。 #$ARGUMENTS 

### <if>./ref/product/designディレクトリ内に仕様書が存在せず、./logディレクトリにログファイルもないとき
- ./ref/systemディレクトリ内のProductDesign.mdに基づきユーザにヒアリング開始

### <else if>./ref/product/designディレクトリ内に仕様書が存在しないが./logディレクトリにログファイルがあるとき
- 現状の開発状況を確認・報告し、./ref/systemディレクトリ内のProductDesign.mdに基づきユーザに追加機能のヒアリング開始

### <else if>./ref/product/designディレクトリ内に仕様書が存在するとき
- ./ref/systemディレクトリ内のProductDevelop.mdに基づき設計開始

### <else if>./ref/product/planディレクトリ内に設計書が存在するとき
- ./ref/systemディレクトリ内のProductManage.mdに基づき開発計画作成開始

### <else if>./log/product/planディレクトリ内に開発計画書（未記入）が存在するとき
- ./ref/systemディレクトリ内のCodingRule.md及び./ref/product/plan内の資料に基づき開発開始。開発進捗に応じて計画書に記入

### <else if>./ref/product/planディレクトリ内に開発計画書（記入あり）が存在するとき
- ./ref/systemディレクトリ内のCodingRule.md及び./ref/product/plan内の資料に基づき未実装個所の開発を継続。開発進捗に応じて計画書に記入

### <else if>./ref/product/planディレクトリ内に開発計画書（完了済み）が存在するとき
- ユーザに、実装済みとして./logディレクトリ内の対応するディレクトリに./product内のそれぞれファイルを移行（アーカイブ）するか確認。

### <if>./ref/product/cacheディレクトリにファイルが存在する時
- 該当のタスクを優先的に処理する。完了済みの段階に応じて./ref/systemディレクトリから必要なルールを参照し開発を進める。