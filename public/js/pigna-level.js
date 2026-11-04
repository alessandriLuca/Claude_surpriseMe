// Generatore di livelli per "Pigna trova il fazzoletto".
// Logica pura, senza DOM: usata dal gioco e dai test.

export const WALL = 1;
export const FLOOR = 0;

export const THEMES = [
  {
    name: "La cucina",
    floor: ["#f1dfc0", "#e6cfa6"],
    wall: "#8a5a36",
    obstacles: ["🪑", "🍳", "🧊", "🥘", "🪣"],
    spots: ["🧺", "📦", "🥖", "🧽"],
  },
  {
    name: "Il salotto",
    floor: ["#c99a6b", "#b98a5d"],
    wall: "#5e3b2a",
    obstacles: ["🛋️", "📺", "🪴", "🕰️", "🎹"],
    spots: ["🧸", "🧶", "👞", "📚"],
  },
  {
    name: "Il giardino",
    floor: ["#8fcf6a", "#7fc15b"],
    wall: "#5a8f3a",
    obstacles: ["🌳", "🪨", "🌻", "⛲", "🪵"],
    spots: ["🌷", "🌿", "🍂", "🕳️"],
  },
  {
    name: "La cantina",
    floor: ["#9d8f82", "#8e8174"],
    wall: "#4a3f36",
    obstacles: ["🛢️", "🍾", "🪜", "🧰", "📦"],
    spots: ["🧺", "🍷", "🥔", "🧀"],
  },
  {
    name: "La piazza della sagra",
    floor: ["#d9c7a7", "#cbb894"],
    wall: "#a0522d",
    obstacles: ["⛪", "🎪", "🪗", "🍝", "🎺"],
    spots: ["🍕", "🎈", "🧃", "🎁"],
  },
];

/** RNG deterministico (mulberry32). */
export function rngFrom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Distanze di percorso (BFS) da una cella; -1 se irraggiungibile. */
export function distances(lv, sx, sy) {
  const d = new Array(lv.cols * lv.rows).fill(-1);
  const q = [[sx, sy]];
  d[sy * lv.cols + sx] = 0;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(lv, nx, ny)) continue;
      const k = ny * lv.cols + nx;
      if (d[k] !== -1) continue;
      d[k] = d[y * lv.cols + x] + 1;
      q.push([nx, ny]);
    }
  }
  return d;
}

export function walkable(lv, x, y) {
  return x >= 0 && y >= 0 && x < lv.cols && y < lv.rows && lv.grid[y * lv.cols + x] !== WALL;
}

/** Percorso più breve (lista di celle, esclusa la partenza) o null. */
export function path(lv, sx, sy, tx, ty) {
  if (!walkable(lv, tx, ty)) return null;
  const d = distances(lv, tx, ty);
  if (d[sy * lv.cols + sx] < 0) return null;
  const out = [];
  let x = sx;
  let y = sy;
  while (x !== tx || y !== ty) {
    const cur = d[y * lv.cols + x];
    let moved = false;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (walkable(lv, nx, ny) && d[ny * lv.cols + nx] === cur - 1) {
        x = nx;
        y = ny;
        out.push([x, y]);
        moved = true;
        break;
      }
    }
    if (!moved) return null;
  }
  return out;
}

/**
 * Crea il livello n (da 1). Ogni livello è risolvibile: tutte le celle libere
 * sono raggiungibili dalla partenza.
 */
export function generateLevel(n, seed = n * 7919) {
  const rng = rngFrom(seed);
  const theme = THEMES[(n - 1) % THEMES.length];
  const cols = Math.min(13, 7 + Math.floor((n + 1) / 2));
  const rows = Math.min(17, 9 + n);
  const grid = new Array(cols * rows).fill(FLOOR);
  const deco = new Array(cols * rows).fill(null);
  for (let x = 0; x < cols; x++) {
    grid[x] = WALL;
    grid[(rows - 1) * cols + x] = WALL;
  }
  for (let y = 0; y < rows; y++) {
    grid[y * cols] = WALL;
    grid[y * cols + cols - 1] = WALL;
  }
  const lv = { n, theme, cols, rows, grid, deco, start: [1, rows - 2], spots: [], bones: [], cats: [], target: -1, timeLimit: 0 };
  const [sx, sy] = lv.start;

  const floorCount = () => grid.filter((c) => c === FLOOR).length;
  const connected = () => {
    const d = distances(lv, sx, sy);
    let reach = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) reach++;
    return reach === floorCount();
  };

  // ostacoli, solo se non spezzano la stanza
  const wantObstacles = Math.floor((cols - 2) * (rows - 2) * 0.17) + n;
  let tries = 0;
  let placed = 0;
  while (placed < wantObstacles && tries++ < wantObstacles * 25) {
    const x = 1 + Math.floor(rng() * (cols - 2));
    const y = 1 + Math.floor(rng() * (rows - 2));
    const k = y * cols + x;
    if (grid[k] !== FLOOR || Math.abs(x - sx) + Math.abs(y - sy) < 2) continue;
    grid[k] = WALL;
    if (!connected()) {
      grid[k] = FLOOR;
      continue;
    }
    deco[k] = theme.obstacles[Math.floor(rng() * theme.obstacles.length)];
    placed++;
  }

  // nascondigli, lontani dalla partenza e un po' distanziati
  const dStart = distances(lv, sx, sy);
  const free = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === FLOOR && dStart[i] >= 3) free.push(i);
  const shuffled = free.sort(() => rng() - 0.5);
  const nSpots = Math.min(3 + Math.min(n, 6), shuffled.length);
  for (const k of shuffled) {
    if (lv.spots.length >= nSpots) break;
    const x = k % cols;
    const y = Math.floor(k / cols);
    if (lv.spots.some((s) => Math.abs((s % cols) - x) + Math.abs(Math.floor(s / cols) - y) < 3)) continue;
    lv.spots.push(k);
  }
  for (const k of lv.spots) deco[k] = theme.spots[Math.floor(rng() * theme.spots.length)];
  // il fazzoletto sta in uno dei nascondigli più lontani
  const far = lv.spots.slice().sort((a, b) => dStart[b] - dStart[a]);
  lv.target = far[Math.floor(rng() * Math.max(1, Math.ceil(far.length / 2)))];

  // ossi da raccogliere
  const taken = new Set([...lv.spots, sy * cols + sx]);
  const nBones = 2 + (n % 3);
  for (const k of free.sort(() => rng() - 0.5)) {
    if (lv.bones.length >= nBones) break;
    if (!taken.has(k)) {
      lv.bones.push(k);
      taken.add(k);
    }
  }

  // gatti dispettosi dal livello 2
  const nCats = n >= 5 ? 2 : n >= 2 ? 1 : 0;
  const farFree = free.filter((k) => !taken.has(k)).sort((a, b) => dStart[b] - dStart[a]);
  for (let i = 0; i < nCats && i < farFree.length; i++) lv.cats.push(farFree[i * 3] ?? farFree[i]);

  lv.timeLimit = 40 + lv.spots.length * 5 + Math.floor((cols * rows) / 12);
  return lv;
}
