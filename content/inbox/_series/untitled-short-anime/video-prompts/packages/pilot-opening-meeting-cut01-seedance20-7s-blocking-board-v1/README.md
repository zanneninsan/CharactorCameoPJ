# SCENE 01 教団会議オープニング — インパクトドリー版 v2

全台本のSCENE 01（旧CUT 1）を、スタート／エンドフレームなしで生成するSeedance 2.0用パッケージ。

2026-09-02の試作`Video 9`は、人物、部屋、座席、衣装の再現は及第点。一方で、残念院さんのテンションが低く、カメラがほぼ引き画のまま、寄りの効果背景もないため、2026-09-08に演技とカメラをv2へ更新した。

## 方針

開始画像と終了画像は使わない。現行`CAM_VIDEO_1`を、引き画、残念院さんの高いテンション、約10フレームの急速ドリー、黒金の放射状効果背景、寄り停止を示す時間譜として使う。

プレビズのマネキン外観、ローポリ形状、3DCG質感、簡略化したエンブレムは完成画へ転写しない。完成映像の人物、衣装、会議室、公式エンブレムは個別資料を優先する。

## シーン範囲

残念院さんの開会宣言だけを扱う。宣言後の短い着地で終了し、信者Bの次のセリフは次CUTへ分ける。

> それでは、第810回目の満足教教団拡大会議――サティスファクション・レコンキスタを始めますわ！

## 生成設定

- モデル: Seedance 2.0
- 入力方式: Reference-to-Video
- 解像度: 1080p
- アスペクト比: 16:9
- 尺: 7秒
- カット数: 1
- 音声: 添付音声を使用。残念院さん一人だけが発話

## 添付順

1. `previz/scene01-impact-v2/scene01-impact-camera-previz-v2.mp4` — `CAM_VIDEO_1`（@Video 1）
2. `02-zannenin-identity.png` — `IMG_Z`（@Image 1）
3. `03-believer-b-identity.png` — `IMG_B`（@Image 2）
4. `04-believer-f-identity.png` — `IMG_F`（@Image 3）
5. `05-zannenin-costume-reference.png` — `CST_Z`（@Image 4）
6. `06-community-room-reference.png` — `BG_1`（@Image 5）
7. `07-manzokukyo-emblem-reference-v2.png` — `EMBLEM_1`（@Image 6）
8. `08-audio-cut01-zannenin-opening-108pct-7s.wav` — `AUDIO_Z`（@Audio 1）

`BG_1`は垂れ幕の位置、大きさ、室内との関係を担当し、`EMBLEM_1`は垂れ幕へ載せる正確な図案を担当する。背景資料内に描かれた小さなエンブレムだけには依存しない。

## 現行プレビズの読み方

- 00:00.00〜約00:03.21: 三人の正面ミディアムワイド。残念院さんが素早く立ち、大きく宣言する。
- 約00:03.25〜00:03.67: カメラ軸を変えず、約10フレームで残念院さんの胸上へ急速ドリーイン。
- 約00:03.42: 会議室から黒・深紅・金・クリームの効果背景へ切り替える。
- 約00:03.67〜00:03.83: 到達時の小さなインパクト揺れ。その後は完全固定。
- 約00:03.83〜00:07.00: 寄りと効果背景を保ち、右手を掲げて言い切る。

旧`01-cut01-two-beat-blocking-board-v1.png`は`Video 9`生成時の履歴。現行生成には添付しない。

## プレビズ再生成

```powershell
.\tools\blender-previz\build-scene01-impact-previz-v2.ps1
```

- 動画: `previz/scene01-impact-v2/scene01-impact-camera-previz-v2.mp4`
- Blender: `previz/scene01-impact-v2/scene01-impact-camera-previz-v2.blend`
- 代表フレーム: `previz/scene01-impact-v2/scene01-impact-contact-sheet-v2.jpg`
- 設計: `previz/scene01-impact-v2/scene01-impact-plan-v2.md`
- 評価: `previz/scene01-impact-v2/evaluation-scene01-impact-v2.json`

## 台詞固定

音声参照だけへ台詞内容を委ねず、`prompt.md`のタイムラインへ残念院さんの発話全文を文字で記載してある。文字列と音声を一致させ、追加、言い換え、省略、語順変更を行わない。

## 音声調整

提供されたElevenLabs音声の末尾無音を整理し、声の高さを変えない`atempo=1.08`で軽く早回ししてある。

- 出力尺: 約7.01秒
- 発話開始: 約0.29秒
- 発話終了: 約6.64秒
- 末尾余白: 約0.36秒

## 接続

- 前SCENE: なし。パイロット本編の冒頭。
- 次SCENE: 信者Bの「前回までに、何か決まりましたっけ？」。
- 接続方法: 効果背景の寄りを約0.36秒保持した直後、次SCENEへハードカット。
