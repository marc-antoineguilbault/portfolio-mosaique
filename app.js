import { pool, colorFromSeed, RATIOS } from './data.js';

const GAP = 48;
const GAP_Y = 160;
const INITIAL_OFFSET_RANGE = 400;
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;
const RECYCLE_MARGIN_VH = 1.5;
const ANTI_REPEAT = 8;
const VELOCITY_VARIANCE = 0.5;
const MOBILE_SCALE = 0.8;

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
  colHeights = new Array(cols).fill(0).map(() => GAP - Math.random() * INITIAL_OFFSET_RANGE);
  colVelocityMultipliers = new Array(cols);
  for (let groupStart = 0; groupStart < cols; groupStart += 2) {
    const groupVel = 1 - VELOCITY_VARIANCE / 2 + Math.random() * VELOCITY_VARIANCE;
    colVelocityMultipliers[groupStart] = groupVel;
    if (groupStart + 1 < cols) colVelocityMultipliers[groupStart + 1] = groupVel;
  }
}

function placeNext(item) {
  if (item.type === 'mobile') {
    let i = 0;
    for (let k = 1; k < cols; k++) {
      if (colHeights[k] < colHeights[i]) i = k;
    }
    const w = colWidth * MOBILE_SCALE;
    const x = GAP + i * (colWidth + GAP) + (colWidth - w) / 2;
    const y = colHeights[i];
    const h = w / RATIOS.mobile;
    colHeights[i] = y + h + GAP_Y;
    return { x, y, w, h, velocityMultiplier: colVelocityMultipliers[i] };
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
    return { x, y, w, h, velocityMultiplier: colVelocityMultipliers[bestI] };
  }
}

function createTile(item, pos, label) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.type = item.type;
  el.style.background = colorFromSeed(item.seed);
  el.style.width = `${pos.w}px`;
  el.style.height = `${pos.h}px`;
  el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  el.textContent = label;
  scroller.appendChild(el);
  return { el, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h, velocityMultiplier: pos.velocityMultiplier };
}

const recentHistory = [];
let lastType = null;
const mobilePool = pool.filter(p => p.type === 'mobile');
const tabletPool = pool.filter(p => p.type === 'tablet');

function pickRandom() {
  let desiredType;
  if (lastType === 'mobile') desiredType = 'tablet';
  else if (lastType === 'tablet') desiredType = 'mobile';
  else desiredType = Math.random() < 0.5 ? 'mobile' : 'tablet';

  let candidates = desiredType === 'mobile' ? mobilePool : tabletPool;
  if (candidates.length === 0) candidates = pool;

  let item;
  let tries = 0;
  do {
    item = candidates[Math.floor(Math.random() * candidates.length)];
    tries++;
  } while (recentHistory.includes(item.seed) && tries < 20);
  recentHistory.push(item.seed);
  if (recentHistory.length > ANTI_REPEAT) recentHistory.shift();
  lastType = item.type;
  return item;
}

function recycleIfNeeded() {
  const { h: vh } = getViewportSize();
  const margin = vh * RECYCLE_MARGIN_VH;
  for (const tile of liveTiles) {
    if (tile.y + tile.h - offset * tile.velocityMultiplier < -margin) {
      const newItem = pickRandom();
      const pos = placeNext(newItem);
      tile.item = newItem;
      tile.x = pos.x;
      tile.y = pos.y;
      tile.w = pos.w;
      tile.h = pos.h;
      tile.velocityMultiplier = pos.velocityMultiplier;
      tile.el.dataset.type = newItem.type;
      tile.el.style.background = colorFromSeed(newItem.seed);
      tile.el.style.width = `${pos.w}px`;
      tile.el.style.height = `${pos.h}px`;
    }
  }
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

let offset = 0;
let velocity = BASE_VELOCITY;
let lastFrameTime = 0;
let paused = false;

scroller.addEventListener('mouseenter', () => { paused = true; });
scroller.addEventListener('mouseleave', () => { paused = false; });

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
    tile.el.style.transform = `translate3d(${tile.x}px, ${tile.y - tileOffset}px, 0)`;
  }
  recycleIfNeeded();
  requestAnimationFrame(frame);
}

function init() {
  const { w, h } = getViewportSize();
  if (w === 0 || h === 0) {
    requestAnimationFrame(init);
    return;
  }
  computeLayout();
  fillUntil(h * 2);
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
