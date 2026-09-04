# キュート版ティザーサイト

既存2案を保持した独立した3案目。公式設定の追加ではなく、公開前のデザイン案です。

## プレビュー

- 今回: `/anime/manzokukyo-zannenin-cute/`
- 初代（変更なし）: `/anime/manzokukyo-zannenin/`
- 前案（変更なし）: `/anime/manzokukyo-zannenin-next/`

この案だけ生成: `node scripts/build-anime-teaser-cute.mjs`

リンク・透過・切替動作検証: `node scripts/check-anime-teaser-cute.mjs`

生成先は `dist/anime/manzokukyo-zannenin-cute/`。生成物を直接編集しない。PDFの生成および外部公開はしていません。

## 素材

- 残念院さんの立ち絵: ユーザー提供 `D:/download_d/Codex 画像 2026年9月4日 02_52_24.png` を採用。正面を切り出し、rembg / isnet-animeで背景を透過。描き直しなし。
- キービジュアル: 上記最新レタッチ版と既存の信者F・信者B透過素材を参照した画像生成による新規ポーズの提案。正本資料の代用にはしない。衣装の細部は公開前に監修が必要。
- 新規素材保存先: `content/inbox/_series/untitled-short-anime/website-assets/manzokukyo-zannenin-cute/`
- キービジュアル生成記録: 同フォルダの `keyvisual-prompt.md`。
- ロゴ・信者F・信者B: 既存 `website-assets/manzokukyo-zannenin/` の透過素材を再利用。
- エンブレム: `world-setting-assets/manzokukyo-emblem-v2.png`。

既存2案の画像は差し替えていません。広告用の短いコピーは仮案であり、キャラクターJSONへ公式化していません。キャラクター紹介の初期選択は残念院さん。Fは他の人物より小柄に表示。「3人組」とは表記しません。映像・スタッフ・キャストは未発表のため仮名や架空の公開日を置いていません。

## 参考サイトの研究

- [アズールレーン びそくぜんしんっ！にっ！](https://2nd.azurlane-bisoku.jp/): 大きなキービジュアル、丸い形、鮮やかな差し色による作品主体の構成。
- [株式会社マジルミエ](https://magilumiere-pr.com/): イラストと強いタイトルタイポグラフィを主役にした第一画面。
- [乙女怪獣キャラメリゼ](https://otomekaiju.com/): ビジュアルの占有率、鮮明な作品色、キャッチコピーの一体感。

参考先のイラスト・ロゴ・ソースは転用していません。桃色、ミント、淡い黄色、日本語の丸い見出し、会議メモ風のおはなし紹介として独自に実装しています。

## 検証範囲

正本の文字コード・JSON、生成、ローカルURL、ファイル参照、透過チャンネル、タブのクリック・キー操作・スワイプ・メニュー操作を検証。操作テストはDOMのテスト用代替オブジェクトによるものです。ブラウザでの画面サイズ別の見た目は未検証です。
