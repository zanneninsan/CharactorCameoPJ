# AGENTS.md

このリポジトリは、キャラクターと世界観の公式設定を育て、公式サイトとAI向けプロンプトへ自動反映するためのプロジェクトです。

新しいコンテキストで作業するCodexは、まずこのファイルを読んでから進めてください。

## Project Intent

目的は「キャラクター情報を育てていくサイクル」を作ることです。

- キャラクターのプロフィール、用語集、その他設定、年表を蓄積する
- 蓄積した公式設定からキャラクター公式サイトを生成する
- 同じ公式設定からAI向けプロンプトを生成する
- 同じ仕組みを別キャラクターにも転用できるようにする

主な入力口はWebフォームではなく、Codexです。ユーザーがCodexに原典、メモ、URL、既存設定、会話ログ、画像生成結果の評価などを渡し、Codexが整理して正本データへ反映します。

## Current Architecture

現時点の正本はGit管理のJSON/Markdownです。

```text
content/
  characters/
    {characterId}/
      character.json      # 公式設定の正本
  inbox/
    {characterId}/
      *.md                # 未整理の原典、メモ、確認待ち
schemas/
  character.schema.json   # character.jsonの目安スキーマ
scripts/
  build.mjs               # 公式サイトとAIプロンプトを生成
dist/
  ...                     # 生成物。基本的に手編集しない
docs/
  architecture.md         # 設計メモ
  codex-workflow.md       # Codex主導の運用
```

`dist/` は生成物です。手で編集せず、`content/` と `scripts/` を更新して再生成してください。

## Commands

PowerShellでは `npm` が実行ポリシーで止まることがあるため、基本は `npm.cmd` を使います。

```powershell
npm.cmd run build
npm.cmd run check
```

- `build`: `dist/` にサイトとプロンプトを生成する
- `check`: キャラクターJSONを読み込めるか軽く検証する

## How To Add Character Information

Critical rule: missing character information must remain undefined.

- Do not infer, invent, or complete missing facts.
- If a known field has no provided value, use `未定義`.
- If an optional list has no provided items, leave it empty.
- Do not split a character name into family/given names unless the source explicitly defines that structure.
- When reporting changes, clearly separate confirmed canon from undefined or pending items.

ユーザーからキャラクター情報を受け取ったら、次の順で処理してください。

1. 対象キャラクターIDを確認する
2. `content/characters/{characterId}/character.json` を読む
3. 受け取った情報を既存設定と照合する
4. 確定できる内容は `character.json` に反映する
5. 未確定、矛盾候補、判断材料は `content/inbox/{characterId}/` にMarkdownで残す
6. `npm.cmd run build` または `npm.cmd run check` を実行する
7. 何を公式化し、何を保留したかをユーザーに短く報告する

公式設定にないことは断定しないでください。迷う内容は勝手に公式化せず、`draft` や inbox の確認待ちとして扱います。

### New Character Workflow

新規キャラクターページを作るときは、まず `docs/new-character-workflow.md` を読んでください。

このワークフローには、ユーザと対話しながら初期ページを作るための確認順、`character.json` の初期形、未定義ルール、二次創作ガイドラインの初期案、完了報告テンプレートがまとまっています。

特に、新規キャラクター作成では以下を守ってください。

- 最初に聞くのは、キャラクター表示名、URL用ID、概要、確定プロフィール、イメージカラーを中心にする。
- 一度に質問しすぎない。追加質問は最大3つまで。
- 「まず入れられるところから」と言われたら、未定義を残して初期ページを作る。
- 苗字・名前形式ではないキャラクター名にも耐える。
- 足りない情報は推測せず `未定義` のままにする。
- URL用IDに大文字、アンダースコア、空白などが含まれる場合は、ビルド検証に通る英小文字・数字・ハイフン形式へ正規化し、元の指定は `content/inbox/{characterId}/` に確認事項として残す。
- 初期ページを作った直後は、次に何を決めるとよいかを必ず提案する。特に情報が少ないキャラクターでは、まずイメージカラー、概要・キャッチフレーズ、基本プロフィール、外見・服装、話し方・世界観、ヒーローバナー・OGP、二次創作ガイドラインの順に候補を出す。
- ユーザーに次アクションを提案するときも、公式化済みの内容と未定義・確認待ちの内容を分け、質問は最大3つに絞る。
- ヒーローバナーやロゴ画像がある場合は `brandAssets` に追加し、`npm.cmd run build` 後にキャラクターページ、ルートページのカード、`dist/{characterId}/assets/generated/ogp.png` を目視確認する。日本語テキストが入る場合は文字化けがないかも確認する。
- 新規キャラクターのトップページには、生成AIが `dist/prompts/{characterId}/` 配下のMarkdownへ辿れるよう、AI向けプロンプト誘導メタデータが出ていることを確認する。Markdown本文をHTMLへ丸ごと埋め込むより、Markdown URLを明示する方式を優先する。
- 二次創作ガイドラインは、ユーザーが追加を希望した場合、または「おすすめで進めて」と明示した場合だけ `fanworkGuidelines` として作る。希望未確認のまま勝手に公式ルール化しない。

## Character Data Notes

`character.json` の主な領域:

- `profile`: 年齢、身長体重、好きな食べ物、一人称など
- `theme`: Webページのデザインに使うイメージカラー。`primary`, `secondary`, `accent`, `paper`, `panel`, `text`, `muted` を指定できる
- `likes`: 好きなものの簡易リスト
- `links`: SNSアカウントなど、Webサイトに表示するソーシャルリンク
- `contentLinks`: 公式ゲーム、Discord、配布ページなど、SNS以外の任意コンテンツURL
- `rights`: 権利者情報。権利者名、管理者、問い合わせ先、補足を入れる。リンク先がある場合は `holderUrl`, `managedByUrl`, `contactUrl` も入れる。未確認の情報は推測せず `未定義` にする
- `glossary`: 用語集
- `settings`: 世界観、関係性、能力、話し方、禁止事項など
- `sideFlavors`: 本筋の公式設定とは別枠のサブ設定、ネタ、背景フック
- `visualReferences`: 衣装三面図など、公式ビジュアル参照画像と説明
- `timeline`: 年表。年齢固定キャラクターでは `timelineType: "fictional"` を架空年表、`timelineType: "real"` を実年表として分ける
- `promptGuidance.agent`: 会話AI/カスタムエージェント向けの振る舞い
- `promptGuidance.t2t`: Text-to-Text向けの文章生成ルール
- `promptGuidance.image`: 画像生成AI向けの外見・構図・制約
- `promptGuidance.video`: 動画生成AI向けの動き・演出・制約
- `sources`: 出典や根拠

二次創作ガイドラインを公開する場合は、末尾に `revisionHistory` を入れ、改訂日と変更概要を残してください。ガイドラインページではPDF出力導線も確認してください。

AI出力に強く影響する要素、特に口調、外見、服装、色、持ち物、世界観の禁止事項は優先して整理してください。

## Multi-Tenant Rule

別キャラクターを追加する場合は、`content/characters/{newCharacterId}/character.json` を作ります。

`characterId` はURLにも使うため、英小文字、数字、ハイフンのみを推奨します。

## Firebase / Web Editing Direction

FirebaseやFirestoreへの外部化は将来のPhase 2候補です。

現時点では、Git/JSONを公式確定版として扱います。Firestoreを導入する場合も、役割は次のように分ける想定です。

- Git/JSON: 公式確定版、履歴、レビュー、バックアップ
- Firestore: Web編集、下書き、即時更新、共同編集
- Codex: 情報整理、矛盾検出、公式化、プロンプト改善
- Build script: JSONまたはFirestoreからサイト/プロンプトを生成

Webからの入力フォームやCMSは便利ですが、初期優先度は低いです。まずはCodex主導で設定の型と運用サイクルを固めてください。

## Editing Rules

- `dist/` を直接編集しない
- 既存の未コミット変更を勝手に戻さない
- 変更範囲はユーザーの依頼に必要な部分へ絞る
- 日本語文書はUTF-8で扱う
- ビルドや検証を実行したら、結果を最終報告に含める

## Useful Docs

- `README.md`: 基本的な使い方
- `docs/architecture.md`: 技術選定と全体設計
- `docs/codex-workflow.md`: Codexで設定を追加する運用
- `schemas/character.schema.json`: キャラクター正本データの構造目安
