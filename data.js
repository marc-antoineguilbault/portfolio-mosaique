function buildImages(slug, mobileCount, tabletCount, ext = 'jpg') {
  const images = [];
  for (let i = 1; i <= mobileCount; i++) {
    const n = String(i).padStart(2, '0');
    images.push({ type: 'mobile', seed: `${slug}-m${n}`, src: `assets/${slug}/m${n}.${ext}` });
  }
  for (let i = 1; i <= tabletCount; i++) {
    const n = String(i).padStart(2, '0');
    images.push({ type: 'tablet', seed: `${slug}-t${n}`, src: `assets/${slug}/t${n}.${ext}` });
  }
  return images;
}

export const projects = [
  { id: 'quintessence',   name: 'Quintessence',   images: buildImages('quintessence',   7, 2) },
  { id: 'pozzo-di-borgo', name: 'Pozzo di Borgo', images: buildImages('pozzo-di-borgo', 5, 8) },
  { id: 'mcdo',           name: 'McDonald’s',     images: buildImages('mcdo',           3, 7) },
  { id: 'loreal',         name: 'L’Oréal',        images: buildImages('loreal',         4, 8) },
  { id: 'pompidou',       name: 'Pompidou',       images: buildImages('pompidou',       3, 3, 'png') },
  { id: 'gobelins',       name: 'Gobelins',       images: buildImages('gobelins',       5, 3) },
  { id: 'liquides',       name: 'Liquides',       images: buildImages('liquides',       5, 7) },
  { id: 'placeholders',   name: 'Placeholders',   images: [
    { type: 'fullwidth', seed: 'fw01' },
    { type: 'fullwidth', seed: 'fw02' },
    { type: 'square',    seed: 'sq01' },
    { type: 'square',    seed: 'sq02' },
    { type: 'square',    seed: 'sq03' },
  ]},
];

export const pool = projects.flatMap(p => p.images);

function hashSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h) + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

export function colorFromSeed(seed) {
  const hue = hashSeed(seed);
  return `hsl(${hue}, 35%, 50%)`;
}

export const RATIOS = {
  mobile: 9 / 19.5,
  tablet: 3024 / 1964,
  fullwidth: 16 / 9,
  square: 1,
};
