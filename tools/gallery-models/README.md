# 画廊用の散策モデル

## 残念院さん v11

ユーザー指定の `D:/vroidmodel/zannenin-official-costume-v11.vrm` を、標準の散策モデルとして軽量化しました。元VRMは変更せず、大きな原本はリポジトリへ追加していません。

```powershell
npm.cmd ci --prefix tools/gallery-models
node tools/gallery-models/optimize-v11.mjs D:/vroidmodel/zannenin-official-costume-v11.vrm
node scripts/check-manzokukyo-gallery-v11.mjs
```

- 元モデル：34,501,220 bytes、96描画、72,921三角形。
- 画廊用：2,202,548 bytes、23描画、53,567三角形、22画像。容量を約94%削減。
- 最大1024pxのWebP画像に変換。顔、黒金衣装の模様、描き込まれたセル影、透過を維持。使わない表情を除き、Blinkと骨格を保持。
- 同じ骨格と材質の部品を統合し、面削減・数値の量子化を実施。顔のBlink付き部品は個別に維持する。
- VRM専用描画を使わず、標準glTFのunlit材質で元の描き込みを表示。髪は簡単な揺れを付け、VRMの物理演算や全表情の再現は行わない。
- 原本の出典・利用条件メタデータはGLBの `asset.extras.vrmMeta` に引き継ぐ。数値と原本ハッシュは `v11-optimization.json` に記録。
- glTF Validatorのエラー・警告は0。骨格の姿勢、歩行中の範囲、Blink、リソース解放は自動検査。ブラウザで実際の画像と歩行も目視確認する。
- 配布対象は `content/characters/zannenin/assets/models/zannenin-v11-gallery.glb` のみ。軽量化ツールや専用依存関係はサイトに含めない。

「散策する人」で誰念院さんと切り替える。同時に動かすのは1人で、OFF状態を保って切り替えられる。読み込み中も絵や異変ゲームは利用でき、切り替え前のモデルは新モデルの準備後に解放する。

## 誰念院さん

ユーザーが指定した試作VRM `D:/vroidmodel/zannenin-san-rough.vrm` の複製を、このフォルダに保存しています。元ファイルは変更していません。新しいキャラクターの公式設定ではなく、画廊の演出用です。

通常のサイトビルドは、コミット済みの `content/characters/zannenin/assets/models/darenin-gallery.glb` を使います。このフォルダや元VRMはサイトへコピーされません。

再生成する場合だけ、リポジトリのルートで実行してください。

```powershell
npm.cmd ci --prefix tools/gallery-models
node tools/gallery-models/optimize.mjs
node tools/gallery-models/prepare-loader.mjs
node scripts/check-manzokukyo-gallery-visitor.mjs
```

- 元モデル：393,120 bytes、63描画、6,704三角形。
- 画廊用：127,296 bytes、1描画、5,116三角形、画像テクスチャなし。
- 表情・衣装の色を頂点色にまとめ、頬の半透明は肌色と合成して不透明に固定。骨格と顔の形を残し、頂点共有・控えめな面削減・数値の量子化を実施。
- 専用のVRMライブラリ・物理演算・圧縮デコーダーを読み込まない。GLTFLoaderは既存のThree.js r185を共有し、使う補助処理だけをまとめる。
- glTF Validatorはエラー・警告ともに0。元ファイルのハッシュと実測値は `optimization.json` に記録。
- 散策の乱数は異変ゲームと独立。画面外・ダイアログ表示中・動きを減らす設定では負荷を抑え、絵の正面鑑賞中はモデルを隠す。表示ボタンをOFFにすると散策も止まる。
- ランダムな散策・足踏み・首や腕の動きは `manzokukyo-gallery-visitor.js` が制御。来館者としての通常演出で、異変判定には含めない。

GLTFLoaderと付随するユーティリティの出典は [Three.js r185](https://github.com/mrdoob/three.js/tree/r185/examples/jsm)。MITライセンス本文はサイトの `vendor/LICENSE` に同梱しています。
