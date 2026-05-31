// Damping exponentiel frame-rate-independent (Freya Holmér, "Lerp Smoothing is Broken").
// Ramène `cur` vers `target` ; halfLife = secondes pour couvrir la moitié de la distance.
// 2**(-dt/H) = exp(-ln2 · dt/H) → indépendant de la cadence de rafraîchissement.
export const damp = (cur, target, halfLife, dt) =>
  target + (cur - target) * 2 ** (-dt / halfLife);
