import { pool, colorFromSeed, RATIOS } from './data.js';

const GAP = 48;
const GAP_Y = 160;
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;

// Patterns déterministes — la grille est identique à chaque reload.
const INITIAL_OFFSETS = [-50, -320, -180, -240];   // décalage Y de départ par colonne
const GROUP_VELOCITIES = [0.85, 1.15];             // une vitesse par paire de colonnes
const COL_STAGGER = [0, 80, 0, 80];                // décalage visuel permanent par colonne (briser l'alignement vertical entre cols)

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

const TILT_MAX_DEG = 5;
const TILT_PERSPECTIVE = 1000;

const cursorEl = document.getElementById('cursor');

window.addEventListener('mousemove', (e) => {
  cursorEl.style.left = `${e.clientX}px`;
  cursorEl.style.top = `${e.clientY}px`;
});

function attachTilt(inner) {
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
    inner.style.transform = `perspective(${TILT_PERSPECTIVE}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    inner.style.setProperty('--gx', (px / rect.width) * 100 + '%');
    inner.style.setProperty('--gy', (py / rect.height) * 100 + '%');
  });
  inner.addEventListener('mouseleave', () => {
    inner.style.transform = '';
    cursorEl.classList.remove('locked');
  });
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

  const inner = document.createElement('div');
  inner.className = 'tile-inner';
  inner.style.background = color;
  inner.textContent = label;
  el.appendChild(inner);
  attachTilt(inner);

  scroller.appendChild(el);
  return { el, inner, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h, velocityMultiplier: pos.velocityMultiplier, colIdx: pos.colIdx };
}

const mobilePool = pool.filter(p => p.type === 'mobile');
const tabletPool = pool.filter(p => p.type === 'tablet');
let mobileIdx = 0;
let tabletIdx = 0;
let lastType = null;

function pickRandom() {
  let desiredType;
  if (lastType === 'mobile') desiredType = 'tablet';
  else if (lastType === 'tablet') desiredType = 'mobile';
  else desiredType = 'mobile';

  let item;
  if (desiredType === 'mobile' && mobilePool.length > 0) {
    item = mobilePool[mobileIdx % mobilePool.length];
    mobileIdx++;
  } else if (desiredType === 'tablet' && tabletPool.length > 0) {
    item = tabletPool[tabletIdx % tabletPool.length];
    tabletIdx++;
  } else {
    item = pool[(mobileIdx + tabletIdx) % pool.length];
  }
  lastType = item.type;
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
