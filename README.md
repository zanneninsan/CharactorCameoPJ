# Character Cameo PJ

キャラクターと世界観の公式設定を育て、公式サイトとAI向けプロンプトへ自動変換するためのGit管理型ナレッジベースです。

## まず使う

```powershell
npm.cmd run build
npm.cmd run check
npm.cmd run dev
npm.cmd run import:drive-visuals -- zannenin
```

生成物は `dist/` に出ます。

- `dist/index.html`: キャラクター一覧
- `dist/{characterId}/index.html`: 公式サイト。SNSリンクや任意コンテンツURLがある場合はLitlink的なリンク集も表示
- `dist/prompts/{characterId}/agent.md`: AIエージェントとしてキャラクター本人に振る舞わせるプロンプト
- `dist/prompts/{characterId}/t2t.md`: Text-to-Textへキャラクター情報を参照資料として渡すプロンプト
- `dist/prompts/{characterId}/image-default.md`: 画像生成AI向けプロンプト（通常衣装）
- `dist/prompts/{characterId}/video-default.md`: 動画生成AI向けプロンプト（通常衣装）
- `dist/prompts/{characterId}/image-outfit-change.md`: 画像生成AI向けプロンプト（衣装変更用）
- `dist/prompts/{characterId}/video-outfit-change.md`: 動画生成AI向けプロンプト（衣装変更用）

`npm.cmd run check` はキャラクターJSONを軽く検証します。

`npm.cmd run dev` はローカル確認用サーバーを起動します。`PORT` 未指定時はワークツリーごとの既定ポートを使うため、起動ログに表示された `Local: http://127.0.0.1:{port}/` を開いてください。

`npm.cmd run import:drive-visuals -- {characterId}` はGoogle Drive資料集から画像を取り込む手動同期です。取り込み後は `content/characters/{characterId}/character.json` の `visualReferences` と、生成されたサムネイル/大きめ画像、ページ表示を確認してください。

公開用には `dist/robots.txt`, `dist/sitemap.xml`, `dist/.nojekyll`, OGP画像、JSON-LDも生成されます。公開URLは `SITE_URL` または `GITHUB_PAGES_URL`、ソースURLは `SOURCE_REPO_URL`、sitemapの日付は `SITEMAP_LASTMOD` で上書きできます。

## キャラクターを追加する

`content/characters/{characterId}/character.json` を追加します。構造は `content/characters/demo-character/character.json` をコピーすると始めやすいです。

## 育て方

1. 原典、メモ、会話ログ、画像指示、既存設定などを `content/inbox/{characterId}/` に置く
2. 確定した公式設定を `content/characters/{characterId}/character.json` に追記する
3. `npm.cmd run build` でサイトとAI向けプロンプトを再生成する
4. GitHub Pagesに公開する

各ページには「このサイトのソース」導線があります。ルートページはリポジトリとキャラクター設定ディレクトリへ、個別キャラクターページは末尾から該当 `character.json` とリポジトリへリンクします。

設計方針は `docs/architecture.md` にまとめています。
