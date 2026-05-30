// Tracker de vélocité de scroll lissée — source unique du warp.
// Ne mesure QUE le mouvement réel d'offset (molette + swipe + momentum) ; l'auto-scroll
// lent (~30 px/s) reste sous vMin → normalized() = 0 (net au repos).
// reset() neutralise les discontinuités d'offset (resize → offset=0, retour de focus) :
// sans lui, Δoffset/dt produirait un pic de vélocité parasite → warp violent.

export function createVelocityTracker({ lerp = 0.15, vMin = 200, vMax = 2500 } = {}) {
  let last = null;        // dernier offset échantillonné (null = non initialisé)
  let smooth = 0;         // vélocité lissée, px/s (signée)
  const CLAMP = vMax * 2; // borne dure : absorbe un dt aberrant / un saut d'1 frame

  return {
    // À appeler une fois par frame avec l'offset courant et le dt (s).
    sample(offset, dt) {
      if (last === null || dt <= 0) { last = offset; return smooth; }
      let raw = (offset - last) / dt;
      if (raw > CLAMP) raw = CLAMP;
      else if (raw < -CLAMP) raw = -CLAMP;
      smooth += (raw - smooth) * lerp;
      last = offset;
      return smooth;
    },
    // Vélocité normalisée 0→1 (magnitude), sous vMin = 0, au-dessus de vMax = 1.
    normalized() {
      const a = Math.abs(smooth);
      if (a <= vMin) return 0;
      const n = (a - vMin) / (vMax - vMin);
      return n > 1 ? 1 : n;
    },
    // Resynchronise sans produire de vélocité. Passer l'offset courant (resize/reprise focus).
    reset(offset) {
      smooth = 0;
      last = (offset === undefined ? null : offset);
    },
  };
}
