// Curated from existing Git-tracked meme/expression references. Originals stay in place.
export const galleryMemeImages = [
  {
    "path": "drive-visuals/ネタ系-chatgpt-image-2026年4月26日-17-12-17-png-13arp7w.webp",
    "label": "金貨をもぐもぐ"
  },
  {
    "path": "drive-visuals/ネタ系-image-2-jpg-hmkl1q.webp",
    "label": "たぬきの着ぐるみ"
  },
  {
    "path": "drive-visuals/ネタ系-有志作-hhjib5-bgaaeqz2-jfif-1ue8nk5.webp",
    "label": "無課金で動画を作りたい"
  },
  {
    "path": "drive-visuals/ネタ系-有志作-hhjp-msa8aagaix-jfif-zd638g.webp",
    "label": "ニヤリ顔"
  },
  {
    "path": "drive-visuals/ネタ系-有志作-hhkgl7ebcaetk1j-jfif-o67rok.webp",
    "label": "激辛ラーメン"
  },
  {
    "path": "drive-visuals/ネタ系-有志作-hhnfwhwbgaalwkk-jfif-gh6x49.webp",
    "label": "残念院さんの行列"
  },
  {
    "path": "drive-visuals/ネタ系-有志作-hhnniojbcaakdja-jfif-1brs1cc.webp",
    "label": "ご満悦のキラキラ顔"
  },
  {
    "path": "drive-visuals/ネタ系-有志作-hhpix9xbeaenqyi-jfif-1o0r31z.webp",
    "label": "ニュース速報"
  },
  {
    "path": "drive-visuals/ネタ系-段落テキスト-png-lgnltu.webp",
    "label": "説教顔"
  },
  {
    "path": "drive-visuals/表情系-chatgpt-image-2026年4月22日-20-27-18-png-1ajia2.webp",
    "label": "涙をぬぐう"
  },
  {
    "path": "drive-visuals/表情系-chatgpt-image-2026年4月22日-23-48-52-png-146vkt8.webp",
    "label": "両手でにっこり"
  },
  {
    "path": "drive-visuals/表情系-chatgpt-image-2026年4月23日-19-50-04-png-65i2ny.webp",
    "label": "おちゃめな舌出し"
  }
];

export function galleryImagePath(index, anomaly, records, thumbnail = false) {
  if (anomaly?.kind === 'meme-gallery') {
    const slot = index % galleryMemeImages.length;
    return thumbnail ? `../../../assets/generated/manzokukyo/gallery/meme-${String(slot + 1).padStart(2, '0')}-room.webp` : `../../../assets/${galleryMemeImages[slot].path}`;
  }
  const record = records[anomaly?.kind === 'same-image' ? anomaly.index : index];
  return thumbnail ? `../../../assets/generated/manzokukyo/gallery/gallery-${record.id}-room.webp` : `../../../assets/manzokukyo/gallery/gallery-${record.id}.png`;
}
