# キャラクター公式設定ナレッジベース 設計メモ

## 目的

キャラクターと世界観の設定を継続的に蓄積し、以下のアウトプットへ自動反映する。

- キャラクター公式サイト
- AIエージェントとしてキャラクター本人に振る舞わせるプロンプト
- Text-to-Textへキャラクター情報を参照資料として渡すプロンプト
- 画像生成AI向けプロンプト
- 動画生成AI向けプロンプト

この仕組みは複数キャラクターに転用できるよう、キャラクター単位のマルチテナント構造にする。

## 運用の前提

主な入力面はGitHub Pages上のWebフォームではなく、Codex側での追記・整理・反映とする。

想定する基本操作:

- ユーザーがCodexに原典、メモ、URL、既存設定、画像生成結果の評価などを渡す
- Codexが内容を読み、未整理情報を `content/inbox/{characterId}/` に保存する
- Codexが確定情報、未確定情報、矛盾候補を分ける
- ユーザー確認後、Codexが `content/characters/{characterId}/character.json` を更新する
- ビルドで公式サイトとAI向けプロンプトへ反映する

Web側の入力フォームやCMSは便利だが、初期優先度は低い。まずはCodexを編集・整理の主役にする。

## 技術選定

### 採用: Git管理の静的生成

初期MVPでは、設定データをJSON/MarkdownとしてGitで管理し、Node.jsのビルドスクリプトでHTMLとMarkdownプロンプトを生成する。

理由:

- GitHub Pagesだけで公開でき、サーバー運用が不要
- 設定の変更履歴、差分レビュー、巻き戻しがGitで扱える
- キャラクターごとのディレクトリ追加でマルチテナント化できる
- AI向けプロンプトもサイトと同じ正本データから生成できる
- 将来Astro/Next.js/Headless CMSへ移行しやすい

### 後回しにするもの

- Webフォームからの設定追加
- ブラウザ上の管理画面
- 複数人同時編集
- データベース運用

これらは、キャラクター設定の型と運用サイクルが固まってから追加する。

### 将来候補

- Astro: 公式サイトの表現力、コンポーネント化、検索追加を強化したい段階で導入
- Decap CMS / TinaCMS: ブラウザから設定を編集したい段階で導入
- SQLite / Supabase: Web UIから複数人が同時編集する段階で導入
- ベクトルDB: 大量の原典からRAG検索や矛盾検出をしたい段階で導入

## データ構造

```text
content/
  characters/
    {characterId}/
      character.json      # 確定した公式設定の正本
  inbox/
    {characterId}/
      *.md                # 未整理の原典、メモ、会話ログ
schemas/
  character.schema.json   # character.jsonの目安スキーマ
scripts/
  build.mjs               # サイトとプロンプトを生成
dist/
  ...                     # GitHub Pages用生成物
```

`character.json` は次の考え方で分ける。

- `profile`: 年齢、身長体重、好きな食べ物などのプロフィール
- `theme`: Webページのデザインに使うイメージカラー。キャラクターごとに配色を変える
- `links`: SNSアカウントなど、Litlink的に表示するソーシャルリンク
- `contentLinks`: 公式ゲーム、Discord、配布ページなど、SNS以外の任意コンテンツURL
- `glossary`: 用語集
- `settings`: 世界観、能力、関係性、禁止事項などの設定
- `sideFlavors`: サイドフレーバー。本筋とは別枠のサブ設定、ネタ、背景フック
- `visualReferences`: 衣装三面図などの公式ビジュアル参照画像と説明
- `timeline`: 年表、時系列
- `promptGuidance`: AIに渡すときの振る舞い、文章生成、見た目、動画演出の補助情報
- `sources`: 原典や出典

ビジュアル資料は、ベース資料とGoogle Drive由来の追加資料を分けて表示する。Drive由来の資料は `source: "google-drive"` と `driveId` を持ち、`scripts/import-drive-visuals.mjs` による手動取り込みで `assets/drive-visuals/` にWebP化して保存する。サイト側では段階表示、スマホ2カラム、遅延ロード、モーダル表示、左右移動、別タブ表示を提供する。

生成サイトは、GitHub Pages公開とクローラ閲覧を前提に、OGP/Twitter Card、JSON-LD、`robots.txt`、`sitemap.xml`、`.nojekyll` を出力する。公開URLやソースURLは環境変数で上書きできる。

ルートページと個別キャラクターページには、編集協力のためのソースリンクを表示する。個別ページでは末尾に該当 `character.json` とGitHubリポジトリへのリンクを出す。

## キャラクター情報を育てるサイクル

1. 収集: ユーザーがCodexに原典、SNS投稿、台本、画像指示、作者メモなどを渡す
2. 保管: Codexが必要に応じて `inbox` に未整理情報を残す
3. 整理: Codexが事実、推測、未確定、矛盾を分ける
4. 公式化: ユーザー確認後、確定した内容だけを `character.json` に追記
5. 生成: 公式サイトとAI向けプロンプトをビルド
6. 検証: サイト表示、プロンプトの再現性、矛盾の有無を確認
7. 反映: GitHub Pagesへ公開

## 初期MVPの範囲

- 複数キャラクターの読み込み
- キャラクター別公式サイト生成
- AI向けプロンプト4種の生成: Agent, Text-to-Text, Image, Video
- GitHub Pages用ワークフロー
- JSONの軽量バリデーション
- Codex主導の情報追加フロー

## 次に足すとよい機能

- `inbox` から公式設定候補を抽出するAI補助スクリプト
- 設定の確度: `official`, `draft`, `rumor`, `deprecated`
- 出典単位の引用リンク
- キャラクター間の関係性グラフ
- サイト内検索
- プロンプトのモデル別テンプレート
- 画像生成用のポジティブ/ネガティブプロンプト分離
