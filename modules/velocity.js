// Tracker de vélocité de scroll lissée — source unique du warp.
// Ne mesure que le mouvement réel d'offset ; l'auto-scroll lent reste sous vMin (warp = 0).
// reset() neutralise les discontinuités d'offset (resize → offset=0, retour de focus).
//
// warpFactor() : facteur d'étirement SIGNÉ piloté par un ressort amorti qui suit la magnitude
// normalisée. À l'arrêt du scroll, il DÉPASSE sous 0 (rebond squash) avant de se figer à 0
// exactement (seuillage → coût nul au repos / skip-write réactivé).

export function createVelocityTracker({
  lerp = 0.15, vMin = 200, vMax = 2500, spring = 0.18, springDamp = 0.45,
} = {}) {
  let last = null;     // dernier offset échantillonné (null = non initialisé)
  let smooth = 0;      // vélocité lissée, px/s (signée)
  let w = 0, wv = 0;   // facteur warp (ressort) + sa vélocité
  const CLAMP = vMax * 2;
  const REST_EPS = 0.0005;
  const WAVE_HIST = 20;                       // frames d'historique du warp (vague verticale)
  const hist = new Array(WAVE_HIST).fill(0);
  let head = 0;                               // index de la dernière valeur écrite

  const norm = () => {
    const a = Math.abs(smooth);
    if (a <= vMin) return 0;
    const n = (a - vMin) / (vMax - vMin);
    return n > 1 ? 1 : n;
  };

  return {
    sample(offset, dt) {
      if (last === null || dt <= 0) {
        last = offset;
      } else {
        let raw = (offset - last) / dt;
        if (raw > CLAMP) raw = CLAMP;
        else if (raw < -CLAMP) raw = -CLAMP;
        smooth += (raw - smooth) * lerp;
        last = offset;
      }
      // Ressort amorti du facteur warp vers la magnitude normalisée → overshoot (rebond squash).
      const target = norm();
      wv += (target - w) * spring;
      wv *= (1 - springDamp);
      w += wv;
      // Seuillage : fige à 0 au repos → warpFactor() stable, skip-write réactivé (coût nul).
      if (Math.abs(w) < REST_EPS && Math.abs(wv) < REST_EPS) { w = 0; wv = 0; }
      head = (head + 1) % WAVE_HIST;          // historise w pour la vague verticale
      hist[head] = w;
      return smooth;
    },
    normalized() { return norm(); },     // magnitude 0→1 (inchangé)
    warpFactor() { return w; },          // signé : peut dépasser sous 0 (squash) à l'arrêt
    // Facteur warp d'il y a `delayFrames` frames (interpolé). La vague verticale fait lire à
    // chaque tuile le warp avec un retard ∝ sa position Y. delayFrames = 0 → valeur courante.
    warpAt(delayFrames) {
      const d = delayFrames < 0 ? 0 : (delayFrames > WAVE_HIST - 1 ? WAVE_HIST - 1 : delayFrames);
      const i = Math.floor(d);
      const a = hist[(head - i + WAVE_HIST * 2) % WAVE_HIST];
      const b = hist[(head - i - 1 + WAVE_HIST * 2) % WAVE_HIST];
      return a + (b - a) * (d - i);
    },
    reset(offset) {
      smooth = 0; w = 0; wv = 0;
      hist.fill(0); head = 0;
      last = (offset === undefined ? null : offset);
    },
  };
}
