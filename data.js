export const projects = [
  { id: 'p1', name: 'Project Alpha', images: [
    { type: 'mobile', seed: 'a1' },
    { type: 'mobile', seed: 'a2' },
    { type: 'tablet', seed: 'a3' },
  ]},
  { id: 'p2', name: 'Project Beta', images: [
    { type: 'tablet', seed: 'b1' },
    { type: 'mobile', seed: 'b2' },
    { type: 'mobile', seed: 'b3' },
    { type: 'mobile', seed: 'b4' },
  ]},
  { id: 'p3', name: 'Project Gamma', images: [
    { type: 'mobile', seed: 'c1' },
    { type: 'tablet', seed: 'c2' },
    { type: 'tablet', seed: 'c3' },
  ]},
  { id: 'p4', name: 'Project Delta', images: [
    { type: 'mobile', seed: 'd1' },
    { type: 'mobile', seed: 'd2' },
    { type: 'mobile', seed: 'd3' },
    { type: 'tablet', seed: 'd4' },
  ]},
  { id: 'p5', name: 'Project Epsilon', images: [
    { type: 'tablet', seed: 'e1' },
    { type: 'mobile', seed: 'e2' },
    { type: 'tablet', seed: 'e3' },
  ]},
  { id: 'p6', name: 'Project Zeta', images: [
    { type: 'mobile', seed: 'f1' },
    { type: 'mobile', seed: 'f2' },
    { type: 'tablet', seed: 'f3' },
  ]},
  { id: 'p7', name: 'Project Eta', images: [
    { type: 'mobile', seed: 'g1' },
    { type: 'tablet', seed: 'g2' },
    { type: 'mobile', seed: 'g3' },
  ]},
];

export const pool = projects.flatMap(p => p.images);

function hashSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h) + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

export function colorFromSeed(seed) {
  const hue = hashSeed(seed);
  return `hsl(${hue}, 35%, 50%)`;
}

export const RATIOS = {
  mobile: 9 / 19.5,
  tablet: 3 / 4,
};
