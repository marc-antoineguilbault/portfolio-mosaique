// Apparition ligne par ligne de la meta d'une tile.
// Wrap chaque mot d'un <p> dans un span temporaire, mesure offsetTop par
// getBoundingClientRect() (précis pour des inlines), regroupe en lignes
// visuelles, puis reconstruit en <span class="tile-meta__line"> (clip) >
// <span class="tile-meta__line-inner"> (animé). Le texte d'origine est
// stocké en data-original-text pour permettre un re-split (resize).
//
// API :
// - splitIntoLines(pEl, startIdx?, stepMs?) → nombre de lignes produites
// - splitMetaIntoLines(meta) → split subtitle + desc avec indexes en chaîne

export function splitIntoLines(pEl, startIdx = 0, stepMs = 70) {
  const text = pEl.dataset.originalText ?? pEl.textContent.trim();
  if (!text) return 0;
  pEl.dataset.originalText = text;
  const words = text.split(/\s+/);
  pEl.replaceChildren();
  const wordSpans = [];
  words.forEach((w, i) => {
    if (i > 0) pEl.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    sp.className = '__w';
    sp.textContent = w;
    pEl.appendChild(sp);
    wordSpans.push(sp);
  });
  void pEl.offsetHeight;
  const lines = [];
  let currentTop = null;
  for (const span of wordSpans) {
    const top = span.getBoundingClientRect().top;
    if (currentTop === null || Math.abs(top - currentTop) > 2) {
      lines.push([]);
      currentTop = top;
    }
    lines[lines.length - 1].push(span.textContent);
  }
  pEl.replaceChildren();
  lines.forEach((wordList, i) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'tile-meta__line';
    const inner = document.createElement('span');
    inner.className = 'tile-meta__line-inner';
    inner.style.setProperty('--line-delay', `${(startIdx + i) * stepMs}ms`);
    inner.textContent = wordList.join(' ');
    wrapper.appendChild(inner);
    pEl.appendChild(wrapper);
  });
  return lines.length;
}

export function splitMetaIntoLines(meta) {
  const subtitle = meta.querySelector('.tile-meta__subtitle');
  const desc = meta.querySelector('.tile-meta__desc');
  let idx = 0;
  if (subtitle) idx += splitIntoLines(subtitle, idx);
  if (desc) idx += splitIntoLines(desc, idx);
}
