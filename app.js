import { pool, colorFromSeed, RATIOS } from './data.js';

const GAP = 12;
const BASE_VELOCITY = 30;
const WHEEL_GAIN = 0.5;
const RECYCLE_MARGIN = 100;
const ANTI_REPEAT = 8;

const viewport = document.getElementById('viewport');
const scroller = document.getElementById('scroller');

let cols = 4;
let colWidth = 0;
let colHeights = [];
let liveTiles = [];

function getColsForViewport(w) {
  if (w >= 1400) return 5;
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
  colHeights = new Array(cols).fill(GAP);
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
    colHeights[i] = y + h + GAP;
    return { x, y, w, h };
  } else {
    let bestI = 0;
    let bestScore = Infinity;
    for (let i = 0; i < cols - 1; i++) {
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
    colHeights[bestI] = y + h + GAP;
    colHeights[bestI + 1] = y + h + GAP;
    return { x, y, w, h };
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
  return { el, item, x: pos.x, y: pos.y, w: pos.w, h: pos.h };
}

function pickRandom() {
  return pool[Math.floor(Math.random() * pool.length)];
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

function frame(t) {
  const dt = Math.min((t - lastFrameTime) / 1000, 0.1);
  lastFrameTime = t;
  offset += velocity * dt;
  scroller.style.transform = `translate3d(0, ${-offset}px, 0)`;
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
  requestAnimationFrame((t) => {
    lastFrameTime = t;
    requestAnimationFrame(frame);
  });
}

requestAnimationFrame(init);
