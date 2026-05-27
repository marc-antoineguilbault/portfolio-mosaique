// Extrait 3 couleurs distinctes en samplant 3 bandes horizontales de l'image
// (haut, milieu, bas) pour piloter le glow CSS multi-color de chaque tile.
// Échantillonne 32×32 px, ignore les pixels blanc/noir purs (UI chrome, fonds),
// boost la saturation et plafonne la luminosité.
//
// API : extractGlowColors(img) → [hsl, hsl, hsl] | null
// L'<img> doit être déjà chargée (naturalWidth > 0). En cas d'erreur (CORS, etc.) → null.

const _glowCanvas = document.createElement('canvas');
_glowCanvas.width = 32;
_glowCanvas.height = 32;
const _glowCtx = _glowCanvas.getContext('2d', { willReadFrequently: true });

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    case b: h = (r - g) / d + 4; break;
  }
  return [h * 60, s, l];
}

function bandAverage(data, yStart, yEnd) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = 0; x < 32; x++) {
      const i = (y * 32 + x) * 4;
      if (data[i + 3] < 128) continue;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum > 240 || lum < 16) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
  }
  if (count === 0) return null;
  r /= count; g /= count; b /= count;
  const [h, s, l] = rgbToHsl(r, g, b);
  const sBoosted = Math.min(s * 1.9, 0.9);
  const lClamped = Math.max(0.42, Math.min(0.6, l));
  return `hsl(${h.toFixed(0)}, ${(sBoosted * 100).toFixed(0)}%, ${(lClamped * 100).toFixed(0)}%)`;
}

export function extractGlowColors(img) {
  try {
    _glowCtx.clearRect(0, 0, 32, 32);
    _glowCtx.drawImage(img, 0, 0, 32, 32);
    const data = _glowCtx.getImageData(0, 0, 32, 32).data;
    const fallback = 'hsl(0, 0%, 50%)';
    return [
      bandAverage(data, 0, 11)  || fallback,
      bandAverage(data, 11, 22) || fallback,
      bandAverage(data, 22, 32) || fallback,
    ];
  } catch (_e) {
    return null;
  }
}
