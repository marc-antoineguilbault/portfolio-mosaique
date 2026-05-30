// Curseur élastique + glyphe contextuel. Possède l'élément #cursor.
// - Élasticité : position rattrapée par lerp (inertie) + étirement directionnel (ellipse) ∝ vitesse.
// - Glyphe : délégation — au survol d'un [data-cursor], le rond devient disque blanc à glyphe noir.
// Desktop only (hasHover). reduced-motion : position directe + glyphe, mais pas d'élasticité.

const LERP = 0.2;          // inertie : 0.2 ≈ rattrapage doux
const STRETCH_K = 0.045;   // étirement ∝ vitesse (px/frame)
const STRETCH_MAX = 0.45;  // plafond d'étirement

export function initCursor({ hasHover, reducedMotion }) {
  const cur = document.getElementById('cursor');
  if (!cur || !hasHover) return;   // tactile : pas de curseur (déjà masqué en CSS)

  let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
  let cx = tx, cy = ty;

  window.addEventListener('mousemove', (e) => {
    tx = e.clientX; ty = e.clientY;
    if (reducedMotion) {
      // position directe (pas d'inertie), centrée
      cur.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -50%)`;
    }
  });

  // Glyphe contextuel par délégation : suit l'élément [data-cursor] survolé.
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-cursor]');
    setGlyph(el ? el.getAttribute('data-cursor') : '');
  });
  document.addEventListener('mouseout', (e) => {
    const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-cursor]');
    if (!to) setGlyph('');
  });

  function setGlyph(g) {
    if (g) { cur.textContent = g; cur.classList.add('has-glyph'); }
    else { cur.textContent = ''; cur.classList.remove('has-glyph'); }
  }

  if (reducedMotion) return;   // pas de boucle d'élasticité

  function tick() {
    const px = cx, py = cy;
    cx += (tx - cx) * LERP;
    cy += (ty - cy) * LERP;
    const vx = cx - px, vy = cy - py;
    const st = Math.min(Math.hypot(vx, vy) * STRETCH_K, STRETCH_MAX);
    const ang = Math.atan2(vy, vx);
    cur.style.transform =
      `translate(${cx}px, ${cy}px) translate(-50%, -50%) rotate(${ang}rad) scale(${1 + st}, ${1 - st * 0.6})`;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
