# Character Cameo PJ

キャラクターと世界観の公式設定を育て、公式サイトとAI向けプロンプトへ自動変換するためのGit管理型ナレッジベースです。

## まず使う

```powershell
npm.cmd run build
```

生成物は `dist/` に出ます。

- `dist/index.html`: キャラクター一覧
- `dist/{characterId}/index.html`: 公式サイト。SNSリンクや任意コンテンツURLがある場合はLitlink的なリンク集も表示
- `dist/prompts/{characterId}/agent.md`: AIエージェントとしてキャラクター本人に振る舞わせるプロンプト
- `dist/prompts/{characterId}/t2t.md`: Text-to-Textへキャラクター情報を参照資料として渡すプロンプト
- `dist/prompts/{characterId}/image.md`: 画像生成AI向けプロンプト
- `dist/prompts/{characterId}/video.md`: 動画生成AI向けプロンプト

## キャラクターを追加する

`content/characters/{characterId}/character.json` を追加します。構造は `content/characters/demo-character/character.json` をコピーすると始めやすいです。

## 育て方

1. 原典、メモ、会話ログ、画像指示、既存設定などを `content/inbox/{characterId}/` に置く
2. 確定した公式設定を `content/characters/{characterId}/character.json` に追記する
3. `npm.cmd run build` でサイトとAI向けプロンプトを再生成する
4. GitHub Pagesに公開する

設計方針は `docs/architecture.md` にまとめています。
