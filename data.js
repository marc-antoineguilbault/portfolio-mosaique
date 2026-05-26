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
  { id: 'liquides-paris',     name: 'Liquides Paris',          desc: 'E-commerce et brand experience pour une parfumerie de niche.',          images: buildImages('liquides-paris',     2, 2, 'webp') },
  { id: 'gobelins-paris',     name: 'Gobelins Paris',          desc: 'Site institutionnel pour la première école d’art appliqué de France.',  images: buildImages('gobelins-paris',     1, 3, 'webp') },
  { id: 'loreal-groupe',      name: 'L’Oréal Groupe',          desc: 'Plateforme corporate pour le leader mondial de la beauté.',             images: buildImages('loreal-groupe',      1, 3, 'webp') },
  { id: 'centre-pompidou',    name: 'Centre Pompidou',         desc: 'Refonte digitale d’un haut-lieu de l’art moderne et contemporain.',     images: buildImages('centre-pompidou',    1, 1, 'webp') },
  { id: 'pozzo-di-borgo',     name: 'Pozzo Di Borgo (Parfums)',desc: 'E-shop et storytelling pour une maison de parfums confidentielle.',     images: buildImages('pozzo-di-borgo',     1, 2, 'webp') },
  { id: 'quintessence-paris', name: 'Quintessence Paris',      desc: 'Identité numérique pour une maison de bougies de luxe.',                images: buildImages('quintessence-paris', 2, 4, 'webp') },
  { id: 'courvoisier',        name: 'Courvoisier',             desc: 'Refonte digitale d’une maison de cognac historique.',                   images: buildImages('courvoisier',        0, 2, 'webp', true) },
  { id: 'royal-canin',        name: 'Royal Canin',             desc: 'Site éditorial pour le leader mondial de la nutrition animale.',       images: buildImages('royal-canin',        1, 0, 'webp') },
  { id: 'porsche-macan',      name: 'Porsche Macan',           desc: 'Page produit immersive pour la Macan 100 % électrique.',                images: buildImages('porsche-macan',      1, 0, 'webp') },
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
