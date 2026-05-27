function buildImages(slug, mobileCount, tabletCount, ext = 'jpg', locked = false) {
  const images = [];
  for (let i = 1; i <= mobileCount; i++) {
    const n = String(i).padStart(2, '0');
    images.push({ type: 'mobile', seed: `${slug}-m${n}`, src: `assets/${slug}/m${n}.${ext}`, locked, project: slug });
  }
  for (let i = 1; i <= tabletCount; i++) {
    const n = String(i).padStart(2, '0');
    images.push({ type: 'tablet', seed: `${slug}-t${n}`, src: `assets/${slug}/t${n}.${ext}`, locked, project: slug });
  }
  return images;
}

export const projects = [
  { id: 'liquides-paris',     name: 'Liquides Paris',          desc: 'Une boutique confidentielle pour dénicher le parfum qui nous ressemble.',                                images: buildImages('liquides-paris',     2, 2, 'webp') },
  { id: 'gobelins-paris',     name: 'Gobelins Paris',          desc: 'Un site vitrine qui valorise les créations étudiantes pour promouvoir ses formations.',                  images: buildImages('gobelins-paris',     1, 3, 'webp') },
  { id: 'loreal-groupe',      name: 'L’Oréal Groupe',          desc: 'Un site corporate mettant à l’honneur les voix de ceux qui font vivre le groupe.',                       images: buildImages('loreal-groupe',      1, 3, 'webp') },
  { id: 'centre-pompidou',    name: 'Centre Pompidou',         desc: 'Un espace numérique où les œuvres se dévoilent en profondeur.',                                          images: buildImages('centre-pompidou',    1, 1, 'webp') },
  { id: 'pozzo-di-borgo',     name: 'Pozzo Di Borgo (Parfums)',desc: 'Un e-shop où chaque parfum raconte l’histoire d’un membre de la famille Pozzo Di Borgo.',                 images: buildImages('pozzo-di-borgo',     1, 2, 'webp') },
  { id: 'quintessence-paris', name: 'Quintessence Paris',      desc: 'Un site marchand où chaque senteur ouvre la porte d’une pièce d’un hôtel particulier parisien.',          images: buildImages('quintessence-paris', 2, 4, 'webp') },
  { id: 'courvoisier',        name: 'Courvoisier',             desc: 'Un site vitrine où chaque verre raconte un instant d’exception.',                                        images: buildImages('courvoisier',        0, 2, 'webp', true) },
  { id: 'royal-canin',        name: 'Royal Canin',             desc: 'Une landing page d’enrôlement pour rejoindre les ambassadeurs santé de la marque.',                      images: buildImages('royal-canin',        1, 0, 'webp') },
  { id: 'porsche-macan',      name: 'Porsche Macan',           desc: 'Une landing page où chaque détail technique se transforme en émotion de conduite.',                      images: buildImages('porsche-macan',      1, 0, 'webp') },
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
};
