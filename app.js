import { pool, colorFromSeed, RATIOS } from './data.js';

const GAP = 48;
const GAP_Y = 160;
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;

// Radius ancré à la grille de référence : vw=1470, 4 cols, gap=48 → colWidth=307.5, radius=32.
const REF_COL_WIDTH = (1470 - 5 * GAP) / 4;
const REF_RADIUS_OUTER = 32;
const RADIUS_RATIO = REF_RADIUS_OUTER / REF_COL_WIDTH;
const FRAME_PADDING = 12;

// Patterns déterministes — la grille est identique à chaque reload.
const INITIAL_OFFSETS = [-50, -320, -180, -240];   // décalage Y de départ par colonne
const GROUP_VELOCITIES = [1, 1];                   // vitesses uniformes : un parallax (vitesses divergentes) entrerait en collision avec les tuiles `fullwidth`
const COL_STAGGER = [0, 80, 0, 80];                // décalage visuel permanent par colonne (briser l'alignement vertical entre cols) — offset constant, n'introduit pas de divergence dans le temps

const viewport = document.getElementById('viewport');
const scroller = document.getElementById('scroller');

let cols = 4;
let colWidth = 0;
let colHeights = [];
let colVelocityMultipliers = [];
let liveTiles = [];

function getColsForViewport(w) {
  if (w >= 900) return 4;
  if (w >= 600) return 3;
  return 2;
}

function getViewportSize() {
  const w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
  const h = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
  return { w, h };
}

function computeLayout() {
  const { w: vw } = getViewportSize();
  cols = getColsForViewport(vw);
  colWidth = (vw - (cols + 1) * GAP) / cols;
  colHeights = new Array(cols).fill(0).map((_, i) => GAP + (INITIAL_OFFSETS[i] ?? -100));
  colVelocityMultipliers = new Array(cols).fill(0).map((_, i) => GROUP_VELOCITIES[Math.floor(i / 2) % GROUP_VELOCITIES.length]);

  const radiusOuter = colWidth * RADIUS_RATIO;
  const radiusInner = Math.max(0, radiusOuter - FRAME_PADDING);
  document.documentElement.style.setProperty('--tile-radius-outer', `${radiusOuter}px`);
  document.documentElement.style.setProperty('--tile-radius-inner', `${radiusInner}px`);
}

function placeNext(item) {
  if (item.type === 'mobile') {
    let i = 0;
    for (let k = 1; k < cols; k++) {
      if (colHeights[k] < colHeights[i]) i = k;
    }
    const x = GAP + i * (colWidth + GAP);
    const y = colHeights[i];
    const w = colWidth;
    const h = w / RATIOS.mobile;
    colHeights[i] = y + h + GAP_Y;
    return { x, y, w, h, velocityMultiplier: colVelocityMultipliers[i], colIdx: i };
  } else {
    let bestI = 0;
    let bestScore = Infinity;
    for (let i = 0; i + 1 < cols; i += 2) {
      const score = Math.max(colHeights[i], colHeights[i + 1]);
      if (score < bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    const x = GAP + bestI * (colWidth + GAP);
    const y = Math.max(colHeights[bestI], colHeights[bestI + 1]);
    const w = 2 * colWidth + GAP;
    const h = w / RATIOS.tablet;
    colHeights[bestI] = y + h + GAP_Y;
    colHeights[bestI + 1] = y + h + GAP_Y;
    return { x, y, w, h, velocityMultiplier: colVelocityMultipliers[bestI], colIdx: bestI };
  }
}

const TILT_MAX_DEG = 2.5;
const TILT_PERSPECTIVE = 1400;
const CONTENT_HEIGHT_RATIO = 2.5;
const SCROLL_DOWN_DURATION = 8000;
const SCROLL_UP_DURATION = 1500;

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function attachScroll(scroller, host) {
  let animId = null;
  function animateScrollTo(target, duration, onDone) {
    cancelAnimationFrame(animId);
    const start = scroller.scrollTop;
    const delta = target - start;
    const startTime = performance.now();
    function step(t) {
      const elapsed = t - startTime;
      const progress = Math.min(elapsed / duration, 1);
      scroller.scrollTop = start + delta * easeInOutQuad(progress);
      if (progress < 1) {
        animId = requestAnimationFrame(step);
      } else if (onDone) {
        onDone();
      }
    }
    animId = requestAnimationFrame(step);
  }
  host.addEventListener('mouseenter', () => {
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 0) return;
    const distance = Math.max(maxScroll - scroller.scrollTop, 0);
    const duration = SCROLL_DOWN_DURATION * (distance / maxScroll);
    animateScrollTo(maxScroll, duration);
  });
  host.addEventListener('mouseleave', () => {
    const maxScroll = scroller.scrollHeight - scroller.clientHeight;
    if (maxScroll <= 0) return;
    const distance = scroller.scrollTop;
    const duration = SCROLL_UP_DURATION * (distance / maxScroll);
    animateScrollTo(0, duration);
  });
}

const cursorEl = document.getElementById('cursor');

window.addEventListener('mousemove', (e) => {
  cursorEl.style.left = `${e.clientX}px`;
  cursorEl.style.top = `${e.clientY}px`;
});

function attachTilt(inner) {
  const frame = inner.parentElement;
  inner.addEventListener('mouseenter', () => {
    cursorEl.classList.add('locked');
  });
  inner.addEventListener('mousemove', (e) => {
    const rect = inner.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dx = (px - cx) / cx;
    const dy = (py - cy) / cy;
    const rotateY = dx * TILT_MAX_DEG;
    const rotateX = -dy * TILT_MAX_DEG;
    frame.style.transform = `perspective(${TILT_PERSPECTIVE}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    inner.style.setProperty('--gx', (px / rect.width) * 100 + '%');
    inner.style.setProperty('--gy', (py / rect.height) * 100 + '%');
  });
  inner.addEventListener('mouseleave', () => {
    frame.style.transform = '';
    cursorEl.classList.remove('locked');
  });
}

function attachFrameGlow(frame) {
  frame.addEventListener('mousemove', (e) => {
    const rect = frame.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    frame.style.setProperty('--frame-x', x + '%');
    frame.style.setProperty('--frame-y', y + '%');
  });
}

// Extrait la couleur dominante d'une image pour piloter le glow.
// Échantillonne 32×32 px, ignore blanc/noir purs (UI chrome, fonds), moyenne RGB,
// puis convertit en HSL pour booster la saturation et plafonner la luminosité.
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

function extractGlowColor(img) {
  try {
    _glowCtx.clearRect(0, 0, 32, 32);
    _glowCtx.drawImage(img, 0, 0, 32, 32);
    const data = _glowCtx.getImageData(0, 0, 32, 32).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum > 240 || lum < 16) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
    }
    if (count === 0) return null;
    r /= count; g /= count; b /= count;
    const [h, s, l] = rgbToHsl(r, g, b);
    const sBoosted = Math.min(s * 1.8, 0.85);
    const lClamped = Math.max(0.42, Math.min(0.58, l));
    return `hsl(${h.toFixed(0)}, ${(sBoosted * 100).toFixed(0)}%, ${(lClamped * 100).toFixed(0)}%)`;
  } catch (e) {
    return null;
  }
}

function createTile(item, pos, label) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.type = item.type;
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.h}px`;
  el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;

  const color = colorFromSeed(item.seed);
  el.style.setProperty('--tile-glow-color', color);

  const frame = document.createElement('div');
  frame.className = 'tile-frame';

  const inner = document.createElement('div');
  inner.className = 'tile-inner';

  const tileScroll = document.createElement('div');
  tileScroll.className = 'tile-scroll';

  const content = document.createElement('div');
  content.className = 'tile-content';

  if (item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = '';
    img.draggable = false;
    const applyGlow = () => {
      const c = extractGlowColor(img);
      if (c) el.style.setProperty('--tile-glow-color', c);
    };
    if (img.complete && img.naturalWidth > 0) applyGlow();
    else img.addEventListener('load', applyGlow, { once: true });
    content.appendChild(img);
    content.classList.add('tile-content--image');
  } else {
    const hueMatch = color.match(/hsl\((\d+)/);
    const hue = hueMatch ? hueMatch[1] : 0;
    const lighter = `hsl(${hue}, 35%, 62%)`;
    const darker = `hsl(${hue}, 35%, 32%)`;
    content.style.background = `linear-gradient(180deg, ${lighter} 0%, ${color} 50%, ${darker} 100%)`;
    content.style.height = `${pos.h * CONTENT_HEIGHT_RATIO}px`;
    content.textContent = label;
  }

  tileScroll.appendChild(content);
  inner.appendChild(tileScroll);
  frame.appendChild(inner);

  el.appendChild(frame);
  attachTilt(inner);
  attachFrameGlow(frame);
  attachScroll(tileScroll, inner);

  scroller.appendChild(el);
  return { el, inner, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h, velocityMultiplier: pos.velocityMultiplier, colIdx: pos.colIdx };
}

// Shuffle déterministe (PRNG linéaire seedé) — entrelace les projets dès la 1ère tuile
// sans casser la propriété "grille identique à chaque reload".
function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const poolByType = {
  mobile: seededShuffle(pool.filter(p => p.type === 'mobile'), 42),
  tablet: seededShuffle(pool.filter(p => p.type === 'tablet'), 1337),
};
const poolIndices = { mobile: 0, tablet: 0 };

const TYPE_CYCLE = ['mobile', 'tablet'];
let cycleIdx = 0;

function pickRandom() {
  let desiredType;
  for (let attempt = 0; attempt < TYPE_CYCLE.length; attempt++) {
    desiredType = TYPE_CYCLE[(cycleIdx + attempt) % TYPE_CYCLE.length];
    if (poolByType[desiredType].length > 0) break;
  }
  cycleIdx++;
  const p = poolByType[desiredType];
  const item = p[poolIndices[desiredType] % p.length];
  poolIndices[desiredType]++;
  return item;
}

function fillUntil(targetHeight) {
  let counter = liveTiles.length;
  while (Math.min(...colHeights) < targetHeight) {
    const item = pickRandom();
    const pos = placeNext(item);
    const tile = createTile(item, pos, String(++counter));
    liveTiles.push(tile);
  }
}

function topUpIfNeeded() {
  const { h: vh } = getViewportSize();
  const maxVel = Math.max(...colVelocityMultipliers);
  const target = offset * maxVel + vh * 3;
  if (Math.min(...colHeights) < target) {
    fillUntil(target);
  }
}

let offset = 0;
let velocity = BASE_VELOCITY;
let lastFrameTime = 0;
let paused = false;

viewport.addEventListener('mousedown', () => { paused = true; });
window.addEventListener('mouseup', () => { paused = false; });
viewport.addEventListener('touchstart', () => { paused = true; }, { passive: true });
window.addEventListener('touchend', () => { paused = false; });
window.addEventListener('touchcancel', () => { paused = false; });

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  offset += e.deltaY * WHEEL_GAIN;
  if (offset < 0) offset = 0;
}, { passive: false });

function frame(t) {
  const dt = Math.min((t - lastFrameTime) / 1000, 0.1);
  lastFrameTime = t;
  if (!paused) {
    offset += velocity * dt;
  }
  for (const tile of liveTiles) {
    const tileOffset = offset * tile.velocityMultiplier;
    const stagger = COL_STAGGER[tile.colIdx] ?? 0;
    tile.el.style.transform = `translate3d(${tile.x}px, ${tile.y - tileOffset + stagger}px, 0)`;
  }
  topUpIfNeeded();
  requestAnimationFrame(frame);
}

function init() {
  const { w, h } = getViewportSize();
  if (w === 0 || h === 0) {
    requestAnimationFrame(init);
    return;
  }
  computeLayout();
  fillUntil(h * 3);
  lastFrameTime = performance.now();
  requestAnimationFrame(frame);
}

init();

function rebuildLayout() {
  const { h } = getViewportSize();
  computeLayout();
  for (const tile of liveTiles) {
    const pos = placeNext(tile.item);
    tile.x = pos.x;
    tile.y = pos.y;
    tile.w = pos.w;
    tile.h = pos.h;
    tile.velocityMultiplier = pos.velocityMultiplier;
    tile.colIdx = pos.colIdx;
    tile.el.style.width = `${pos.w}px`;
    tile.el.style.height = `${pos.h}px`;
  }
  fillUntil(h * 2);
  offset = 0;
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(rebuildLayout, 150);
});
