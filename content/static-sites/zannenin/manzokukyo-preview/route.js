export const TRAVEL_DISTANCE = 64;
export const STOPS = [
  { id: 'projector', label: '映写機', x: -2.35, z: -9 },
  { id: 'radio', label: '交信機', x: 2.35, z: -21 },
  { id: 'tiktok', label: '縦型スクリーン', x: -2.35, z: -33 },
  { id: 'games', label: 'ゲーム機', x: 2.35, z: -45 },
  { id: 'portrait', label: '肖像', x: -1.65, z: -57 }
].map(stop => ({ ...stop, progress: (4 - (stop.z + 7)) / TRAVEL_DISTANCE }));
