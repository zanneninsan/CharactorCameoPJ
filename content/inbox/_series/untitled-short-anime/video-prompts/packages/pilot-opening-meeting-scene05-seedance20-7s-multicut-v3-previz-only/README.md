# pilot-opening-meeting-scene05-seedance20-7s-multicut-v3-previz-only

SCENE 5「要約と即答」。信者Bの要約から残念院さんの即答までを、Seedance 2.0の一つのプロンプト内で生成する7秒・2ショット・Blenderプレビズ参照版。

生成時の連番は`SCENE 5`とする。00:03.70より前を`SHOT 1`、ハードカット後を`SHOT 2`として、SCENE内の演出単位だけを区別する。次の生成単位は`SCENE 6`とする。

## 方針

カラー背景・静止配置ボードは添付しない。合格済みBlenderプレビズで人物、机、椅子、PCの配置、動き、カット点、カメラだけを示し、会議室の構造と「現画角には窓・扉がない」ことはプロンプト本文でも固定する。完成背景は日本の2Dセル画調で新規描画させる。

## 添付順

1. `02-believer-b-identity.png` — Seedance上の `@Image 1`、`IMG_B`
2. `03-zannenin-identity.png` — Seedance上の `@Image 2`、`IMG_Z`
3. `04-zannenin-costume-reference.png` — Seedance上の `@Image 3`、`COSTUME_Z`
4. `05-manzokukyo-emblem-reference.png` — Seedance上の `@Image 4`、`EMB_1`
5. `previz/v1-2d-camera/pilot-opening-meeting-scene05-previz-v1-2d-camera-7s.mp4` — Seedance上の `@Video 1`、`CAM_VIDEO_1`
6. `06-audio-believer-b-summary.mp3` — Seedance上の `@Audio 1`、`AUDIO_B`
7. `07-audio-zannenin-reply.mp3` — Seedance上の `@Audio 2`、`AUDIO_Z`

画像4枚、動画1本、音声2本。カラー背景資料は含めない。`01-scene05-two-shot-blocking-board-v4-pc-centered.png`は制作履歴として保持するが、現行生成には添付しない。

## プレビズの読み方

- 00:00〜00:03.70: SHOT 1。信者B、パイプ椅子、ノートPCを同じ中央軸へ置き、4%だけ平面TUする。
- 00:03.70: 明確なハードカット。
- 00:03.70〜00:07.00: SHOT 2。残念院さんへ切り返し、カメラを固定する。
- 動画から参照するのは人物配置、同一縮尺、家具、PC、会話軸、動作、カット時刻、平面TUと停止だけ。代理人物の外見、色、材質、ローポリ形状、3DCG画調は完成映像へ持ち込まない。

## Blenderプレビズ再生成

```powershell
.\tools\blender-previz\build-scene05-meeting-previz-v1-2d-camera.ps1 -QualityControlOnly
.\tools\blender-previz\build-scene05-meeting-previz-v1-2d-camera.ps1
```

- Python正本: `tools/blender-previz/create_scene05_meeting_previz.py`
- Blend: `previz/v1-2d-camera/pilot-opening-meeting-scene05-previz-v1-2d-camera.blend`
- QC: `previz/v1-2d-camera/qc-contact-sheet-v1-2d-camera.jpg`
- 評価: `previz/v1-2d-camera/evaluation-v1-2d-camera.json`
- 動画検査: `previz/v1-2d-camera/ffprobe-v1-2d-camera.json`

QCでは、各SHOTの人物数1、机1、黒い社長椅子1、パイプ椅子2、PC1、窓2、扉1を検査した。両SHOTの窓・扉は画角外、PCはSHOT 1だけに全体表示、二つのカメラは会話軸の同じ側で合格している。

## 箱型の部屋配置モデル

映像用プレビズと同じ座標から、天井を外した会議室全体の箱モデルを生成する。上面図、南側斜視、東壁の入口側から見た確認画像を同時に出力するため、長机、3席、PC、西壁の窓2つ、東壁の扉1つ、北壁の垂れ幕を一画面で確認できる。

東壁の扉は、室内から正対した画面でドアノブが左側になる向きへ固定する。

```powershell
.\tools\blender-previz\build-scene05-room-layout-v1.ps1
```

- Blend: `previz/room-layout-v1/scene05-room-layout-box-v1.blend`
- 3方向確認: `previz/room-layout-v1/room-layout-contact-sheet-v1.jpg`
- 上面図: `previz/room-layout-v1/layout_0001.png`
- 南側斜視: `previz/room-layout-v1/layout_0002.png`
- 入口側: `previz/room-layout-v1/layout_0003.png`
- 自動評価: `previz/room-layout-v1/evaluation-room-layout-v1.json`

## SHOT 2静止画

残念院さんへ切り返した第2ショットは、動きが落ち着いたフレーム120を1920×1080 PNGとして出力する。

```powershell
.\tools\blender-previz\render-scene05-shot2-still.ps1
```

- 静止画: `stills/scene05-shot2-frame120-v1.png`

## 音声タイミング

- 信者B: `06-audio-believer-b-summary.mp3`。発話は動画内の約00:00.338〜00:03.614。
- 残念院さん: `07-audio-zannenin-reply.mp3`。実尺2.847秒、冒頭無音約0.165秒。
- SHOT 2開始の00:03.70から残念院さん音声を再生し、発話は動画内の約00:03.865〜00:06.547。

## 生成設定

- Seedance 2.0
- Reference-to-Video
- 1080p
- 16:9
- 7秒

生成画面側で指定し、プロンプト本文へ重複記載しない。
