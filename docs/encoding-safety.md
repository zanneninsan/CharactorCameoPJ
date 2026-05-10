# 文字化け対策ルール

このリポジトリの正本は、日本語を含むUTF-8のJSON/Markdownです。
PowerShellや一部ターミナル表示では、ファイル自体が正常でも `縺薙・` のように文字化けして見えることがあります。
表示が崩れて見えた場合でも、それを正本データとして扱わないでください。

## 基本方針

- 正本ファイルはUTF-8として読む・書く。
- 文字化けして見えたテキストを、そのまま `character.json` やMarkdownへ貼り戻さない。
- PowerShellの `Get-Content` 出力が文字化けした場合は、ファイル破損と判断する前にNode.jsでUTF-8読みを確認する。
- JSONを編集するときは、構造を壊さない方法を優先する。手編集する場合も、編集前後に `npm.cmd run check` を通す。
- 生成物の `dist/` は直接直さない。文字化けがあれば `content/`、`docs/`、`scripts/` 側を直して再生成する。

## 読み取り時の確認

日本語を含むファイルの内容確認でPowerShell表示が怪しい場合は、次のようにNode.jsで読む。

```powershell
node -e "const fs=require('fs'); console.log(fs.readFileSync('content/characters/rhenimaru/character.json','utf8'))"
```

一部だけ確認したい場合:

```powershell
node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('content/characters/rhenimaru/character.json','utf8')); console.log(c.displayName, c.summary)"
```

PowerShell側をUTF-8表示に寄せたい場合は、作業中のシェルで以下を実行してから確認してもよい。

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
chcp 65001
```

ただし、表示設定を変えても環境によっては崩れることがあります。最終判断はNode.jsでのUTF-8読み、ビルド結果、ブラウザ表示で行います。

## 編集時のルール

- `縺`, `繧`, `譁`, `蜈`, `螟`, `髯`, `荳`, `逕` などが日本語本文の大部分に混ざって見えたら、まず表示経路の文字化けを疑う。
- 文字化けして見える内容を元に、名称・プロフィール・ガイドライン本文を手で復元しない。
- ユーザー提供文を反映するときは、提供された原文を優先し、ターミナルに出た文字化け表示を根拠にしない。
- `content/characters/{characterId}/character.json` の日本語キーや値を変更したら、変更差分をNode.js読みまたはブラウザ表示で確認する。
- 日本語入り画像、OGP、バナーを追加したら、`npm.cmd run build` 後に `dist/{characterId}/assets/generated/ogp.png` とキャラクターページを目視確認する。

## 検証

通常の検証:

```powershell
npm.cmd run check
```

文字化け検査だけを実行する場合:

```powershell
npm.cmd run check:encoding
```

`check:encoding` は、正本側のテキストファイルに典型的な文字化け断片やUnicode置換文字が混入していないかを確認します。
検出された場合は、元のユーザー提供テキスト、Git履歴、またはブラウザ表示を確認してから修正してください。

## 報告時

文字化けに関わる作業をした場合は、最終報告に次を含めます。

- どの正本ファイルを変更したか
- `npm.cmd run check` の結果
- 必要に応じて `npm.cmd run build` と目視確認の結果
- 文字化けが実データ破損だったのか、表示経路だけの問題だったのか
