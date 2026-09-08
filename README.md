# Paper Review — 論文査読

LabPay の「論文査読」を、HTML・CSS・JavaScript だけで使える独立したアプリに移植しました。PHP・データベースサーバー・npm install・ビルドは不要です。

## 使い方

1. このフォルダー全体を同じ場所に置き、`index.html` を Chrome / Edge などのブラウザで開きます。ZIPの場合は先に展開してください。
2. 論文PDFを選びます。必要に応じて投稿先、厳しさ、回答文・回答PDFを指定します。
3. 画面右側の「OpenAI APIキー」に自分のキーを入力します。
4. 「査読を開始」を押します。数分かかる場合があるため、ページを開いたまま待ちます。
5. 「査読レポート」「修正TODO」「AIに相談」から結果を利用します。

OpenAI APIを利用できるキーと、選択モデルへのアクセスが必要です。API料金はキーの所有者のアカウントに発生します。LabPayのポイント課金はありません。キーをコードに書く必要はありません。

ファイルを直接開く方法がブラウザの設定で制限される場合は、このフォルダー内で以下を実行し、表示したアドレスを開いてください。Pythonはこの補助的な起動方法にだけ必要です。

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

[ローカルで開く](http://127.0.0.1:8080)

履歴は開いた場所・ブラウザごとに分かれます。`file://` からの起動と `http://127.0.0.1:8080` からの起動は別の保存場所です。移行したい結果はJSONを書き出して読み込んでください。

## 移植した機能

|機能|対応内容|
|---|---|
|論文PDF|本文・図・表・数式をOpenAIに直接渡して査読。各PDF最大30 MiB、合計50 MB未満|
|対象会議|指定可能。空欄はHCI系国際会議|
|厳しさ|緩め／やや厳しめ／厳しめ|
|モデル|GPT-6 Astra、GPT-5.6 Sol／Terra／Luna、元のGPT-5・o1。対応モデルIDの手入力も可能|
|思考量|モデルごとにAPIが対応する全段階を選択。設定・履歴・JSON・Markdownに保存し、追加チャットにも反映|
|プロンプト|元の `PAPER_REVIEW_DEFAULT_PROMPT` を全文そのまま移植。独自プロンプトへの置換・保存・既定への復帰|
|章別要約|章立てに沿った日本語要約|
|総合評価|採否7段階、スコア、査読者の自信、学生向けの平易なまとめ|
|貢献|妥当性、著者の主張と査読者の独立解釈、その差異|
|構成・論理|記述漏れ、論理展開、背景→手法→実験→結果→議論の整合性、仮説・RQとの対応|
|編集|用語、専門用語の説明、図表参照|
|統計|検定選択、仮定、効果量、多重比較、報告・解釈などの問題と改善案|
|参考文献|モデル知識と論文内の整合性に基づく確認、疑わしい引用の一覧と修正提案|
|改稿|強み・弱み、優先修正、追加分析、再実験できない場合の代替案、原文・和訳・理由・書き換え・和訳|
|リバトル|最大20,000字のテキストと回答PDFを同時使用可能。対応済み論点、漏れ、矛盾、弱い主張、修正案|
|修正TODO|元の抽出項目から生成。チェックと進捗を端末内に保存|
|AIに相談|要約と査読結果を文脈にした追加チャット。会話履歴を保存|
|履歴|査読結果・元PDF・回答PDF・チェック・会話をブラウザのIndexedDBに保存|
|出力|Markdown、結果コピー、JSONの書き出し／読み込み、印刷／PDF保存|

「参考文献の確認」は元の実装と同様に外部の文献DBを検索しません。表示される確認数はAIによる整合性評価で、文献の実在を外部照合した件数ではありません。

AIへの追加質問には、章別要約と査読結果を渡します。元PDFを再送信しないため、元の文章を確認する質問では必要箇所を質問欄に貼ってください。

## モデルと思考量

「AIの設定」でモデルを選ぶと、そのモデルの対応する思考量をすべて表示します。「モデルの既定」はAPIに思考量を指定せず送信します。元の設定を維持するため、初期モデルはGPT-5のままです。

|モデル|APIモデルID|選べる思考量（既定以外）|
|---|---|---|
|GPT-6 Astra|`gpt-6-astra`|低 `low`、標準 `medium`、高 `high`、非常に高 `xhigh`、最大 `max`|
|GPT-5.6 Sol|`gpt-5.6-sol`|なし `none`、低 `low`、標準 `medium`、高 `high`、非常に高 `xhigh`、最大 `max`|
|GPT-5.6 Terra|`gpt-5.6-terra`|なし `none`、低 `low`、標準 `medium`、高 `high`、非常に高 `xhigh`、最大 `max`|
|GPT-5.6 Luna|`gpt-5.6-luna`|なし `none`、低 `low`、標準 `medium`、高 `high`、非常に高 `xhigh`、最大 `max`|
|GPT-5|`gpt-5`|最小 `minimal`、低 `low`、標準 `medium`、高 `high`|
|o1（既存互換）|`o1`|低 `low`、標準 `medium`、高 `high`|

対応段階は2026-09-08に [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)、[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)、[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra)、[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) の公式仕様を確認しています。`gpt-5.6` はSolを指す別名として手入力でも使えます。GPT-6には `none` / `minimal`、GPT-5.6には `minimal` を表示しません。APIで確認できない `ultra` は追加していません。

モデル変更時に現在の思考量が対応しなくなった場合は「モデルの既定」に戻し、画面に理由を表示します。手入力の未知のモデルにはAPI共通の候補を表示するため、そのモデルの対応段階を確認してください。

思考量を高くすると時間や料金が増える場合があります。GPT-6・GPT-5.6では回答用の余裕を確保するため、アプリの生成上限を `high` で48,000、`xhigh` で96,000、`max` で128,000トークンに設定します。これは思考用と回答用を合わせた上限で、固定の消費量ではありません。既定・それ以下の設定では元と同じ査読24,000／追加チャット12,000を使います。元のGPT-5・o1の生成上限は変更していません。

## 元のLabPayとの違い

査読の評価基準と出力項目を移植しています。同じPDFでもAIの回答文や評価の完全一致は保証されません。

- LabPayのログイン、残高、ポイント徴収、研究AIサブスクリプションとは連携しません。
- サーバーの共有URL、共有対象への通知、複数人による同時編集、LabPayの個人TODOへの転送はありません。結果JSONやPDFを渡すことで共有します。
- タブを閉じた後のバックグラウンド実行はありません。中止・ページ終了後も、開始済みのAPI処理に料金が発生する場合があります。
- 履歴は端末内です。ブラウザのサイトデータ削除で消えるので、残したい結果はJSONで書き出してください。JSONに元PDFのバイナリは含みません。論文・回答PDFは別に保管してください。
- APIへのPDFアップロード失敗・途中で切れた出力を明示し、課金を伴う自動再試行はしません。回答PDFの送信が失敗した場合は、回答を無視して続けず停止します。

## キー・ファイルの扱い

APIキーは入力欄と実行中のメモリだけに保持し、localStorage・IndexedDB・結果JSONには保存しません。外部のJavaScriptライブラリ、CDN、分析タグは使用していません。キーは画面の「消去」で消せます。

PDFと回答文は査読時に `https://api.openai.com/v1` へ直接送信します。アップロードしたPDFは成功・失敗・中止のいずれでも削除を試み、通信切断時に備えてアップロード時に1時間の有効期限も指定しています。これはFiles API上のファイル削除であり、APIサービス全体のデータ保持方針とは別です。

この版は自分の端末で自分のキーを入力して使うための構成です。キーをHTMLやJSに書き込んで配布しないでください。

## ファイル構成

```text
index.html           画面
styles.css           共通デザイン・スマートフォン表示・印刷
result-view.css      査読結果のデザイン
app.js               入力・履歴・チェック・会話・エクスポート
prompts.js           元の査読プロンプトと出力項目
models.js            モデル一覧・思考量の対応表・生成上限
review-api.js        PDF送信・査読・追加質問・ファイル削除
tests/               APIと画面の動作確認
README.md            この説明
```

## 確認方法

依存ライブラリ不要のAPIテスト：

```sh
node --test tests/review-api.test.cjs
```

テストではAPIを模擬します。キー不要、API料金は発生しません。実際のAPIキーによる課金を伴う査読はこの開発時には実行していません。

初版ではAPIテスト14件とChromiumでの画面テスト15項目を確認しました。PDFと回答文の同時入力、全査読項目、保存・再読み込み、チェック、追加チャット、書き出し・読み込み、エラー復帰・中止、キー非保存、スマートフォン幅の表示を含みます。モデル・思考量追加後のAPIテストは53件に拡張し、すべて成功しています。

さらに、履歴の初期読み込みを意図的に遅らせ、起動直後の履歴表示とJSON読み込みが競合しないことを2件の回帰テストで確認しました（`tests/startup-race.cjs`）。

モデル・思考量追加後は `tests/model-options.cjs` で9項目を確認しました。全モデルの対応段階、非対応段階への切り替え防止、APIへの反映、保存・JSON／Markdown出力、読み込んだ結果の追加チャット、旧JSON互換、スマートフォン表示がすべて成功しています。

画面の確認用 `tests/browser-smoke.cjs` は開発環境のPlaywrightとChromiumを使用します。アプリの利用自体には必要ありません。

## 実装元とAPI仕様

- `src/handlers/ai.php`：`PAPER_REVIEW_DEFAULT_PROMPT`、`ai_paper_review()`、査読JSON形式
- `public/js/views/paper_review.js`：入力と査読結果表示
- `public/js/ai_checklist.js`：修正TODO候補の抽出
- [OpenAIのファイル入力](https://developers.openai.com/api/docs/guides/file-inputs)
- [OpenAI Files API：アップロード、有効期限、削除](https://platform.openai.com/docs/api-reference/files)
- [GPT-5](https://developers.openai.com/api/docs/models/gpt-5) / [o1](https://developers.openai.com/api/docs/models/o1)

APIの流れは元の実装に合わせ、Files API（`purpose=user_data`）→Chat Completions（`file_id`、`json_object`）です。思考量を明示した場合は `reasoning_effort` を渡します。モデルIDを手入力する場合は、このAPI形式・PDF入力・JSON出力への対応を確認してください。GPT-6では非対応の `temperature` を送信しません。詳細は [GPT-6のモデルガイド](https://developers.openai.com/api/docs/guides/latest-model) と [Chat Completionsの仕様](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) を参照してください。
