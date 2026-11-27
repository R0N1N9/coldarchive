'use strict';
(() => {
// ============================================================= helpers
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + RNG() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = arr => arr[Math.floor(RNG() * arr.length)];
const TAU = Math.PI * 2;
const RR = Math.round;
let RNG = Math.random;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seedRNG(seed) { RNG = mulberry32(seed >>> 0); }
function unseedRNG() { RNG = Math.random; }
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const turnTo = (cur, tgt, step) => cur + clamp(angDiff(tgt, cur), -step, step);
const hyp = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const now = () => performance.now();

const T = 28;                 // tile size in px
const COLS = 60, ROWS = 42;   // generated grid size
// tile codes
const OPEN = 0, WALL = 1, RACK = 2, DOOR = 3, GLASS = 4, FENCE = 5, COVER = 6, EXT = 7; // EXT=outdoor ground
const SECTORS = [{ name: 'PERIMETER' }, { name: 'DATA FLOOR' }, { name: 'SECURE CORE' }];
// IoT devices scattered through the facility — the operator can trip one to make it go haywire
// (a loud, bright distraction that pulls guards). glyph shows on the map; c = spark/particle color.
const DEV_KINDS = [
  { name: 'Vending machine', glyph: '🅥', c: '120,200,255', say: 'dispensing cans everywhere' },
  { name: 'Printer',         glyph: '⎙', c: '235,235,245', say: 'spitting out paper' },
  { name: 'Coffee machine',  glyph: '☕', c: '190,130,80',  say: 'steaming over' },
  { name: 'Smart display',   glyph: '▣', c: '0,229,255',   say: 'strobing ads' },
  { name: 'PA speaker',      glyph: '♪', c: '255,210,120', say: 'blaring feedback' },
  { name: 'Server fans',     glyph: '✶', c: '150,170,205', say: 'screaming at redline' },
  { name: 'HVAC unit',       glyph: '❋', c: '160,210,230', say: 'rattling the ducts' },
  { name: 'Robot vacuum',    glyph: '⊚', c: '120,255,200', say: 'ramming the walls' },
  { name: 'Water cooler',    glyph: '≈', c: '120,200,255', say: 'gurgling and spraying' },
  { name: 'Charging dock',   glyph: '⌁', c: '255,150,90',  say: 'arcing sparks' },
  { name: 'Fault klaxon',    glyph: '◮', c: '255,90,90',   say: 'wailing' },
  { name: 'Forklift beacon', glyph: '◉', c: '255,190,60',  say: 'beeping and rolling' },
];
// difficulty presets — scale lethality, detection speed, alarm recovery, guard density, gear
const DIFF = {
  recruit:   { name: 'Recruit',   tag: 'New to this', guardDmg: 0.7, guardAcc: 0.46, awRate: 0.6, alarmDecay: 2.2, count: 0.65, drops: 5, hp: 120, camoRegen: 1.4 },
  operative: { name: 'Operative', tag: 'The real op',  guardDmg: 1.05, guardAcc: 0.6, awRate: 0.9, alarmDecay: 1.4, count: 0.9, drops: 3, hp: 100, camoRegen: 1.0 },
  ghost:     { name: 'Ghost',     tag: 'Lethal',       guardDmg: 1.35, guardAcc: 0.7, awRate: 1.15, alarmDecay: 0.9, count: 1.0, drops: 2, hp: 85, camoRegen: 0.8 },
};
let difficulty = 'operative';
// agent loadout chosen in the staging screen before a match (the field agent's active ability)
const AGENT_KITS = {
  camo:  { name: 'Optic Camo',   glyph: '◈', desc: 'Toggle light-bending cloak. Drains battery; the classic ghost tool.', toggle: true },
  surge: { name: 'Adrenal Surge', glyph: '⟐', desc: 'Burst of speed + patch a wound. ~6s. Cooldown 22s.', cd: 22 },
  emp:   { name: 'EMP Charge',    glyph: '✺', desc: 'Fry nearby drones & cameras for 6s. Cooldown 18s.', cd: 18 },
  decoy: { name: 'Decoy Beacon',  glyph: '⦿', desc: 'Drop a noisemaker that pulls guards off you. Cooldown 14s.', cd: 14 },
};
let agentKit = 'camo';
// "cyber warfare" — when on, the facility ICE periodically hacks the operator's console,
// and the operator must purge the intrusion or be knocked offline for a few seconds.
let cyberWar = false;
// operator console color themes — recolor the netrunner HUD + the map's neon wireframe
const OP_THEMES = {
  // the default "Cyber Op" look — teal netrunner scan with red/green accents + scanline/glitch FX
  cp:     { name: 'Cyber Op', hex: '#00ffe0', rgb: '0,255,224', text: '#cafff8', muted: '#3ea79b', fx: true },
  cyan:   { name: 'Cyan',   hex: '#00e5ff', rgb: '0,229,255',   text: '#bdf6ff', muted: '#4f8a99' },
  amber:  { name: 'Amber',  hex: '#ffb000', rgb: '255,176,0',   text: '#ffe6b0', muted: '#9a7b3a' },
  matrix: { name: 'Matrix', hex: '#2bff88', rgb: '43,255,136',  text: '#bdffd8', muted: '#4f9a6e' },
  violet: { name: 'Violet', hex: '#a06bff', rgb: '160,107,255', text: '#ddccff', muted: '#7a6aa8' },
  rose:   { name: 'Rose',   hex: '#ff57b0', rgb: '255,87,176',  text: '#ffd0ea', muted: '#a85a84' },
  ice:    { name: 'Ice',    hex: '#9fe8ff', rgb: '159,232,255', text: '#e4f7ff', muted: '#6a93a5' },
};
let opTheme = 'cp';
try { const s = localStorage.getItem('opTheme'); if (s && OP_THEMES[s]) opTheme = s; } catch (e) {}
let curHalf = -1, facRender = false;   // which split half is rendering, and whether it's the facility console
// the operator accent in canvas space (facility versus mode keeps its own red)
function opAccentRGB() { return (soloMode === 'versus' || facRender) ? '255,42,109' : (OP_THEMES[opTheme] || OP_THEMES.cyan).rgb; }
function nA(al) { return 'rgba(' + opAccentRGB() + ',' + al + ')'; }
function nHex() { return (soloMode === 'versus' || facRender) ? '#ff2a6d' : (OP_THEMES[opTheme] || OP_THEMES.cyan).hex; }
function applyOpTheme() {
  const t = OP_THEMES[opTheme] || OP_THEMES.cyan; const rs = document.documentElement.style;
  rs.setProperty('--n-cyan', t.hex); rs.setProperty('--n-edge', 'rgba(' + t.rgb + ',0.3)');
  rs.setProperty('--n-text', t.text); rs.setProperty('--n-muted', t.muted);
  document.body.classList.toggle('theme-cp', !!t.fx);   // extra netrunner FX layer
  try { localStorage.setItem('opTheme', opTheme); } catch (e) {}
}
// ===================== universe / IP skin: Cold Archive (original) vs NightWatch =====================
// Both universes share the same code; only the player-facing tokens (callsigns, faction names,
// branding, palette) differ. NightWatch maps the game onto the canon IP (Ra + Rōnin, Warden, SENTINEL).
const UNIVERSES = {
  coldarchive: {
    name: 'Cold Archive', brand: 'CYBER&nbsp;OPS<em>//</em>CS-7', title: 'CYBER OPS', title2: 'COLD ARCHIVE',
    tagline: 'Infiltrate · recover · exfil', eyebrow: 'Operation Cold Archive',
    op: 'Overwatch', callsigns: ['Agent', 'Agent 2'], ai: 'SENTINEL',
    guardU: 'GUARD', chiefU: 'CHIEF', chief: 'Site Chief',
    opTheme: 'cp', raBody: null, nwFont: false,
  },
  nightwatch: {
    name: 'NightWatch', brand: 'NIGHT&#8203;WATCH<em>//</em>CA-1', title: 'NIGHTWATCH', title2: 'COLD ARCHIVE',
    tagline: 'Eyes open. Lights out.', eyebrow: 'Operation Cold Archive · Batch Window',
    op: 'Rōnin', callsigns: ['Ra', 'Corvid'], ai: 'SENTINEL',
    guardU: 'WARDEN', chiefU: 'OVERSEER', chief: 'the Overseer',
    opTheme: 'cp', raBody: '#f2b35b', agent2Body: '#40d8e8', nwFont: true,
  },
};
let universe = 'nightwatch';
try { const s = localStorage.getItem('universe'); if (s && UNIVERSES[s]) universe = s; } catch (e) {}
function U() { return UNIVERSES[universe] || UNIVERSES.coldarchive; }
// the callsign for a field agent by index (0 = primary / Ra, 1 = second / Corvid)
function agentCallsign(idx) { const c = U().callsigns; return c[idx] || c[0]; }
// rewrite an authored (Cold Archive) string to the active universe's callsigns + faction names
function nwText(s) {
  if (universe !== 'nightwatch' || !s) return s;
  return s
    .replace(/OVERWATCH/g, 'RŌNIN').replace(/Overwatch/g, 'Rōnin')
    .replace(/Site Chief/g, 'Overseer').replace(/\bChief\b/g, 'Overseer').replace(/\bCHIEF\b/g, 'OVERSEER')
    .replace(/\bGUARDS\b/g, 'WARDENS').replace(/\bGUARD\b/g, 'WARDEN')
    .replace(/\bguards\b/g, 'wardens').replace(/\bGuards\b/g, 'Wardens')
    .replace(/\bguard\b/g, 'warden').replace(/\bGuard\b/g, 'Warden');
}
function applyUniverse() {
  const u = U();
  document.body.classList.toggle('uni-nw', universe === 'nightwatch');
  const setHTML = (sel, html) => { const e = document.querySelector(sel); if (e) e.innerHTML = html; };
  setHTML('.n-brand', u.brand);
  setHTML('#soloTitle', u.title + '<br><em>' + u.title2 + '</em>');
  setHTML('#soloTag', u.tagline);
  const eb = document.querySelector('#soloEyebrow'); if (eb) eb.textContent = u.eyebrow;
  try { document.title = u.title === 'NIGHTWATCH' ? 'NightWatch: Cold Archive' : 'Cyber Ops: Cold Archive'; } catch (e) {}
  try { localStorage.setItem('universe', universe); } catch (e) {}
}
function D() { return DIFF[difficulty] || DIFF.operative; }

// ============================================================= procedural map
// A fenced compound with a single building shell carved into rooms by recursive
// splitting. Rooms get a purpose; doors connect neighbours; one gap in the fence.
let grid, base, zoneGrid, zones, objSpots, exfil, startPos, roomList;

function genMap() {
  grid = new Uint8Array(COLS * ROWS);
  base = new Uint8Array(COLS * ROWS);
  zoneGrid = new Int16Array(COLS * ROWS).fill(-1);
  zones = []; roomList = []; objSpots = {};
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < COLS && y < ROWS) base[x + y * COLS] = v; };
  const get = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? WALL : base[x + y * COLS];

  base.fill(EXT);
  // building footprint
  const bx0 = ri(13, 15), by0 = ri(3, 4), bx1 = ri(52, 55), by1 = ri(37, 38);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(x, y, OPEN);
  // outer walls
  for (let x = bx0; x <= bx1; x++) { set(x, by0, WALL); set(x, by1, WALL); }
  for (let y = by0; y <= by1; y++) { set(bx0, y, WALL); set(bx1, y, WALL); }

  // recursive split into rooms
  const rooms = [];
  function split(x0, y0, x1, y1, depth) {
    const w = x1 - x0, h = y1 - y0;
    const minRoom = 6;
    if (depth > 5 || (w < minRoom * 2 + 1 && h < minRoom * 2 + 1) || (RNG() < 0.18 && depth > 1 && w < 16 && h < 14)) {
      rooms.push({ x0, y0, x1, y1 }); return;
    }
    const vert = (w >= h) ? (w > minRoom * 2) : !(h > minRoom * 2);
    if (vert && w > minRoom * 2) {
      const cut = ri(x0 + minRoom, x1 - minRoom);
      for (let y = y0; y <= y1; y++) set(cut, y, WALL);
      split(x0, y0, cut, y1, depth + 1); split(cut, y0, x1, y1, depth + 1);
    } else if (h > minRoom * 2) {
      const cut = ri(y0 + minRoom, y1 - minRoom);
      for (let x = x0; x <= x1; x++) set(x, cut, WALL);
      split(x0, y0, x1, cut, depth + 1); split(x0, cut, x1, y1, depth + 1);
    } else { rooms.push({ x0, y0, x1, y1 }); }
  }
  // carve a central corridor so the plan reads like a real building — rooms open off a hallway
  const corrY0 = ri(by0 + 9, by1 - 11), corrY1 = corrY0 + 1;
  for (let x = bx0; x <= bx1; x++) { set(x, corrY0 - 1, WALL); set(x, corrY1 + 1, WALL); }
  for (let y = corrY0; y <= corrY1; y++) for (let x = bx0 + 1; x <= bx1 - 1; x++) set(x, y, OPEN);
  split(bx0, by0, bx1, corrY0 - 1, 0);     // rooms above the hall
  split(bx0, corrY1 + 1, bx1, by1, 0);     // rooms below the hall
  rooms.push({ x0: bx0, y0: corrY0 - 1, x1: bx1, y1: corrY1 + 1, corridor: true });

  // room metadata
  rooms.forEach((r, i) => {
    r.id = i; r.cx = (r.x0 + r.x1) / 2; r.cy = (r.y0 + r.y1) / 2;
    r.w = r.x1 - r.x0 - 1; r.h = r.y1 - r.y0 - 1; r.area = r.w * r.h;
    r.inx0 = r.x0 + 1; r.iny0 = r.y0 + 1; r.inx1 = r.x1 - 1; r.iny1 = r.y1 - 1;
    r.doors = []; r.neighbours = [];
  });

  // connect adjacent rooms by punching a door through shared walls (build MST-ish + extras)
  function sharedWall(a, b) {
    // vertical shared edge
    if (a.x1 === b.x0 || b.x1 === a.x0) {
      const wx = (a.x1 === b.x0) ? a.x1 : b.x1;
      const y0 = Math.max(a.y0, b.y0) + 1, y1 = Math.min(a.y1, b.y1) - 1;
      if (y1 - y0 >= 1) return { x: wx, y0, y1, vert: true };
    }
    if (a.y1 === b.y0 || b.y1 === a.y0) {
      const wy = (a.y1 === b.y0) ? a.y1 : b.y1;
      const x0 = Math.max(a.x0, b.x0) + 1, x1 = Math.min(a.x1, b.x1) - 1;
      if (x1 - x0 >= 1) return { y: wy, x0, x1, vert: false };
    }
    return null;
  }
  const pairs = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const s = sharedWall(rooms[i], rooms[j]); if (s) pairs.push({ a: i, b: j, s });
  }
  // union-find for spanning connectivity
  const parent = rooms.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { parent[find(a)] = find(b); };
  const shuffled = pairs.slice().sort(() => RNG() - 0.5);
  function punch(p) {
    const s = p.s; let dx, dy;
    if (s.vert) { dx = s.x; dy = ri(s.y0, s.y1); } else { dy = s.y; dx = ri(s.x0, s.x1); }
    set(dx, dy, DOOR);
    rooms[p.a].doors.push({ x: dx, y: dy }); rooms[p.b].doors.push({ x: dx, y: dy });
    rooms[p.a].neighbours.push(p.b); rooms[p.b].neighbours.push(p.a);
  }
  for (const p of shuffled) { if (find(p.a) !== find(p.b)) { punch(p); uni(p.a, p.b); } }
  // extra doors so it isn't a pure tree (loops make patrols and routes interesting)
  for (const p of shuffled) { if (RNG() < 0.22) { const s = p.s; let has = false; rooms[p.a].doors.forEach(d => { if (Math.abs((s.vert ? s.x : d.x) - d.x) < 1 && false) has = true; }); punch(p); } }
  // hall-centric: every room that borders the corridor gets a door onto it
  const corrIdx = rooms.findIndex(r => r.corridor);
  if (corrIdx >= 0) { const corr = rooms[corrIdx];
    for (let i = 0; i < rooms.length; i++) { if (i === corrIdx || rooms[i].corridor) continue; if (rooms[i].neighbours.includes(corrIdx)) continue; const s = sharedWall(rooms[i], corr); if (s) { punch({ a: i, b: corrIdx, s }); uni(i, corrIdx); } }
  }

  // pick the perimeter-facing room on the west as the entry; the deepest room as vault (never the hall)
  rooms.sort((a, b) => a.x0 - b.x0);
  const entryRoom = rooms.find(r => !r.corridor) || rooms[0];
  // graph distance from entry
  const gd = rooms.map(() => 999); gd[entryRoom.id] = 0;
  const bq = [entryRoom.id];
  while (bq.length) { const c = bq.shift(); for (const nb of rooms[c].neighbours) if (gd[nb] > gd[c] + 1) { gd[nb] = gd[c] + 1; bq.push(nb); } }
  let vaultRoom = entryRoom, far = -1;
  for (const r of rooms) { if (r.corridor) continue; const d = gd[r.id] + r.x0 * 0.02; if (d > far && r.area >= 16) { far = d; vaultRoom = r; } }
  // network room: a mid-deep room distinct from vault, prefer east
  let netRoom = null, nscore = -1;
  for (const r of rooms) { if (r.corridor || r === vaultRoom || r === entryRoom) continue; const sc = gd[r.id] * 2 + r.x1 * 0.05 - Math.abs(r.area - 30) * 0.05; if (sc > nscore && gd[r.id] >= 2) { nscore = sc; netRoom = r; } }
  if (!netRoom) netRoom = rooms.find(r => !r.corridor && r !== vaultRoom && r !== entryRoom) || entryRoom;
  // utility junction room: close to entry but not entry
  let utilRoom = null, uscore = 1e9;
  for (const r of rooms) { if (r.corridor || r === entryRoom || r === vaultRoom || r === netRoom) continue; if (gd[r.id] >= 1 && gd[r.id] < uscore) { uscore = gd[r.id]; utilRoom = r; } }
  if (!utilRoom) utilRoom = entryRoom;

  // assign security tiers by graph distance
  rooms.forEach(r => {
    r.sec = r === vaultRoom || r === netRoom ? 2 : gd[r.id] >= 2 ? 1 : gd[r.id] >= 1 ? 1 : 0;
    r.role = 'room';
  });
  entryRoom.role = 'lobby'; entryRoom.sec = 0;
  utilRoom.role = 'utility'; vaultRoom.role = 'vault'; vaultRoom.sec = 2; netRoom.role = 'network'; netRoom.sec = 2;
  rooms.forEach(r => { if (r.corridor) { r.role = 'corridor'; r.sec = 0; } });
  // the biggest deep rooms become data halls — hot/cold-aisle rack farms (the heart of an AI DC)
  const anchors = [entryRoom, utilRoom, vaultRoom, netRoom];
  const hallCands = rooms.filter(r => !r.corridor && anchors.indexOf(r) < 0 && r.sec >= 1 && r.area >= 20).sort((a, b) => b.area - a.area);
  hallCands.slice(0, Math.min(2, hallCands.length)).forEach(r => { r.role = 'datahall'; r.sec = Math.max(r.sec, 1); });
  // smaller support rooms get human spaces (offices, restrooms, break rooms) so it feels like a real building
  const support = rooms.filter(r => !r.corridor && anchors.indexOf(r) < 0 && r.role === 'room' && r.area <= 34);
  support.forEach((r, i) => { if (r.area <= 16 && i % 3 === 0) r.role = 'restroom'; else if (r.area <= 22) r.role = 'office'; else if (i % 4 === 0) r.role = 'break'; });
  // real AI-datacenter room names, by function & security tier
  const DC_PERIM = ['Loading Dock', 'Receiving', 'Generator Yard', 'Security Office', 'Staging', 'Fuel Store', 'Guard Lobby'];
  const DC_BUILD = ['NOC', 'UPS Room', 'Battery Room', 'Switchgear', 'Chiller Plant', 'Mechanical', 'Meet-Me Room', 'Telecom', 'Pump Room', 'Fire Suppression', 'Server Closet'];
  const DC_OFFICE = ['Offices', 'Open Office', 'Admin Offices', 'IT Office', 'Conference Room', 'Reception'];
  let hi = 0, pi = 0, bi = 0, oi = 0, ri_ = 0;
  rooms.forEach(r => {
    if (r.role === 'corridor') r.name = r.w > r.h ? 'Main Corridor' : 'Corridor';
    else if (r.role === 'lobby') r.name = 'Entry Vestibule';
    else if (r.role === 'utility') r.name = 'Electrical Room';
    else if (r.role === 'vault') r.name = 'GPU Training Cage';
    else if (r.role === 'network') r.name = 'Core Network';
    else if (r.role === 'datahall') r.name = 'Data Hall ' + String.fromCharCode(65 + hi++);
    else if (r.role === 'restroom') r.name = (ri_++ % 2 ? "Women's Room" : "Men's Room");
    else if (r.role === 'office') r.name = DC_OFFICE[oi++ % DC_OFFICE.length];
    else if (r.role === 'break') r.name = 'Break Room';
    else r.name = r.sec === 0 ? DC_PERIM[pi++ % DC_PERIM.length] : DC_BUILD[bi++ % DC_BUILD.length];
    r.zone = zones.length;
    zones.push({ name: r.name, sec: r.sec, room: r });
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const k = x + y * COLS; if (zoneGrid[k] === -1) zoneGrid[k] = r.zone;
    }
  });
  roomList = rooms;

  // fence around the compound
  const fx0 = 7, fy0 = 1, fx1 = COLS - 1, fy1 = ROWS - 2;
  for (let x = fx0; x <= fx1; x++) { set(x, fy0, FENCE); set(x, fy1, FENCE); }
  for (let y = fy0; y <= fy1; y++) { set(fx0, y, FENCE); set(fx1, y, FENCE); }
  // gap in the west fence lined up with entry room
  const gapY = clamp(RR(entryRoom.cy), fy0 + 2, fy1 - 2);
  set(fx0, gapY, EXT); set(fx0, gapY - 1, EXT);
  startPos = { x: 2.5 * T, y: (gapY + 0.5) * T };

  // maintenance door on the entry room's west wall, reachable from the gap
  const mdY = clamp(gapY, entryRoom.y0 + 1, entryRoom.y1 - 1);
  set(entryRoom.x0, mdY, DOOR);
  entryRoom.doors.push({ x: entryRoom.x0, y: mdY, ext: true });
  objSpots.maint = { tx: entryRoom.x0, ty: mdY };

  // exfil van: outside the east fence
  exfil = { x: (COLS - 3) * T, y: clamp(RR(vaultRoom.cy) - 2, 3, ROWS - 6) * T, w: 2.4 * T, h: 4 * T };
  // a dock door on the east wall of some east room + fence gap near exfil
  const eastRoom = rooms.filter(r => !r.corridor && r.x1 >= bx1 - 1).sort((a, b) => Math.abs(a.cy - (exfil.y / T)) - Math.abs(b.cy - (exfil.y / T)))[0] || vaultRoom;
  const dockY = clamp(RR(eastRoom.cy), eastRoom.y0 + 1, eastRoom.y1 - 1);
  set(eastRoom.x1, dockY, DOOR);
  objSpots.dock = { tx: eastRoom.x1, ty: dockY };
  for (let y = dockY - 1; y <= dockY + 2; y++) set(fx1, y, EXT);
  objSpots.dockRoom = eastRoom;

  // objective spots inside rooms
  const spotIn = r => {
    for (let tries = 0; tries < 40; tries++) {
      const x = ri(r.inx0, r.inx1), y = ri(r.iny0, r.iny1);
      if (get(x, y) === OPEN) return { tx: x, ty: y };
    }
    return { tx: RR(r.cx), ty: RR(r.cy) };
  };
  objSpots.util = spotIn(utilRoom); objSpots.net = spotIn(netRoom);
  objSpots.uplink = spotIn(vaultRoom);
  objSpots.vaultDoor = vaultRoom.doors[0] || { x: vaultRoom.x0, y: RR(vaultRoom.cy) };
  objSpots.vaultRoom = vaultRoom; objSpots.utilRoom = utilRoom; objSpots.netRoom = netRoom; objSpots.entryRoom = entryRoom;

  // furniture: racks in network/vault, cover crates & desks elsewhere
  function scatter(r, v, count, avoid) {
    let n = 0, tries = 0;
    while (n < count && tries < count * 12) {
      tries++;
      const x = ri(r.inx0, r.inx1), y = ri(r.iny0, r.iny1);
      if (get(x, y) !== OPEN) continue;
      let near = false;
      for (const a of avoid) if (Math.abs(a.tx - x) <= 1 && Math.abs(a.ty - y) <= 1) near = true;
      if (near) continue;
      // keep doors clear
      let dClear = true;
      for (const d of r.doors) if (Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1) dClear = false;
      if (!dClear) continue;
      set(x, y, v); n++;
    }
  }
  const upA = [objSpots.uplink], utA = [objSpots.util], ntA = [objSpots.net];
  rooms.forEach(r => {
    if (r.role === 'datahall') { rackRows(r, []); }                       // hot/cold-aisle cabinet rows
    else if (r.role === 'vault') { rackRows(r, upA); }                    // GPU training cage — dense racks
    else if (r.role === 'network') { rackRows(r, ntA); }                  // core network — switch cabinets
    else if (r.role === 'utility') { scatter(r, COVER, 3, utA); }         // electrical gear
    else if (r.role === 'corridor') { /* hallways stay clear */ }
    else if (r.role === 'restroom') { stallRow(r); }                      // a row of toilet stalls
    else if (r.role === 'office') { deskGrid(r); }                        // desks in rows
    else if (r.role === 'break') { scatter(r, COVER, ri(2, 4), []); }     // tables
    else if (r.role !== 'lobby') {
      if (RNG() < 0.5) scatter(r, RACK, ri(2, Math.min(6, Math.max(2, r.area / 6))), []);
      else scatter(r, COVER, ri(2, 4), []);
    } else scatter(r, COVER, 3, []);
  });
  // outdoor cover (vehicles/units)
  for (let i = 0; i < 10; i++) {
    const x = RNG() < 0.5 ? ri(fx0 + 1, bx0 - 2) : ri(bx1 + 2, fx1 - 1);
    const y = ri(fy0 + 1, fy1 - 1);
    if (get(x, y) === EXT) set(x, y, COVER);
  }

  grid.set(base);
  return { entryRoom, vaultRoom, netRoom, utilRoom, rooms };
}

// tile access (grid = live state incl. opened doors)
const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) ? WALL : grid[tx + ty * COLS];
const solidAt = (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === DOOR || v === GLASS || v === FENCE || v === COVER; };
const walkAt = (tx, ty) => { const v = tileAt(tx, ty); return v === OPEN || v === EXT; };       // doors handled dynamically
const opaqueAt = (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === DOOR; };
const flyWalk = (tx, ty) => { const v = tileAt(tx, ty); return v === OPEN || v === EXT || v === COVER; }; // drones fly over cover
const solidPx = (x, y) => solidAt(Math.floor(x / T), Math.floor(y / T));
const zoneAtPx = (x, y) => { const tx = Math.floor(x / T), ty = Math.floor(y / T); return (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) ? -1 : zoneGrid[tx + ty * COLS]; };

// ============================================================= world state
let W = null;         // dynamic world
let game = 'menu';    // menu | play | paused | over
let mapSeed = 0;
function buildWorld() {
  seedRNG(mapSeed || (mapSeed = (Math.random() * 1e9) >>> 0));
  const info = genMap();
  W = {
    t: 0,
    ag: makeAgent(startPos.x, startPos.y, 0),
    guards: [], drones: [], cams: [], devs: [], items: [], doors: [], bodies: [], allies: [],
    tracers: [], fx: [], decoys: [], emps: [], marks: [], pings: [], waypoint: null, cues: [], reqPins: [],
    lights: zones.map(() => 1), lightT: zones.map(() => 0),
    ow: { bw: 100, drops: 3, cdrones: 2, cooldowns: {}, scanT: 0, jam: [], sweepFight: 0, selAlly: null,
      offline: 0, hack: null, intrCd: cyberWar ? 22 : 1e9, defended: 0, casts: [] },
    def: { power: 70, sel: null, reveal: 0, cd: { rally: 0, lock: 0, hack: 0, scan: 0 } },
    obj: { step: 0, access: 1, upload: 0, sweep: 0, alarm: 0, alarmT: 0, alarms: 0, lockdown: false,
      vaultCracked: false, cracking: 0, won: false, lost: false, lostMsg: '', relays: 0 },
    stats: { time: 0, kills: 0, takedowns: 0, shots: 0, alarms: 0, detections: 0, hacks: 0, picks: 0 },
    comms: [], camPhase: 0,
  };
  const ag = W.ag;
  ag.hp = ag.maxHp = D().hp; W.ow.drops = D().drops;
  ag.aim = Math.atan2(info.entryRoom.cy * T - ag.y, info.entryRoom.cx * T - ag.x);
  // Duo / two-agent co-op: a second infiltrator spawns alongside the first
  if (twoAgents()) {
    W.ag2 = makeAgent(startPos.x, startPos.y + 34, 1);
    W.ag2.hp = W.ag2.maxHp = D().hp; W.ag2.aim = ag.aim;
  } else W.ag2 = null;

  // doors (interactive)
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (base[tx + ty * COLS] === DOOR) {
      const vert = base[(tx - 1) + ty * COLS] === WALL || base[(tx + 1) + ty * COLS] === WALL ? false : true;
      const isVertWall = (base[(tx) + (ty - 1) * COLS] === WALL && base[(tx) + (ty + 1) * COLS] === WALL);
      // lock type: electronic (operator hacks), mechanical (agent picks), or both
      const rt = RNG(); const type = rt < 0.4 ? 'elec' : rt < 0.8 ? 'mech' : 'both';
      W.doors.push({ tx, ty, x: tx * T + T / 2, y: ty * T + T / 2, open: false, openT: 0, hacked: false, type,
        locked: zones[zoneGrid[tx + ty * COLS]] ? zones[zoneGrid[tx + ty * COLS]].sec : 0,
        vert: isVertWall, held: 0 });
    }
  }
  // the vault door needs keycard+crack; mark it
  const vd = objSpots.vaultDoor;
  W.vaultDoorRef = W.doors.find(d => d.tx === vd.x && d.ty === vd.y) || null;
  W.dockDoorRef = W.doors.find(d => d.tx === objSpots.dock.tx && d.ty === objSpots.dock.ty) || null;
  W.maintDoorRef = W.doors.find(d => d.tx === objSpots.maint.tx && d.ty === objSpots.maint.ty) || null;
  if (W.vaultDoorRef) W.vaultDoorRef.type = 'elec';   // vault is electronic (crack + keycard)
  if (W.maintDoorRef) W.maintDoorRef.type = 'mech';   // breach door is a mechanical lock to pick
  if (W.dockDoorRef) { W.dockDoorRef.sealed = true; W.dockDoorRef.type = 'elec'; }

  // guards: populate rooms by security tier
  let gid = 0;
  const guardPaths = [];
  roomList.forEach(r => {
    let count = r.sec === 2 ? 2 : r.sec === 1 ? (RNG() < 0.7 ? 1 : 2) : (RNG() < 0.5 ? 1 : 0);
    count = Math.max(r.sec === 2 ? 1 : 0, Math.round(count * D().count));
    if (r.role === 'lobby') count = 1;
    for (let i = 0; i < count; i++) {
      const sp = openSpotIn(r); if (!sp) continue;
      const wps = patrolFor(r);
      W.guards.push(makeGuard(gid++, sp.x, sp.y, wps, r));
    }
  });
  // mark one guard in a mid room as the Site Chief (carries keycard)
  const chiefCands = W.guards.filter(g => zones[g.zone] && zones[g.zone].sec >= 1);
  const chief = chiefCands.length ? pick(chiefCands) : W.guards[0];
  if (chief) { chief.chief = true; chief.wps = bigPatrol(chief.home); }
  W.chief = chief || null;
  // outdoor patrol: 1-2 guards walking the yard
  for (let i = 0; i < 2; i++) {
    const yx = RNG() < 0.5 ? rnd(T * 9, T * 12) : rnd((COLS - 12) * T, (COLS - 9) * T);
    const yy = rnd(T * 4, (ROWS - 4) * T);
    if (solidPx(yx, yy)) continue;
    const g = makeGuard(gid++, yx, yy, yardPatrol(), null); g.outdoor = true; W.guards.push(g);
  }

  // drones (patrol server/vault + yard)
  const droneRooms = roomList.filter(r => r.sec === 2);
  droneRooms.slice(0, 2).forEach(r => W.drones.push(makeDrone(r)));
  W.drones.push(makeDrone(null)); // yard drone

  // cameras: on walls of secure & corridor rooms
  roomList.forEach(r => {
    if (r.role === 'lobby' && RNG() < 0.5) return;
    const chance = r.sec === 2 ? 1 : r.sec === 1 ? 0.7 : 0.3;
    if (RNG() < chance) W.cams.push(makeCam(r));
    if (r.sec === 2 && RNG() < 0.5) W.cams.push(makeCam(r));
  });

  // IoT distraction devices — tripping one makes it go haywire (noise + sparks)
  const devBag = DEV_KINDS.slice().sort(() => RNG() - 0.5); let dvn = 0;
  roomList.forEach(r => {
    if (RNG() < 0.6 || r.sec === 0) {
      const sp = openSpotIn(r); if (sp) { const k = devBag[dvn++ % devBag.length]; W.devs.push({ x: sp.x, y: sp.y, name: k.name, glyph: k.glyph, c: k.c, say: k.say, radius: ri(150, 240), active: 0, said: false, hacked: false, zone: r.zone }); }
    }
  });
  // supply/ammo scattered
  const supRooms = roomList.filter(r => r.role !== 'vault').sort(() => RNG() - 0.5).slice(0, 4);
  supRooms.forEach((r, i) => { const sp = openSpotIn(r); if (sp) W.items.push({ kind: i % 2 ? 'med' : 'ammo', x: sp.x, y: sp.y, got: false }); });

  // spawn safety: nothing should have eyes on the entry gap at t=0
  W.guards.forEach(g => { if (hyp(g.x, g.y, startPos.x, startPos.y) < 230) { const s = g.wps[g.wps.length - 1]; g.x = s.x; g.y = s.y; g.home = { x: s.x, y: s.y }; } g.face += Math.PI; });
  W.drones.forEach(dr => { if (hyp(dr.x, dr.y, startPos.x, startPos.y) < 260) { const s = dr.wps[Math.min(1, dr.wps.length - 1)]; dr.x = s.x; dr.y = s.y; } });
  W.cams.forEach(c => { if (hyp(c.x, c.y, startPos.x, startPos.y) < 200) c.dead = true; });
  W.cam = { x: ag.x, y: ag.y, z: 1 };
  W.cam2 = { x: W.ag2 ? W.ag2.x : ag.x, y: W.ag2 ? W.ag2.y : ag.y, z: 1 };
  W.opCam = { x: (COLS * T) / 2, y: (ROWS * T) / 2, z: Math.min(window.innerWidth / (COLS * T), window.innerHeight / (ROWS * T)) * 0.96 };
  W.opCam.z = clamp(W.opCam.z, 0.25, 1.4);
  W.opCam2 = { x: W.opCam.x, y: W.opCam.y, z: W.opCam.z };   // second op viewport (split-screen op half)
  explored.fill(0); ectx.clearRect(0, 0, COLS, ROWS);
  comms('sys', 'Link established. Agent on the wire.');
  setStep(0);
  unseedRNG();
}

function openSpotIn(r) {
  for (let i = 0; i < 50; i++) { const x = ri(r.inx0, r.inx1), y = ri(r.iny0, r.iny1); if (walkAt(x, y)) return { x: x * T + T / 2, y: y * T + T / 2, tx: x, ty: y }; }
  return null;
}
// hot/cold-aisle cabinet rows: parallel RACK lines with walkable aisles + a 1-tile perimeter walkway
// (so every door and aisle stays reachable). `avoid` keeps objective tiles clear.
function rackRows(r, avoid) {
  if ((r.inx1 - r.inx0) < 2 || (r.iny1 - r.iny0) < 2) { scatterRack(r); return; }
  const horiz = (r.inx1 - r.inx0) >= (r.iny1 - r.iny0);
  const blocked = (x, y) => avoid && avoid.some(a => a && Math.abs(a.tx - x) <= 1 && Math.abs(a.ty - y) <= 1);
  const put = (x, y) => { const k = x + y * COLS; if (base[k] === OPEN && !blocked(x, y)) base[k] = RACK; };
  if (horiz) { for (let y = r.iny0 + 1; y <= r.iny1 - 1; y += 2) for (let x = r.inx0 + 1; x <= r.inx1 - 1; x++) put(x, y); }
  else { for (let x = r.inx0 + 1; x <= r.inx1 - 1; x += 2) for (let y = r.iny0 + 1; y <= r.iny1 - 1; y++) put(x, y); }
}
function scatterRack(r) { for (let i = 0; i < 4; i++) { const x = ri(r.inx0, r.inx1), y = ri(r.iny0, r.iny1); if (base[x + y * COLS] === OPEN) base[x + y * COLS] = RACK; } }
function doorNear(r, x, y) { for (const d of r.doors) if (Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1) return true; return false; }
// a row of toilet partitions along the top wall + a sink counter along the bottom
function stallRow(r) {
  const y = r.iny0;
  for (let x = r.inx0; x <= r.inx1; x += 2) { const k = x + y * COLS; if (base[k] === OPEN && !doorNear(r, x, y)) base[k] = COVER; }
  if (r.iny1 > r.iny0 + 1) { const y2 = r.iny1; for (let x = r.inx0; x <= r.inx1; x += 3) { const k = x + y2 * COLS; if (base[k] === OPEN && !doorNear(r, x, y2)) base[k] = COVER; } }
}
// office desks on a loose grid, with walking aisles between them
function deskGrid(r) {
  for (let y = r.iny0 + 1; y <= r.iny1 - 1; y += 2) for (let x = r.inx0 + 1; x <= r.inx1 - 1; x += 2) {
    const k = x + y * COLS; if (base[k] === OPEN && !doorNear(r, x, y) && RNG() < 0.78) base[k] = COVER;
  }
}
function patrolFor(r) {
  const pts = [];
  const n = ri(2, 4);
  for (let i = 0; i < n; i++) { const s = openSpotIn(r); if (s) pts.push({ x: s.x, y: s.y }); }
  // sometimes extend into a neighbour
  if (RNG() < 0.5 && r.neighbours.length) {
    const nb = roomList[pick(r.neighbours)]; const s = openSpotIn(nb); if (s) pts.push({ x: s.x, y: s.y });
  }
  return pts.length ? pts : [{ x: r.cx * T, y: r.cy * T }];
}
function bigPatrol(home) {
  const pts = [{ x: home.x, y: home.y }];
  const secRooms = roomList.filter(r => r.sec >= 1).sort(() => RNG() - 0.5).slice(0, 4);
  secRooms.forEach(r => { const s = openSpotIn(r); if (s) pts.push({ x: s.x, y: s.y }); });
  return pts;
}
function yardPatrol() {
  const pts = [];
  for (let i = 0; i < 4; i++) { const x = RNG() < 0.5 ? rnd(T * 9, T * 12) : rnd((COLS - 12) * T, (COLS - 9) * T), y = rnd(T * 3, (ROWS - 3) * T); if (!solidPx(x, y)) pts.push({ x, y }); }
  return pts.length ? pts : [{ x: T * 10, y: T * 10 }];
}
function makeGuard(id, x, y, wps, room) {
  return { id, x, y, r: 9, bio: true, face: rnd(0, TAU), hp: 125, chief: false, outdoor: false,
    home: { x, y }, zone: room ? room.zone : -1, wps: wps.length ? wps : [{ x, y }], wi: 0,
    state: 'patrol', aw: 0, path: [], repath: 0, wait: rnd(0.4, 1.6), scanA: 0, scanDir: 1,
    target: null, last: null, lostT: 0, searchT: 0, fireCd: 0, react: 0, radioT: 0, jamT: 0, stunT: 0,
    dead: false, visible: false, seenAg: false, hitFlash: 0, pend: -1, alertedBy: null };
}
function makeDrone(room) {
  let pts;
  if (room) { pts = []; for (let i = 0; i < 4; i++) { const s = openSpotIn(room); if (s) pts.push({ x: s.x, y: s.y }); } }
  else { pts = yardPatrol(); }
  const p0 = pts[0] || { x: COLS * T / 2, y: ROWS * T / 2 };
  return { x: p0.x, y: p0.y, r: 8, face: rnd(0, TAU), wps: pts.length ? pts : [p0], wi: 0,
    state: 'patrol', aw: 0, dead: false, empT: 0, spoofT: 0, scanA: 0, visible: false, target: null, last: null,
    hp: 40, searchT: 0, indoor: !!room, hitFlash: 0 };
}
function makeCam(room) {
  // place on a wall of the room, aim inward
  const walls = [];
  for (let x = room.x0 + 1; x < room.x1; x++) { walls.push({ x, y: room.y0, a: Math.PI / 2 }); walls.push({ x, y: room.y1, a: -Math.PI / 2 }); }
  for (let y = room.y0 + 1; y < room.y1; y++) { walls.push({ x: room.x0, y, a: 0 }); walls.push({ x: room.x1, y, a: Math.PI }); }
  const wsel = pick(walls);
  return { x: wsel.x * T + T / 2, y: wsel.y * T + T / 2, baseA: wsel.a, face: wsel.a, sweep: rnd(0.4, 0.75), scanA: rnd(0, TAU),
    range: 190, cone: 0.5, hacked: false, hackT: 0, spotted: 0, zone: room.zone, dead: false, alertT: 0 };
}

// ============================================================= raycasting / vision
function ray(x0, y0, ang, maxD, opaque) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let px = x0 / T, py = y0 / T; let mx = Math.floor(px), my = Math.floor(py);
  const ddx = dx === 0 ? 1e9 : Math.abs(1 / dx), ddy = dy === 0 ? 1e9 : Math.abs(1 / dy);
  const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  let sdx = dx === 0 ? 1e9 : (dx < 0 ? (px - mx) : (mx + 1 - px)) * ddx;
  let sdy = dy === 0 ? 1e9 : (dy < 0 ? (py - my) : (my + 1 - py)) * ddy;
  const maxT = maxD / T; let d = 0;
  const op = opaque || opaqueAt;
  for (let i = 0; i < 240; i++) {
    if (sdx < sdy) { d = sdx; sdx += ddx; mx += sx; } else { d = sdy; sdy += ddy; my += sy; }
    if (d > maxT) return maxD;
    if (op(mx, my)) return d * T;
  }
  return maxD;
}
function los(ax, ay, bx, by, opaque) { const d = hyp(ax, ay, bx, by); if (d < 1) return true; return ray(ax, ay, Math.atan2(by - ay, bx - ax), d, opaque) >= d - 0.6; }

const AG_FAR = 340, AG_NEAR = 150, AG_CONE = 0.62, AG_SOFT = 0.3;
function agVisLen(a, ag) {
  const rel = Math.abs(angDiff(a, (ag || W.ag).aim));
  if (rel < AG_CONE) return AG_FAR; if (rel > AG_CONE + AG_SOFT) return AG_NEAR;
  return lerp(AG_FAR, AG_NEAR, (rel - AG_CONE) / AG_SOFT);
}
const NRAYS = 200; const visPts = new Float32Array(NRAYS * 2); const visPtsB = new Float32Array(NRAYS * 2);
let VIS = visPts;   // the vision polygon the fog pass reads (reassigned per half in split-screen)
const explored = new Uint8Array(COLS * ROWS);
const exploredCv = document.createElement('canvas'); exploredCv.width = COLS; exploredCv.height = ROWS;
const ectx = exploredCv.getContext('2d'); ectx.fillStyle = '#fff';
let visTick = 0;
function computePoly(ag, out, markExplored) {
  for (let i = 0; i < NRAYS; i++) {
    const a = i / NRAYS * TAU; let L = agVisLen(a, ag); if (ag.nv) L = Math.max(L, AG_NEAR * 1.5);
    let d = ray(ag.x, ag.y, a, L); if (d < L) d += 8;
    const c = Math.cos(a), s = Math.sin(a);
    out[i * 2] = ag.x + c * d; out[i * 2 + 1] = ag.y + s * d;
    if (markExplored) for (let t = 0; t <= d; t += T * 0.5) markSeen(ag.x + c * t, ag.y + s * t);
  }
}
function computeVision() {
  visTick++; const mark = visTick % 2 === 0;
  if (splitScreen() && W.ag2) {       // two local viewports: a polygon for each agent
    computePoly(W.ag, visPts, mark); computePoly(W.ag2, visPtsB, mark); return;
  }
  const ag = localAgent() || W.ag;
  computePoly(ag, visPts, mark);
  // Duo: also chart the ground around the partner so the shared map fills in from both
  if (mark && W.ag2) { const a2 = (W.ag2 === ag) ? W.ag : W.ag2; if (a2 && a2 !== ag && !a2.dead) for (let i = 0; i < NRAYS; i += 2) { const a = i / NRAYS * TAU, d = Math.min(ray(a2.x, a2.y, a, AG_NEAR * 1.4), AG_NEAR * 1.4), c = Math.cos(a), s = Math.sin(a); for (let t = 0; t <= d; t += T) markSeen(a2.x + c * t, a2.y + s * t); } }
}
function markSeen(x, y) { const tx = Math.floor(x / T), ty = Math.floor(y / T); if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return; const k = tx + ty * COLS; if (explored[k]) return; explored[k] = 1; ectx.fillRect(tx, ty, 1, 1); }
function agentSees(x, y) { const ag = W.ag; const d = hyp(ag.x, ag.y, x, y); const a = Math.atan2(y - ag.y, x - ag.x); return d <= agVisLen(a) + 8 && los(ag.x, ag.y, x, y); }
// Enemies are only revealed to the agent by: direct FORWARD line of sight, being right next to them,
// or intel from the operator (a tag/scan, or a security camera on the tapped network). No through-wall sense.
const VICINITY = 155, INTEL_RANGE = 400, THERMAL_RANGE = 310;
function enemyIntel(e) { return W.ow.scanT > 0 || e.markT > 0 || (e.id != null && W.marks.includes(e.id)); }
function agentRevealEnemy(e) {
  const ag = W.ag; const d = hyp(ag.x, ag.y, e.x, e.y);
  if (enemyIntel(e) && d <= INTEL_RANGE) return true;             // op intel: seen (through walls) when within range
  if (ag.thermal) return !!e.bio && d <= THERMAL_RANGE && los(ag.x, ag.y, e.x, e.y); // thermal = body heat; robotic enemies run cold
  if (d <= AG_FAR && los(ag.x, ag.y, e.x, e.y) && (d < VICINITY || Math.abs(angDiff(Math.atan2(e.y - ag.y, e.x - ag.x), ag.aim)) < AG_CONE)) return true; // direct sight / vicinity
  return false;
}
function enemyThroughWall(e) { return enemyIntel(e) && !los(W.ag.x, W.ag.y, e.x, e.y); }
// is this enemy in the agent's own clear, direct sight (not just known from intel)?
function agentDirectSee(e) { const ag = W.ag; const d = hyp(ag.x, ag.y, e.x, e.y); return d <= AG_FAR && los(ag.x, ag.y, e.x, e.y) && (d < VICINITY || Math.abs(angDiff(Math.atan2(e.y - ag.y, e.x - ag.x), ag.aim)) < AG_CONE); }
// a plain red "contact" icon — enemy present, exact pose unknown (used by the pulse scan)
function drawContactIcon(c, x, y, face, chief) {
  c.save(); c.translate(x, y);
  // facing arrow — rotates to where the contact is actually looking
  c.save(); c.rotate(face);
  c.fillStyle = 'rgba(255,42,109,0.92)'; c.beginPath(); c.moveTo(9, 0); c.lineTo(-4, -5.5); c.lineTo(-1, 0); c.lineTo(-4, 5.5); c.closePath(); c.fill();
  c.restore();
  // axis-aligned targeting brackets
  c.strokeStyle = '#ff2a6d'; c.lineWidth = 1.4; const s = 11, cc = 4;
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => { c.beginPath(); c.moveTo(sx * s - sx * cc, sy * s); c.lineTo(sx * s, sy * s); c.lineTo(sx * s, sy * s - sy * cc); c.stroke(); });
  if (chief) { c.fillStyle = '#d6a0ff'; c.beginPath(); c.arc(0, -14, 2.5, 0, TAU); c.fill(); }
  c.restore();
}

// ============================================================= movement & pathfinding
function collide(e, canCover) {
  const r = e.r;
  const x0 = Math.floor((e.x - r) / T), x1 = Math.floor((e.x + r) / T), y0 = Math.floor((e.y - r) / T), y1 = Math.floor((e.y + r) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const blocked = canCover ? (tileAt(tx, ty) === WALL || tileAt(tx, ty) === RACK || tileAt(tx, ty) === GLASS || tileAt(tx, ty) === FENCE || closedDoor(tx, ty)) : solidBlock(tx, ty, e);
    if (!blocked) continue;
    const cx = clamp(e.x, tx * T, tx * T + T), cy = clamp(e.y, ty * T, ty * T + T);
    let dx = e.x - cx, dy = e.y - cy; const d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      if (d2 > 0.0001) { const d = Math.sqrt(d2); e.x += dx / d * (r - d); e.y += dy / d * (r - d); }
      else { const l = e.x - tx * T, rg = tx * T + T - e.x, u = e.y - ty * T, b = ty * T + T - e.y; const m = Math.min(l, rg, u, b);
        if (m === l) e.x = tx * T - r; else if (m === rg) e.x = tx * T + T + r; else if (m === u) e.y = ty * T - r; else e.y = ty * T + T + r; }
    }
  }
}
function closedDoor(tx, ty) { if (base[tx + ty * COLS] !== DOOR) return false; const d = doorAt(tx, ty); return d ? !d.open : true; }
function solidBlock(tx, ty, e) { const v = tileAt(tx, ty); if (v === WALL || v === RACK || v === GLASS || v === FENCE || v === COVER) return true; if (v === DOOR) return closedDoor(tx, ty); return false; }
function doorAt(tx, ty) { for (const d of W.doors) if (d.tx === tx && d.ty === ty) return d; return null; }
function moveEnt(e, dx, dy, canCover) {
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 5) || 1;
  for (let i = 0; i < steps; i++) { e.x += dx / steps; e.y += dy / steps; collide(e, canCover); }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
let bfsPrev = new Int32Array(COLS * ROWS), bfsDist = new Int16Array(COLS * ROWS);
function pathBlocked(tx, ty, fly) {
  const v = tileAt(tx, ty);
  if (fly) return v === WALL || v === RACK || v === GLASS || v === FENCE || closedDoor(tx, ty);
  if (v === WALL || v === RACK || v === GLASS || v === FENCE || v === COVER) return true;
  if (v === DOOR) return false; // guards can open
  return false;
}
function bfs(sx, sy, goal, maxD, fly) {
  bfsPrev.fill(-1); bfsDist.fill(-1);
  const s = sx + sy * COLS; if (sx < 0 || sy < 0 || sx >= COLS || sy >= ROWS) return;
  bfsDist[s] = 0; const q = [s]; let h = 0;
  while (h < q.length) {
    const k = q[h++]; if (k === goal) break; const d = bfsDist[k]; if (d >= maxD) continue;
    const x = k % COLS, y = (k / COLS) | 0;
    for (const [ox, oy] of DIRS) {
      const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (pathBlocked(nx, ny, fly)) continue;
      if (ox && oy && (pathBlocked(x + ox, y, fly) || pathBlocked(x, y + oy, fly))) continue;
      const nk = nx + ny * COLS; if (bfsDist[nk] !== -1) continue;
      bfsDist[nk] = d + 1; bfsPrev[nk] = k; q.push(nk);
    }
  }
}
function nearestOpen(tx, ty, fly) {
  if (!pathBlocked(tx, ty, fly)) return [tx, ty];
  for (let r = 1; r < 5; r++) for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) { const nx = tx + ox, ny = ty + oy; if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && !pathBlocked(nx, ny, fly)) return [nx, ny]; }
  return null;
}
function pathTo(e, x, y, fly) {
  const sx = Math.floor(e.x / T), sy = Math.floor(e.y / T);
  const g = nearestOpen(Math.floor(x / T), Math.floor(y / T), fly); if (!g) return [];
  const goal = g[0] + g[1] * COLS; bfs(sx, sy, goal, 120, fly); if (bfsDist[goal] === -1) return [];
  const out = []; let k = goal; const start = sx + sy * COLS;
  while (k !== -1 && k !== start) { out.push({ x: (k % COLS) * T + T / 2, y: ((k / COLS) | 0) * T + T / 2 }); k = bfsPrev[k]; }
  out.reverse(); return out;
}
function followPath(e, speed, dt, fly) {
  if (!e.path || !e.path.length) return true;
  const wp = e.path[0], dx = wp.x - e.x, dy = wp.y - e.y, d = Math.hypot(dx, dy);
  if (d < 6) { e.path.shift(); return !e.path.length; }
  const st = Math.min(d, speed * dt); moveEnt(e, dx / d * st, dy / d * st, !fly);
  e.face = turnTo(e.face, Math.atan2(dy, dx), 7 * dt);
  // auto-open doors in front
  const ft = Math.floor((e.x + Math.cos(e.face) * 12) / T), fy = Math.floor((e.y + Math.sin(e.face) * 12) / T);
  const dr = doorAt(ft, fy); if (dr && !dr.open && !dr.sealed && !(dr === W.vaultDoorRef && !W.obj.vaultCracked)) { dr.open = true; dr.openT = 2.5; }
  return false;
}

// ============================================================= comms & objectives
function comms(kind, text) {
  W.comms.push({ kind, text, t: W.t });
  if (W.comms.length > 40) W.comms.shift();
  renderComms();
  if (kind === 'ag') net.out('cmag', text);   // agent chatter -> overwatch comms log
}
let agentMsgs = [];
function pushAgentMsg(text, tag) { agentMsgs.push({ text, t: now(), tag: tag || 'OVERWATCH' }); if (agentMsgs.length > 3) agentMsgs.shift(); renderAgentMsgs(); }
function aReqNotify(text) { pushAgentMsg(text, 'YOU'); }

function setStep(s) {
  W.obj.step = s;
  const o = OBJ[s];
  if (o) { aToastShow(o.toast); }
  renderObjective();
}
const OBJ = [
  { t: 'Breach the perimeter', s: 'Through the fence line. Pick the loading-dock service door.', toast: 'INFILTRATE' },
  { t: 'Tap the distribution network', s: 'Plant a relay in the Electrical Room.', toast: 'FIND THE ELECTRICAL ROOM' },
  { t: "Lift the Site Chief's access badge", s: 'He patrols the data halls. Overwatch can tag him.', toast: 'FIND THE CHIEF' },
  { t: 'Tap the core network', s: 'Pick into Core Network and plant the second relay.', toast: 'REACH CORE NETWORK' },
  { t: 'Breach the GPU training cage', s: 'Badge in while overwatch cracks the cage lock.', toast: 'REACH THE GPU CAGE' },
  { t: 'Copy the evidence', s: 'Hold the cluster console. Overwatch fights the sweep.', toast: 'HOLD THE CONSOLE' },
  { t: 'Pull the evidence drive', s: 'Pull the sealed drive from the training cluster.', toast: 'GRAB THE DRIVE' },
  { t: 'Exfiltrate', s: 'Overwatch opens the loading dock. Get to the van.', toast: 'GET OUT' },
];

function objectiveTarget() {
  const o = W.obj; const S = objSpots;
  switch (o.step) {
    case 0: return mark(S.maint.tx, S.maint.ty, 'Maintenance door');
    case 1: return { x: S.util.tx * T + T / 2, y: S.util.ty * T + T / 2, label: 'Utility junction' };
    case 2: return W.chief && !W.chief.dead ? { x: W.chief.x, y: W.chief.y, label: 'Site Chief', moving: true } : null;
    case 3: return { x: S.net.tx * T + T / 2, y: S.net.ty * T + T / 2, label: 'Network room' };
    case 4: return { x: objSpots.vaultDoor.x * T + T / 2, y: objSpots.vaultDoor.y * T + T / 2, label: 'Vault door' };
    case 5: case 6: return { x: S.uplink.tx * T + T / 2, y: S.uplink.ty * T + T / 2, label: 'Uplink' };
    case 7: return { x: exfil.x + exfil.w / 2, y: exfil.y + exfil.h / 2, label: 'Exfil van' };
  }
  return null;
}
function mark(tx, ty, label) { return { x: tx * T + T / 2, y: ty * T + T / 2, label }; }

// ============================================================= agent interactions
// nearest guard within melee reach, and whether the agent is behind it (unaware)
function meleeTarget(ag) {
  ag = ag || W.ag; let best = null, bd = 32;
  for (const g of W.guards) { if (g.dead) continue; const d = hyp(ag.x, ag.y, g.x, g.y); if (d < bd) { best = g; bd = d; } }
  if (!best) return null;
  const facing = Math.abs(angDiff(Math.atan2(ag.y - best.y, ag.x - best.x), best.face));
  const behind = facing > 1.9 && best.state !== 'alert';   // in the rear arc and unaware
  return { g: best, behind };
}
function agentMelee(mt, ag) {
  ag = ag || W.ag; const g = mt.g;
  if (mt.behind) { takedown(g, true); aToastShow('STEALTH KILL'); return; } // backstab: one silent hit
  // frontal or aware: two hits, and they can break free
  if (!g.meleeExpire || W.t > g.meleeExpire) g.meleeHits = 0;
  g.meleeHits = (g.meleeHits || 0) + 1; g.meleeExpire = W.t + 2.5;
  g.hitFlash = 0.22; g.stunT = Math.max(g.stunT, 0.85); sfx('hit'); noise(g.x, g.y, 90, false);
  W.fx.push({ k: 'melee', x: g.x, y: g.y, a: Math.atan2(g.y - ag.y, g.x - ag.x), t: 0.28, max: 0.28 });
  if (g.meleeHits >= 2) { takedown(g, false); aToastShow('TAKEDOWN'); }
  else aToastShow('STAGGERED — HIT AGAIN');
}
function agentInteract(ag) {
  ag = ag || W.ag; if (ag.dead) return;
  // NOTE: melee lives on the FIRE button now — USE is only for doors / lockpicking / objectives
  // interactions by objective
  const o = W.obj, S = objSpots;
  const nearSpot = (sp, rad) => hyp(ag.x, ag.y, sp.tx * T + T / 2, sp.ty * T + T / 2) < (rad || 26);
  const nearDoor = d => d && hyp(ag.x, ag.y, d.x, d.y) < 30;
  // general door handling — the agent's domain is the mechanical lock (pick to open, push to close)
  let nd = null, ndd = 30; for (const d of W.doors) { if (d === W.vaultDoorRef) continue; const q = hyp(ag.x, ag.y, d.x, d.y); if (q < ndd) { ndd = q; nd = d; } }
  // step 7 (exfil): the agent can hand-breach the sealed dock door even without Overwatch
  if (o.step === 7 && nd && !nd.open && nd.sealed && (nd === W.dockDoorRef || nd.type === 'elec')) {
    if (!pickState) startPick(nd, () => { nd.sealed = false; nd.open = true; nd.openT = 999; nd.hacked = true; aToastShow('DOOR FORCED — EXFIL OPEN'); comms('ag', 'Forced the dock door. Exfil is open.'); });
    return;
  }
  if (nd) {
    if (nd.open && (nd.type === 'mech' || nd.type === 'both')) { nd.open = false; nd.openT = 0; nd.hacked = false; sfx('click'); aToastShow('DOOR CLOSED'); return; }
    if (!nd.open && !nd.sealed && (nd.type === 'mech' || nd.type === 'both')) {
      if (nd === W.maintDoorRef && o.step === 0) { startPick(nd, () => { setStep(1); comms('ag', 'Inside. Moving to the junction.'); }); return; }
      startPick(nd, () => { aToastShow('LOCK PICKED'); }); return;
    }
    if (!nd.open && nd.type === 'elec' && !nd.sealed) { aToastShow('ELECTRONIC LOCK — ASK OVERWATCH'); agentRequestAt('door', nd.x, nd.y); return; }
  }
  if (o.step === 1 && nearSpot(S.util)) { startChannel(2.2, 'Planting relay…', () => { o.access = 2; o.relays = 1; setStep(2); comms('ag', 'Relay live. The data floor is yours.'); aToastShow('DATA FLOOR ONLINE'); }); return; }
  if (o.step === 3 && nearSpot(S.net)) { startChannel(2.6, 'Planting relay…', () => { o.access = 3; o.relays = 2; setStep(4); comms('ag', 'Core relay live. You have the secure core.'); aToastShow('SECURE CORE ONLINE'); }); return; }
  if (o.step === 4 && nearDoor(W.vaultDoorRef)) {
    if (!ag.keycard) { aToastShow('NEED THE KEYCARD'); return; }
    if (!o.vaultCracked) { aToastShow('OVERWATCH MUST CRACK THE LOCK'); comms('req', 'Agent: at the vault — crack it!'); o.cracking = Math.max(o.cracking, 0.001); return; }
    W.vaultDoorRef.open = true; W.vaultDoorRef.openT = 99; setStep(5); comms('ag', 'Vault open. Going for the uplink.'); return;
  }
  if ((o.step === 5) && nearSpot(S.uplink, 30)) { /* handled by hold logic */ return; }
  if (o.step === 6 && nearSpot(S.uplink, 30)) { ag.drive = true; setStep(7); o.lockdown = true; triggerLockdown(); return; }
  // pick up items
  for (const it of W.items) { if (it.got || it.dropT > 0) continue; if (hyp(ag.x, ag.y, it.x, it.y) < 24) { pickupItem(it, ag); return; } }
}
function pickupItem(it, ag) {
  ag = ag || W.ag; if (it.got || it.dropT > 0) return; it.got = true; const lo = isLocalAgent(ag);
  if (it.kind === 'med') { ag.hp = Math.min(ag.maxHp, ag.hp + 45); if (lo) aToastShow('+45 HEALTH'); }
  else if (it.kind === 'supply') { ag.hp = Math.min(ag.maxHp, ag.hp + 35); ag.res += 20; ag.mag = Math.min(10, ag.mag + 10); if (lo) aToastShow('SUPPLIES — +HEALTH +AMMO'); }
  else { ag.res += 20; ag.mag = Math.min(10, ag.mag + 10); if (lo) aToastShow('+AMMO'); }
  sfx('pickup');
}
function takedown(g, silent) {
  g.dead = true; g.deadT = W.t; W.bodies.push({ x: g.x, y: g.y, a: g.face, chief: g.chief });
  W.stats.takedowns++;
  sfx('thud');
  if (g.chief) { W.ag.keycard = true; if (W.obj.step === 2) { setStep(3); comms('ag', 'Got the keycard. Heading to the network room.'); } aToastShow('KEYCARD ACQUIRED'); }
  if (!silent && g.state === 'alert') { /* a struggle: nearby guards may notice */ }
  const a = Math.atan2(g.y - W.ag.y, g.x - W.ag.x);
  W.fx.push({ k: silent ? 'stealth' : 'melee', x: g.x, y: g.y, a, t: silent ? 0.4 : 0.32, max: silent ? 0.4 : 0.32 });
}
let pickState = null, channelState = null;
function startPick(door, done) {
  if (door.open) { done(); return; }
  const t = door.hacked ? 0.4 : (1.6 + door.locked * 0.7);
  pickState = { door, dur: t, t: 0, done };
  W.stats.picks++;
}
function startChannel(dur, label, done) { channelState = { dur, t: 0, label, done }; }

// vault crack is overwatch-driven (ability), see ow actions. Keycard also obtainable from chief's body:
function tryLootBody() {
  const ag = W.ag; if (ag.keycard) return;
  for (const b of W.bodies) { if (b.chief && hyp(ag.x, ag.y, b.x, b.y) < 22) { ag.keycard = true; if (W.obj.step === 2) { setStep(3); } aToastShow('KEYCARD ACQUIRED'); comms('ag', 'Keycard secured.'); } }
}

// ============================================================= noise & alert
function noise(x, y, radius, loud) {
  for (const g of W.guards) {
    if (g.dead || g.stunT > 0) continue;
    const d = hyp(g.x, g.y, x, y); const clear = los(g.x, g.y, x, y);
    const R = clear ? radius : radius * 0.45; if (d > R) continue;
    if (g.state === 'alert') { if (loud) g.last = { x, y }; continue; }
    if (loud && d < R * 0.7) alertGuard(g, x, y, 'sound');
    else { if (g.state !== 'alert') { g.state = 'suspicious'; g.target = { x, y }; g.aw = Math.max(g.aw, 0.5); g.path = pathTo(g, x, y); g.wait = 0; g.searchT = 5; } }
  }
  for (const dr of W.drones) { if (dr.dead || dr.empT > 0) continue; const d = hyp(dr.x, dr.y, x, y); if (d < radius * 1.1 && loud) { dr.state = 'hunt'; dr.last = { x, y }; dr.target = { x, y }; } }
}
// Directional "audio" cues for the agent: you hear enemies you can't see.
// White = footsteps/movement, red = gunfire. Stored as a bearing that fades.
function emitFootstepCues(dt) {
  const ag = W.ag; if (ag.dead) return; const HEAR = 300;
  for (const g of W.guards) {
    const spd = Math.hypot(g.x - (g._px ?? g.x), g.y - (g._py ?? g.y)); g._px = g.x; g._py = g.y;
    if (g.dead || g.stunT > 0) continue;
    g.cueT = (g.cueT || 0) - dt;
    if (spd < 0.35) continue;                                   // standing still -> no footsteps
    const d = hyp(ag.x, ag.y, g.x, g.y); if (d > HEAR) continue;
    if (agentRevealEnemy(g)) continue;                          // you can see them; no need for a cue
    const clear = los(ag.x, ag.y, g.x, g.y); const hearR = clear ? HEAR : HEAR * 0.6;
    if (d > hearR || g.cueT > 0) continue;
    g.cueT = g.running ? 0.4 : 0.6;
    let str = clamp(1 - d / HEAR, 0.25, 1) * (g.running ? 1 : 0.78);
    if (g.state === 'alert') str = Math.max(str, 0.95);              // spotted -> bigger
    W.cues.push({ dir: Math.atan2(g.y - ag.y, g.x - ag.x), t: 1.1, max: 1.1, kind: 'step', str });
  }
}
function gunCue(sx, sy) { const ag = W.ag; if (ag.dead) return; const d = hyp(ag.x, ag.y, sx, sy); if (d > 460) return; W.cues.push({ dir: Math.atan2(sy - ag.y, sx - ag.x), t: 1.3, max: 1.3, kind: 'gun', str: clamp(1 - d / 460, 0.5, 1) }); }
function alertGuard(g, x, y, src) {
  if (g.dead) return; const was = g.state === 'alert';
  g.state = 'alert'; g.aw = 1; g.last = { x, y }; g.target = { x, y }; g.path = []; g.searchT = 8;
  if (!was) {
    g.react = rnd(0.3, 0.6); W.stats.detections++; raiseAlarm(0.5);
    if (src === 'see') comms('sys', 'Contact has eyes on the agent!');
    sfx('alert');
    // nearby guards converge
    for (const o of W.guards) if (o !== g && !o.dead && o.state !== 'alert' && o.pend < 0 && hyp(o.x, o.y, g.x, g.y) < 260 && los(o.x, o.y, g.x, g.y)) { o.pend = rnd(0.4, 1.1); o.pendAt = { x, y }; }
  }
}
function raiseAlarm(amount) {
  const o = W.obj; o.alarm = clamp(o.alarm + amount, 0, 1); o.alarmT = now();
  if (o.alarm >= 1 && !o._alarmFull) { o._alarmFull = true; W.stats.alarms++; comms('sys', 'ALARM — facility on alert.'); }
}

// ============================================================= combat
// the nearest enemy the aim line would hit before a wall (null if the muzzle points at nothing)
function fireLineTarget(ag) {
  ag = ag || W.ag; const a = ag.aim, maxD = 460;
  const wd = ray(ag.x, ag.y, a, maxD, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || closedDoor(tx, ty); });
  let best = null, bt = wd;
  for (const g of W.guards) { if (g.dead) continue; const t = rayHit(ag.x, ag.y, a, g.x, g.y, g.r + 6); if (t >= 0 && t < bt) { bt = t; best = g; } }
  for (const dr of W.drones) { if (dr.dead) continue; const t = rayHit(ag.x, ag.y, a, dr.x, dr.y, dr.r + 6); if (t >= 0 && t < bt) { bt = t; best = dr; } }
  return best;
}
function agentFire(ag) {
  ag = ag || W.ag; if (ag.reload > 0 || ag.fireCd > 0 || ag.dead || ag.downed) return;
  if (!fireLineTarget(ag)) { return; }                 // hold fire unless an enemy is in the line of fire
  if (ag.mag <= 0) { startReload(ag); return; }
  ag.mag--; ag.fireCd = 0.24; W.stats.shots++; ag.lastShot = W.t;
  const spread = (ag.running ? 0.12 : 0.04);
  const a = ag.aim + rnd(-spread, spread);
  const maxD = 460; const d = ray(ag.x, ag.y, a, maxD, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || closedDoor(tx, ty); });
  let hx = ag.x + Math.cos(a) * d, hy = ag.y + Math.sin(a) * d, hitT = d;
  let target = null;
  for (const g of W.guards) { if (g.dead) continue; const t = rayHit(ag.x, ag.y, a, g.x, g.y, g.r + 2); if (t >= 0 && t < hitT) { hitT = t; target = g; } }
  for (const dr of W.drones) { if (dr.dead) continue; const t = rayHit(ag.x, ag.y, a, dr.x, dr.y, dr.r + 2); if (t >= 0 && t < hitT) { hitT = t; target = dr; } }
  if (target) { hx = ag.x + Math.cos(a) * hitT; hy = ag.y + Math.sin(a) * hitT; }
  W.tracers.push({ x1: ag.x, y1: ag.y, x2: hx, y2: hy, t: 0.07, c: '210,200,170' });
  sfx('shot');
  // suppressed but audible
  noise(ag.x, ag.y, 150, false); ag.lastNoise = W.t;
  if (target) {
    sparks(hx, hy);
    if (target.r === 8 || target.indoor !== undefined) { damageDrone(target, 30, a); }
    else { damageGuard(target, 50, a); }
  }
}
function rayHit(x, y, ang, cx, cy, r) { const dx = Math.cos(ang), dy = Math.sin(ang); const fx = x - cx, fy = y - cy; const b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r; const disc = b * b - c; if (disc < 0) return -1; const t = -b - Math.sqrt(disc); return t > 0 ? t : (c < 0 ? 0 : -1); }
function damageGuard(g, dmg, ang) {
  if (g.dead) return; g.hp -= dmg; g.hitFlash = 0.2; blood(g.x, g.y, ang);
  if (g.hp <= 0) { g.dead = true; g.deadT = W.t; W.bodies.push({ x: g.x, y: g.y, a: g.face, chief: g.chief }); W.stats.kills++; sfx('thud'); if (g.chief) { comms('sys', 'Site Chief down — keycard on the body.'); } }
  else { const sh = nearestAgentTo(g.x, g.y) || W.ag; alertGuard(g, sh.x, sh.y, 'hit'); }
}
function damageDrone(dr, dmg, ang) { if (dr.dead) return; dr.hp -= dmg; dr.hitFlash = 0.2; sparks(dr.x, dr.y); if (dr.hp <= 0) { dr.dead = true; W.fx.push({ k: 'boom', x: dr.x, y: dr.y, t: 0.5 }); sfx('boom'); comms('sys', 'Patrol drone down.'); } else { dr.state = 'hunt'; dr.target = { x: W.ag.x, y: W.ag.y }; dr.last = { x: W.ag.x, y: W.ag.y }; } }
function startReload(ag) { ag = ag || W.ag; if (ag.reload > 0 || ag.mag >= 10 || ag.res <= 0) return; ag.reload = 1.1; sfx('reload'); }
function hurtAgent(dmg, ang, ag) {
  ag = ag || W.ag; if (ag.dead || ag.downed) return; ag.hp -= dmg; ag.hurt = 1;
  if (isLocalAgent(ag)) { hurtFlash(ang); buzz(60); }
  if (ag.hp <= 0) { ag.hp = 0; ag.downed = true; ag.downT = 16; ag.moving = ag.running = false;
    const who = twoAgents() ? ('Agent ' + ((ag.idx || 0) + 1)) : 'AGENT';
    comms('sys', who + ' DOWN — medevac or they bleed out.'); if (isLocalAgent(ag)) { aToastShow('DOWNED — NEED MEDEVAC', 'warn'); buzz(200); pushAgentMsg('You are down — hold on for a medevac.', 'YOU'); }
    if (!humanDrivesOp()) aiMedevac(ag);
  }
}
function aiMedevac(ag) { ag = ag || W.ag; setTimeout(() => { if (W && game === 'play' && ag.downed && !W.allies.some(a => a.medic) && owReady('medevac')) owFire('medevac', ag.x, ag.y); }, rnd(400, 1000)); }

// ============================================================= guards
function updateGuard(g, dt) {
  if (g.dead) return;
  g.hitFlash = Math.max(0, g.hitFlash - dt);
  if (g.stunT > 0) { g.stunT -= dt; if (g.stunT <= 0 && g.meleeHits > 0 && !g.dead) { g.meleeHits = 0; const nn = nearestAgentTo(g.x, g.y) || W.ag; alertGuard(g, nn.x, nn.y, 'struggle'); comms('sys', 'A guard broke free of the agent!'); } g.aw = Math.max(g.aw, 0.3); return; }
  // pending convergence
  if (g.pend >= 0) { g.pend -= dt; if (g.pend <= 0) { g.pend = -1; g.state = 'suspicious'; g.target = g.pendAt; g.path = pathTo(g, g.pendAt.x, g.pendAt.y); g.aw = 0.6; g.searchT = 6; } }
  // vision of agent (sets g.tgtAg to the agent it sees)
  const canSee = guardSeesAgent(g); g._sees = canSee;
  const seenAg = g.tgtAg;
  if (canSee && seenAg) {
    g.aw = Math.min(1, g.aw + dt * 2.4 * D().awRate);
    g.seenAg = true; g.last = { x: seenAg.x, y: seenAg.y };
    if (g.aw >= 1) { if (g.state !== 'alert') alertGuard(g, seenAg.x, seenAg.y, 'see'); g.target = { x: seenAg.x, y: seenAg.y }; }
    else if (g.state === 'patrol') { g.state = 'suspicious'; g.target = { x: seenAg.x, y: seenAg.y }; }
  } else {
    g.aw = Math.max(0, g.aw - dt * 0.4);
  }
  const spd = g.state === 'alert' ? 92 : g.state === 'suspicious' ? 58 : 42;
  if (g.state === 'alert') {
    const agT = seenAg || nearestAgentTo(g.x, g.y) || W.ag;
    // a friendly drone that's closer and in view draws the guard's fire off the agent
    const ally = guardAllyTarget(g);
    const useAlly = ally && (!canSee || hyp(g.x, g.y, ally.x, ally.y) < hyp(g.x, g.y, agT.x, agT.y) * 0.9);
    if (canSee || useAlly) {
      const tgt = useAlly ? ally : agT;
      const d = hyp(g.x, g.y, tgt.x, tgt.y);
      g.face = turnTo(g.face, Math.atan2(tgt.y - g.y, tgt.x - g.x), 8 * dt);
      if (d > 150 && canSee && !useAlly) { g.path = (g.repath -= dt) <= 0 ? (g.repath = 0.5, pathTo(g, agT.x, agT.y)) : g.path; followPath(g, spd, dt); }
      else { g.path = []; }
      if (g.jamT <= 0) { g.fireCd -= dt; if (g.react > 0) g.react -= dt; else if (g.fireCd <= 0 && Math.abs(angDiff(g.face, Math.atan2(tgt.y - g.y, tgt.x - g.x))) < 0.3) guardFire(g, tgt); }
    } else {
      g.searchT -= dt;
      if (g.searchT <= 0) { g.state = 'patrol'; g.aw = 0; g.target = null; g.path = []; }
      else {
        if (!g.path || !g.path.length) { if (g.last) { g.path = pathTo(g, g.last.x, g.last.y); g.last = null; } else { const s = openSpotIn(roomList[g.zone >= 0 ? zones[g.zone].room.id : 0] || roomList[0]); if (s) g.path = pathTo(g, s.x, s.y); } }
        followPath(g, spd, dt);
      }
    }
  } else if (g.state === 'suspicious') {
    g.searchT -= dt; g.aw = Math.max(g.aw, 0.3);
    if (g.target) { if (!g.path || !g.path.length) g.path = pathTo(g, g.target.x, g.target.y); if (followPath(g, spd, dt)) { g.target = null; scanAround(g, dt); } }
    else scanAround(g, dt);
    if (g.searchT <= 0 && g.aw < 0.3) { g.state = 'patrol'; }
  } else if (g.defGo) {
    // warden move-order: march to the ordered post and hold it (don't drift back to patrol)
    const d = hyp(g.x, g.y, g.defGo.x, g.defGo.y);
    if (d > 18) { if (!g.path || !g.path.length || (g.repath = (g.repath || 0) - dt) <= 0) { g.repath = 0.5; g.path = pathTo(g, g.defGo.x, g.defGo.y); } followPath(g, 64, dt); }
    else { g.path = []; scanAround(g, dt); }
  } else {
    // patrol
    if (g.wait > 0) { g.wait -= dt; scanAround(g, dt); }
    else {
      const wp = g.wps[g.wi];
      if (!g.path || !g.path.length) g.path = pathTo(g, wp.x, wp.y);
      if (followPath(g, spd, dt)) { g.wi = (g.wi + 1) % g.wps.length; g.wait = rnd(0.6, 2.2); }
    }
  }
  if (g.radioT > 0) g.radioT -= dt;
}
function scanAround(g, dt) { g.scanA = (g.scanA || 0) + g.scanDir * dt * 1.1; if (Math.abs(g.scanA) > 0.9) g.scanDir *= -1; g.face = turnTo(g.face, g.face + g.scanA * dt, 2 * dt); g.face += Math.sin(now() / 500 + g.id) * dt * 0.3; }
// does this guard see a specific agent?
function guardSeesThisAgent(g, ag) {
  if (!ag || ag.dead || ag.downed) return false;   // a downed agent is not an active target
  const d = hyp(g.x, g.y, ag.x, ag.y);
  let range = 240, cone = 0.62;
  let vis = 1;
  if (ag.cloak) vis *= 0.28;
  if (!ag.running && !ag.moving) vis *= 0.8;
  const z = zoneAtPx(ag.x, ag.y);
  if (z >= 0 && W.lights[z] === 0) vis *= 0.4;    // dark room
  range *= vis < 0.5 ? 0.55 : 1;
  if (d > range) return false;
  const a = Math.atan2(ag.y - g.y, ag.x - g.x);
  const rel = Math.abs(angDiff(a, g.face));
  if (d > 30 && rel > cone) return false;          // outside cone (close range = feels you)
  if (!los(g.x, g.y, ag.x, ag.y, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || closedDoor(tx, ty); })) return false;
  if (ag.cloak && d > 90 && RNG() < 0.6) return false;   // very low chance when deeply cloaked and far
  return true;
}
// sees ANY agent — picks the nearest one it can see and remembers it as the guard's target
function guardSeesAgent(g) {
  let best = null, bd = 1e18;
  for (const ag of liveAgents()) { if (guardSeesThisAgent(g, ag)) { const d = hyp(g.x, g.y, ag.x, ag.y); if (d < bd) { bd = d; best = ag; } } }
  g.tgtAg = best; return !!best;
}
function guardFire(g, target) {
  target = target || W.ag;
  g.fireCd = rnd(0.42, 0.72);                 // faster, more aggressive bursts
  const a = Math.atan2(target.y - g.y, target.x - g.x) + rnd(-0.07, 0.07);
  const d = ray(g.x, g.y, a, 460, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || closedDoor(tx, ty); });
  let hit = hyp(g.x, g.y, target.x, target.y) <= d && Math.abs(angDiff(a, Math.atan2(target.y - g.y, target.x - g.x))) < 0.12;
  const ex = g.x + Math.cos(a) * d, ey = g.y + Math.sin(a) * d;
  W.tracers.push({ x1: g.x, y1: g.y, x2: hit ? target.x : ex, y2: hit ? target.y : ey, t: 0.07, c: '255,90,70' });
  sfx('eshot'); raiseAlarm(0.04); gunCue(g.x, g.y);
  if (hit && RNG() < D().guardAcc) { if (isAgent(target)) hurtAgent(Math.round(ri(9, 15) * D().guardDmg), a, target); else damageAlly(target, ri(12, 18)); }
}

// a hunting patrol drone's ranged shock-round
function droneZap(dr) {
  const ag = dr.tgtAg && !dr.tgtAg.dead && !dr.tgtAg.downed ? dr.tgtAg : nearestAgentTo(dr.x, dr.y); if (!ag) return;
  const a = Math.atan2(ag.y - dr.y, ag.x - dr.x);
  const d = ray(dr.x, dr.y, a, 200, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || closedDoor(tx, ty); });
  if (hyp(dr.x, dr.y, ag.x, ag.y) > d) return;   // wall in the way
  W.tracers.push({ x1: dr.x, y1: dr.y, x2: ag.x, y2: ag.y, t: 0.08, c: '255,120,60' });
  sfx('eshot'); raiseAlarm(0.03); gunCue(dr.x, dr.y);
  if (RNG() < 0.55 + D().guardAcc * 0.3) hurtAgent(Math.round(ri(4, 9) * D().guardDmg), a, ag);
}

// ============================================================= friendly combat drone (operator-deployed)
function makeAlly(x, y) { return { x, y, r: 7, hp: 44, maxHp: 44, battery: 32, face: 0, state: 'deploy', deployT: 1.3, fireCd: 0, moveTo: null, repath: 0, path: [], dead: false, hitFlash: 0 }; }
function damageAlly(a, dmg) { if (a.dead) return; a.hp -= dmg; a.hitFlash = 0.2; sparks(a.x, a.y); if (a.hp <= 0) { a.dead = true; W.fx.push({ k: 'boom', x: a.x, y: a.y, t: 0.5 }); sfx('boom'); comms('sys', 'Support drone destroyed.'); W.ow.cooldowns.cdrone = Math.max(W.ow.cooldowns.cdrone || 0, 16); if (W.ow.selAlly === a) W.ow.selAlly = null; } }
function allyFire(a, tgt) {
  const ang = Math.atan2(tgt.y - a.y, tgt.x - a.x);
  W.tracers.push({ x1: a.x, y1: a.y, x2: tgt.x, y2: tgt.y, t: 0.07, c: '120,235,180' });
  sfx('shot', 0.55); noise(a.x, a.y, 120, false);
  if (tgt.bio) damageGuard(tgt, 26, ang); else damageDrone(tgt, 30, ang);
}
function updateAlly(a, dt) {
  if (a.dead) return;
  a.hitFlash = Math.max(0, a.hitFlash - dt);
  if (a.deployT > 0) { a.deployT -= dt; if (a.deployT <= 0) { a.state = 'follow'; comms('me', 'Overwatch: support drone online.'); pushAgentMsg('Support drone is yours.'); } return; }
  a.battery -= dt;
  if (a.battery <= 0) { a.dead = true; W.fx.push({ k: 'boom', x: a.x, y: a.y, t: 0.4 }); comms('sys', (a.medic ? 'Medevac' : 'Support') + ' drone — battery dead.'); if (!a.medic) W.ow.cooldowns.cdrone = Math.max(W.ow.cooldowns.cdrone || 0, 12); if (W.ow.selAlly === a) W.ow.selAlly = null; return; }
  // medic drone: ignore combat, fly to the agent, heal or revive, then leave
  if (a.medic) {
    if (!a._tgt || a._tgt.dead || (!a._tgt.downed && a.leaveT)) a._tgt = agentList().find(x => x && x.downed) || nearestAgentTo(a.x, a.y) || W.ag;
    const ag = a._tgt; a.face = turnTo(a.face, Math.atan2(ag.y - a.y, ag.x - a.x), 7 * dt);
    if (a.leaveT) { a.leaveT -= dt; moveEnt(a, Math.cos(a.face) * -40 * dt, Math.sin(a.face) * -40 * dt, false); if (a.leaveT <= 0) a.dead = true; return; }
    if (hyp(a.x, a.y, ag.x, ag.y) < 26) {
      if (ag.downed) { ag.downed = false; ag.downT = 0; ag.hp = Math.round(ag.maxHp * 0.55); comms('sys', 'Agent revived.'); aToastShow('REVIVED', 'warn'); pushAgentMsg('Back up — thanks for the save.', 'YOU'); }
      else { ag.hp = Math.min(ag.maxHp, ag.hp + 50); aToastShow('+50 HEALTH (MEDEVAC)'); }
      W.fx.push({ k: 'heal', x: ag.x, y: ag.y, t: 0.6, max: 0.6 }); sfx('pickup'); a.leaveT = 2.5;
    } else { a.repath -= dt; if (a.repath <= 0 || !a.path.length) { a.repath = 0.4; a.path = pathTo(a, ag.x, ag.y, true); } followPath(a, 135, dt, true); }
    return;
  }
  // an explicit move order garrisons the drone at that spot; otherwise it escorts the agent
  const anchor = a.moveTo || { x: W.ag.x + 26, y: W.ag.y - 26 };
  const distAnchor = hyp(a.x, a.y, anchor.x, anchor.y);
  // auto-engage the nearest enemy in sight — but never abandon a hold point
  let tgt = null, td = 250;
  for (const g of W.guards) { if (g.dead) continue; const d = hyp(a.x, a.y, g.x, g.y); if (d < td && los(a.x, a.y, g.x, g.y)) { td = d; tgt = g; } }
  for (const dr of W.drones) { if (dr.dead || dr.empT > 0) continue; const d = hyp(a.x, a.y, dr.x, dr.y); if (d < td && los(a.x, a.y, dr.x, dr.y)) { td = d; tgt = dr; } }
  if (tgt) {
    a.state = 'engage'; a.face = turnTo(a.face, Math.atan2(tgt.y - a.y, tgt.x - a.x), 9 * dt); a.fireCd -= dt;
    if (a.fireCd <= 0 && Math.abs(angDiff(a.face, Math.atan2(tgt.y - a.y, tgt.x - a.x))) < 0.25) { allyFire(a, tgt); a.fireCd = 0.42; }
    if (a.moveTo && distAnchor > 120) { a.repath -= dt; if (a.repath <= 0 || !a.path.length) { a.repath = 0.4; a.path = pathTo(a, anchor.x, anchor.y, true); } followPath(a, 120, dt, true); }  // leashed: drift back to the hold point
    else if (td < 95) { const aw = Math.atan2(a.y - tgt.y, a.x - tgt.x); moveEnt(a, Math.cos(aw) * 55 * dt, Math.sin(aw) * 55 * dt, false); }
    else if (td > 170 && !a.moveTo) { a.repath -= dt; if (a.repath <= 0) { a.repath = 0.4; a.path = pathTo(a, tgt.x, tgt.y, true); } followPath(a, 115, dt, true); }
  } else if (distAnchor > 20) {
    a.repath -= dt; if (a.repath <= 0 || !a.path.length) { a.repath = 0.45; a.path = pathTo(a, anchor.x, anchor.y, true); }
    followPath(a, 135, dt, true); a.state = a.moveTo ? 'move' : 'follow'; a.face = turnTo(a.face, Math.atan2(anchor.y - a.y, anchor.x - a.x), 7 * dt);
  } else { a.state = a.moveTo ? 'hold' : 'idle'; }  // reached an ordered spot: hold it (don't snap back to the agent)
}
// Splinter-Cell "last known position": while hunters have lost sight of the agent but are still
// searching, a white silhouette marks where they last saw them.
function updateLKP() {
  let sees = false, hunting = false;
  for (const g of W.guards) { if (g.dead) continue; if (g.state === 'alert' || g.searchT > 0) hunting = true; if (g._sees && g.state !== 'patrol') sees = true; }
  for (const dr of W.drones) { if (dr.dead) continue; if (dr.state === 'hunt') hunting = true; if (dr._sees) sees = true; }
  if (sees && !W.ag.dead) { W.lkp = { x: W.ag.x, y: W.ag.y, aim: W.ag.aim, shown: false }; }
  else if (hunting) { if (W.lkp) W.lkp.shown = true; }
  else W.lkp = null;
}
// the nearest friendly drone a guard should prefer to shoot (closer + visible than the agent)
function guardAllyTarget(g) { let best = null, bd = 300; for (const a of W.allies) { if (a.dead || a.deployT > 0) continue; const d = hyp(g.x, g.y, a.x, a.y); if (d < bd && los(g.x, g.y, a.x, a.y)) { bd = d; best = a; } } return best; }

// ============================================================= drones
function updateDrone(dr, dt) {
  if (dr.dead) return;
  dr.hitFlash = Math.max(0, dr.hitFlash - dt);
  if (dr.empT > 0) { dr.empT -= dt; dr.aw = 0; return; }
  dr.scanA += dt * 2; dr.face = dr.scanA;
  const sees = !dr.spoofT && droneSeesAgent(dr); dr._sees = sees;
  const at = dr.tgtAg;
  if (sees && at) { dr.aw = Math.min(1, dr.aw + dt * 2); dr.last = { x: at.x, y: at.y }; if (dr.aw >= 1) { dr.state = 'hunt'; dr.target = { x: at.x, y: at.y }; raiseAlarm(0.02); if (!dr._tagged) { dr._tagged = true; comms('sys', 'Drone has a lock on the agent!'); for (const g of W.guards) if (!g.dead && hyp(g.x, g.y, dr.x, dr.y) < 320) alertGuard(g, at.x, at.y, 'drone'); } } }
  else { dr.aw = Math.max(0, dr.aw - dt * 0.5); if (dr.state === 'hunt' && dr.aw <= 0) { dr._tagged = false; } }
  const spd = dr.state === 'hunt' ? 110 : 64;
  if (dr.state === 'hunt' && dr.target) {
    if (!dr.path || !dr.path.length || (dr.repath = (dr.repath || 0) - dt) <= 0) { dr.repath = 0.4; dr.path = pathTo(dr, dr.target.x, dr.target.y, true); }
    if (followPath(dr, spd, dt, true)) { if (sees && at) dr.target = { x: at.x, y: at.y }; else { dr.state = 'patrol'; } }
    if (sees && at) dr.target = { x: at.x, y: at.y };
    // ranged zap: a hunting drone now shoots when it has an agent in sight at close range
    dr.fireCd = (dr.fireCd || 0) - dt;
    if (sees && at && dr.fireCd <= 0 && hyp(dr.x, dr.y, at.x, at.y) < 180) { droneZap(dr); dr.fireCd = rnd(0.7, 1.05); }
  } else if (dr.defGo) {
    // warden move order: fly to the spot and resume patrol once there
    if (!dr.path || !dr.path.length || (dr.repath = (dr.repath || 0) - dt) <= 0) { dr.repath = 0.4; dr.path = pathTo(dr, dr.defGo.x, dr.defGo.y, true); }
    if (followPath(dr, spd, dt, true) || hyp(dr.x, dr.y, dr.defGo.x, dr.defGo.y) < 24) dr.defGo = null;
  } else {
    const wp = dr.wps[dr.wi]; if (!dr.path || !dr.path.length) dr.path = pathTo(dr, wp.x, wp.y, true);
    if (followPath(dr, spd, dt, true)) dr.wi = (dr.wi + 1) % dr.wps.length;
  }
}
function droneSeesThisAgent(dr, ag) {
  if (!ag || ag.dead || ag.downed) return false;
  let range = dr.state === 'hunt' ? 220 : 170; let vis = 1;
  if (ag.cloak) vis *= 0.35; range *= vis;
  const d = hyp(dr.x, dr.y, ag.x, ag.y); if (d > range) return false;
  return los(dr.x, dr.y, ag.x, ag.y, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || closedDoor(tx, ty); });
}
function droneSeesAgent(dr) {
  let best = null, bd = 1e18;
  for (const ag of liveAgents()) { if (droneSeesThisAgent(dr, ag)) { const d = hyp(dr.x, dr.y, ag.x, ag.y); if (d < bd) { bd = d; best = ag; } } }
  dr.tgtAg = best; return !!best;
}

// ============================================================= cameras
function updateCam(c, dt) {
  if (c.dead) return;
  if (c.hacked) { c.hackT -= dt; if (c.hackT <= 0) { c.hacked = false; comms('sys', 'A camera is back online.'); } else return; }
  c.face = c.baseA + Math.sin(W.t * c.sweep + c.scanA) * 0.7;
  // camera intel: a live camera on the operator's tapped network relays enemies in its view to the agent
  if (zoneTapped(c.zone)) {
    for (const g of W.guards) { if (g.dead) continue; if (hyp(c.x, c.y, g.x, g.y) < c.range && Math.abs(angDiff(Math.atan2(g.y - c.y, g.x - c.x), c.face)) < c.cone && los(c.x, c.y, g.x, g.y)) g.markT = Math.max(g.markT || 0, 0.7); }
    for (const dr of W.drones) { if (dr.dead) continue; if (hyp(c.x, c.y, dr.x, dr.y) < c.range && Math.abs(angDiff(Math.atan2(dr.y - c.y, dr.x - c.x), c.face)) < c.cone && los(c.x, c.y, dr.x, dr.y)) dr.markT = Math.max(dr.markT || 0, 0.7); }
  }
  // detection: whichever agent falls in the camera's cone
  let seen = null;
  for (const ag of liveAgents()) {
    let range = c.range; if (ag.cloak) range *= 0.3;
    if (c.zone >= 0 && W.lights[c.zone] === 0) range *= 0.5;
    if (hyp(c.x, c.y, ag.x, ag.y) < range && Math.abs(angDiff(Math.atan2(ag.y - c.y, ag.x - c.x), c.face)) < c.cone && los(c.x, c.y, ag.x, ag.y)) { seen = ag; break; }
  }
  if (seen) {
    c.spotted += dt;
    if (c.spotted > 1.1) { c.alertT = 1.5; raiseAlarm(0.03); if (!c._raised || W.t - c._raised > 4) { c._raised = W.t; comms('sys', 'A camera has an agent — guards vectoring in.'); for (const g of W.guards) if (!g.dead && g.state !== 'alert' && hyp(g.x, g.y, seen.x, seen.y) < 340) { g.pend = rnd(0.3, 1); g.pendAt = { x: seen.x, y: seen.y }; } } }
  } else c.spotted = Math.max(0, c.spotted - dt * 0.7);
  c.alertT = Math.max(0, c.alertT - dt);
}

// ============================================================= lockdown / sweep
function triggerLockdown() {
  comms('sys', 'SENTINEL: lockdown. The building is sealed.'); aToastShow('LOCKDOWN', 'warn');
  W.doors.forEach(d => { if (d !== W.maintDoorRef) { d.open = false; d.openT = 0; } });
  if (W.dockDoorRef) W.dockDoorRef.sealed = true;
  W.obj.alarm = 1; raiseAlarm(0.5);
  // all guards hunt toward the uplink/agent
  W.guards.forEach(g => { if (!g.dead) { g.state = 'alert'; g.last = { x: W.ag.x, y: W.ag.y }; g.searchT = 20; g.aw = 0.6; } });
}

// ============================================================= overwatch actions
const PAYLOADS = [
  { id: 'scan', key: '1', name: 'Pulse scan', cost: 10, cd: 6, desc: 'Reveal every contact for 6s.' },
  { id: 'jam', key: '2', name: 'Jam earpieces', cost: 20, cd: 10, desc: 'Guards near the agent lose comms & slow for 5s.' },
  { id: 'emp', key: '3', name: 'EMP burst', cost: 30, cd: 12, desc: 'Click to disable drones & cameras in a radius.' },
  { id: 'supply', key: '4', name: 'Supply drop', cost: 0, cd: 2, desc: 'Click to drop health + ammo. Limited drops.' },
  { id: 'lights', key: '5', name: 'Cut lights', cost: 15, cd: 8, desc: 'Click a room to kill its lights for 8s.' },
  { id: 'spoof', key: '6', name: 'Spoof cams', cost: 25, cd: 14, desc: 'Loop every camera feed for 10s.' },
  { id: 'decoy', key: '7', name: 'Decoy ping', cost: 12, cd: 7, desc: 'Click to lure guards to a noise.' },
  { id: 'cdrone', key: '8', name: 'Combat drone', cost: 35, cd: 16, desc: 'Deploy a gun drone (low HP, battery). Tap it then tap a spot to move it; it auto-fires on sight.' },
  { id: 'medevac', key: '9', name: 'Medevac drone', cost: 30, cd: 22, desc: 'Send a medic drone to the agent — heals, or revives them when downed.' },
];
let owSelect = null;   // payload awaiting a click target
function owReady(id) { const p = PAYLOADS.find(x => x.id === id); return p && W.ow.bw >= p.cost && (W.ow.cooldowns[id] || 0) <= 0 && (id !== 'supply' || W.ow.drops > 0); }
function owSelectPayload(id) {
  const p = PAYLOADS.find(x => x.id === id); if (!p) return;
  if (!owReady(id)) { nToastShow('NO BANDWIDTH / ON COOLDOWN'); return; }
  const instant = ['scan', 'jam', 'spoof'].includes(id);
  if (net.mode === 'guest') { if (instant) net.out('pay', id, '', ''); else { owSelect = (owSelect === id) ? null : id; renderAbilities(); } return; }
  if (instant) { owFire(id, null); return; }
  owSelect = (owSelect === id) ? null : id; renderAbilities();
}
function owSpend(p) { W.ow.bw = clamp(W.ow.bw - p.cost, 0, 100); W.ow.cooldowns[p.id] = p.cd; }
// Cyberpunk-style upload times — the hack is committed instantly (RAM/bandwidth spent) but only
// LANDS after this delay; physical deployments (supply/drones) have their own inbound animation.
const CAST = { scan: 1.1, jam: 1.0, emp: 0.9, supply: 0, lights: 0.7, spoof: 1.7, decoy: 0.5, cdrone: 0, medevac: 0, camhack: 1.4, doorhack: 1.0, devtrip: 0.8 };
const CAST_ICON = { scan: '◎', jam: '⚡', emp: '✺', lights: '☾', spoof: '▣', decoy: '⦿', camhack: '▣', doorhack: '▤', devtrip: '♪' };
const CAST_NAME = { scan: 'Pulse scan', jam: 'Jam', emp: 'EMP', lights: 'Cut lights', spoof: 'Spoof cams', decoy: 'Decoy', camhack: 'Camera hack', doorhack: 'Door hack', devtrip: 'Distract' };
function startCast(id, label, wx, wy, dur, target) {
  W.ow.casts.push({ id, label, wx: wx != null ? wx : W.ag.x, wy: wy != null ? wy : W.ag.y, t: 0, dur, target: target || null });
  comms('me', 'Overwatch: uploading ' + label.toLowerCase() + '…'); nToastShow('UPLOADING · ' + label.toUpperCase());
}
function owFire(id, wx, wy) {
  if (owOffline()) { nToastShow('CONSOLE OFFLINE'); return; }
  const p = PAYLOADS.find(x => x.id === id); if (!p || !owReady(id)) return;
  owSpend(p); owSelect = null; renderAbilities();
  const dur = CAST[id] || 0;
  if (dur > 0) { startCast(id, p.name, wx, wy, dur); return; }
  owApply(id, wx, wy);
}
function owApply(id, wx, wy, target) {
  W.stats.hacks++;
  switch (id) {
    case 'scan': W.ow.scanT = 4; W.marks = W.guards.filter(g => !g.dead).map(g => g.id); W.drones.forEach(dr => { if (!dr.dead) dr.markT = 4; }); W.fx.push({ k: 'pulse', x: W.ag.x, y: W.ag.y, t: 1, max: 1 }); comms('me', 'Overwatch: pulse scan.'); nToastShow('PULSE SCAN'); break;  // temporary tags, cleared when scanT ends
    case 'jam': { let n = 0; for (const g of W.guards) if (!g.dead && hyp(g.x, g.y, W.ag.x, W.ag.y) < 220) { g.jamT = 5; g.stunT = Math.max(g.stunT, 0.3); n++; } comms('me', 'Overwatch: jamming their net.'); nToastShow('EARPIECES JAMMED'); break; }
    case 'emp': { for (const dr of W.drones) if (!dr.dead && hyp(dr.x, dr.y, wx, wy) < 160) { dr.empT = 7; } for (const c of W.cams) if (!c.dead && hyp(c.x, c.y, wx, wy) < 160) { c.hacked = true; c.hackT = 7; } W.emps.push({ x: wx, y: wy, t: 0.6 }); comms('me', 'Overwatch: EMP out.'); nToastShow('EMP BURST'); sfx('emp'); break; }
    case 'supply': W.ow.drops--; W.items.push({ kind: 'supply', x: wx, y: wy, got: false, dropT: 1.4 }); comms('me', 'Overwatch: supply inbound at your marker.'); nToastShow('SUPPLY DROP'); break;
    case 'lights': { const z = zoneAtPx(wx, wy); if (z >= 0) { W.lights[z] = 0; W.lightT[z] = 8; comms('me', 'Overwatch: killing the lights.'); nToastShow('LIGHTS OUT'); } break; }
    case 'spoof': W.cams.forEach(c => { if (!c.dead) { c.hacked = true; c.hackT = 10; } }); comms('me', 'Overwatch: looping the camera feeds.'); nToastShow('CAMERAS SPOOFED'); break;
    case 'decoy': W.decoys.push({ x: wx, y: wy, t: 2.4 }); noise(wx, wy, 230, true); comms('me', 'Overwatch: decoy ping.'); nToastShow('DECOY'); break;
    case 'cdrone': W.allies.push(makeAlly(wx, wy)); comms('me', 'Overwatch: deploying support drone.'); nToastShow('COMBAT DRONE INBOUND'); pushAgentMsg('Support drone inbound.'); break;
    case 'medevac': { const m = makeAlly(wx, wy); m.medic = true; m.hp = m.maxHp = 44; m.battery = 24; W.allies.push(m); comms('me', 'Overwatch: medevac inbound.'); nToastShow('MEDEVAC INBOUND'); pushAgentMsg('Medevac inbound — hold on.'); break; }
    case 'camhack': if (target && !target.dead) { target.hacked = true; target.hackT = 9; comms('me', 'Overwatch: camera looped.'); nToastShow('CAMERA LOOPED'); } break;
    case 'doorhack': if (target) { target.hacked = true; if (!target.open) { target.sealed = false; target.open = true; target.openT = (W.obj.step === 7 || target === W.dockDoorRef) ? 999 : 6; } else { target.open = false; target.openT = 0; } comms('me', 'Overwatch: ' + (target.open ? 'opening' : 'sealing') + ' a door.'); pushAgentMsg(target.open ? 'Door open — go.' : 'Sealing that door.'); } break;
    case 'devtrip': if (target && !target.hacked) { target.active = 3; noise(target.x, target.y, target.radius, true); comms('me', 'Overwatch: tripping the ' + target.name.toLowerCase() + '.'); } break;
  }
  const note = { scan: 'Tagging contacts for you.', jam: 'Jamming their earpieces.', emp: 'EMP out — drones down.', supply: 'Supply inbound at the marker.', lights: 'Killing the lights.', spoof: 'Looping the cameras.', decoy: 'Decoy ping — drawing them off.' }[id];
  if (note) pushAgentMsg(note);
}
function owClickWorld(wx, wy, button) {
  if (owOffline()) { nToastShow('CONSOLE OFFLINE'); return; }
  if (button === 2) { W.waypoint = { x: wx, y: wy, t: 12 }; comms('me', 'Overwatch: waypoint set.'); return; }
  if (owSelect) { owFire(owSelect, wx, wy); return; }
  // friendly drone command: tap a drone to select it, then tap a spot to send it there
  let al = null, ald = 22; for (const a of W.allies) { if (a.dead || a.deployT > 0) continue; const q = hyp(a.x, a.y, wx, wy); if (q < ald) { ald = q; al = a; } }
  if (al) { W.ow.selAlly = (W.ow.selAlly === al) ? null : al; nToastShow(W.ow.selAlly ? 'DRONE SELECTED — TAP A SPOT TO SEND IT' : 'DRONE RELEASED'); return; }
  if (W.ow.selAlly && !W.ow.selAlly.dead) { W.ow.selAlly.moveTo = { x: wx, y: wy }; W.ow.selAlly.path = []; comms('me', 'Overwatch: drone repositioning.'); return; }  // stays selected — tap again to reposition, tap the drone to release
  // click a door to hack/open
  let d = null, dd = 24;
  for (const dr of W.doors) { const q = hyp(dr.x, dr.y, wx, wy); if (q < dd) { dd = q; d = dr; } }
  if (d) { owHackDoor(d); return; }
  // click a camera
  let c = null, cd = 24; for (const cc of W.cams) { if (cc.dead) continue; const q = hyp(cc.x, cc.y, wx, wy); if (q < cd) { cd = q; c = cc; } }
  if (c) { if (c.hacked) { nToastShow('ALREADY LOOPED'); return; } if (castingOn(c)) { return; } if (W.ow.bw >= 10) { W.ow.bw -= 10; startCast('camhack', 'Camera hack', c.x, c.y, CAST.camhack, c); } else nToastShow('NO BANDWIDTH'); return; }
  // click a device to trigger a distraction
  let dv = null, dvd = 24; for (const v of W.devs) { const q = hyp(v.x, v.y, wx, wy); if (q < dvd) { dvd = q; dv = v; } }
  if (dv) { if (castingOn(dv)) { return; } if (W.ow.bw >= 8) { W.ow.bw -= 8; startCast('devtrip', 'Trip ' + dv.name, dv.x, dv.y, CAST.devtrip, dv); } else nToastShow('NO BANDWIDTH'); return; }
  // click a guard/drone to tag
  let g = null, gd = 26; for (const gg of W.guards) { if (gg.dead) continue; const q = hyp(gg.x, gg.y, wx, wy); if (q < gd) { gd = q; g = gg; } }
  if (g) { if (!W.marks.includes(g.id)) W.marks.push(g.id); g.markT = 12; comms('me', 'Overwatch: contact tagged.'); return; }
}
function owHackDoor(d) {
  if (d.sealed && !(W.obj.step === 7)) { nToastShow('DOOR SEALED — LOCKDOWN'); return; }
  const z = zoneGrid[d.tx + d.ty * COLS]; const sec = zones[z] ? zones[z].sec : 0;
  if (d === W.vaultDoorRef) { nToastShow('VAULT NEEDS THE CRACK + KEYCARD'); return; }
  if (d.type === 'mech') { nToastShow('MECHANICAL LOCK — AGENT MUST PICK IT'); pushAgentMsg('That door is a manual lock — pick it.'); return; }
  if (castingOn(d)) return;
  const cost = 6 + sec * 4;
  if (W.ow.bw < cost) { nToastShow('NO BANDWIDTH'); return; }
  W.ow.bw -= cost; startCast('doorhack', d.open ? 'Seal door' : 'Door hack', d.x, d.y, CAST.doorhack, d);
}
// is an upload already in flight against this target?
function castingOn(target) { return W.ow.casts.some(c => c.target === target); }
// vault crack: overwatch holds while the agent is at the door (ability-free, bandwidth drain)
function owCrackTick(dt) {
  const o = W.obj; if (o.step !== 4 || o.vaultCracked) return;
  const atDoor = hyp(W.ag.x, W.ag.y, W.vaultDoorRef.x, W.vaultDoorRef.y) < 40 && W.ag.keycard;
  if (atDoor && W.ow.bw > 0 && (owIntentCrack || net.role === 'agent' && soloMode === 'agent')) {
    o.cracking = Math.min(1, o.cracking + dt * 0.33); W.ow.bw = Math.max(0, W.ow.bw - dt * 6);
    if (o.cracking >= 1) { o.vaultCracked = true; comms('sys', 'Vault lock cracked. Swipe in.'); aToastShow('VAULT UNLOCKED'); }
  }
}
let owIntentCrack = false;

// ============================================================= upload hold
function uploadTick(dt) {
  const o = W.obj; if (o.step !== 5) return;
  const atUplink = hyp(W.ag.x, W.ag.y, objSpots.uplink.tx * T + T / 2, objSpots.uplink.ty * T + T / 2) < 34;
  W.upBox = true;
  if (atUplink && !W.ag.dead) {
    o.upload = Math.min(1, o.upload + dt * 0.11);
    // sweep rises unless overwatch fights it
    const fight = W.ow.sweepFight > 0 ? 1 : 0;
    o.sweep = clamp(o.sweep + dt * (0.055 - fight * 0.12), 0, 1);
    if (W.ow.sweepFight > 0) { W.ow.sweepFight -= dt; W.ow.bw = Math.max(0, W.ow.bw - dt * 4); }
    if (o.upload >= 1) { setStep(6); comms('ag', 'Copy complete. Pulling the drive.'); }
    if (o.sweep >= 1 && !o._swept) { o._swept = true; comms('sys', 'SENTINEL traced the uplink!'); triggerLockdownEarly(); }
  } else if (o.upload > 0 && o.upload < 1) {
    o.sweep = Math.max(0, o.sweep - dt * 0.03);
  }
}
function triggerLockdownEarly() {
  raiseAlarm(1); W.guards.forEach(g => { if (!g.dead) { g.state = 'alert'; g.last = { x: W.ag.x, y: W.ag.y }; g.searchT = 16; } });
  aToastShow('TRACED — THEY KNOW WHERE YOU ARE', 'warn');
}

// ============================================================= main update
let last = now(), acc = 0;
function update(dt) {
  W.t += dt; W.stats.time += dt;
  const ag = W.ag;
  // decay fx timers
  W.tracers = W.tracers.filter(t => (t.t -= dt) > 0);
  W.fx = W.fx.filter(f => (f.t -= dt) > 0);
  W.emps = W.emps.filter(e => (e.t -= dt) > 0);
  W.decoys = W.decoys.filter(d => (d.t -= dt) > 0);
  W.pings = W.pings.filter(p => (p.t -= dt) > 0);
  W.cues = W.cues.filter(c => (c.t -= dt) > 0);
  W.reqPins = W.reqPins.filter(p => (p.t -= dt) > 0);
  if (W.waypoint) { W.waypoint.t -= dt; W.waypoint.rp = (W.waypoint.rp || 0) - dt; if (W.waypoint.rp <= 0) { W.waypoint.rp = 0.5; W.waypoint.path = pathTo(W.ag, W.waypoint.x, W.waypoint.y, false); } if (W.waypoint.t <= 0) W.waypoint = null; }
  for (const k in W.ow.cooldowns) if (W.ow.cooldowns[k] > 0) W.ow.cooldowns[k] -= dt;
  // hack uploads: tick each, apply the effect when the upload completes
  if (W.ow.casts.length) { for (const c of W.ow.casts) { c.t += dt; if (c.t >= c.dur) { c.done = true; owApply(c.id, c.wx, c.wy, c.target); } } W.ow.casts = W.ow.casts.filter(c => !c.done); }
  if (W.ow.scanT > 0) { W.ow.scanT -= dt; if (W.ow.scanT <= 0) W.marks = W.marks.filter(id => { const g = W.guards.find(x => x.id === id); return g && g.markT > 0; }); }
  W.guards.forEach(g => { if (g.markT > 0) g.markT -= dt; });
  W.drones.forEach(dr => { if (dr.markT > 0) dr.markT -= dt; });
  W.items.forEach(it => { if (it.dropT > 0) { it.dropT -= dt; if (it.dropT <= 0) sfx('pickup'); } });
  for (const a of liveAgents()) for (const it of W.items) { if (!it.got && !(it.dropT > 0) && hyp(a.x, a.y, it.x, it.y) < 18) pickupItem(it, a); }  // walk-over pickup
  emitFootstepCues(dt);
  W.devs.forEach(v => { if (v.active > 0) { v.active -= dt; if (v.active <= 0) v.said = false; } });
  // lights restore
  W.lights.forEach((v, i) => { if (W.lightT[i] > 0) { W.lightT[i] -= dt; if (W.lightT[i] <= 0) W.lights[i] = 1; } });
  // bandwidth regen scales with access
  W.ow.bw = clamp(W.ow.bw + dt * (2 + W.obj.access * 1.5), 0, 100);
  // alarm decay
  if (now() - W.obj.alarmT > 4000 && !W.obj.lockdown) { W.obj.alarm = Math.max(0, W.obj.alarm - dt * 0.06 * D().alarmDecay); if (W.obj.alarm < 1) W.obj._alarmFull = false; }

  // agents: input (human or AI) + per-agent physics  (one agent normally, two in Duo mode)
  for (const a of agentList()) {
    if (a.downed) { a.downT -= dt; a.moving = a.running = false; if (a.downT <= 0 && !a.dead) { a.dead = true; onAgentBledOut(a); } continue; }
    if (splitScreen()) {
      const hi = agentHalf(a);
      if (hi >= 0 && halfView[hi] === 'agent') agentHumanControl(a, dt, halfTouch(hi));   // that half's player drives it
      else if (a === W.ag) agentAIControl(dt);       // player is on the console → AI runs the body
      else partnerAIControl(a, dt);
    }
    else if (isLocalAgent(a) && humanDrivesAgent()) agentHumanControl(a, dt);
    else if (a === W.ag) agentAIControl(dt);       // primary agent: full objective AI
    else partnerAIControl(a, dt);                   // second agent: partner AI (follow + fight)
    agentPhysicsPost(a, dt);
  }
  // overwatch (human or AI)
  if (!humanDrivesOp()) opAIControl(dt);

  // doors auto-close
  W.doors.forEach(d => { if (d.openT > 0) { d.openT -= dt; if (d.openT <= 0 && !d.held) d.open = false; } });
  // channel / pick progress
  if (pickState) { pickState.t += dt; noise(ag.x, ag.y, 60, false); if (pickState.t >= pickState.dur) { const d = pickState.done; pickState.door.open = true; pickState.door.openT = 4; pickState = null; sfx('pickup'); d(); } }
  if (channelState) { channelState.t += dt; if (channelState.t >= channelState.dur) { const d = channelState.done; channelState = null; d(); } }
  tryLootBody();

  // entities
  W.guards.forEach(g => updateGuard(g, dt));
  W.drones.forEach(dr => updateDrone(dr, dt));
  W.allies.forEach(a => updateAlly(a, dt)); W.allies = W.allies.filter(a => !a.dead);
  updateLKP();
  W.cams.forEach(c => updateCam(c, dt));
  owCrackTick(dt); uploadTick(dt); intrTick(dt);

  // haywire devices: loud noise sources + a shower of themed sparks, and a one-time comms callout
  W.devs.forEach(v => {
    if (v.active <= 0) return;
    if (RNG() < 0.12) noise(v.x, v.y, v.radius * 0.6, false);
    if (RNG() < 0.55) { const a = rnd(0, TAU), sp = rnd(30, 115); W.fx.push({ k: 'p', x: v.x, y: v.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 22, t: rnd(0.2, 0.55), c: v.c || '255,210,120' }); }
    if (!v.said) { v.said = true; comms('sys', v.name + ' — ' + (v.say || 'going haywire') + '.'); }
  });
  // versus / split-facility: warden power/cooldowns regen, reveal decay, timed door unseal
  if (facilityMode()) {
    const def = W.def; def.power = Math.min(100, def.power + dt * 5);
    for (const k in def.cd) if (def.cd[k] > 0) def.cd[k] -= dt;
    if (def.reveal > 0) def.reveal -= dt;
    if (def.sel && def.sel.dead) def.sel = null;
    if (def.rallyPt && (def.rallyPt.t -= dt) <= 0) def.rallyPt = null;
    W.doors.forEach(d => { if (d._unseal > 0) { d._unseal -= dt; if (d._unseal <= 0) d.sealed = false; } });
  }
  // decoys draw guards
  W.decoys.forEach(d => { for (const g of W.guards) if (!g.dead && g.state !== 'alert' && hyp(g.x, g.y, d.x, d.y) < 280 && g.pend < 0) { g.state = 'suspicious'; g.target = { x: d.x, y: d.y }; g.aw = Math.max(g.aw, 0.5); if (!g.path.length) g.path = pathTo(g, d.x, d.y); g.searchT = 5; } });

  // passive breach: if the agent is inside the building past the maintenance door, step 0 is done however the door opened
  if (W.obj.step === 0 && objSpots.entryRoom && ag.x > (objSpots.entryRoom.x0 + 0.6) * T) { setStep(1); comms('ag', 'Inside. Moving to the junction.'); }
  // exfil check
  if (W.obj.step === 7 && ag.drive && ag.x > exfil.x - 10 && ag.y > exfil.y - 10 && ag.y < exfil.y + exfil.h + 10) endMission(true, 'Evidence recovered. Agent clear.');

  computeVision();
  // camera follow (split: each half tracks its own agent)
  if (splitScreen()) {
    const k = 1 - Math.exp(-9 * dt);
    W.cam.x = lerp(W.cam.x, W.ag.x, k); W.cam.y = lerp(W.cam.y, W.ag.y, k);
    if (W.ag2) { W.cam2.x = lerp(W.cam2.x, W.ag2.x, k); W.cam2.y = lerp(W.cam2.y, W.ag2.y, k); }
  } else {
    const camAg = localAgent() || ag;
    W.cam.x = lerp(W.cam.x, camAg.x, 1 - Math.exp(-9 * dt));
    W.cam.y = lerp(W.cam.y, camAg.y, 1 - Math.exp(-9 * dt));
  }

  // net send
  net.tick(dt);
}

// ============================================================= role / mode flags
// net.role: this client's role for networking. soloMode: solo variant or null for co-op.
// view: which screen is shown (agent|op). humanDrivesAgent/Op decide control source.
let soloMode = null;     // 'both' | 'agent' | 'op' | 'practice' | 'versus' | 'split' | null(coop)
let view = 'agent';
// split-screen sub-mode (soloMode==='split'): what each half is
//  'agents'   — both halves are field agents (original split)
//  'opagent'  — P1 overwatch console, P2 field agent
//  'toggle'   — either half can switch between agent and overwatch (SWAP button)
//  'facility' — P1 is the facility (Sentinel), P2 is overwatch + agent
let splitMode = 'agents';
let halfView = ['agent', 'agent'];   // per-half current view: 'agent' | 'op' | 'facility'
let autoDemo = false;    // both sides AI (demo / self-test)
function isSim() { return net.mode === 'solo' || net.mode === 'host'; }  // runs the world
function humanDrivesAgent() {
  if (autoDemo || soloMode === 'versus') return false;  // versus: both intruders are AI, human plays the facility
  if (soloMode === 'split') return true;                 // both halves are human agents
  if (soloMode === 'both' || soloMode === 'duo') return view === 'agent';
  if (soloMode === 'agent' || soloMode === 'practice') return true;
  if (soloMode === 'op') return false;
  return net.chosenRole === 'agent';      // coop: agent host controls agent
}
// a human sits at the overwatch console in a split half (op or a toggle-half currently on op)
function splitHumanOp() { return soloMode === 'split' && (halfView[0] === 'op' || halfView[1] === 'op'); }
// the facility console is live (versus, or a split half playing the facility)
function facilityMode() { return soloMode === 'versus' || (soloMode === 'split' && splitMode === 'facility'); }
function humanDrivesOp() {
  if (autoDemo || soloMode === 'versus') return false;
  if (soloMode === 'split') return splitHumanOp();
  if (soloMode === 'both' || soloMode === 'duo') return view === 'op';
  if (soloMode === 'op') return true;
  if (soloMode === 'agent' || soloMode === 'practice') return false;
  return net.chosenRole === 'op';
}
// versus / split-facility: a human is the facility "warden" — redirecting guards, locking down, hacking the op
function humanDrivesDef() { return facilityMode() && !autoDemo; }
// ---- two-agent "Duo" mode: a second infiltrator plays alongside the first ----
function makeAgent(x, y, idx) {
  return { x, y, r: 9, aim: 0, hp: 100, mag: 10, res: 30, reload: 0, fireCd: 0, idx: idx || 0,
    nv: false, thermal: false, cloak: false, bat: 100, moving: false, running: false, step: 0, hurt: 0, dead: false,
    keycard: false, drive: false, inLight: 1, exposure: 0, lastNoise: 0, downAt: 0, aiReq: 0, downed: false, downT: 0,
    ability: agentKit, abilCd: 0, abilT: 0, spdMul: 1 };
}
function duoMode() { return soloMode === 'duo' || net.duo; }        // net.duo set for co-op duo (later)
// two field agents exist only when both split halves can field one
function twoAgents() { return duoMode() || (soloMode === 'split' && (splitMode === 'agents' || splitMode === 'toggle')); }
function agentList() { return (W && W.ag2) ? [W.ag, W.ag2] : (W ? [W.ag] : []); }
// ---- split-screen half mapping -------------------------------------------
// each half has a fixed KIND; its live VIEW (halfView[i]) can change only for 'toggle' halves
function halfKinds() {
  return splitMode === 'opagent' ? ['op', 'agent']
    : splitMode === 'toggle' ? ['toggle', 'toggle']
    : splitMode === 'facility' ? ['facility', 'toggle']
    : ['agent', 'agent'];
}
function halfKind(i) { return halfKinds()[i]; }
function halfCanToggle(i) { return halfKind(i) === 'toggle'; }
// the field agent that belongs to half i (null for op/facility halves)
function halfAgent(i) {
  const K = halfKinds(); if (K[i] === 'op' || K[i] === 'facility') return null;
  const order = [0, 1].filter(j => K[j] === 'agent' || K[j] === 'toggle');
  return i === order[0] ? W.ag : (order.length > 1 ? W.ag2 : W.ag);
}
function agentHalf(a) { return halfAgent(0) === a ? 0 : halfAgent(1) === a ? 1 : -1; }
function halfTouch(i) { return i === 0 ? touch : touch2; }
function halfCam(a) { return a === W.ag2 ? W.cam2 : W.cam; }
function liveAgents() { return agentList().filter(a => a && !a.dead && !a.downed); }
function isAgent(e) { return !!W && (e === W.ag || e === W.ag2); }
// the agent the LOCAL player drives (host/solo => primary; co-op guest => second)
function localAgent() { return (net.mode === 'guest' && W && W.ag2) ? W.ag2 : (W ? W.ag : null); }
function isLocalAgent(a) { return a === localAgent(); }
// nearest live agent to a point (enemies target this)
function nearestAgentTo(x, y) { let best = null, bd = 1e18; for (const a of liveAgents()) { const d = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y); if (d < bd) { bd = d; best = a; } } return best; }

// ============================================================= human agent control
const keys = new Set();
const mouse = { x: 0, y: 0, down: false, active: false };
const touch = { move: null, aim: null };
const touch2 = { move: null, aim: null };   // split-screen player 2
function agentHumanControl(ag, dt, tc) {
  ag = ag || W.ag; if (ag.dead) { return; }
  tc = tc || touch;
  const flip = splitScreen() && tc === touch2;   // P2's half is rotated 180° — rotate their input to match
  let mx = 0, my = 0, mag = 0, walk = false;
  if (tc.move) { mx = tc.move.vx; my = tc.move.vy; mag = tc.move.mag < 0.16 ? 0 : tc.move.mag; walk = tc.move.mag < 0.55; if (flip) { mx = -mx; my = -my; } }
  else {
    if (keys.has('w') || keys.has('arrowup')) my -= 1; if (keys.has('s') || keys.has('arrowdown')) my += 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1; if (keys.has('d') || keys.has('arrowright')) mx += 1;
    const l = Math.hypot(mx, my); if (l) { mx /= l; my /= l; mag = 1; } walk = keys.has('shift');
  }
  // gamepad (single-view only)
  const gp = !splitActive && navigator.getGamepads && navigator.getGamepads()[0];
  if (gp && !tc.move && mag === 0) { const lx = gp.axes[0] || 0, ly = gp.axes[1] || 0; const l = Math.hypot(lx, ly); if (l > 0.18) { mx = lx / l; my = ly / l; mag = Math.min(1, l); walk = l < 0.6; } }
  const menuOpen = game !== 'play';
  if (menuOpen) mag = 0;
  ag.moving = mag > 0; ag.running = ag.moving && !walk;
  if (mag > 0) {
    const sp = (walk ? 66 : 128) * (ag.spdMul || 1); moveEnt(ag, mx * sp * dt, my * sp * dt, true);
    // quieter footsteps — the agent has soft soles; cloak muffles them further. Walking stays silent.
    if (ag.running) { ag.step -= dt; if (ag.step <= 0) { ag.step = 0.46; noise(ag.x, ag.y, ag.cloak ? 44 : 70, false); } }
  }
  // aim
  let firing = false;
  if (tc.aim && tc.aim.mag > 0.2) { ag.aim = turnTo(ag.aim, Math.atan2(tc.aim.vy, tc.aim.vx) + (flip ? Math.PI : 0), 16 * dt); firing = tc.aim.mag > 0.92; }
  if (touchFire && tc === touch) firing = true;
  else if (gp) { const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0; if (Math.hypot(rx, ry) > 0.25) { ag.aim = turnTo(ag.aim, Math.atan2(ry, rx), 16 * dt); } if ((gp.buttons[7] && gp.buttons[7].value > 0.4)) firing = true; }
  if (tc === touch && mouse.active && !tc.aim) { const s = worldToScreenAgent(ag.x, ag.y); ag.aim = Math.atan2(mouse.y - s.y, mouse.x - s.x); if (mouse.down) firing = true; }
  if (tc === touch && keys.has(' ')) firing = true;
  if (firing && !menuOpen && (view === 'agent' || splitScreen())) { const mt = meleeTarget(ag); if (mt) { if (ag.fireCd <= 0) { agentMelee(mt, ag); ag.fireCd = 0.4; } } else agentFire(ag); }  // FIRE melees when a contact is adjacent, else shoots
}

// Fire the agent's equipped loadout ability (left-hand ABILITY button / Q key).
function useAgentAbility(ag) {
  ag = ag || (W && W.ag); if (!ag || ag.dead || ag.downed || game !== 'play') return;
  const kit = ag.ability || 'camo';
  if (kit === 'camo') { ag.cloak = !ag.cloak && ag.bat > 5; aToastShow(ag.cloak ? 'OPTIC CAMO ON' : 'CAMO OFF'); const tc = $('tCamo'); if (tc) tc.classList.toggle('on', ag.cloak); updateAbilityBtn(); return; }
  if (ag.abilCd > 0) { aToastShow('ABILITY CHARGING — ' + Math.ceil(ag.abilCd) + 's'); return; }
  const def = AGENT_KITS[kit] || {};
  if (kit === 'surge') { ag.abilT = 6; ag.spdMul = 1.45; ag.hp = Math.min(ag.maxHp, ag.hp + 35); W.fx.push({ k: 'heal', x: ag.x, y: ag.y, t: 0.6, max: 0.6 }); sfx('pickup'); aToastShow('ADRENAL SURGE'); }
  else if (kit === 'emp') { for (const dr of W.drones) if (!dr.dead && hyp(dr.x, dr.y, ag.x, ag.y) < 175) dr.empT = 6; for (const c of W.cams) if (!c.dead && hyp(c.x, c.y, ag.x, ag.y) < 175) { c.hacked = true; c.hackT = 6; } W.emps.push({ x: ag.x, y: ag.y, t: 0.6 }); sfx('emp'); aToastShow('EMP CHARGE'); }
  else if (kit === 'decoy') { W.decoys.push({ x: ag.x, y: ag.y, t: 2.4 }); noise(ag.x, ag.y, 260, true); aToastShow('DECOY OUT'); }
  ag.abilCd = def.cd || 12;
  updateAbilityBtn();
}
function updateAbilityBtn() {
  const b = $('tAbility'); if (!b) return; const ag = W && W.ag; if (!ag) return;
  const kit = ag.ability || 'camo', def = AGENT_KITS[kit] || {};
  if (kit === 'camo') { b.classList.toggle('on', !!ag.cloak); b.innerHTML = (def.glyph || '◈') + '<small>CAMO</small>'; b.classList.remove('cooling'); return; }
  const cooling = ag.abilCd > 0;
  b.classList.toggle('cooling', cooling);
  b.innerHTML = (def.glyph || '◆') + '<small>' + (cooling ? Math.ceil(ag.abilCd) + 's' : (def.name || '').split(' ').pop().toUpperCase()) + '</small>';
}

// per-agent physics tick (battery/cloak, reload, cooldowns) — runs for every agent
function agentPhysicsPost(ag, dt) {
  if (ag.cloak) { ag.bat = Math.max(0, ag.bat - dt * 14); if (ag.bat <= 0) { ag.cloak = false; if (isLocalAgent(ag)) aToastShow('CAMO DEPLETED'); } }
  else ag.bat = Math.min(100, ag.bat + dt * 7 * D().camoRegen);
  ag.hurt = Math.max(0, ag.hurt - dt * 1.4);
  if (ag.reload > 0) { ag.reload -= dt; if (ag.reload <= 0) { const need = 10 - ag.mag, take = Math.min(need, ag.res); ag.mag += take; ag.res -= take; } }
  if (ag.fireCd > 0) ag.fireCd -= dt;
  if (ag.abilCd > 0) ag.abilCd -= dt;
  if (ag.abilT > 0) { ag.abilT -= dt; if (ag.abilT <= 0) ag.spdMul = 1; } else ag.spdMul = 1;
}
function onAgentBledOut(ag) {
  if (liveAgents().length === 0 && !W.obj.won && !W.obj.lost) endMission(false, twoAgents() ? 'Both agents down. No medevac in time.' : 'Agent bled out. No medevac in time.');
  else comms('sys', 'An agent bled out — the other is still in.');
}
function threatNear(ag, r) { for (const g of W.guards) if (!g.dead && g.state === 'alert' && hyp(g.x, g.y, ag.x, ag.y) < (r || 240)) return true; return false; }
// Partner AI for the second agent in Duo mode: stick with the lead, fight threats, keep up.
function partnerAIControl(ag, dt) {
  if (ag.dead || ag.downed) return;
  const lead = (W.ag && W.ag !== ag && !W.ag.dead && !W.ag.downed) ? W.ag : (liveAgents().find(a => a !== ag) || ag);
  const ai = ag._ai || (ag._ai = { path: [], repath: 0 });
  // nearest active threat in sight
  let threat = null, td = 300;
  for (const g of W.guards) { if (g.dead) continue; if (g.state === 'patrol') continue; const d = hyp(ag.x, ag.y, g.x, g.y); if (d < td && los(ag.x, ag.y, g.x, g.y)) { td = d; threat = g; } }
  // silent takedown of an adjacent unaware guard
  for (const g of W.guards) { if (!g.dead && g.state !== 'alert' && hyp(ag.x, ag.y, g.x, g.y) < 22) takedown(g, true); }
  if (threat && ag.mag > 0 && td < 260) {
    const fa = Math.atan2(threat.y - ag.y, threat.x - ag.x); ag.aim = turnTo(ag.aim, fa, 10 * dt);
    if (Math.abs(angDiff(ag.aim, fa)) < 0.22) agentFire(ag);
    ag.cloak = ag.bat > 20 && td < 170;
  } else ag.cloak = ag.bat > 28 && threatNear(ag, 220);
  // follow the lead, tucked just behind their shoulder; close the gap fast if far
  const gx = lead.x - Math.cos(lead.aim) * 32, gy = lead.y - Math.sin(lead.aim) * 32;
  const dl = hyp(ag.x, ag.y, gx, gy);
  if (ag === lead) { ag.moving = false; return; }
  if (dl > 38 || threat) {
    ai.repath -= dt; if (ai.repath <= 0 || !ai.path.length) { ai.repath = 0.4; ai.path = pathTo(ag, threat ? lead.x : gx, threat ? lead.y : gy, false); }
    const spd = threat ? 118 : (dl > 180 ? 134 : 88);
    if (ai.path.length) { const wp = ai.path[0], dx = wp.x - ag.x, dy = wp.y - ag.y, d = Math.hypot(dx, dy); if (d < 7) ai.path.shift(); else { const st = Math.min(d, spd * dt); moveEnt(ag, dx / d * st, dy / d * st, true); if (!threat) ag.aim = turnTo(ag.aim, Math.atan2(dy, dx), 7 * dt); } ag.moving = true; ag.running = spd > 100; }
  } else { ag.moving = false; ag.running = false; }
  // nudge doors open so it doesn't get stuck behind the lead
  for (const d of W.doors) { if (d.open || d.sealed || d === W.vaultDoorRef) continue; if (hyp(d.x, d.y, ag.x, ag.y) < 30) { d.open = true; d.openT = 3; } }
}

// ============================================================= AI agent (plays the field)
function agentAIControl(dt) {
  const ag = W.ag; if (ag.dead) return;
  const ai = W._agAI || (W._agAI = { path: [], repath: 0, think: 0, hideT: 0, mode: 'advance', waitFor: null });
  // threat assessment
  let threat = null, td = 200;
  for (const g of W.guards) { if (g.dead) continue; if (g.state === 'alert' && guardSeesAgent(g)) { const d = hyp(ag.x, ag.y, g.x, g.y); if (d < td) { threat = g; td = d; } } }
  // retaliate if seen & close
  if (threat && td < 150 && ag.mag > 0) { ag.aim = turnTo(ag.aim, Math.atan2(threat.y - ag.y, threat.x - ag.x), 10 * dt); if (Math.abs(angDiff(ag.aim, Math.atan2(threat.y - ag.y, threat.x - ag.x))) < 0.2) agentFire(); }
  // takedown adjacent unaware guard
  for (const g of W.guards) { if (g.dead) continue; const d = hyp(ag.x, ag.y, g.x, g.y); if (d < 24 && g.state !== 'alert') { takedown(g, true); } }

  // objective-driven goal
  const o = W.obj; let goal = null, action = null;
  const S = objSpots;
  // --- overwatch orders override the objective in AI mode (move / hold / go / fall back) ---
  if (W.agHold) {
    ag.moving = false; ai.path = []; ag.cloak = ag.bat > 20 && !!threat;
    if (threat && ag.mag > 0) { const fa = Math.atan2(threat.y - ag.y, threat.x - ag.x); ag.aim = turnTo(ag.aim, fa, 9 * dt); if (Math.abs(angDiff(ag.aim, fa)) < 0.2) agentFire(); }
    return;
  }
  let orderGoal = null;
  if (W.agOrder) {
    if (W.agOrder.kind === 'move') { orderGoal = { x: W.agOrder.x, y: W.agOrder.y }; if (hyp(ag.x, ag.y, orderGoal.x, orderGoal.y) < 24) { W.agOrder = null; orderGoal = null; if (W.waypoint && W.waypoint.order) W.waypoint = null; comms('ag', 'In position.'); } }
    else if (W.agOrder.kind === 'retreat') { orderGoal = { x: S.entryRoom.cx * T, y: S.entryRoom.cy * T }; if (hyp(ag.x, ag.y, orderGoal.x, orderGoal.y) < 40) { W.agOrder = null; orderGoal = null; } }
  }
  if (o.step === 0) { goal = { x: (S.entryRoom.cx) * T, y: (S.entryRoom.cy) * T }; action = () => { if (W.maintDoorRef && !W.maintDoorRef.open && !W.maintDoorRef.sealed && hyp(ag.x, ag.y, W.maintDoorRef.x, W.maintDoorRef.y) < 30 && !pickState) startPick(W.maintDoorRef, () => { setStep(1); comms('ag', 'Inside.'); }); }; }
  else if (o.step === 1) { goal = { x: S.util.tx * T + T / 2, y: S.util.ty * T + T / 2 }; action = () => { if (hyp(ag.x, ag.y, goal.x, goal.y) < 26 && !channelState) startChannel(2.2, '', () => { o.access = 2; o.relays = 1; setStep(2); comms('ag', 'Building relay live.'); }); }; }
  else if (o.step === 2) { if (W.chief && !W.chief.dead) { goal = { x: W.chief.x, y: W.chief.y }; } else { tryLootBody(); goal = W.bodies.find(b => b.chief) || null; } }
  else if (o.step === 3) { goal = { x: S.net.tx * T + T / 2, y: S.net.ty * T + T / 2 }; action = () => { if (hyp(ag.x, ag.y, goal.x, goal.y) < 26 && !channelState) startChannel(2.6, '', () => { o.access = 3; o.relays = 2; setStep(4); comms('ag', 'Core relay live.'); }); }; }
  else if (o.step === 4) { goal = { x: W.vaultDoorRef.x, y: W.vaultDoorRef.y }; action = () => { if (!ag.keycard) return; if (!o.vaultCracked) { owIntentCrack = true; o.cracking = Math.max(o.cracking, 0.001); return; } W.vaultDoorRef.open = true; W.vaultDoorRef.openT = 99; setStep(5); }; }
  else if (o.step === 5 || o.step === 6) { goal = { x: S.uplink.tx * T + T / 2, y: S.uplink.ty * T + T / 2 }; action = () => { if (o.step === 6 && hyp(ag.x, ag.y, goal.x, goal.y) < 30) { ag.drive = true; setStep(7); o.lockdown = true; triggerLockdown(); } }; }
  else if (o.step === 7) {
    const dock = W.dockDoorRef;
    if (dock && !dock.open) { goal = { x: dock.x, y: dock.y }; action = () => { if (hyp(ag.x, ag.y, dock.x, dock.y) < 30 && !pickState) startPick(dock, () => { dock.sealed = false; dock.open = true; dock.openT = 999; dock.hacked = true; comms('ag', 'Forced the dock door. Exfil is open.'); }); }; }
    else goal = { x: exfil.x + exfil.w / 2, y: exfil.y + exfil.h / 2 };
  }
  // an active move/fall-back order takes priority over the objective destination
  if (orderGoal) { goal = orderGoal; action = null; }

  // hold tight on the uplink during the copy: stay put, face threats, don't wander off
  if (o.step === 5 && goal && hyp(ag.x, ag.y, goal.x, goal.y) < 30) {
    ag.moving = false; ag.cloak = ag.bat > 15;
    if (threat) { ag.aim = turnTo(ag.aim, Math.atan2(threat.y - ag.y, threat.x - ag.x), 9 * dt); if (ag.mag > 0 && Math.abs(angDiff(ag.aim, Math.atan2(threat.y - ag.y, threat.x - ag.x))) < 0.2) agentFire(); }
    if (action) action();
    return;
  }
  // move toward goal, avoiding alert guards' LOS a little by just pathing
  if (goal) {
    ai.repath -= dt;
    if (ai.repath <= 0 || !ai.path.length) { ai.repath = 0.5; ai.path = pathTo(ag, goal.x, goal.y, false); }
    // nearest guard/camera proximity for stealth decisions
    let gnear = 999; for (const g of W.guards) { if (!g.dead) gnear = Math.min(gnear, hyp(g.x, g.y, ag.x, ag.y)); }
    for (const c of W.cams) { if (!c.dead && !c.hacked) gnear = Math.min(gnear, hyp(c.x, c.y, ag.x, ag.y)); }
    const danger = !!threat && td < 230;
    const sneaking = !danger && gnear < 220;            // creep when something's near
    const spd = danger ? 120 : sneaking ? 60 : (o.alarm > 0.4 ? 100 : 82);
    ag.running = danger || (o.alarm > 0.3 && !sneaking);
    if (ai.path.length) {
      const wp = ai.path[0], dx = wp.x - ag.x, dy = wp.y - ag.y, d = Math.hypot(dx, dy);
      if (d < 7) ai.path.shift(); else { const st = Math.min(d, spd * dt); moveEnt(ag, dx / d * st, dy / d * st, true); if (!threat) ag.aim = turnTo(ag.aim, Math.atan2(dy, dx), 7 * dt); }
      ag.moving = true;
      // stay cloaked whenever a threat is within sight range and camo has charge
      ag.cloak = ag.bat > 22 && (danger || gnear < 230 || o.alarm > 0.25);
    } else ag.moving = false;
    // doors: overwatch opens them. When no human runs overwatch, the AI handler opens the nearest one ahead.
    if (!humanDrivesOp()) { for (const dr of W.doors) { if (dr.open || dr.sealed || dr === W.vaultDoorRef) continue; if (hyp(dr.x, dr.y, ag.x, ag.y) < 34) { dr.open = true; dr.openT = 4; } } }
    if (action) action();
    if (hyp(ag.x, ag.y, goal.x, goal.y) < 30) agentInteract2();
  }
}
function agentInteract2() { /* AI calls objective-specific actions inline above; nothing extra */ }

// ---- cyber warfare: enemy ICE attacks the operator's console; purge it or go offline ----
function intrTick(dt) {
  const ow = W.ow, o = W.obj;
  if (ow.defended > 0) ow.defended -= dt;
  if (ow.offline > 0) { ow.offline -= dt; if (ow.offline <= 0) { ow.offline = 0; comms('sys', 'Console rebooted — overwatch back online.'); nToastShow('BACK ONLINE'); ow.intrCd = 10; } return; }
  // an active intrusion always progresses — whether it's the ambient ICE or a warden's manual hack
  if (ow.hack) {
    const rate = ow.hack.rate * (0.8 + o.alarm * 0.9);
    ow.hack.prog += rate * dt;
    if (ow.hack.prog >= 1) { ow.hack = null; ow.offline = 6 + (D().count > 0.85 ? 2 : 0); ow.selAlly = null; ow.casts = []; comms('sys', 'Console breached — OVERWATCH OFFLINE.'); nToastShow('CONSOLE OFFLINE'); aBannerFlash('OVERWATCH DOWN', 'warn'); sfx('alarm'); }
    return;
  }
  if (!cyberWar) return;  // only the ambient auto-intrusion scheduling needs the modifier on
  ow.intrCd -= dt * (0.7 + o.alarm);
  if (ow.intrCd <= 0) { ow.hack = { prog: 0, rate: 0.13 + D().awRate * 0.05 }; comms('sys', 'ICE intrusion on your feed — PURGE IT.'); nToastShow('! INTRUSION — PURGE'); sfx('emp'); ow.intrCd = 26; }
}
// Operator defends: knock the intrusion back; enough taps in time repels it.
function owPurge() {
  if (net.mode === 'guest') { net.out('purge'); return; }  // host runs the sim
  const ow = W.ow; if (ow.offline > 0) return; ow.defended = 0.5;
  if (!ow.hack) return;
  ow.hack.prog -= 0.3;
  if (ow.hack.prog <= 0) { ow.hack = null; ow.intrCd = Math.max(ow.intrCd, 14); comms('me', 'Overwatch: intrusion purged.'); nToastShow('INTRUSION PURGED'); sfx('pickup'); }
}
function owOffline() { return W && W.ow && W.ow.offline > 0; }

// ---- versus: the human warden drives the facility against an AI agent + AI operator ----
function isDrone(u) { return W.drones.includes(u); }
function defClickWorld(wx, wy, button) {
  const def = W.def;
  // armed RALLY: the next map tap sends every unit to that spot (not to the agent, whom you may not see)
  if (def.rallyArm) {
    if (button === 2) { def.rallyArm = false; nToastShow('RALLY CANCELLED'); return; }
    def.rallyArm = false;
    if ((def.cd.rally || 0) > 0 || def.power < DEF_COST.rally) { nToastShow('RALLY NOT READY'); return; }
    for (const g of W.guards) { if (g.dead) continue; g.defGo = { x: wx, y: wy }; if (!g._sees) { g.state = 'patrol'; g.target = null; g.path = []; } g.aw = Math.max(g.aw, 0.5); }
    for (const dr of W.drones) { if (!dr.dead) dr.defGo = { x: wx, y: wy }; }
    def.cd.rally = 16; def.power -= DEF_COST.rally; def.rallyPt = { x: wx, y: wy, t: 4 };
    comms('sys', 'Warden: all units, converge on the marker.'); nToastShow('RALLY — CONVERGE'); return;
  }
  if (button === 2) { if (def.sel && def.sel.defGo) { def.sel.defGo = null; if (!def.sel._sees) { def.sel.state = 'patrol'; def.sel.path = []; } nToastShow('UNIT RESUMED PATROL'); } def.sel = null; return; }
  // select the nearest unit (guard or drone), or send the selected unit to the spot
  let u = null, ud = 34;
  for (const q of W.guards) { if (q.dead) continue; const d = hyp(q.x, q.y, wx, wy); if (d < ud) { ud = d; u = q; } }
  for (const q of W.drones) { if (q.dead) continue; const d = hyp(q.x, q.y, wx, wy); if (d < ud) { ud = d; u = q; } }
  if (u) { def.sel = (def.sel === u) ? null : u; nToastShow(def.sel ? (isDrone(u) ? 'DRONE SELECTED — TAP A SPOT' : 'GUARD SELECTED — TAP A SPOT') : 'UNIT RELEASED'); return; }
  if (def.sel && !def.sel.dead) {
    if (def.power < 6) { nToastShow('LOW POWER'); return; }
    def.power -= 6; const s = def.sel; s.defGo = { x: wx, y: wy };
    if (isDrone(s)) { s.state = 'patrol'; s.path = []; nToastShow('DRONE ORDERED'); }
    else { if (!s._sees) { s.state = 'patrol'; s.target = null; s.path = []; } s.aw = Math.max(s.aw, 0.3); nToastShow('GUARD ORDERED'); }  // posts there and holds
    return;  // stays selected for repeat orders
  }
  // tap a camera to sweep (reveal the intruder briefly)
  let c = null, cd = 26; for (const cc of W.cams) { if (cc.dead) continue; const d = hyp(cc.x, cc.y, wx, wy); if (d < cd) { cd = d; c = cc; } }
  if (c) { if (def.power < 8) { nToastShow('LOW POWER'); return; } def.power -= 8; def.reveal = Math.max(def.reveal, 2.4); nToastShow('CAMERA SWEEP'); return; }
}
const DEF_COST = { rally: 20, lock: 28, hack: 24, scan: 14 };
function defAction(kind) {
  const def = W.def, ag = W.ag;
  if ((def.cd[kind] || 0) > 0) { nToastShow('RECHARGING'); return; }
  const cost = DEF_COST[kind] || 0; if (def.power < cost) { nToastShow('LOW POWER'); return; }
  const lkp = W.lkp || { x: ag.x, y: ag.y };
  if (kind === 'rally') { def.rallyArm = !def.rallyArm; nToastShow(def.rallyArm ? 'RALLY — TAP A LOCATION' : 'RALLY CANCELLED'); return; }   // armed; placement + cost handled in defClickWorld
  else if (kind === 'lock') { for (const d of W.doors) { if (d === W.vaultDoorRef || d.sealed) continue; d.sealed = true; d.open = false; d._unseal = 10; } def.cd.lock = 22; comms('sys', 'Warden: facility lockdown.'); nToastShow('LOCKDOWN'); sfx('alarm'); }
  else if (kind === 'hack') { W.ow.hack = { prog: 0, rate: 0.16 }; def.cd.hack = 22; comms('sys', 'Warden: spiking the operator feed.'); nToastShow('HACK — OP FEED'); sfx('emp'); }
  else if (kind === 'scan') { def.reveal = Math.max(def.reveal, 4); def.cd.scan = 12; nToastShow('THERMAL SWEEP'); }
  def.power -= cost;
}
// is the intruder currently visible to the warden (spotted by a sensor, or revealed by a sweep)?
function defSeesAgent() {
  if (!W || soloMode !== 'versus') return true;
  if (W.def.reveal > 0) return true;
  for (const g of W.guards) if (!g.dead && g._sees) return true;
  for (const c of W.cams) if (!c.dead && !c.hacked && c.spotted > 0.4) return true;
  return false;
}

// ============================================================= AI overwatch (supports the agent)
function opAIControl(dt) {
  // the AI operator defends its own feed, and mostly wins — but can still get knocked down
  if (owOffline()) return;
  const ai = W._opAI || (W._opAI = { t: 0, pt: 0, reacting: false }); ai.t -= dt;
  const o = W.obj, ag = W.ag;
  // the AI operator defends its own feed, but only after a reaction delay — so a warden's hack can land
  if (W.ow.hack) { if (!ai.reacting) { ai.reacting = true; ai.pt = 1.2 + Math.random() * 0.9; } ai.pt -= dt; if (ai.pt <= 0) { ai.pt = 0.5; if (Math.random() < 0.55) owPurge(); } }
  else ai.reacting = false;
  // auto-crack vault when agent is there
  if (o.step === 4 && ag.keycard && hyp(ag.x, ag.y, W.vaultDoorRef.x, W.vaultDoorRef.y) < 40) owIntentCrack = true;
  // auto fight sweep during upload
  if (o.step === 5 && o.upload > 0 && o.upload < 1 && W.ow.bw > 20 && o.sweep > 0.25) W.ow.sweepFight = 0.6;
  if (ai.t > 0) return; ai.t = 0.5;
  // open ELECTRONIC doors ahead of the agent (overwatch's domain) — mechanical locks are the
  // agent's job to pick, so leave those for the player to open with the lockpick (USE) button
  if (humanDrivesAgent() || soloMode === 'agent') {
    for (const d of W.doors) { if (d.open || d.sealed || d === W.vaultDoorRef || d.type === 'mech') continue; if (hyp(ag.x, ag.y, d.x, d.y) < 52) { if (W.ow.bw > 10) { d.open = true; d.openT = 5; } } }
  }
  // react to threats: jam / lights / emp
  let nearAlert = 0, nearDrone = null;
  for (const g of W.guards) if (!g.dead && g.state === 'alert' && hyp(g.x, g.y, ag.x, ag.y) < 220) nearAlert++;
  for (const dr of W.drones) if (!dr.dead && dr.state === 'hunt' && hyp(dr.x, dr.y, ag.x, ag.y) < 220) nearDrone = dr;
  if (nearAlert >= 2 && owReady('jam')) owFire('jam');
  else if (nearDrone && owReady('emp')) owFire('emp', nearDrone.x, nearDrone.y);
  else if (o.alarm > 0.5 && owReady('lights')) { const z = zoneAtPx(ag.x, ag.y); if (z >= 0 && W.lights[z] === 1) owFire('lights', ag.x, ag.y); }
  // medevac the agent if they're down and no medic is already inbound
  if (ag.downed && !W.allies.some(a => a.medic) && owReady('medevac')) owFire('medevac', ag.x, ag.y);
  // deploy a combat drone when the agent is pinned down and none is active
  if (!ag.downed && nearAlert >= 2 && o.alarm > 0.5 && !W.allies.some(a => !a.medic) && owReady('cdrone')) owFire('cdrone', ag.x + rnd(-20, 20), ag.y - 30);
  // supply if hurt
  if (ag.hp < 60 && W.ow.drops > 0 && owReady('supply')) owFire('supply', ag.x + rnd(-20, 20), ag.y + rnd(-20, 20));
  // tag threats periodically
  if (o.alarm > 0.2 && owReady('scan')) owFire('scan');
}

// ============================================================= agent requests (to overwatch)
const REQS = {
  door: 'needs a door opened', distract: 'wants a distraction', supply: 'needs a supply drop',
  lights: 'wants the lights cut', scan: 'wants a scan', ping: 'pinged a location',
};
const REQ_LABEL = { door: 'a door opened', distract: 'a distraction', supply: 'a supply drop', lights: 'the lights cut', scan: 'a scan', ping: 'eyes here', mark: 'a mark', jam: 'earpieces jammed', emp: 'an EMP', spoof: 'cameras spoofed', decoy: 'a decoy', cdrone: 'drone support' };
let agentReqMode = null;   // armed request kind awaiting a placement tap
// select-then-place: a request button arms the request; the next tap on the agent screen places it
function agentRequest(kind) {
  if (kind === 'scan') { agentRequestAt('scan', W.ag.x, W.ag.y); return; }  // scan is global, no target needed
  agentReqMode = (agentReqMode === kind) ? null : kind;
  if (agentReqMode) aToastShow('TAP A SPOT · ' + (REQ_LABEL[kind] || kind).toUpperCase());
  const grid = $('aReqGrid'); if (grid) grid.querySelectorAll('button').forEach(b => b.classList.toggle('arm', b.dataset.r === agentReqMode));
}
function cancelAgentReq() { agentReqMode = null; const grid = $('aReqGrid'); if (grid) grid.querySelectorAll('button').forEach(b => b.classList.remove('arm')); }
// drag a request straight onto the map (tap still arms select-then-place)
let agentReqDrag = null;
function agentReqDragStart(kind, sx, sy) { agentReqDrag = { kind, sx, sy, cx: sx, cy: sy, moved: 0 }; }
window.addEventListener('pointermove', e => { if (agentReqDrag) { agentReqDrag.cx = e.clientX; agentReqDrag.cy = e.clientY; agentReqDrag.moved = Math.max(agentReqDrag.moved, Math.hypot(e.clientX - agentReqDrag.sx, e.clientY - agentReqDrag.sy)); } });
window.addEventListener('pointerup', e => {
  if (!agentReqDrag) return; const d = agentReqDrag; agentReqDrag = null;
  if (game !== 'play' || view !== 'agent' || !humanDrivesAgent()) return;
  if (d.kind === 'scan') { agentRequestAt('scan', W.ag.x, W.ag.y); return; }
  if (d.moved > 14) { const w = screenToAgentWorld(e.clientX, e.clientY); agentRequestAt(d.kind, w.x, w.y); }
  else { agentRequest(d.kind); }   // a tap -> arm select-then-place
});
function agentPlaceRequest(wx, wy) { if (!agentReqMode) return false; agentRequestAt(agentReqMode, wx, wy); cancelAgentReq(); return true; }
function agentRequestAt(kind, wx, wy) {
  const lbl = REQ_LABEL[kind] || kind;
  comms('req', 'Agent needs ' + lbl + '.');
  net.out('req', kind, RR(wx), RR(wy));
  W.reqPins.push({ x: wx, y: wy, kind, t: 10 });
  if (kind === 'ping' || kind === 'mark') W.pings.push({ x: wx, y: wy, t: 6 });
  aReqNotify('REQUEST SENT · ' + lbl.toUpperCase());
  const el = document.querySelector('.a-req span[data-r="' + kind + '"]'); if (el) { el.classList.add('sent'); setTimeout(() => el.classList.remove('sent'), 1500); }
  if (!humanDrivesOp()) aiFulfilRequest(kind, wx, wy);
}
function aiFulfilRequest(kind, wx, wy) {
  const ag = W.ag; const px = wx == null ? ag.x : wx, py = wy == null ? ag.y : wy;
  setTimeout(() => {
    if (!W || game !== 'play') return;
    if (kind === 'door') { let best = null, bd = 140; for (const d of W.doors) { if (d.open || d.sealed || d.type === 'mech') continue; const q = hyp(px, py, d.x, d.y); if (q < bd) { bd = q; best = d; } } if (best) { best.open = true; best.openT = 6; best.hacked = true; comms('me', 'Overwatch: door open.'); pushAgentMsg('Door open — go.'); } }
    else if (kind === 'supply' && owReady('supply')) owFire('supply', px, py);
    else if (kind === 'lights' && owReady('lights')) owFire('lights', px, py);
    else if (kind === 'scan' && owReady('scan')) owFire('scan');
    else if (kind === 'jam' && owReady('jam')) owFire('jam');
    else if (kind === 'emp' && owReady('emp')) owFire('emp', px, py);
    else if (kind === 'spoof' && owReady('spoof')) owFire('spoof');
    else if (kind === 'decoy' && owReady('decoy')) owFire('decoy', px, py);
    else if (kind === 'cdrone' && owReady('cdrone')) owFire('cdrone', px, py);
    else if (kind === 'distract') { const v = W.devs.filter(d => !d.hacked).sort((a, b) => hyp(a.x, a.y, px, py) - hyp(b.x, b.y, px, py))[0]; if (v && hyp(v.x, v.y, px, py) < 420) { v.active = 3; noise(v.x, v.y, v.radius, true); comms('me', 'Overwatch: tripping the ' + v.name.toLowerCase() + '.'); pushAgentMsg('Tripping the ' + v.name.toLowerCase() + '.'); } }
  }, rnd(300, 800));
}

// ============================================================= end mission
function endMission(win, msg) {
  if (W.obj.won || W.obj.lost) return;
  W.obj.won = win; W.obj.lost = !win; W.obj.lostMsg = msg;
  game = 'over';
  net.out('end', win ? 1 : 0, msg);
  showResults(win, msg);
  sfx(win ? 'win' : 'fail');
}

// ============================================================= canvas & audio
const cv = $('game'), ctx = cv.getContext('2d');
const bcv = $('bodycam'), bctx = bcv.getContext('2d');
// offscreen buffers for post-processing (bloom) + a static noise tile for film grain
const bloomC = document.createElement('canvas'), bloomX = bloomC.getContext('2d');
const grainC = document.createElement('canvas'), grainX = grainC.getContext('2d');
(function makeGrain() { grainC.width = grainC.height = 128; const img = grainX.createImageData(128, 128); const d = img.data; for (let i = 0; i < d.length; i += 4) { const v = 128 + (Math.random() * 2 - 1) * 90; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } grainX.putImageData(img, 0, 0); })();
let FXQ = 1;   // effects quality (lowered on weak devices)
let VW = 0, VH = 0, DPR = 1, AGS = 1;
// split-screen viewport state: VX0/VY0 = current half's offset, RAG = agent being rendered, VROT = 180° flip.
// Split is TOP/BOTTOM so the two players sit across the device (chessboard) — each half is full width, half height.
let VX0 = 0, VY0 = 0, RAG = null, splitActive = false, VROT = 0;
function splitScreen() { return soloMode === 'split'; }
// base transform for the current half — flipped 180° when VROT (players face each other across the device)
function vbSet() {
  if (VROT) ctx.setTransform(-DPR, 0, 0, -DPR, (VX0 + VW) * DPR, (VY0 + VH) * DPR);
  else ctx.setTransform(DPR, 0, 0, DPR, VX0 * DPR, VY0 * DPR);
}
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = Math.round(VW * DPR); cv.height = Math.round(VH * DPR);
  AGS = clamp(Math.min(VW, VH) / 620, 0.72, 1.3) * 1.5;
  bcv.width = 360; bcv.height = 225;
  bloomC.width = Math.max(1, Math.round(VW * 0.5)); bloomC.height = Math.max(1, Math.round(VH * 0.5));
}
window.addEventListener('resize', resize); resize();
function worldToScreenAgent(wx, wy) { return { x: (wx - W.cam.x) * AGS + VW / 2, y: (wy - W.cam.y) * AGS + VH / 2 }; }
function screenToAgentWorld(sx, sy) { return { x: (sx - VW / 2) / AGS + W.cam.x, y: (sy - VH / 2) / AGS + W.cam.y }; }

let AC = null, nbuf = null;
function initAudio() { if (AC) { if (AC.state === 'suspended') AC.resume(); return; } try { AC = new (window.AudioContext || window.webkitAudioContext)(); nbuf = AC.createBuffer(1, AC.sampleRate / 2, AC.sampleRate); const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = RNG() * 2 - 1; } catch (e) { AC = null; } }
function envg(g, t, a, pk, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function nz(t, f, q, pk, dec, type) { if (!AC) return; const s = AC.createBufferSource(); s.buffer = nbuf; const fl = AC.createBiquadFilter(); fl.type = type || 'bandpass'; fl.frequency.value = f; fl.Q.value = q; const g = AC.createGain(); envg(g, t, 0.003, pk, dec); s.connect(fl); fl.connect(g); g.connect(AC.destination); s.start(t); s.stop(t + dec + 0.05); }
function tn(t, f0, f1, pk, dec, type) { if (!AC) return; const o = AC.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dec); const g = AC.createGain(); envg(g, t, 0.004, pk, dec); o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dec + 0.05); }
function sfx(k, vol) { if (!AC) return; vol = vol == null ? 1 : vol; const t = AC.currentTime; switch (k) {
  case 'shot': nz(t, 2200, 0.8, 0.18 * vol, 0.06); tn(t, 170, 60, 0.1 * vol, 0.05, 'triangle'); break;
  case 'eshot': nz(t, 850, 0.7, 0.42 * vol, 0.15); tn(t, 130, 40, 0.22 * vol, 0.11, 'triangle'); break;
  case 'thud': nz(t, 420, 1.1, 0.3, 0.1); break;
  case 'reload': tn(t, 1300, 850, 0.08, 0.04, 'square'); tn(t + 0.5, 850, 650, 0.09, 0.05, 'square'); break;
  case 'pickup': tn(t, 640, 960, 0.12, 0.16); break;
  case 'alert': tn(t, 820, 820, 0.1, 0.08, 'square'); tn(t + 0.12, 1120, 1120, 0.1, 0.1, 'square'); break;
  case 'boom': nz(t, 280, 0.5, 0.7 * vol, 0.7, 'lowpass'); tn(t, 80, 30, 0.5 * vol, 0.5); break;
  case 'emp': tn(t, 1800, 200, 0.2, 0.4, 'sawtooth'); nz(t, 1200, 0.5, 0.2, 0.3); break;
  case 'win': tn(t, 520, 520, 0.14, 0.14); tn(t + 0.15, 780, 780, 0.14, 0.3); break;
  case 'fail': tn(t, 300, 90, 0.22, 0.6, 'sawtooth'); break;
} }
function buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
function blood(x, y, a) { for (let i = 0; i < 6; i++) W.fx.push({ k: 'p', x, y, vx: Math.cos(a) * rnd(20, 80) + rnd(-30, 30), vy: Math.sin(a) * rnd(20, 80) + rnd(-30, 30), t: rnd(0.2, 0.5), c: '150,30,24' }); }
function sparks(x, y) { for (let i = 0; i < 5; i++) { const a = rnd(0, TAU); W.fx.push({ k: 'p', x, y, vx: Math.cos(a) * rnd(30, 120), vy: Math.sin(a) * rnd(30, 120), t: rnd(0.1, 0.3), c: '255,210,120' }); } }
function hurtFlash(a) { const h = $('hurt'); h.style.opacity = '1'; clearTimeout(hurtFlash._t); hurtFlash._t = setTimeout(() => h.style.opacity = '0', 180); }

// ============================================================= palette
const ZCOL = { floorA: '#171a1d', floorB: '#15181b', wall: '#2c3238', wallTop: '#3a424a', rack: '#242b33', cover: '#333b33', ext: '#0e1412', extEdge: '#13201a' };
// semi-3D palette (standard + night-vision phosphor)
const MAT = {
  wall:  { h: 15, top: '#3b434d', front: '#23282f', edge: '#4c555f', ntop: '#1f3a2c', nfront: '#122017', nedge: '#2b5240' },
  rack:  { h: 19, top: '#2b333d', front: '#141820', edge: '#39444f', ntop: '#19332a', nfront: '#0c1812', nedge: '#245038' },
  crate: { h: 9,  top: '#5a5038', front: '#2f2a1d', edge: '#6c6044', ntop: '#24331c', nfront: '#131d0f', nedge: '#2f5234' },
};
// draw one extruded block: footprint (px,py,sz), rises by m.h toward the viewer
function drawBlock(c, px, py, sz, m, nv) {
  const top = nv ? m.ntop : m.top, front = nv ? m.nfront : m.front, edge = nv ? m.nedge : m.edge;
  c.fillStyle = front; c.fillRect(px, py + sz - m.h, sz, m.h);              // south (front) face
  c.fillStyle = top; c.fillRect(px, py - m.h, sz, sz);                      // elevated top cap
  c.fillStyle = edge; c.fillRect(px, py - m.h, sz, 1.5);                    // top highlight edge
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px, py + sz - 1.5, sz, 1.5); // base contact shade
}

// ============================================================= AGENT VIEW (realistic, fog of war)
function drawAgent() {
  vbSet();
  const ag = RAG || localAgent() || W.ag, nv = ag.nv;
  ctx.fillStyle = nv ? '#0a1410' : '#06080a'; ctx.fillRect(0, 0, VW, VH);
  ctx.save();
  ctx.translate(VW / 2, VH / 2); ctx.scale(AGS, AGS); ctx.translate(-W.cam.x, -W.cam.y);
  const vx0 = W.cam.x - VW / 2 / AGS - T, vx1 = W.cam.x + VW / 2 / AGS + T;
  const vy0 = W.cam.y - VH / 2 / AGS - T, vy1 = W.cam.y + VH / 2 / AGS + T;
  const tx0 = Math.max(0, Math.floor(vx0 / T)), tx1 = Math.min(COLS - 1, Math.ceil(vx1 / T));
  const ty0 = Math.max(0, Math.floor(vy0 / T)), ty1 = Math.min(ROWS - 1, Math.ceil(vy1 / T));
  // floors (with grout grid for a tiled concrete feel)
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const v = base[tx + ty * COLS]; const px = tx * T, py = ty * T;
    if (v === EXT) { ctx.fillStyle = nv ? '#0c140f' : ((tx * 5 + ty * 9) % 7 === 0 ? '#12161a' : '#0f1316'); ctx.fillRect(px, py, T, T); }
    else if (v !== WALL && v !== FENCE) {
      const z = zoneGrid[tx + ty * COLS]; const lit = z >= 0 ? W.lights[z] : 1;
      ctx.fillStyle = nv ? ((tx + ty) % 2 ? '#10201a' : '#0e1c17') : ((tx * 7 + ty * 13) % 5 === 0 ? '#20242b' : '#1b1f25');
      ctx.fillRect(px, py, T, T);
      if (!nv && !lit) { ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(px, py, T, T); }
      ctx.strokeStyle = nv ? 'rgba(80,160,120,0.08)' : 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
    }
  }
  // exfil pad
  ctx.fillStyle = 'rgba(126,226,168,0.08)'; ctx.fillRect(exfil.x, exfil.y, exfil.w, exfil.h);
  ctx.strokeStyle = 'rgba(126,226,168,0.5)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2; ctx.strokeRect(exfil.x + 2, exfil.y + 2, exfil.w - 4, exfil.h - 4); ctx.setLineDash([]);
  // cast shadows for solid/raised tiles (soft, offset toward camera)
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const v = base[tx + ty * COLS]; if (v === WALL || v === RACK || v === COVER) ctx.fillRect(tx * T + 4, ty * T + 5, T, T);
  }
  // extruded walls / racks / crates, drawn north->south so nearer blocks overlap farther ones
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const v = base[tx + ty * COLS]; const px = tx * T, py = ty * T;
    if (v === WALL) drawBlock(ctx, px, py, T, MAT.wall, nv);
    else if (v === RACK) { drawBlock(ctx, px + 2, py + 2, T - 4, MAT.rack, nv); for (let i = 0; i < 4; i++) { ctx.fillStyle = ((tx * 3 + ty + i) % 2) ? 'rgba(90,255,170,0.8)' : 'rgba(0,200,255,0.7)'; ctx.fillRect(px + 6 + (i % 2) * 10, py - MAT.rack.h + 5 + ((i / 2) | 0) * 7, 2, 2); } }
    else if (v === COVER) drawBlock(ctx, px + 3, py + 3, T - 6, MAT.crate, nv);
    else if (v === FENCE) { ctx.strokeStyle = nv ? 'rgba(120,200,160,0.5)' : 'rgba(120,130,120,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + T, py + T); ctx.moveTo(px + T, py); ctx.lineTo(px, py + T); ctx.stroke(); ctx.strokeStyle = nv ? 'rgba(120,200,160,0.3)' : 'rgba(90,100,90,0.4)'; ctx.strokeRect(px + 1, py + 1, T - 2, T - 2); }
  }
  // doors
  for (const d of W.doors) { if (d.tx < tx0 || d.tx > tx1 || d.ty < ty0 || d.ty > ty1) continue; const px = d.tx * T, py = d.ty * T; ctx.save(); if (d.open) { ctx.fillStyle = 'rgba(90,120,100,0.25)'; ctx.fillRect(px + 2, py + 2, T - 4, T - 4); } else { ctx.fillStyle = d.sealed ? (nv ? '#2a1618' : '#3a2024') : (nv ? '#223a2e' : '#4a4036'); ctx.fillRect(px + 2, py + 2, T - 4, T - 4); ctx.fillStyle = d === W.vaultDoorRef ? '#d6c27a' : d.sealed ? '#e0664f' : '#8a7a5a'; ctx.fillRect(px + T / 2 - 1, py + 4, 2, T - 8); } ctx.restore(); }
  // devices
  for (const v of W.devs) { if (v.x < vx0 || v.x > vx1 || v.y < vy0 || v.y > vy1) continue; const col = v.c || '245,211,0'; ctx.fillStyle = v.active > 0 ? 'rgb(' + col + ')' : 'rgba(0,200,255,0.5)'; ctx.beginPath(); ctx.arc(v.x, v.y, 3, 0, TAU); ctx.fill(); if (v.active > 0) { ctx.strokeStyle = 'rgba(' + col + ',' + (0.5 * v.active) + ')'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(v.x, v.y, (3 - v.active) * 20 + 6, 0, TAU); ctx.stroke(); } }
  // objective marker spot
  drawObjSpot();
  // items
  for (const it of W.items) {
    if (it.got) continue;
    const col = it.kind === 'med' ? '#7ee2a8' : it.kind === 'supply' ? '#00e5ff' : '#d6c27a';
    if (it.dropT > 0) { // supply parachuting in onto a landing beacon
      const yo = it.dropT * 150, sway = Math.sin(W.t * 2.6) * (6 + it.dropT * 10), cx = it.x + sway, cy = it.y - yo;
      // landing beacon on the ground
      ctx.strokeStyle = 'rgba(0,229,255,' + (0.3 + 0.3 * Math.sin(W.t * 8)) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(it.x, it.y, 16, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(0,229,255,0.12)'; ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(cx - 16, cy); ctx.lineTo(cx + 16, cy); ctx.closePath(); ctx.fill();
      // crate
      ctx.fillStyle = '#2a3340'; ctx.fillRect(cx - 6, cy - 6, 12, 12); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(cx - 6, cy - 6, 12, 12); ctx.fillStyle = col; ctx.fillRect(cx - 6, cy - 1, 12, 2);
      // parachute cords + canopy above the crate
      const pcy = cy - 30, pw = 20;
      ctx.strokeStyle = '#c9cfd6'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 5, cy - 6); ctx.lineTo(cx - pw, pcy); ctx.moveTo(cx + 5, cy - 6); ctx.lineTo(cx + pw, pcy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, pcy); ctx.stroke();
      ctx.fillStyle = '#2a6aa0'; ctx.beginPath(); ctx.moveTo(cx - pw, pcy); ctx.quadraticCurveTo(cx, pcy - 22, cx + pw, pcy); ctx.quadraticCurveTo(cx, pcy - 8, cx - pw, pcy); ctx.fill();
      ctx.strokeStyle = '#6fd0ff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - pw, pcy); ctx.quadraticCurveTo(cx, pcy - 22, cx + pw, pcy); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(cx, pcy - 16); ctx.lineTo(cx, pcy - 2); ctx.stroke();
      continue;
    }
    const pulse = 0.5 + 0.5 * Math.sin(W.t * 4);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + 0.2 * pulse; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(it.x, it.y, 9, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = col; ctx.fillRect(it.x - 4, it.y - 4, 8, 8); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(it.x - 4, it.y - 4, 8, 8);
  }
  // bodies
  for (const b of W.bodies) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = 'rgba(40,44,40,0.8)'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 8, 0, 0, TAU); ctx.fill(); if (b.chief && !W.ag.keycard) { ctx.fillStyle = '#d6c27a'; ctx.fillRect(-2, -2, 4, 4); } ctx.restore(); }
  // decoys
  for (const d of W.decoys) { ctx.strokeStyle = 'rgba(245,211,0,' + (d.t / 2.4 * 0.6) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(d.x, d.y, (2.4 - d.t) * 60 + 4, 0, TAU); ctx.stroke(); }
  // tracers
  for (const t of W.tracers) { ctx.strokeStyle = 'rgba(' + t.c + ',' + (t.t / 0.07) + ')'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke(); }
  // (enemies are drawn above the fog, below, so revealed/intel contacts always read clearly)
  // particles
  for (const f of W.fx) {
    if (f.k === 'p') { ctx.fillStyle = 'rgba(' + f.c + ',' + clamp(f.t * 2, 0, 1) + ')'; ctx.fillRect(f.x, f.y, 2, 2); f.x += f.vx * 0.016; f.y += f.vy * 0.016; }
    else if (f.k === 'boom') { ctx.strokeStyle = 'rgba(255,180,80,' + f.t + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(f.x, f.y, (0.5 - f.t) * 60 + 6, 0, TAU); ctx.stroke(); }
    else if (f.k === 'melee') { const pr = 1 - f.t / f.max; ctx.save(); ctx.translate(f.x, f.y); ctx.strokeStyle = 'rgba(255,255,255,' + (f.t / f.max) + ')'; ctx.lineWidth = 2.5; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const r0 = 4 + pr * 10, r1 = 8 + pr * 18; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke(); } ctx.restore(); }
    else if (f.k === 'stealth') { const pr = 1 - f.t / f.max; ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.strokeStyle = 'rgba(235,245,255,' + (f.t / f.max) + ')'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, 16, -0.9 + pr * 1.8, 0.9 + pr * 1.8); ctx.stroke(); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 16, -0.9 + pr * 1.8, 0.9 + pr * 1.8); ctx.strokeStyle = 'rgba(143,196,214,' + (f.t / f.max) + ')'; ctx.stroke(); ctx.restore(); }
    else if (f.k === 'heal') { const pr = 1 - f.t / f.max, al = f.t / f.max; ctx.strokeStyle = 'rgba(57,255,158,' + al + ')'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(f.x, f.y, 6 + pr * 24, 0, TAU); ctx.stroke(); ctx.fillStyle = 'rgba(57,255,158,' + al + ')'; ctx.fillRect(f.x - 2, f.y - 7, 4, 14); ctx.fillRect(f.x - 7, f.y - 2, 14, 4); }
  }
  // emps
  for (const e of W.emps) { ctx.strokeStyle = 'rgba(0,229,255,' + e.t + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, (0.6 - e.t) * 260 + 10, 0, TAU); ctx.stroke(); }
  // IR laser + agent
  drawAgentBody(ctx, ag.x, ag.y, ag.aim, ag);
  // partner marker (coop/both: the other player presence)
  ctx.restore();
  // fog of war
  drawFog(nv);
  // overlay: NV tint, cloak shimmer
  if (nv) { ctx.fillStyle = 'rgba(180,255,210,0.06)'; ctx.fillRect(0, 0, VW, VH); }
  // thermal optic: wash the environment cold so warm bodies pop
  if (ag.thermal) {
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = 'color'; ctx.fillStyle = '#143a66'; ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(6,14,28,0.35)'; ctx.fillRect(0, 0, VW, VH);
  }
  // enemies drawn above the fog so revealed contacts (sight, vicinity, or op intel) are always clear
  ctx.save(); ctx.translate(VW / 2, VH / 2); ctx.scale(AGS, AGS); ctx.translate(-W.cam.x, -W.cam.y);
  for (const g of W.guards) drawGuardWorld(g, false);
  for (const dr of W.drones) drawDroneWorld(dr, false);
  for (const a of W.allies) drawAllyWorld(a, false);
  for (const a of agentList()) if (a !== ag) drawTeammate(ctx, a, false);   // the other player's agent
  drawLKPWorld(false);
  // muzzle-flash light bursts (agent + any visible gunfire) lighting the scene
  const nowFire = (W.t - ag.lastShot) < 0.05;
  if (nowFire) addFlashLight(ag.x + Math.cos(ag.aim) * 16, ag.y + Math.sin(ag.aim) * 16, 88, '255,220,150', 0.42);
  for (const t of W.tracers) if (t.c === '255,90,70' && t.t > 0.05) addFlashLight(t.x1, t.y1, 78, '255,130,95', 0.4);
  ctx.restore();
  // cinematic post (bloom / grain / vignette) over the scene, before HUD — skipped in split (perf)
  if (!splitActive) postProcess(true);
  // night vision washes out in a lit room — best used with the lights cut
  const txa = Math.floor(ag.x / T), tya = Math.floor(ag.y / T), za = zoneAtPx(ag.x, ag.y);
  nvBrightNow = nv && base[txa + tya * COLS] !== EXT && za >= 0 && W.lights[za] === 1;
  if (nvBrightNow && !splitActive) {
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(bloomC, 0, 0, VW, VH); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(200,255,220,' + (0.27 + 0.05 * Math.sin(W.t * 8)) + ')'; ctx.fillRect(0, 0, VW, VH);
  }
  // waypoint / pings edge markers (single-view only; split uses its own compact overlay)
  if (!splitActive) { drawAgentMarkers(); drawCues(); }
  // pick/channel ring
  if (pickState || channelState) drawChannelRing();
  if (ag.reload > 0) {
    const s = worldToScreenAgent(ag.x, ag.y), cy = s.y - 28 * AGS, p = 1 - ag.reload / 1.1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(s.x, cy, 12, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#d6c27a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, cy, 12, -Math.PI / 2, -Math.PI / 2 + p * TAU); ctx.stroke();
    ctx.fillStyle = '#d6c27a'; ctx.font = '9px "Barlow Condensed"'; ctx.textAlign = 'center'; ctx.fillText('RELOAD', s.x, cy - 18);
  }
  // request drag-and-drop reticle
  if ((agentReqDrag && agentReqDrag.moved > 10) || agentReqMode) {
    const kind = agentReqDrag ? agentReqDrag.kind : agentReqMode;
    const x = agentReqDrag ? agentReqDrag.cx : (mouse.active ? mouse.x : VW / 2), y = agentReqDrag ? agentReqDrag.cy : (mouse.active ? mouse.y : VH / 2);
    const pr = 0.5 + 0.5 * Math.sin(W.t * 6);
    ctx.strokeStyle = 'rgba(214,194,122,' + (0.6 + pr * 0.4) + ')'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#d6c27a'; ctx.font = '11px "Barlow Condensed"'; ctx.textAlign = 'center'; ctx.fillText('REQUEST: ' + (REQ_LABEL[kind] || kind).toUpperCase(), x, y - 27);
  }
}
function addFlashLight(wx, wy, r, rgb, a) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(wx, wy, 2, wx, wy, r); g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(0.5, 'rgba(' + rgb + ',' + (a * 0.3) + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(wx, wy, r, 0, TAU); ctx.fill(); ctx.restore();
}
function drawObjSpot() {
  const o = W.obj, S = objSpots; let sp = null, col = '#d6c27a';
  if (o.step === 1) sp = S.util; else if (o.step === 3) sp = S.net; else if (o.step === 5 || o.step === 6) sp = S.uplink;
  if (sp) { const x = sp.tx * T + T / 2, y = sp.ty * T + T / 2; const pulse = 0.5 + 0.5 * Math.sin(W.t * 4); ctx.strokeStyle = 'rgba(214,194,122,' + (0.4 + pulse * 0.4) + ')'; ctx.lineWidth = 2; ctx.strokeRect(x - 12, y - 12, 24, 24);
    if (o.step === 5) { ctx.fillStyle = 'rgba(57,255,158,0.2)'; ctx.fillRect(x - 12, y - 12, 24 * o.upload, 24); }
  }
}
// the OTHER player's agent, drawn as the realistic grounded figure in a teal-green teammate tint
function drawTeammate(c, a, opView) {
  if (!a || a.dead) return;
  const z = opView ? W.opCam.z : AGS, down = a.downed, col = down ? '#ff2a6d' : (U().agent2Body || '#39ff9e');
  // ground shadow
  c.fillStyle = 'rgba(0,0,0,0.38)'; c.beginPath(); c.ellipse(a.x + 3, a.y + 4, 11, 8, 0, 0, TAU); c.fill();
  if (down) {
    c.save(); c.translate(a.x, a.y); c.rotate(a.aim + 0.5); c.fillStyle = '#38514a'; c.beginPath(); c.ellipse(0, 0, 11, 6, 0, 0, TAU); c.fill(); c.fillStyle = '#243a33'; c.beginPath(); c.arc(7, 0, 4, 0, TAU); c.fill(); c.restore();
  } else {
    // IR laser (teammate, dim green)
    const ld = ray(a.x, a.y, a.aim, 320, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || closedDoor(tx, ty); });
    c.strokeStyle = universe === 'nightwatch' ? 'rgba(64,216,232,0.24)' : 'rgba(57,255,158,0.24)'; c.lineWidth = 1; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + Math.cos(a.aim) * ld, a.y + Math.sin(a.aim) * ld); c.stroke();
    if (universe === 'nightwatch') { nwOperator(c, a.x, a.y - 3, a.aim, col, a.cloak); }
    else {
      // raised figure (same model as the player, tinted team-green)
      c.save(); c.translate(a.x, a.y - 3); c.rotate(a.aim);
      if (a.cloak) c.globalAlpha = 0.5;
      const body = a.cloak ? '#8fc4d6' : '#2f6b52', bodyLo = a.cloak ? '#5f97ab' : '#1f4a38', head = a.cloak ? '#b6e4f0' : '#245a44';
      c.fillStyle = '#12161a'; c.fillRect(4, -2, 15, 4);
      c.fillStyle = '#0c0f12'; c.fillRect(2, -3.5, 5, 7);
      c.fillStyle = bodyLo; c.beginPath(); c.ellipse(-1, 1.5, 8.5, 10, 0, 0, TAU); c.fill();
      c.fillStyle = body; c.beginPath(); c.ellipse(0, 0, 8.5, 10, 0, 0, TAU); c.fill();
      c.fillStyle = bodyLo; c.fillRect(-7, -9, 14, 3);
      c.fillStyle = head; c.beginPath(); c.arc(3, 0, 4.6, 0, TAU); c.fill();
      c.fillStyle = 'rgba(180,255,220,0.25)'; c.beginPath(); c.arc(4, -1.5, 1.8, 0, TAU); c.fill();
      c.restore(); c.globalAlpha = 1;
    }
  }
  // team ring + label + health
  c.strokeStyle = col; c.lineWidth = opView ? 1.4 / z : 1.4; c.beginPath(); c.arc(a.x, a.y, 13, 0, TAU); c.stroke();
  c.fillStyle = col; c.font = (opView ? 9 / z : 10) + 'px "Barlow Condensed"'; c.textAlign = 'center';
  c.fillText(down ? 'DOWN' : agentCallsign(a.idx || 0).toUpperCase(), a.x, a.y - 16); c.textAlign = 'left';
  if (a.hp < a.maxHp) { c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(a.x - 11, a.y + 13, 22, 3); c.fillStyle = a.hp < 35 ? '#ff2a6d' : col; c.fillRect(a.x - 11, a.y + 13, 22 * clamp(a.hp / (a.maxHp || 100), 0, 1), 3); }
}
// ---- NightWatch top-down character art (operator / Warden / SENTINEL drone) ----
// A NightWatch operator seen from above: Multicam-Black kit, chest rig, poncho shoulders,
// helmet with a goggle/NVG strip glowing in the team accent, KR-50 forward. Caller passes world x,y + facing.
function nwOperator(c, x, y, a, accent, cloak) {
  c.save(); c.translate(x, y); c.rotate(a);
  const al = cloak ? 0.42 : 1; c.globalAlpha = al;
  // KR-50 rifle, forward
  c.fillStyle = '#121314'; c.fillRect(-3, -1.8, 7, 3.6);                         // stock
  c.fillStyle = '#2a2d31'; c.fillRect(4, -3, 6, 6);                              // receiver + optic
  c.fillStyle = '#17181b'; c.fillRect(9, -1.3, 13, 2.6);                         // barrel + suppressor
  // poncho / pack behind the shoulders (urban-digital)
  c.fillStyle = cloak ? '#5f97ab' : '#33373b'; c.beginPath(); c.ellipse(-3.5, 0, 10.5, 11.8, 0, 0, TAU); c.fill();
  // Multicam-Black torso
  c.fillStyle = cloak ? '#8fc4d6' : '#2b2c2e'; c.beginPath(); c.ellipse(0, 0, 8.6, 10, 0, 0, TAU); c.fill();
  // plate carrier
  c.fillStyle = cloak ? '#6f9fb0' : '#1a1b1c'; c.beginPath(); c.ellipse(1, 0, 5.6, 7.6, 0, 0, TAU); c.fill();
  // mag pouches
  c.fillStyle = cloak ? '#5f97ab' : '#0f1012'; c.fillRect(-2.5, -5, 3, 3.4); c.fillRect(-2.5, 1.6, 3, 3.4);
  // shoulder straps (FDE) + accent patch (team colour)
  c.fillStyle = cloak ? '#7fb0c0' : '#5f533e'; c.fillRect(-6.5, -9, 13, 2.4);
  c.fillStyle = accent; c.fillRect(-4, -1.3, 2.6, 2.6);
  // head: helmet + goggle/NVG strip glowing in the team accent
  c.fillStyle = cloak ? '#b6e4f0' : '#20242a'; c.beginPath(); c.arc(3.4, 0, 4.5, 0, TAU); c.fill();
  c.save(); c.globalCompositeOperation = cloak ? 'source-over' : 'lighter';
  c.fillStyle = cloak ? '#dff4fa' : accent; c.globalAlpha = al * (cloak ? 1 : 0.85); c.fillRect(5.6, -2.6, 1.7, 5.2); c.restore();
  c.globalAlpha = 1; c.restore();
}
// A Warden guard: grey multicam, black tac vest, a RED VISOR that glows on alert, silenced SMG.
function nwWarden(c, x, y, a, state, flash, chief) {
  c.save(); c.translate(x, y); c.rotate(a);
  c.fillStyle = '#121314'; c.fillRect(3, -1.3, 13, 2.6);                         // SMG
  c.fillStyle = 'rgba(0,0,0,0.32)'; c.beginPath(); c.ellipse(-0.5, 1.4, 8, 9, 0, 0, TAU); c.fill();
  c.fillStyle = flash ? '#fff' : '#787d82'; c.beginPath(); c.ellipse(0, 0, 8, 9, 0, 0, TAU); c.fill();   // grey camo torso
  c.fillStyle = flash ? '#fff' : '#1c1d20'; c.beginPath(); c.ellipse(0.5, 0, 5, 6.6, 0, 0, TAU); c.fill(); // tac vest
  c.fillStyle = flash ? '#fff' : '#5a5e63'; c.fillRect(-6, -8, 12, 2.3);         // shoulders
  c.fillStyle = flash ? '#fff' : '#2a2c2f'; c.beginPath(); c.arc(2.8, 0, 4, 0, TAU); c.fill();   // helmet
  // red visor — the Warden identifier; glows when alert
  const alert = state === 'alert';
  if (alert) { c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(255,64,80,0.55)'; c.fillRect(4.2, -2.8, 2.6, 5.6); c.restore(); }
  c.fillStyle = flash ? '#fff' : (alert ? '#ff6472' : '#ff4050'); c.fillRect(4.7, -2.1, 1.6, 4.2);
  c.restore();
  if (chief) { c.fillStyle = '#c070ff'; c.beginPath(); c.arc(x, y - 13, 2.6, 0, TAU); c.fill(); c.strokeStyle = 'rgba(192,112,255,0.7)'; c.lineWidth = 1; c.stroke(); }
}
// A SENTINEL patrol drone: X-frame quad with spinning rotor discs, magenta hard-light core, red eye when hunting.
function nwDrone(c, x, y, spin, state, flash) {
  const hunt = state === 'hunt', neon = hunt ? '255,58,74' : '255,42,138';
  c.save(); c.translate(x, y);
  c.save(); c.rotate(spin);
  for (let i = 0; i < 4; i++) {
    const ang = i / 4 * TAU + Math.PI / 4, ex = Math.cos(ang) * 8.5, ey = Math.sin(ang) * 8.5;
    c.strokeStyle = flash ? '#fff' : '#3a3f48'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(0, 0); c.lineTo(ex, ey); c.stroke();
    c.strokeStyle = 'rgba(' + neon + ',0.5)'; c.lineWidth = 1; c.beginPath(); c.arc(ex, ey, 3.1, 0, TAU); c.stroke();
  }
  c.restore();
  // body plate + hard-light core
  c.fillStyle = flash ? '#fff' : '#20242b'; c.beginPath(); c.arc(0, 0, 3.6, 0, TAU); c.fill();
  c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = 'rgba(' + neon + ',0.9)'; c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fill(); c.restore();
  c.fillStyle = flash ? '#fff' : (hunt ? '#ff3a4a' : '#ff2a8a'); c.beginPath(); c.arc(0, 0, 1.2, 0, TAU); c.fill();
  c.restore();
}
function drawAgentBody(c, x, y, a, agArg) {
  const ag = agArg || W.ag;
  if (ag.downed) {
    c.fillStyle = 'rgba(0,0,0,0.4)'; c.beginPath(); c.ellipse(x + 2, y + 3, 13, 9, 0, 0, TAU); c.fill();
    c.save(); c.translate(x, y); c.rotate(a + 0.5);
    c.fillStyle = '#3b4a3a'; c.beginPath(); c.ellipse(0, 0, 11, 6, 0, 0, TAU); c.fill();
    c.fillStyle = '#24301f'; c.beginPath(); c.arc(7, 0, 4, 0, TAU); c.fill();
    c.restore();
    const pr = ag.downT / 16; c.strokeStyle = 'rgba(224,102,79,0.9)'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + pr * TAU); c.stroke();
    c.strokeStyle = 'rgba(224,102,79,' + (0.3 + 0.3 * Math.sin(W.t * 6)) + ')'; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 18, 0, TAU); c.stroke();
    return;
  }
  // flashlight / vision warmth in the aim cone (not in NV or thermal)
  if (!ag.nv && !ag.thermal) {
    const fl = c.createRadialGradient(x, y, 10, x, y, AG_FAR * 0.8);
    fl.addColorStop(0, 'rgba(255,240,200,0.10)'); fl.addColorStop(0.5, 'rgba(255,230,180,0.05)'); fl.addColorStop(1, 'rgba(0,0,0,0)');
    c.save(); c.globalCompositeOperation = 'lighter'; c.fillStyle = fl;
    c.beginPath(); c.moveTo(x, y);
    for (let i = -AG_CONE; i <= AG_CONE; i += 0.1) { const d = ray(x, y, a + i, AG_FAR, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || closedDoor(tx, ty); }); c.lineTo(x + Math.cos(a + i) * d, y + Math.sin(a + i) * d); }
    c.closePath(); c.fill(); c.restore();
  }
  // IR laser
  const ld = ray(x, y, a, 420, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || closedDoor(tx, ty); });
  c.strokeStyle = ag.nv ? 'rgba(255,60,60,0.85)' : 'rgba(255,40,40,0.32)'; c.lineWidth = ag.nv ? 1.4 : 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * ld, y + Math.sin(a) * ld); c.stroke();
  c.fillStyle = ag.nv ? '#ff4040' : 'rgba(255,60,60,0.6)'; c.beginPath(); c.arc(x + Math.cos(a) * ld, y + Math.sin(a) * ld, 2, 0, TAU); c.fill();
  // ground shadow
  c.fillStyle = 'rgba(0,0,0,0.38)'; c.beginPath(); c.ellipse(x + 3, y + 4, 11, 8, 0, 0, TAU); c.fill();
  // NightWatch: the operator model. Cold Archive: the original soldier.
  if (universe === 'nightwatch') { nwOperator(c, x, y - 3, a, (ag.idx ? (U().agent2Body || '#40d8e8') : (U().raBody || '#f2b35b')), ag.cloak); return; }
  // raised figure (lift toward camera for a standing look)
  c.save(); c.translate(x, y - 3); c.rotate(a);
  if (ag.cloak) c.globalAlpha = 0.42;
  const body = ag.cloak ? '#8fc4d6' : '#43513f', bodyLo = ag.cloak ? '#5f97ab' : '#2d3828', head = ag.cloak ? '#b6e4f0' : '#2f3b27';
  c.fillStyle = '#12161a'; c.fillRect(4, -2, 15, 4);                        // weapon (barrel forward)
  c.fillStyle = '#0c0f12'; c.fillRect(2, -3.5, 5, 7);                       // receiver
  c.fillStyle = bodyLo; c.beginPath(); c.ellipse(-1, 1.5, 8.5, 10, 0, 0, TAU); c.fill(); // lower torso (shade)
  c.fillStyle = body; c.beginPath(); c.ellipse(0, 0, 8.5, 10, 0, 0, TAU); c.fill();       // torso
  c.fillStyle = bodyLo; c.fillRect(-7, -9, 14, 3);                          // shoulders/pack
  c.fillStyle = head; c.beginPath(); c.arc(3, 0, 4.6, 0, TAU); c.fill();    // head (helmet)
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.arc(4, -1.5, 1.8, 0, TAU); c.fill(); // helmet highlight
  c.restore(); c.globalAlpha = 1;
}
function drawGuardWorld(g, opView) {
  if (g.dead) return;
  if (!opView && !agentRevealEnemy(g)) return;
  const ctxx = opView ? octx : ctx;
  const col = g.state === 'alert' ? '#e0664f' : g.state === 'suspicious' ? '#f5d300' : (g.chief ? '#d6a0ff' : '#c4604f');
  // thermal signature: a hot biological bloom (only the agent's thermal optic, direct heat)
  if (!opView && W.ag.thermal && !enemyThroughWall(g)) {
    ctxx.save(); ctxx.globalCompositeOperation = 'lighter';
    const gr = ctxx.createRadialGradient(g.x, g.y, 1, g.x, g.y, 18); gr.addColorStop(0, 'rgba(255,255,230,0.95)'); gr.addColorStop(0.3, 'rgba(255,120,40,0.9)'); gr.addColorStop(0.7, 'rgba(210,30,20,0.6)'); gr.addColorStop(1, 'rgba(120,0,10,0)');
    ctxx.fillStyle = gr; ctxx.beginPath(); ctxx.arc(g.x, g.y, 18, 0, TAU); ctxx.fill();
    ctxx.globalCompositeOperation = 'source-over'; ctxx.fillStyle = '#fff6e6'; ctxx.beginPath(); ctxx.arc(g.x, g.y, 3, 0, TAU); ctxx.fill();
    ctxx.restore();
    if (g.chief) { ctxx.fillStyle = '#ffd9a0'; ctxx.beginPath(); ctxx.arc(g.x, g.y - 14, 2.5, 0, TAU); ctxx.fill(); }
    return;
  }
  // op intel through a wall: faint physical silhouette + targeting square (no vision cone)
  const ghost = !opView && !agentDirectSee(g);   // revealed by intel, not in the agent's own clear sight
  if (ghost) {
    // pulse scan paints a plain red contact icon ("enemy here"); camera/tag intel shows a faint physical silhouette
    if (W.ow.scanT > 0) { drawContactIcon(ctxx, g.x, g.y, g.face, g.chief); return; }
    ctxx.save(); ctxx.globalAlpha = 0.5; ctxx.translate(g.x, g.y); ctxx.rotate(g.face);
    ctxx.fillStyle = '#12161a'; ctxx.fillRect(4, -1.5, 12, 3);
    ctxx.fillStyle = col; ctxx.beginPath(); ctxx.ellipse(0, 0, 8, 9, 0, 0, TAU); ctxx.fill();
    ctxx.fillStyle = 'rgba(0,0,0,0.45)'; ctxx.beginPath(); ctxx.arc(2.5, 0, 4, 0, TAU); ctxx.fill();
    ctxx.restore(); ctxx.globalAlpha = 1;
    if (g.chief) { ctxx.fillStyle = 'rgba(214,160,255,0.7)'; ctxx.beginPath(); ctxx.arc(g.x, g.y - 13, 2.5, 0, TAU); ctxx.fill(); }
    ctxx.strokeStyle = '#ff2a6d'; ctxx.lineWidth = 1.5; ctxx.strokeRect(g.x - 11, g.y - 11, 22, 22);
    ctxx.strokeStyle = '#ff2a6d'; ctxx.lineWidth = 1.5; const cc = 4; ctxx.beginPath(); ctxx.moveTo(g.x - 11, g.y - 11 + cc); ctxx.lineTo(g.x - 11, g.y - 11); ctxx.lineTo(g.x - 11 + cc, g.y - 11); ctxx.stroke();
    return;
  }
  // vision cone
  if (!opView || true) {
    const far = g.state === 'alert' ? 260 : 220; const half = 0.5;
    const grd = ctxx.createRadialGradient(g.x, g.y, 6, g.x, g.y, far);
    grd.addColorStop(0, g.state === 'alert' ? 'rgba(224,102,79,0.18)' : 'rgba(245,211,0,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctxx.fillStyle = grd; ctxx.beginPath(); ctxx.moveTo(g.x, g.y);
    for (let i = -half; i <= half; i += 0.12) { const d = ray(g.x, g.y, g.face + i, far, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || closedDoor(tx, ty); }); ctxx.lineTo(g.x + Math.cos(g.face + i) * d, g.y + Math.sin(g.face + i) * d); }
    ctxx.closePath(); ctxx.fill();
  }
  if (!opView) { ctxx.fillStyle = 'rgba(0,0,0,0.36)'; ctxx.beginPath(); ctxx.ellipse(g.x + 3, g.y + 4, 10, 7, 0, 0, TAU); ctxx.fill(); }
  const lift = opView ? 0 : 3;
  if (universe === 'nightwatch') { nwWarden(ctxx, g.x, g.y - lift, g.face, g.state, g.hitFlash > 0, g.chief); }
  else {
    ctxx.save(); ctxx.translate(g.x, g.y - lift); ctxx.rotate(g.face);
    const dark = g.hitFlash > 0 ? '#fff' : col;
    ctxx.fillStyle = '#12161a'; ctxx.fillRect(4, -1.5, 12, 3);                 // weapon
    ctxx.fillStyle = 'rgba(0,0,0,0.3)'; ctxx.beginPath(); ctxx.ellipse(-0.5, 1.5, 8, 9, 0, 0, TAU); ctxx.fill();
    ctxx.fillStyle = dark; ctxx.beginPath(); ctxx.ellipse(0, 0, 8, 9, 0, 0, TAU); ctxx.fill(); // torso
    if (!opView) { ctxx.fillStyle = 'rgba(0,0,0,0.3)'; ctxx.fillRect(-6, -8, 12, 2.5); }       // shoulders
    ctxx.fillStyle = g.hitFlash > 0 ? '#fff' : 'rgba(0,0,0,0.45)'; ctxx.beginPath(); ctxx.arc(2.5, 0, 4, 0, TAU); ctxx.fill(); // head
    ctxx.restore();
    if (g.chief) { ctxx.fillStyle = '#d6a0ff'; ctxx.beginPath(); ctxx.arc(g.x, g.y - 13, 2.5, 0, TAU); ctxx.fill(); }
  }
  if ((W.marks.includes(g.id) || g.markT > 0) && !opView) { ctxx.strokeStyle = '#ff2a6d'; ctxx.lineWidth = 1.5; ctxx.strokeRect(g.x - 11, g.y - 11, 22, 22); }
  // awareness pip
  if (g.aw > 0.1 && g.state !== 'alert') { ctxx.fillStyle = 'rgba(245,211,0,' + g.aw + ')'; ctxx.fillRect(g.x - 6, g.y - 15, 12 * g.aw, 2); }
}
function drawDroneWorld(dr, opView) {
  if (dr.dead) return;
  if (!opView && !agentRevealEnemy(dr)) return;
  const ctxx = opView ? octx : ctx;
  const col = dr.empT > 0 ? '#556' : dr.state === 'hunt' ? '#e0664f' : '#00e5ff';
  if (!opView && !agentDirectSee(dr)) { if (W.ow.scanT > 0) { drawContactIcon(ctxx, dr.x, dr.y, dr.scanA, false); return; } ctxx.save(); ctxx.globalAlpha = 0.5; ctxx.strokeStyle = col; ctxx.lineWidth = 2; for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + W.t * 5; ctxx.beginPath(); ctxx.moveTo(dr.x, dr.y); ctxx.lineTo(dr.x + Math.cos(a) * 7, dr.y + Math.sin(a) * 7); ctxx.stroke(); } ctxx.globalAlpha = 1; ctxx.strokeStyle = '#ff2a6d'; ctxx.lineWidth = 1.5; ctxx.strokeRect(dr.x - 10, dr.y - 10, 20, 20); ctxx.restore(); return; }
  if (dr.empT <= 0) { const far = 180, half = 0.45; const grd = ctxx.createRadialGradient(dr.x, dr.y, 4, dr.x, dr.y, far); grd.addColorStop(0, dr.state === 'hunt' ? 'rgba(224,102,79,0.14)' : 'rgba(0,229,255,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); ctxx.fillStyle = grd; ctxx.beginPath(); ctxx.moveTo(dr.x, dr.y); for (let i = -half; i <= half; i += 0.15) { const d = ray(dr.x, dr.y, dr.scanA + i, far, (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || closedDoor(tx, ty); }); ctxx.lineTo(dr.x + Math.cos(dr.scanA + i) * d, dr.y + Math.sin(dr.scanA + i) * d); } ctxx.closePath(); ctxx.fill(); }
  if (universe === 'nightwatch') { nwDrone(ctxx, dr.x, dr.y, W.t * 6, dr.empT > 0 ? 'emp' : dr.state, dr.hitFlash > 0); }
  else {
    ctxx.save(); ctxx.translate(dr.x, dr.y); ctxx.rotate(W.t * 6);
    ctxx.strokeStyle = dr.hitFlash > 0 ? '#fff' : col; ctxx.lineWidth = 2; for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; ctxx.beginPath(); ctxx.moveTo(0, 0); ctxx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7); ctxx.stroke(); ctxx.beginPath(); ctxx.arc(Math.cos(a) * 7, Math.sin(a) * 7, 2.5, 0, TAU); ctxx.stroke(); }
    ctxx.restore();
    ctxx.fillStyle = col; ctxx.beginPath(); ctxx.arc(dr.x, dr.y, 2, 0, TAU); ctxx.fill();
  }
  if (!opView && (dr.markT > 0 || W.ow.scanT > 0)) { ctxx.strokeStyle = '#ff2a6d'; ctxx.lineWidth = 1.5; ctxx.strokeRect(dr.x - 10, dr.y - 10, 20, 20); }
}
function drawAllyWorld(a, opView) {
  if (a.dead) return; const ctxx = opView ? octx : ctx; const col = a.medic ? '#e8f1ff' : '#39ff9e';
  let yo = 0;
  if (a.deployT > 0) {
    yo = a.deployT * 150;
    ctxx.strokeStyle = (a.medic ? 'rgba(232,241,255,0.5)' : 'rgba(57,255,158,0.5)'); ctxx.setLineDash([3, 3]); ctxx.lineWidth = opView ? 1 / W.opCam.z : 1.5; ctxx.beginPath(); ctxx.moveTo(a.x, a.y - yo - 260); ctxx.lineTo(a.x, a.y - yo); ctxx.stroke(); ctxx.setLineDash([]);
    ctxx.strokeStyle = (a.medic ? 'rgba(232,241,255,' : 'rgba(57,255,158,') + (0.3 + 0.3 * Math.sin(W.t * 8)) + ')'; ctxx.lineWidth = opView ? 2 / W.opCam.z : 2; ctxx.beginPath(); ctxx.arc(a.x, a.y, 14, 0, TAU); ctxx.stroke();
  }
  const dy = a.y - yo;
  ctxx.save(); ctxx.translate(a.x, dy); ctxx.rotate(W.t * 11);
  ctxx.strokeStyle = a.hitFlash > 0 ? '#fff' : col; ctxx.lineWidth = opView ? 1.5 / W.opCam.z : 2;
  for (let i = 0; i < 4; i++) { const ang = i / 4 * TAU; ctxx.beginPath(); ctxx.moveTo(0, 0); ctxx.lineTo(Math.cos(ang) * 7, Math.sin(ang) * 7); ctxx.stroke(); ctxx.beginPath(); ctxx.arc(Math.cos(ang) * 7, Math.sin(ang) * 7, 2.4, 0, TAU); ctxx.stroke(); }
  ctxx.restore();
  if (a.medic) { ctxx.fillStyle = '#39ff9e'; ctxx.fillRect(a.x - 1.5, dy - 4, 3, 8); ctxx.fillRect(a.x - 4, dy - 1.5, 8, 3); }   // medic cross
  else { ctxx.strokeStyle = col; ctxx.lineWidth = opView ? 2 / W.opCam.z : 2; ctxx.beginPath(); ctxx.moveTo(a.x, dy); ctxx.lineTo(a.x + Math.cos(a.face) * 11, dy + Math.sin(a.face) * 11); ctxx.stroke(); ctxx.fillStyle = col; ctxx.beginPath(); ctxx.arc(a.x, dy, 2.5, 0, TAU); ctxx.fill(); }
  if (a.deployT <= 0) { const w = 18, mx = a.medic ? 24 : 30; ctxx.fillStyle = 'rgba(0,0,0,0.55)'; ctxx.fillRect(a.x - w / 2, dy - 13, w, 2.5); ctxx.fillStyle = a.battery < 8 ? '#f5d300' : col; ctxx.fillRect(a.x - w / 2, dy - 13, w * clamp(a.battery / mx, 0, 1), 2.5); }
  if (opView && W.ow.selAlly === a) { octx.strokeStyle = '#f5d300'; octx.lineWidth = 1.5 / W.opCam.z; octx.beginPath(); octx.arc(a.x, dy, 13, 0, TAU); octx.stroke(); if (a.moveTo) { octx.setLineDash([4 / W.opCam.z, 3 / W.opCam.z]); octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(a.moveTo.x, a.moveTo.y); octx.stroke(); octx.setLineDash([]); } }
}
function drawLKPWorld(opView) {
  if (!W.lkp || !W.lkp.shown) return; const l = W.lkp; const c = opView ? octx : ctx;
  c.save(); c.translate(l.x, l.y); c.globalAlpha = 0.45 + 0.2 * Math.sin(W.t * 3);
  c.strokeStyle = '#ffffff'; c.fillStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = opView ? 1.4 / W.opCam.z : 1.6;
  c.save(); c.rotate(l.aim || 0);
  c.beginPath(); c.ellipse(0, 0, 8, 10, 0, 0, TAU); c.fill(); c.stroke();
  c.beginPath(); c.arc(3, 0, 4.4, 0, TAU); c.stroke();
  c.fillStyle = '#12161a'; c.restore();
  c.globalAlpha = 1; c.fillStyle = '#fff'; c.font = (opView ? 9 / W.opCam.z : 10) + 'px "Barlow Condensed"'; c.textAlign = 'center'; c.fillText('LAST SEEN', 0, -16);
  c.restore();
}
function drawFog(nv) {
  const fa = RAG || localAgent() || W.ag;
  // dim unexplored & outside-cone using the vision polygon
  ctx.save();
  vbSet();
  // build a dark overlay, punch the vision poly + explored
  fogCtx.setTransform(1, 0, 0, 1, 0, 0); fogCtx.clearRect(0, 0, fogC.width, fogC.height);
  fogCtx.fillStyle = nv ? 'rgba(6,16,12,0.96)' : 'rgba(4,6,9,0.97)'; fogCtx.fillRect(0, 0, fogC.width, fogC.height);
  fogCtx.save();
  fogCtx.translate(VW / 2, VH / 2); fogCtx.scale(AGS, AGS); fogCtx.translate(-W.cam.x, -W.cam.y);
  fogCtx.globalCompositeOperation = 'destination-out';
  // explored dim reveal
  fogCtx.globalAlpha = 0.5; fogCtx.imageSmoothingEnabled = true; fogCtx.drawImage(exploredCv, 0, 0, COLS * T, ROWS * T); fogCtx.globalAlpha = 1;
  // live cone
  const grd = fogCtx.createRadialGradient(fa.x, fa.y, 20, fa.x, fa.y, AG_FAR);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.7, 'rgba(0,0,0,0.96)'); grd.addColorStop(1, 'rgba(0,0,0,0.3)');
  fogCtx.fillStyle = grd; fogCtx.beginPath(); fogCtx.moveTo(VIS[0], VIS[1]); for (let i = 1; i < NRAYS; i++) fogCtx.lineTo(VIS[i * 2], VIS[i * 2 + 1]); fogCtx.closePath(); fogCtx.fill();
  fogCtx.restore();
  ctx.drawImage(fogC, 0, 0, VW, VH, 0, 0, VW, VH);   // copy this half's region 1:1 (VW may be a half-width)
  ctx.restore();
}
const fogC = document.createElement('canvas'), fogCtx = fogC.getContext('2d');
function syncFog() { fogC.width = VW; fogC.height = VH; }
// cinematic post pass: soft bloom on bright areas, film grain, vignette
let grainPattern = null, nvBrightNow = false;
function postProcess(agent) {
  const bw = bloomC.width, bh = bloomC.height;
  // bloom — blur a downscaled copy of the frame and add it back
  bloomX.setTransform(1, 0, 0, 1, 0, 0); bloomX.globalCompositeOperation = 'source-over'; bloomX.clearRect(0, 0, bw, bh);
  bloomX.filter = 'blur(' + (agent ? 3 : 2.6) + 'px) brightness(1.25) saturate(1.1)';
  bloomX.drawImage(cv, 0, 0, bw, bh); bloomX.filter = 'none';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (agent ? 0.4 : 0.52) * FXQ;
  ctx.drawImage(bloomC, 0, 0, VW, VH);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // film grain
  if (!grainPattern) grainPattern = ctx.createPattern(grainC, 'repeat');
  if (grainPattern) { ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = (agent ? 0.05 : 0.07) * FXQ; const ox = (Math.random() * 128) | 0, oy = (Math.random() * 128) | 0; ctx.save(); ctx.translate(-ox, -oy); ctx.fillStyle = grainPattern; ctx.fillRect(ox, oy, VW + ox, VH + oy); ctx.restore(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  // vignette
  const vg = ctx.createRadialGradient(VW / 2, VH * 0.5, Math.min(VW, VH) * 0.33, VW / 2, VH * 0.5, Math.max(VW, VH) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, agent ? 'rgba(0,0,0,0.5)' : 'rgba(0,8,16,0.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
}

// ============================================================= OVERWATCH VIEW (netrunner full map)
const octx = ctx; // op view shares the main canvas
function drawOp() {
  vbSet();   // respects VX0/VROT so the op console can render into a split-screen half
  ctx.fillStyle = '#04060b'; ctx.fillRect(0, 0, VW, VH);
  const C = W.opCam;
  ctx.save(); ctx.translate(VW / 2, VH / 2); ctx.scale(C.z, C.z); ctx.translate(-C.x, -C.y);
  // backdrop grid
  ctx.fillStyle = '#060b14'; ctx.fillRect(0, 0, COLS * T, ROWS * T);
  // floors by zone, tinted by security & light
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const v = base[tx + ty * COLS]; if (v === WALL || v === FENCE) continue;
    const z = zoneGrid[tx + ty * COLS]; const px = tx * T, py = ty * T;
    if (v === EXT) { ctx.fillStyle = '#071012'; ctx.fillRect(px, py, T, T); continue; }
    const sec = z >= 0 && zones[z] ? zones[z].sec : 0;
    const corr = z >= 0 && zones[z] && zones[z].room && zones[z].room.role === 'corridor';
    const lit = z >= 0 ? W.lights[z] : 1;
    let base2 = corr ? '#0c1922' : sec === 2 ? '#0a1a22' : sec === 1 ? '#081620' : '#07131c';
    ctx.fillStyle = lit ? base2 : '#05090e'; ctx.fillRect(px, py, T, T);
    if (corr && lit) { ctx.fillStyle = nA(0.04); ctx.fillRect(px, py, T, T); }  // hallway reads lighter
  }
  // zone outlines + facility room labels
  ctx.lineWidth = 1 / C.z;
  const facCol = soloMode === 'versus';
  roomList.forEach(r => {
    ctx.strokeStyle = r.sec === 2 ? 'rgba(255,42,109,0.3)' : nA(0.16);
    ctx.strokeRect(r.x0 * T + 1, r.y0 * T + 1, (r.x1 - r.x0) * T - 2, (r.y1 - r.y0) * T - 2);
    if (r.name && C.z > 0.38) { const lc = r.sec === 2 ? (facCol ? 'rgba(255,130,160,0.95)' : 'rgba(255,130,160,0.8)') : (facCol ? 'rgba(255,165,185,0.72)' : 'rgba(140,215,240,0.62)'); octText(r.name.toUpperCase(), r.cx * T, r.y0 * T + 12, lc, 9.5); }
  });
  // grid lines
  ctx.strokeStyle = nA(0.05); ctx.lineWidth = 1 / C.z; ctx.beginPath();
  for (let x = 0; x <= COLS; x += 2) { ctx.moveTo(x * T, 0); ctx.lineTo(x * T, ROWS * T); }
  for (let y = 0; y <= ROWS; y += 2) { ctx.moveTo(0, y * T); ctx.lineTo(COLS * T, y * T); }
  ctx.stroke();
  // walls as neon wireframe
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const v = base[tx + ty * COLS]; const px = tx * T, py = ty * T;
    if (v === WALL) { ctx.fillStyle = 'rgba(10,30,44,0.9)'; ctx.fillRect(px, py, T, T); ctx.strokeStyle = nA(0.22); ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1); }
    else if (v === RACK) { ctx.fillStyle = nA(0.34); ctx.fillRect(px + 3, py + 3, T - 6, T - 6); }
    else if (v === COVER) { ctx.fillStyle = 'rgba(40,80,70,0.4)'; ctx.fillRect(px + 4, py + 4, T - 8, T - 8); }
    else if (v === FENCE) { ctx.strokeStyle = nA(0.25); ctx.lineWidth = 1 / C.z; ctx.strokeRect(px + 2, py + 2, T - 4, T - 4); }
  }
  // exfil
  ctx.strokeStyle = 'rgba(57,255,158,0.6)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2 / C.z; ctx.strokeRect(exfil.x, exfil.y, exfil.w, exfil.h); ctx.setLineDash([]);
  octText('EXFIL', exfil.x + exfil.w / 2, exfil.y + exfil.h + 12, '#39ff9e', 10);
  // doors
  for (const d of W.doors) { const px = d.tx * T, py = d.ty * T; ctx.fillStyle = d.open ? 'rgba(57,255,158,0.5)' : d.sealed ? 'rgba(255,42,109,0.6)' : d === W.vaultDoorRef ? 'rgba(245,211,0,0.7)' : nA(0.5); ctx.fillRect(px + 3, py + 3, T - 6, T - 6); if (d.hacked) { ctx.strokeStyle = '#39ff9e'; ctx.lineWidth = 1.5 / C.z; ctx.strokeRect(px + 2, py + 2, T - 4, T - 4); } }
  // devices
  for (const v of W.devs) { const col = v.c || '245,211,0'; ctx.fillStyle = v.active > 0 ? 'rgb(' + col + ')' : nA(0.7); ctx.beginPath(); ctx.arc(v.x, v.y, 3.5, 0, TAU); ctx.fill(); ctx.strokeStyle = nA(0.4); ctx.lineWidth = 1 / C.z; ctx.strokeRect(v.x - 5, v.y - 5, 10, 10); if (v.active > 0) { ctx.strokeStyle = 'rgba(' + col + ',' + 0.6 * v.active + ')'; ctx.beginPath(); ctx.arc(v.x, v.y, (3 - v.active) * v.radius / 3 + 4, 0, TAU); ctx.stroke(); } if (C.z > 0.6 && v.glyph) { ctx.fillStyle = v.active > 0 ? 'rgb(' + col + ')' : nA(0.85); ctx.font = (10 / C.z) + 'px var(--a-font, sans-serif)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(v.glyph, v.x, v.y - 11); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; } }
  // items / supply
  for (const it of W.items) { if (it.got) continue; const col = it.kind === 'med' ? '#39ff9e' : it.kind === 'supply' ? '#00e5ff' : '#f5d300'; ctx.fillStyle = col; ctx.fillRect(it.x - 3, it.y - 3, 6, 6); if (it.dropT > 0) { ctx.strokeStyle = 'rgba(0,229,255,' + (0.4 + 0.3 * Math.sin(W.t * 8)) + ')'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(it.x, it.y, 8 + it.dropT * 14, 0, TAU); ctx.stroke(); octText('INBOUND', it.x, it.y - 14, '#00e5ff', 9); } }
  // objective ring
  const tgt = objectiveTarget(); if (tgt) { const pulse = 0.5 + 0.5 * Math.sin(W.t * 4); ctx.strokeStyle = 'rgba(245,211,0,' + (0.4 + pulse * 0.4) + ')'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(tgt.x, tgt.y, 16, 0, TAU); ctx.stroke(); octText('OBJ', tgt.x, tgt.y - 20, '#f5d300', 9); }
  // cameras
  for (const c of W.cams) { if (c.dead) continue; const col = c.hacked ? '#39ff9e' : c.spotted > 0.4 ? '#ff2a6d' : nHex(); const far = c.range; const grd = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, far); grd.addColorStop(0, c.hacked ? 'rgba(57,255,158,0.14)' : c.spotted > 0.4 ? 'rgba(255,42,109,0.2)' : nA(0.1)); grd.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(c.x, c.y); for (let i = -c.cone; i <= c.cone; i += 0.1) { const d = ray(c.x, c.y, c.face + i, far, (tx, ty) => opaqueAt(tx, ty)); ctx.lineTo(c.x + Math.cos(c.face + i) * d, c.y + Math.sin(c.face + i) * d); } ctx.closePath(); ctx.fill(); ctx.fillStyle = col; ctx.fillRect(c.x - 3, c.y - 3, 6, 6); }
  // decoys / pings / waypoint / emps
  for (const d of W.decoys) { ctx.strokeStyle = 'rgba(245,211,0,' + (d.t / 2.4) + ')'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(d.x, d.y, (2.4 - d.t) * 50 + 4, 0, TAU); ctx.stroke(); }
  for (const p of W.pings) { ctx.strokeStyle = 'rgba(255,42,109,' + (p.t / 6) + ')'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(p.x, p.y, 10 + (6 - p.t) * 4, 0, TAU); ctx.stroke(); octText('PING', p.x, p.y - 14, '#ff2a6d', 9); }
  // agent requests pinned on the map
  const REQP = { door: 'OPEN DOOR', distract: 'DISTRACT', supply: 'SUPPLY', lights: 'LIGHTS', scan: 'SCAN', ping: 'EYES', mark: 'MARK' };
  for (const p of W.reqPins) { const al = clamp(p.t / 3, 0, 1); const pulse = 0.5 + 0.5 * Math.sin(W.t * 5); ctx.strokeStyle = 'rgba(245,211,0,' + (al * (0.5 + pulse * 0.5)) + ')'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, TAU); ctx.moveTo(p.x, p.y - 17); ctx.lineTo(p.x, p.y - 9); ctx.moveTo(p.x, p.y + 9); ctx.lineTo(p.x, p.y + 17); ctx.moveTo(p.x - 17, p.y); ctx.lineTo(p.x - 9, p.y); ctx.moveTo(p.x + 9, p.y); ctx.lineTo(p.x + 17, p.y); ctx.stroke(); octText('⚑ ' + (REQP[p.kind] || p.kind), p.x, p.y - 20, '#f5d300', 10); }
  if (W.waypoint) { ctx.strokeStyle = '#f5d300'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(W.waypoint.x, W.waypoint.y, 8, 0, TAU); ctx.moveTo(W.waypoint.x - 12, W.waypoint.y); ctx.lineTo(W.waypoint.x + 12, W.waypoint.y); ctx.moveTo(W.waypoint.x, W.waypoint.y - 12); ctx.lineTo(W.waypoint.x, W.waypoint.y + 12); ctx.stroke(); }
  for (const e of W.emps) { ctx.strokeStyle = nA(e.t); ctx.lineWidth = 3 / C.z; ctx.beginPath(); ctx.arc(e.x, e.y, (0.6 - e.t) * 240 + 10, 0, TAU); ctx.stroke(); }
  // hack uploads in progress — a filling ring at the target (Cyberpunk-style upload)
  for (const c of W.ow.casts) { const pr = clamp(c.t / c.dur, 0, 1), rad = 15; ctx.lineWidth = 3 / C.z;
    ctx.strokeStyle = nA(0.2); ctx.beginPath(); ctx.arc(c.wx, c.wy, rad, 0, TAU); ctx.stroke();
    ctx.strokeStyle = nHex(); ctx.beginPath(); ctx.arc(c.wx, c.wy, rad, -Math.PI / 2, -Math.PI / 2 + pr * TAU); ctx.stroke();
    octText((CAST_ICON[c.id] || '⛓') + ' ' + c.label.toUpperCase(), c.wx, c.wy - rad - 6 / C.z, nHex(), 9);
    octText(Math.round(pr * 100) + '%', c.wx, c.wy + 3, nHex(), 8); }
  // facility rally marker — where the warden ordered every unit to converge
  if ((facRender || soloMode === 'versus') && W.def.rallyPt) { const r = W.def.rallyPt, pulse = 0.5 + 0.5 * Math.sin(W.t * 5); ctx.strokeStyle = 'rgba(255,42,109,' + (0.4 + pulse * 0.5) + ')'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(r.x, r.y, 10 + (4 - r.t) * 6, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(r.x - 14, r.y); ctx.lineTo(r.x + 14, r.y); ctx.moveTo(r.x, r.y - 14); ctx.lineTo(r.x, r.y + 14); ctx.stroke(); octText('RALLY', r.x, r.y - 18, '#ff2a6d', 9); }
  // bodies
  for (const b of W.bodies) { ctx.fillStyle = 'rgba(80,90,90,0.6)'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,42,109,0.4)'; ctx.lineWidth = 1 / C.z; ctx.beginPath(); ctx.moveTo(b.x - 5, b.y - 5); ctx.lineTo(b.x + 5, b.y + 5); ctx.moveTo(b.x + 5, b.y - 5); ctx.lineTo(b.x - 5, b.y + 5); ctx.stroke(); }
  // tracers
  for (const t of W.tracers) { ctx.strokeStyle = 'rgba(' + t.c + ',' + (t.t / 0.07) + ')'; ctx.lineWidth = 1.4 / C.z; ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke(); }
  // guards & drones (all visible to overwatch on tapped network; untapped zones dimmer)
  for (const g of W.guards) drawOpContact(g);
  // versus: highlight the warden's selected guard + its move order
  if ((soloMode === 'versus' || facRender) && W.def.sel && !W.def.sel.dead) { const s = W.def.sel, go = s.defGo || s.target; ctx.strokeStyle = '#ff2a6d'; ctx.lineWidth = 2 / C.z; ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, TAU); ctx.stroke(); octText(isDrone(s) ? 'DRONE' : nwText('GUARD'), s.x, s.y - 18, '#ff2a6d', 9); if (go) { ctx.setLineDash([4 / C.z, 3 / C.z]); ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(go.x, go.y); ctx.stroke(); ctx.setLineDash([]); ctx.strokeStyle = '#ff2a6d'; ctx.beginPath(); ctx.arc(go.x, go.y, 5, 0, TAU); ctx.stroke(); } }
  for (const dr of W.drones) drawOpDrone(dr);
  for (const a of W.allies) drawAllyWorld(a, true);
  drawLKPWorld(true);
  // the agent
  drawOpAgent();
  // hovered highlight
  if (opHover) { ctx.strokeStyle = '#f5d300'; ctx.lineWidth = 1.5 / C.z; ctx.strokeRect(opHover.x - 10, opHover.y - 10, 20, 20); }
  // drag-and-drop drop target
  if ((owDrag && owDrag.moved > 10) || owSelect) {
    const id = owDrag ? owDrag.id : owSelect; const p = owDrag ? screenToOp(owDrag.cx, owDrag.cy) : (opHover || screenToOp(mouse.x, mouse.y));
    const targeted = TARGETED_PAYLOADS.includes(id);
    ctx.strokeStyle = 'rgba(245,211,0,0.9)'; ctx.lineWidth = 2 / C.z; ctx.setLineDash([6 / C.z, 4 / C.z]);
    ctx.beginPath(); ctx.arc(p.x, p.y, targeted ? 24 : 14, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    octText((PAYLOADS.find(x => x.id === id) || {}).name || '', p.x, p.y - (targeted ? 30 : 20), '#f5d300', 10);
  }
  ctx.restore();
  if (!splitActive) {
    if (owOffline()) drawStatic();
    // cinematic post for the console (bloom on neon, grain, vignette); scanlines via CSS
    postProcess(false);
  }
}
// TV static over the console while overwatch is offline — translucent, so the map still reads through it
function drawStatic() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 1300; i++) { const x = Math.random() * VW, y = Math.random() * VH, s = Math.random() * 2 + 1, g = (Math.random() * 170 + 50) | 0; ctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')'; ctx.fillRect(x, y, s, s); }
  ctx.globalAlpha = 0.5; for (let i = 0; i < 90; i++) { const y = Math.random() * VH; ctx.fillStyle = 'rgba(0,229,255,0.05)'; ctx.fillRect(0, y, VW, 1); }
  ctx.globalAlpha = 1;
  const by = (W.t * 240) % (VH + 80) - 40;  // magenta roll bar sweeping down
  ctx.fillStyle = 'rgba(255,42,109,0.07)'; ctx.fillRect(0, by, VW, 26);
}
function octText(s, x, y, col, size) { octx.fillStyle = col; octx.font = (size || 10) + 'px "Share Tech Mono", monospace'; octx.textAlign = 'center'; octx.fillText(s, x, y); }
function zoneTapped(z) { if (z < 0) return true; const sec = zones[z] ? zones[z].sec : 0; return W.obj.access > sec; }
function drawOpContact(g) {
  if (g.dead) return;
  const C = W.opCam; const tapped = zoneTapped(g.zone >= 0 ? g.zone : zoneAtPx(g.x, g.y));
  // the Sentinel facility always sees its own units; the operator only sees tapped/scanned zones
  const visible = soloMode === 'versus' || facRender || tapped || W.ow.scanT > 0 || W.marks.includes(g.id) || g.markT > 0 || W.obj.access >= 2;
  if (!visible) return;
  const col = g.state === 'alert' ? '#ff2a6d' : g.state === 'suspicious' ? '#f5d300' : (g.chief ? '#d6a0ff' : '#5ad0ff');
  // cone
  const far = 210, half = 0.5; const grd = octx.createRadialGradient(g.x, g.y, 4, g.x, g.y, far); grd.addColorStop(0, g.state === 'alert' ? 'rgba(255,42,109,0.16)' : 'rgba(90,208,255,0.08)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); octx.fillStyle = grd; octx.beginPath(); octx.moveTo(g.x, g.y); for (let i = -half; i <= half; i += 0.14) { const d = ray(g.x, g.y, g.face + i, far, (tx, ty) => opaqueAt(tx, ty)); octx.lineTo(g.x + Math.cos(g.face + i) * d, g.y + Math.sin(g.face + i) * d); } octx.closePath(); octx.fill();
  octx.save(); octx.translate(g.x, g.y); octx.rotate(g.face); octx.fillStyle = col; octx.beginPath(); octx.moveTo(8, 0); octx.lineTo(-5, -5); octx.lineTo(-5, 5); octx.closePath(); octx.fill(); octx.restore();
  if (g.chief) octText(U().chiefU, g.x, g.y - 12, '#d6a0ff', 8);
  if (W.marks.includes(g.id) || g.markT > 0) { octx.strokeStyle = '#ff2a6d'; octx.lineWidth = 1.5 / C.z; octx.strokeRect(g.x - 9, g.y - 9, 18, 18); }
}
function drawOpDrone(dr) {
  if (dr.dead) return; const tapped = zoneTapped(zoneAtPx(dr.x, dr.y));
  if (soloMode !== 'versus' && !facRender && !tapped && W.ow.scanT <= 0 && W.obj.access < 2) return;
  const col = dr.empT > 0 ? '#556' : dr.state === 'hunt' ? '#ff2a6d' : nHex();
  octx.save(); octx.translate(dr.x, dr.y); octx.rotate(W.t * 5); octx.strokeStyle = col; octx.lineWidth = 1.5 / W.opCam.z; for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; octx.beginPath(); octx.moveTo(0, 0); octx.lineTo(Math.cos(a) * 6, Math.sin(a) * 6); octx.stroke(); } octx.restore();
  if (dr.empT > 0) octText('EMP', dr.x, dr.y - 10, '#556', 8);
}
function drawOpAgent() {
  const C = W.opCam;
  // versus: the warden only sees the intruder through its own sensors (LKP marks the rest)
  if ((soloMode === 'versus' || facRender) && !defSeesAgent()) return;
  for (const ag of agentList()) {
    if (!ag || ag.dead) continue;
    // bodycam cone
    octx.fillStyle = 'rgba(214,194,122,0.12)'; octx.beginPath(); octx.moveTo(ag.x, ag.y);
    for (let i = -AG_CONE; i <= AG_CONE; i += 0.12) { const d = ray(ag.x, ag.y, ag.aim + i, AG_FAR, (tx, ty) => opaqueAt(tx, ty)); octx.lineTo(ag.x + Math.cos(ag.aim + i) * d, ag.y + Math.sin(ag.aim + i) * d); }
    octx.closePath(); octx.fill();
    octx.save(); octx.translate(ag.x, ag.y);
    octx.strokeStyle = '#d6c27a'; octx.lineWidth = 2 / C.z; octx.beginPath(); octx.arc(0, 0, 9, 0, TAU); octx.stroke();
    octx.fillStyle = ag.cloak ? '#8fc4d6' : '#d6c27a'; octx.rotate(ag.aim); octx.beginPath(); octx.moveTo(9, 0); octx.lineTo(0, -4); octx.lineTo(0, 4); octx.closePath(); octx.fill();
    octx.restore();
    octText((twoAgents() ? agentCallsign(ag.idx || 0) : agentCallsign(0)).toUpperCase(), ag.x, ag.y - 14, ag.downed ? '#ff2a6d' : (ag.idx ? (U().agent2Body || '#d6c27a') : (U().raBody || '#d6c27a')), 9);
    if (ag.hp < ag.maxHp) { octx.fillStyle = 'rgba(0,0,0,0.6)'; octx.fillRect(ag.x - 12, ag.y + 12, 24, 3); octx.fillStyle = ag.hp < 35 ? '#ff2a6d' : '#39ff9e'; octx.fillRect(ag.x - 12, ag.y + 12, 24 * clamp(ag.hp / (ag.maxHp || 100), 0, 1), 3); }
  }
}

// ============================================================= BODYCAM (op corner) — the agent's FOV, realistic splash
// First-person bodycam feed (raycaster) — what the agent actually sees down their sights.
const FP_FOV = 1.15, FP_NCOL = 150;
function drawBodycam() {
  const b = bctx, ag = W.ag, BW = bcv.width, BH = bcv.height, nv = ag.nv;
  b.setTransform(1, 0, 0, 1, 0, 0);
  const horizon = BH * 0.52;
  // ceiling & floor gradients
  let gC = b.createLinearGradient(0, 0, 0, horizon); gC.addColorStop(0, nv ? '#07120c' : '#070a0e'); gC.addColorStop(1, nv ? '#0b1a12' : '#0e131a'); b.fillStyle = gC; b.fillRect(0, 0, BW, horizon);
  let gF = b.createLinearGradient(0, horizon, 0, BH); gF.addColorStop(0, nv ? '#0e2016' : '#141922'); gF.addColorStop(1, nv ? '#081109' : '#090c11'); b.fillStyle = gF; b.fillRect(0, horizon, BW, BH - horizon);
  const colW = BW / FP_NCOL, projDist = (BW / 2) / Math.tan(FP_FOV / 2);
  const zbuf = new Float32Array(FP_NCOL);
  const isWallFP = (tx, ty) => { const v = tileAt(tx, ty); return v === WALL || v === RACK || v === FENCE || v === COVER || closedDoor(tx, ty); };
  for (let i = 0; i < FP_NCOL; i++) {
    const ca = ag.aim - FP_FOV / 2 + (i / FP_NCOL) * FP_FOV;
    const dx = Math.cos(ca), dy = Math.sin(ca);
    let px = ag.x / T, py = ag.y / T, mx = Math.floor(px), my = Math.floor(py);
    const ddx = dx === 0 ? 1e9 : Math.abs(1 / dx), ddy = dy === 0 ? 1e9 : Math.abs(1 / dy);
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let sdx = dx === 0 ? 1e9 : (dx < 0 ? (px - mx) : (mx + 1 - px)) * ddx;
    let sdy = dy === 0 ? 1e9 : (dy < 0 ? (py - my) : (my + 1 - py)) * ddy;
    let side = 0, dist = 0, tile = WALL, hit = false;
    for (let s = 0; s < 80; s++) {
      if (sdx < sdy) { dist = sdx; sdx += ddx; mx += sx; side = 0; } else { dist = sdy; sdy += ddy; my += sy; side = 1; }
      if (isWallFP(mx, my)) { tile = tileAt(mx, my); hit = true; break; }
      if (dist > 22) break;
    }
    if (!hit) { zbuf[i] = 1e9; continue; }
    const pdist = dist * T; zbuf[i] = pdist;
    const wallH = T * projDist / Math.max(8, pdist);
    const y0 = horizon - wallH * 0.52, y1 = horizon + wallH * 0.48;
    let base = tile === RACK ? (nv ? [24, 70, 48] : [40, 58, 72]) : tile === COVER ? (nv ? [30, 70, 34] : [78, 86, 66]) : tile === FENCE ? (nv ? [60, 120, 80] : [96, 104, 100]) : (nv ? [26, 86, 54] : [74, 88, 104]);
    const shade = clamp(1 - pdist / 460, 0.12, 1) * (side ? 0.66 : 1);
    b.fillStyle = 'rgb(' + (base[0] * shade | 0) + ',' + (base[1] * shade | 0) + ',' + (base[2] * shade | 0) + ')';
    b.fillRect(i * colW, y0, colW + 1, y1 - y0);
    if (tile === RACK) { b.fillStyle = 'rgba(' + (nv ? '90,255,170' : '0,210,255') + ',' + (0.5 * shade) + ')'; const n = Math.max(1, (wallH / 14) | 0); for (let k = 0; k < n; k++) b.fillRect(i * colW, y0 + (k + 0.5) * (y1 - y0) / n, colW + 1, 1); }
  }
  // sprites: billboards for contacts the agent can actually see down the lens (LOS only)
  const sprites = [];
  for (const g of W.guards) { if (!g.dead && agentRevealEnemy(g) && los(ag.x, ag.y, g.x, g.y)) sprites.push({ x: g.x, y: g.y, k: 'guard', g }); }
  for (const dr of W.drones) { if (!dr.dead && agentRevealEnemy(dr) && los(ag.x, ag.y, dr.x, dr.y)) sprites.push({ x: dr.x, y: dr.y, k: 'drone' }); }
  for (const bd of W.bodies) { if (hyp(ag.x, ag.y, bd.x, bd.y) < 320 && los(ag.x, ag.y, bd.x, bd.y)) sprites.push({ x: bd.x, y: bd.y, k: 'body' }); }
  for (const it of W.items) { if (!it.got && hyp(ag.x, ag.y, it.x, it.y) < 300 && los(ag.x, ag.y, it.x, it.y)) sprites.push({ x: it.x, y: it.y, k: 'item', it }); }
  // thermal optic: wash the feed cold before drawing warm bodies
  if (ag.thermal) { b.globalCompositeOperation = 'saturation'; b.fillStyle = '#808080'; b.fillRect(0, 0, BW, BH); b.globalCompositeOperation = 'color'; b.fillStyle = '#14365f'; b.fillRect(0, 0, BW, BH); b.globalCompositeOperation = 'source-over'; b.fillStyle = 'rgba(6,14,28,0.3)'; b.fillRect(0, 0, BW, BH); }
  sprites.sort((p, q) => hyp(ag.x, ag.y, q.x, q.y) - hyp(ag.x, ag.y, p.x, p.y));
  for (const sp of sprites) {
    const dx = sp.x - ag.x, dy = sp.y - ag.y, dist = Math.hypot(dx, dy); if (dist < 4) continue;
    const rel = angDiff(Math.atan2(dy, dx), ag.aim); if (Math.abs(rel) > FP_FOV / 2 + 0.25) continue;
    const sxp = BW / 2 + (rel / (FP_FOV / 2)) * (BW / 2);
    const col = clamp(Math.floor(sxp / colW), 0, FP_NCOL - 1);
    if (dist > zbuf[col] + 8) continue;                 // occluded by a wall
    if (ag.thermal && sp.k === 'guard') { const hh = T * projDist / dist, feet = horizon + hh * 0.48, head = feet - hh * 0.92; b.save(); b.globalCompositeOperation = 'lighter'; const gr = b.createRadialGradient(sxp, (feet + head) / 2, 2, sxp, (feet + head) / 2, hh * 0.5); gr.addColorStop(0, 'rgba(255,245,220,0.95)'); gr.addColorStop(0.4, 'rgba(255,120,40,0.85)'); gr.addColorStop(1, 'rgba(150,0,10,0)'); b.fillStyle = gr; b.fillRect(sxp - hh * 0.45, head, hh * 0.9, feet - head); b.restore(); continue; }
    if (ag.thermal && (sp.k === 'drone' || sp.k === 'item')) continue;   // cold / non-biological: invisible to thermal
    drawFPSprite(b, sxp, horizon, T * projDist / dist, sp, nv);
  }
  // first-person weapon + IR + muzzle flash
  drawFPWeapon(b, BW, BH, ag);
  if (nv) { b.fillStyle = 'rgba(150,255,200,0.08)'; b.fillRect(0, 0, BW, BH); }
  else { b.fillStyle = 'rgba(210,200,170,0.04)'; b.fillRect(0, 0, BW, BH); }
  // scanlines + vignette
  b.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < BH; y += 3) b.fillRect(0, y, BW, 1);
  const vg = b.createRadialGradient(BW / 2, BH / 2, BH * 0.32, BW / 2, BH / 2, BH * 0.8); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); b.fillStyle = vg; b.fillRect(0, 0, BW, BH);
}
function drawFPSprite(b, cx, horizon, h, sp, nv) {
  const w = h * 0.42, feet = horizon + h * 0.48, head = feet - h * 0.92;
  if (sp.k === 'guard') {
    const g = sp.g; const col = g.state === 'alert' ? '#e0664f' : g.state === 'suspicious' ? '#f5d300' : (g.chief ? '#d6a0ff' : '#b85b4b');
    b.fillStyle = 'rgba(0,0,0,0.35)'; b.beginPath(); b.ellipse(cx, feet, w * 0.7, h * 0.05, 0, 0, TAU); b.fill();
    b.fillStyle = col; b.beginPath(); b.moveTo(cx - w * 0.5, feet); b.lineTo(cx - w * 0.5, head + h * 0.3); b.quadraticCurveTo(cx, head + h * 0.12, cx + w * 0.5, head + h * 0.3); b.lineTo(cx + w * 0.5, feet); b.closePath(); b.fill();
    b.fillStyle = '#20242a'; b.fillRect(cx - w * 0.55, head + h * 0.34, w * 1.1, h * 0.04);       // chest rig
    b.fillStyle = col; b.beginPath(); b.arc(cx, head + h * 0.14, h * 0.13, 0, TAU); b.fill();      // head
    if (g.hitFlash > 0) { b.fillStyle = 'rgba(255,255,255,0.6)'; b.fillRect(cx - w * 0.5, head, w, feet - head); }
  } else if (sp.k === 'drone') {
    b.strokeStyle = '#00e5ff'; b.lineWidth = Math.max(1.5, h * 0.03); const r = h * 0.3, cy = horizon - h * 0.05;
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + W.t * 6; b.beginPath(); b.moveTo(cx, cy); b.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); b.stroke(); b.beginPath(); b.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, h * 0.07, 0, TAU); b.stroke(); }
    b.fillStyle = '#00e5ff'; b.beginPath(); b.arc(cx, cy, h * 0.1, 0, TAU); b.fill();
  } else if (sp.k === 'body') {
    b.fillStyle = 'rgba(46,52,48,0.85)'; b.beginPath(); b.ellipse(cx, feet, w * 0.8, h * 0.08, 0, 0, TAU); b.fill();
  } else if (sp.k === 'item') {
    const c = sp.it.kind === 'med' ? '#7ee2a8' : sp.it.kind === 'supply' ? '#00e5ff' : '#d6c27a'; const s = Math.max(4, h * 0.14);
    b.fillStyle = c; b.fillRect(cx - s / 2, feet - s, s, s); b.strokeStyle = 'rgba(255,255,255,0.4)'; b.strokeRect(cx - s / 2, feet - s, s, s);
  }
}
function drawFPWeapon(b, BW, BH, ag) {
  const firing = (W.t - ag.lastShot) < 0.045;
  // muzzle flash (toned down)
  if (firing) { b.save(); b.globalCompositeOperation = 'lighter'; b.fillStyle = 'rgba(255,225,150,0.55)'; b.beginPath(); b.arc(BW * 0.5, BH * 0.52, 7, 0, TAU); b.fill(); b.fillStyle = 'rgba(255,190,90,0.22)'; b.beginPath(); b.arc(BW * 0.5, BH * 0.52, 14, 0, TAU); b.fill(); b.restore(); }
  // IR dot where the laser lands (center-ish)
  b.fillStyle = ag.nv ? 'rgba(255,60,60,0.95)' : 'rgba(255,50,50,0.7)'; b.beginPath(); b.arc(BW * 0.5, BH * 0.5, ag.nv ? 2.5 : 2, 0, TAU); b.fill();
  // gun held low — dips down and swaps the mag during a reload
  const rl = ag.reload > 0 ? Math.sin((1 - ag.reload / 1.1) * Math.PI) : 0;
  b.save(); const gx = BW * 0.5, gy = BH + rl * 30; b.translate(0, 0);
  b.fillStyle = ag.cloak ? 'rgba(143,196,214,0.55)' : '#161b20';
  b.beginPath(); b.moveTo(gx - 10, gy); b.lineTo(gx + 20, gy); b.lineTo(gx + 16, gy - 26); b.lineTo(gx + 8, gy - 30); b.lineTo(gx + 6, gy - 54); b.lineTo(gx - 2, gy - 54); b.lineTo(gx - 2, gy - 26); b.lineTo(gx - 16, gy - 20); b.closePath(); b.fill();
  b.fillStyle = ag.cloak ? 'rgba(143,196,214,0.4)' : '#0c0f12'; b.fillRect(gx + 1, gy - 58, 4, 8); // suppressor tip
  if (ag.reload > 0) { const drop = rl * 22; b.fillStyle = '#20262c'; b.fillRect(gx - 6, gy - 20 + drop, 7, 14); }  // magazine out
  b.restore();
}

// ============================================================= agent edge markers / channel ring
function drawAgentMarkers() {
  const tgt = objectiveTarget(); if (tgt) edgeMark(tgt.x, tgt.y, '#d6c27a', 'OBJ');
  // operator waypoint: a breadcrumb trail on the ground leading there, plus a marker
  if (W.waypoint) {
    const wp = W.waypoint;
    if (wp.path && wp.path.length) {
      const pulse = (W.t * 1.6) % 1;
      for (let i = 0; i < wp.path.length; i += 2) {
        const p = wp.path[i], s = worldToScreenAgent(p.x, p.y);
        if (s.x < -20 || s.x > VW + 20 || s.y < -20 || s.y > VH + 20) continue;
        const fade = 1 - (i / wp.path.length) * 0.5; const near = Math.abs((i / Math.max(1, wp.path.length)) - pulse) < 0.12;
        ctx.fillStyle = 'rgba(245,211,0,' + (fade * (near ? 0.95 : 0.4)) + ')'; ctx.beginPath(); ctx.arc(s.x, s.y, near ? 4.5 : 3, 0, TAU); ctx.fill();
      }
    }
    const ws = worldToScreenAgent(wp.x, wp.y); const m = 40;
    if (ws.x > m && ws.x < VW - m && ws.y > m && ws.y < VH - m) {
      const pr = 0.5 + 0.5 * Math.sin(W.t * 4);
      ctx.strokeStyle = 'rgba(245,211,0,' + (0.5 + pr * 0.4) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ws.x, ws.y, 10, 0, TAU);
      ctx.moveTo(ws.x - 15, ws.y); ctx.lineTo(ws.x - 10, ws.y); ctx.moveTo(ws.x + 10, ws.y); ctx.lineTo(ws.x + 15, ws.y); ctx.moveTo(ws.x, ws.y - 15); ctx.lineTo(ws.x, ws.y - 10); ctx.moveTo(ws.x, ws.y + 10); ctx.lineTo(ws.x, ws.y + 15); ctx.stroke();
      ctx.fillStyle = '#f5d300'; ctx.font = '10px "Barlow Condensed"'; ctx.textAlign = 'center'; ctx.fillText('MOVE', ws.x, ws.y - 20);
    } else edgeMark(wp.x, wp.y, '#f5d300', 'MOVE');
  }
  // pings — expanding pulse rings on screen, edge arrows when off-screen
  for (const p of W.pings) {
    const s = worldToScreenAgent(p.x, p.y), m = 40;
    if (s.x > m && s.x < VW - m && s.y > m && s.y < VH - m) {
      const ph = ((p.max || 6) - p.t) % 0.9 / 0.9, al = (1 - ph) * clamp(p.t / 1.5, 0, 1);
      ctx.strokeStyle = 'rgba(255,42,109,' + al + ')'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y, 6 + ph * 40, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,42,109,' + clamp(p.t / 1.5, 0, 1) + ')'; ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, TAU); ctx.fill();
    } else edgeMark(p.x, p.y, '#ff2a6d', '');
  }
}
// directional threat markers around the agent — arc segments on a ring (Ghost-Recon style),
// bigger when closer or when you're spotted, white for movement, red for gunfire
function drawCues() {
  if (!W.cues || !W.cues.length) return;
  const s = worldToScreenAgent(W.ag.x, W.ag.y); const baseR = Math.min(VW, VH) * 0.13;
  ctx.lineCap = 'round';
  for (const c of W.cues) {
    const al = clamp(c.t / c.max, 0, 1), gun = c.kind === 'gun', str = c.str == null ? 0.5 : c.str;
    const R = baseR + str * 16, halfW = 0.1 + str * 0.26, lw = 2 + str * 4.5;
    ctx.strokeStyle = gun ? 'rgba(255,70,55,' + al + ')' : 'rgba(236,240,245,' + (al * 0.9) + ')';
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(s.x, s.y, R, c.dir - halfW, c.dir + halfW); ctx.stroke();
    if (gun || str > 0.8) { ctx.globalAlpha = al * 0.35; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.arc(s.x, s.y, R + 7, c.dir - halfW * 0.65, c.dir + halfW * 0.65); ctx.stroke(); ctx.globalAlpha = 1; }
  }
  ctx.lineWidth = 1;
}
function edgeMark(wx, wy, col, label) {
  const s = worldToScreenAgent(wx, wy); const m = 40;
  if (s.x > m && s.x < VW - m && s.y > m && s.y < VH - m) {
    if (label) { ctx.fillStyle = col; ctx.font = '11px "Barlow Condensed"'; ctx.textAlign = 'center'; ctx.globalAlpha = 0.8; ctx.fillText(label, s.x, s.y - 16); ctx.globalAlpha = 1; }
    return;
  }
  const a = Math.atan2(s.y - VH / 2, s.x - VW / 2);
  const ex = clamp(VW / 2 + Math.cos(a) * (VW / 2 - m), m, VW - m), ey = clamp(VH / 2 + Math.sin(a) * (VH / 2 - m), m, VH - m);
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -5); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill(); ctx.restore();
}
function drawChannelRing() {
  const s = worldToScreenAgent(W.ag.x, W.ag.y); const st = pickState || channelState; const p = st.t / st.dur;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(s.x, s.y - 26 * AGS, 14, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#d6c27a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y - 26 * AGS, 14, -Math.PI / 2, -Math.PI / 2 + p * TAU); ctx.stroke();
  ctx.fillStyle = '#d6c27a'; ctx.font = '10px "Barlow Condensed"'; ctx.textAlign = 'center'; ctx.fillText(pickState ? 'PICKING' : 'WORKING', s.x, s.y - 44 * AGS);
}

// ============================================================= HUD
function fmtT(s) { const m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + (Math.floor(s % 60) < 10 ? '0' : '') + Math.floor(s % 60); }
let hudCache = {};
function setTx(el, v) { if (hudCache[el] !== v) { hudCache[el] = v; const e = $(el); if (e) e.textContent = v; } }
function renderObjective() {
  const o = OBJ[W.obj.step] || OBJ[0];
  setTx('aStep', 'Objective ' + (W.obj.step + 1) + ' / 8'); setTx('aObj', nwText(o.t)); setTx('aObjSub', nwText(o.s));
  const no = $('nObj'); if (no) no.innerHTML = '<b>OBJ ' + (W.obj.step + 1) + '/8</b>' + esc(nwText(o.t));
}
function updateHud() {
  if (view === 'agent') updateAgentHud(); else updateOpHud();
  const pb = $('pauseBtn'); if (pb) { const show = game === 'play'; if (pb.hidden === show) pb.hidden = !show; }
}
function updateAgentHud() {
  const ag = W.ag;
  setTx('aHpT', Math.max(0, Math.round(ag.hp))); $('aHp').firstElementChild.style.width = clamp(ag.hp / (ag.maxHp || 100) * 100, 0, 100) + '%'; $('aHp').classList.toggle('low', ag.hp < 35);
  setTx('aCkT', Math.round(ag.bat) + '%'); $('aCk').firstElementChild.style.width = clamp(ag.bat, 0, 100) + '%';
  setTx('aAmmo', ''); $('aAmmo').innerHTML = ag.mag + '<small> / ' + ag.res + '</small>'; $('aAmmo').parentElement.firstElementChild;
  $('cNv').classList.toggle('on', ag.nv); $('cTh').classList.toggle('on', ag.thermal); $('cCk').classList.toggle('on', ag.cloak); $('cKey').classList.toggle('on', ag.keycard); $('cDrive').classList.toggle('on', ag.drive);
  updateAbilityBtn();
  const link = $('aLink'); const online = humanDrivesOp() ? false : true; const coopLink = net.mode !== 'solo' ? !!net.partner : true;
  const on = (net.mode === 'solo') ? (soloMode !== 'practice') : coopLink;
  link.classList.toggle('on', on); link.firstChild.nextSibling ? 0 : 0;
  link.innerHTML = '<i></i>' + nwText(soloMode === 'practice' ? 'Range' : on ? 'Overwatch linked' : 'Overwatch offline');
  // banner for alarm/lockdown
  const ban = $('aBanner');
  if (W.obj.lockdown) { ban.hidden = false; ban.className = 'a-banner'; ban.textContent = 'LOCKDOWN — EXFIL'; }
  else if (W.obj.alarm >= 1) { ban.hidden = false; ban.className = 'a-banner'; ban.textContent = 'ALARM'; }
  else if (W.obj.alarm > 0.3) { ban.hidden = false; ban.className = 'a-banner warn'; ban.textContent = 'SPOTTED — BREAK LINE OF SIGHT'; }
  else if (nvBrightNow) { ban.hidden = false; ban.className = 'a-banner warn'; ban.textContent = 'NV WASHED OUT — CUT THE LIGHTS'; }
  else ban.hidden = true;
  // prompt for interaction
  updatePrompt();
}
let meleeLabel = 'USE', agDoorHint = null;
function updatePrompt() {
  const ag = W.ag, o = W.obj, pr = $('aPrompt'); let txt = null, sub = '';
  const mt = meleeTarget();
  meleeLabel = mt ? (mt.behind ? 'STEALTH KILL' : ((mt.g.meleeHits || 0) >= 1 && W.t < mt.g.meleeExpire ? 'FINISH' : 'TAKEDOWN')) : 'USE';
  if (pickState) { pr.hidden = true; return; }
  // doors the agent can act on (mechanical lock is the agent's domain; electronic needs overwatch)
  let openMech = null, closedMech = null, closedElec = null;
  for (const d of W.doors) { if (d === W.vaultDoorRef || hyp(ag.x, ag.y, d.x, d.y) >= 32) continue; if (d.open) { if (d.type === 'mech' || d.type === 'both') openMech = d; } else if (!d.sealed) { if (d.type === 'mech' || d.type === 'both') closedMech = d; else if (d.type === 'elec') closedElec = d; } }
  agDoorHint = closedElec ? 'ask' : null;
  if (openMech) txt = '<kbd>E</kbd> Close door';
  else if (closedMech) txt = '<kbd>E</kbd> Pick the lock';
  else if (closedElec) { txt = '<kbd>E</kbd> Request door open'; sub = 'Electronic lock — overwatch hacks it'; }
  else if (o.step === 1 && hyp(ag.x, ag.y, objSpots.util.tx * T + T / 2, objSpots.util.ty * T + T / 2) < 26) txt = '<kbd>E</kbd> Plant relay';
  else if (o.step === 3 && hyp(ag.x, ag.y, objSpots.net.tx * T + T / 2, objSpots.net.ty * T + T / 2) < 26) txt = '<kbd>E</kbd> Plant relay';
  else if (o.step === 4 && W.vaultDoorRef && hyp(ag.x, ag.y, W.vaultDoorRef.x, W.vaultDoorRef.y) < 34) { if (!ag.keycard) { txt = 'Need the keycard'; } else if (!o.vaultCracked) { txt = 'Overwatch: crack the lock'; sub = 'Hold here'; } else txt = '<kbd>E</kbd> Enter the vault'; }
  else if (o.step === 6 && hyp(ag.x, ag.y, objSpots.uplink.tx * T + T / 2, objSpots.uplink.ty * T + T / 2) < 30) txt = '<kbd>E</kbd> Take the drive';
  else if (o.step === 5 && hyp(ag.x, ag.y, objSpots.uplink.tx * T + T / 2, objSpots.uplink.ty * T + T / 2) < 34) { txt = 'Hold — copying ' + Math.round(o.upload * 100) + '%'; }
  if (txt) { pr.hidden = false; let t2 = isTouch() ? txt.replace(/<kbd>E<\/kbd>\s*/, '<span class="usekey">USE</span> ') : txt; pr.innerHTML = t2 + (sub ? '<span class="sub">' + sub + '</span>' : ''); } else pr.hidden = true;
  // USE button: only doors / lockpicking / objectives — never melee
  const tA = $('tAct'); if (tA) { tA.textContent = closedElec ? 'ASK' : openMech ? 'CLOSE' : closedMech ? 'PICK' : 'USE'; tA.classList.remove('kill', 'stealth'); tA.classList.toggle('ready', !!txt); }
  // FIRE button: becomes the melee / takedown button when an enemy is adjacent
  const tF = $('tFire'); if (tF) { tF.textContent = mt ? (mt.behind ? 'STEALTH' : (meleeLabel === 'FINISH' ? 'FINISH' : 'MELEE')) : 'FIRE'; tF.classList.toggle('kill', !!mt); tF.classList.toggle('stealth', !!(mt && mt.behind)); tF.classList.toggle('amber', !mt); }
}
function updateOpHud() {
  setTx('nTime', fmtT(W.stats.time));
  setTx('nBwT', Math.round(W.ow.bw)); $('nBw').firstElementChild.style.width = W.ow.bw + '%';
  const al = $('nAlarm');
  if (W.ag.downed) { al.className = 'n-stat alarm'; al.innerHTML = '⚠ <b>AGENT DOWN ' + Math.ceil(W.ag.downT) + 's — MEDEVAC (9)</b>'; }
  else { const s = W.obj.lockdown ? 'LOCKDOWN' : W.obj.alarm >= 1 ? 'ALARM' : W.obj.alarm > 0.3 ? 'ALERT' : 'QUIET'; al.className = 'n-stat' + (W.obj.alarm > 0.3 ? ' alarm' : ''); al.innerHTML = 'SEC <b>' + s + '</b>'; }
  setTx('nNet', SECTORS[W.obj.access - 1] ? SECTORS[W.obj.access - 1].name : 'PERIMETER');
  const link = $('nLink'); link.textContent = (net.mode !== 'solo' ? (net.partner ? 'AGENT LINKED' : 'AGENT OFFLINE') : (soloMode === 'op' ? 'AI AGENT' : 'AGENT LINKED'));
  // cyber-warfare intrusion / offline HUD
  // versus: swap the operator console for the facility AI console
  const versus = soloMode === 'versus';
  const nc = $('nCmd'), dc = $('dCmd'), fp = $('facPanel');
  if (nc && nc.hidden !== versus) nc.hidden = versus;
  if (dc && dc.hidden === versus) dc.hidden = !versus;
  if (fp && fp.hidden === versus) fp.hidden = !versus;
  if (!versus) { const brand = document.querySelector('.n-brand'); if (brand && brand.dataset.v === '1') { brand.dataset.v = '0'; brand.innerHTML = 'CYBER&nbsp;OPS<em>//</em>CS-7'; } const hint = $('nHint'); if (hint && hint.dataset.v === '1') { hint.dataset.v = '0'; hint.innerHTML = '<b>CLICK</b> device: hack · <b>CLICK</b> contact: tag · <b>RIGHT-CLICK</b>: waypoint · <b>1-8</b> payloads · <b>wheel</b> zoom'; } }
  if (versus) {
    const def = W.def, o = W.obj;
    const brand = document.querySelector('.n-brand'); if (brand && brand.dataset.v !== '1') { brand.dataset.v = '1'; brand.innerHTML = 'SENTINEL<em>//</em>FACILITY AI'; }
    const hint = $('nHint'); if (hint && hint.dataset.v !== '1') { hint.dataset.v = '1'; hint.innerHTML = '<b>TAP</b> a guard/drone, then <b>TAP</b> the map to send it · <b>TAP</b> a camera: sweep · <b>RALLY/LOCKDOWN/HACK/SCAN</b> below'; }
    // intruder tracker
    const tracking = defSeesAgent(), lastSeen = !tracking && W.lkp && W.lkp.shown;
    const tt = $('fTrackT'); if (tt) { tt.textContent = W.ag.downed ? 'NEUTRALIZED' : tracking ? 'TRACKING' : lastSeen ? 'LAST SEEN' : 'GHOST'; tt.style.color = tracking ? '#ff3b6b' : lastSeen ? '#ffb13b' : '#b9617a'; }
    setTx('fProgT', o.step + ' / 8'); const pb = $('fProgBar'); if (pb) pb.style.width = clamp(o.step / 8 * 100, 0, 100) + '%';
    setTx('fPowT', Math.round(def.power)); const pw = $('fPowBar'); if (pw) pw.style.width = clamp(def.power, 0, 100) + '%';
    // roster
    const gA = W.guards.filter(g => !g.dead).length, dA = W.drones.filter(d => !d.dead).length, cA = W.cams.filter(c => !c.dead && !c.hacked).length;
    setTx('fUnitsT', (gA + dA) + ' ACTIVE');
    const ros = $('fRoster'); if (ros) { const row = (lbl, a, t) => '<div><span>' + lbl + '</span><span class="' + (a ? 'v' : 'lost') + '">' + a + ' / ' + t + '</span></div>'; const h = row('Guards', gA, W.guards.length) + row('Drones', dA, W.drones.length) + row('Cameras', cA, W.cams.length); if (ros.innerHTML !== h) ros.innerHTML = h; }
    // selected unit
    const sb = $('fSelBox'); if (sb) { const show = !!(def.sel && !def.sel.dead); if (sb.hidden === show) sb.hidden = !show; if (show) setTx('fSelT', (isDrone(def.sel) ? 'DRONE' : 'GUARD') + ((def.sel.defGo || def.sel.target) ? ' · EN ROUTE' : ' · HOLDING')); }
    setTx('dPowT', Math.round(def.power));
    [['dRally', 'rally'], ['dLock', 'lock'], ['dHack', 'hack'], ['dScan', 'scan']].forEach(([id, k]) => { const b = $(id); if (b) { const cd = def.cd[k] || 0; b.disabled = cd > 0 || def.power < (DEF_COST[k] || 0); b.style.opacity = cd > 0 ? '.5' : '1'; } });
  }
  const intr = $('nIntr'), off = $('nOffline'), ow = W.ow;
  const showIntr = !!ow.hack && !ow.offline;
  if (intr.hidden === showIntr) intr.hidden = !showIntr;
  if (showIntr) $('nIntrBar').style.width = clamp(ow.hack.prog * 100, 0, 100) + '%';
  const showOff = ow.offline > 0;
  if (off.hidden === showOff) off.hidden = !showOff;
  if (showOff) setTx('nOfflineT', 'rebooting ' + Math.ceil(ow.offline) + 's');
  // sectors list
  const sc = $('sect'); let h = '';
  SECTORS.forEach((s, i) => { const on = W.obj.access > i; h += '<div><span>' + s.name + '</span><span class="' + (on ? 'on' : 'lk') + '">' + (on ? 'TAPPED' : 'LOCKED') + '</span></div>'; });
  if (sc.innerHTML !== h) sc.innerHTML = h;
  // upload box
  const ub = $('upBox'); if (W.obj.step === 5 || W.obj.step === 6) { ub.hidden = false; setTx('upT', Math.round(W.obj.upload * 100) + '%'); $('upBar').firstElementChild.style.width = (W.obj.upload * 100) + '%'; setTx('trT', Math.round(W.obj.sweep * 100) + '%'); $('trBar').firstElementChild.style.width = (W.obj.sweep * 100) + '%'; } else ub.hidden = true;
  renderAbilities();
}
let abilSig = '';
function renderAbilities() {
  const el = $('abil'); if (!el) return;
  const sig = PAYLOADS.map(p => owReady(p.id) + '' + (owSelect === p.id) + Math.ceil(W.ow.cooldowns[p.id] || 0)).join('|') + W.ow.drops;
  if (sig === abilSig && el.childElementCount) return; abilSig = sig;
  el.innerHTML = PAYLOADS.map(p => {
    const ready = owReady(p.id); const cd = W.ow.cooldowns[p.id] || 0; const sel = owSelect === p.id;
    return '<button class="ab' + (ready ? '' : ' off') + (sel ? ' sel' : '') + '" data-p="' + p.id + '" title="' + esc(p.desc) + '"><kbd>' + p.key + '</kbd><span>' + p.name + '</span><span class="c">' + (p.id === 'supply' ? 'x' + W.ow.drops : p.cost) + '</span>' + (cd > 0 ? '<span class="cd" style="width:' + (cd / p.cd * 100) + '%"></span>' : '') + '</button>';
  }).join('');
  el.querySelectorAll('.ab').forEach(b => b.addEventListener('pointerdown', ev => { if (b.classList.contains('off')) return; ev.preventDefault(); initAudio(); owDragStart(b.dataset.p, ev.clientX, ev.clientY); }));
}
let commsSig = '';
function renderComms() {
  const el = $('comms'); if (!el) return;
  const last = W.comms.slice(-9);
  const sig = last.map(c => c.text).join('|'); if (sig === commsSig) return; commsSig = sig;
  el.innerHTML = last.map(c => '<div class="' + c.kind + '">' + (c.kind === 'req' ? '▲ ' : c.kind === 'me' ? '› ' : c.kind === 'ag' ? '◆ ' : '· ') + esc(nwText(c.text)) + '</div>').join('');
}
function renderAgentMsgs() {
  const el = $('aMsgs'); if (!el) return;
  const html = () => agentMsgs.slice(-2).map(m => '<div class="a-msg' + (m.tag === 'YOU' ? ' me' : '') + '"><em>' + esc(nwText(m.tag)) + '</em>' + esc(nwText(m.text)) + '</div>').join('');
  el.innerHTML = html();
  setTimeout(() => { agentMsgs = agentMsgs.filter(m => now() - m.t < 6000); if (el) el.innerHTML = html(); }, 6100);
}
let aToastT = 0;
function aToastShow(txt, cls) { const t = $('aToast'); t.textContent = nwText(txt); t.className = 'a-toast show'; clearTimeout(aToastShow._t); aToastShow._t = setTimeout(() => t.className = 'a-toast', 1600); }
function nToastShow(txt) { const t = $('nToast'); t.textContent = nwText(txt); t.className = 'n-toast show'; clearTimeout(nToastShow._t); nToastShow._t = setTimeout(() => t.className = 'n-toast', 1500); }

// ============================================================= view switching
function setView(v) {
  view = v;
  document.body.classList.toggle('view-agent', v === 'agent');
  document.body.classList.toggle('view-op', v === 'op');
  document.body.classList.toggle('versus', soloMode === 'versus');
  $('ahud').hidden = v !== 'agent';
  $('nhud').hidden = v !== 'op';
  if ($('swap')) { $('swap').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); }
  hudCache = {}; abilSig = ''; commsSig = ''; renderObjective();
}

// ============================================================= main loop
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
  if (net.mode === 'guest') { if (W && game === 'play') guestFrame(dt); else net.tick(dt); } // guest renders host snapshots; ticks in lobby to catch deploy
  else if (game === 'play') update(dt);
  else if (W && (game === 'over' || game === 'paused')) net.tick(dt);
  if (W) { if (splitScreen()) renderSplit(); else if (view === 'agent') drawAgent(); else { drawOp(); drawBodycam(); } updateHud(); }
  requestAnimationFrame(frame);
}
// ---- split-screen: TOP/BOTTOM halves so players sit across the device (chessboard) ----
// P1 = bottom half (upright, near the player at the bottom edge); P2 = top half (flipped 180°).
function renderSplit() {
  splitActive = true;
  const hh = Math.floor(VH / 2);
  drawHalf(0, 0, hh, VW, VH - hh, 0);     // bottom, upright
  drawHalf(1, 0, 0, VW, hh, Math.PI);     // top, flipped — faces the opposite player
  splitActive = false;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // centre divider (horizontal)
  ctx.fillStyle = 'rgba(0,255,224,0.55)'; ctx.fillRect(0, hh - 1, VW, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, hh - 4, VW, 3); ctx.fillRect(0, hh + 1, VW, 3);
  drawSplitHudFor(0, 0, hh, VW, VH - hh, false);
  drawSplitHudFor(1, 0, 0, VW, hh, true);
}
// render one split half according to its current view (agent / op console / facility console)
function drawHalf(i, ox, oy, w, h, rot) {
  if (halfView[i] === 'agent') {
    const a = halfAgent(i);
    if (a) drawAgentView(a, ox, oy, w, h, halfCam(a), a === W.ag2 ? visPtsB : visPts, rot);
  } else {
    facRender = (halfKind(i) === 'facility'); curHalf = i;
    drawOpView(ox, oy, w, h, i === 0 ? W.opCam : W.opCam2, rot);
    facRender = false; curHalf = -1;
  }
}
// per-half HUD: agent status bar + USE/CAMO buttons for agent halves, op/facility control strip for console halves
function drawSplitHudFor(i, ox, oy, w, h, flip) {
  const tag = i === 0 ? 'P1' : 'P2';
  if (halfView[i] === 'agent') { const a = halfAgent(i); if (a) { drawSplitHud(a, ox, oy, w, h, tag, flip); drawAgentButtons(i, ox, oy, w, h, flip); } drawSwapChip(i, ox, oy, w, h, flip); }
  else drawOpStrip(i, ox, oy, w, h, flip, tag);
}
function drawAgentView(ag, ox, oy, w, h, cam, vis, rot) {
  const svVW = VW, svVH = VH, svCam = W.cam, svVIS = VIS, svVX = VX0, svVY = VY0, svRAG = RAG, svROT = VROT;
  ctx.save();
  VW = w; VH = h; W.cam = cam; VIS = vis; VX0 = ox; VY0 = oy; RAG = ag; VROT = rot || 0;
  vbSet(); ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
  drawAgent();
  ctx.restore();
  VW = svVW; VH = svVH; W.cam = svCam; VIS = svVIS; VX0 = svVX; VY0 = svVY; RAG = svRAG; VROT = svROT;
}
// render the overwatch console into one split-screen half (its own op camera + optional 180° flip)
function drawOpView(ox, oy, w, h, cam, rot) {
  const svVW = VW, svVH = VH, svCam = W.opCam, svVX = VX0, svVY = VY0, svROT = VROT;
  ctx.save();
  VW = w; VH = h; W.opCam = cam; VX0 = ox; VY0 = oy; VROT = rot || 0;
  vbSet(); ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();
  drawOp();
  ctx.restore();
  VW = svVW; VH = svVH; W.opCam = svCam; VX0 = svVX; VY0 = svVY; VROT = svROT;
}
// set the drawing transform to a half's local space (0..w, 0..h); flipped 180° for the opposite player
function halfXform(ox, oy, w, h, flip) {
  if (flip) { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.translate(ox + w / 2, oy + h / 2); ctx.rotate(Math.PI); ctx.translate(-w / 2, -h / 2); }
  else { ctx.setTransform(DPR, 0, 0, DPR, ox * DPR, oy * DPR); }
}
function drawSplitHud(ag, ox, oy, w, h, tag, flip) {
  ctx.save();
  halfXform(ox, oy, w, h, flip);
  const pad = 12, bx = pad, by = h - 34, rw = w;
  ctx.fillStyle = '#00ffe0'; ctx.font = '700 12px var(--n-font, monospace)'; ctx.textAlign = 'left'; ctx.fillText(tag, bx, by - 10);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by, 120, 7);
  ctx.fillStyle = ag.downed ? '#ff2a6d' : ag.hp < 35 ? '#ff7a2a' : '#39ff9e'; ctx.fillRect(bx, by, 120 * clamp(ag.hp / (ag.maxHp || 100), 0, 1), 7);
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(bx, by + 10, 120, 4);
  ctx.fillStyle = '#8fc4d6'; ctx.fillRect(bx, by + 10, 120 * clamp(ag.bat / 100, 0, 1), 4);
  ctx.fillStyle = '#d6c27a'; ctx.font = '700 15px var(--n-font, monospace)'; ctx.textAlign = 'left';
  ctx.fillText(ag.mag + ' / ' + ag.res, bx + 140, by + 10);
  if (ag.downed) { ctx.fillStyle = '#ff2a6d'; ctx.font = '700 11px var(--n-font, monospace)'; ctx.textAlign = 'center'; ctx.fillText('DOWNED — NEED MEDIC', rw / 2, h - 12); }
  ctx.restore();
}
// agent USE + CAMO buttons, centred at the player's near edge, for a split agent half
function agentHalfButtons(half) {
  const { w, h } = halfRect(half);
  const bw = 78, bh = 34, gap = 10, y = h - bh - 46, x0 = w / 2 - bw - gap / 2;
  return [{ id: 'use', x: x0, y, w: bw, h: bh }, { id: 'camo', x: x0 + bw + gap, y, w: bw, h: bh }];
}
function agentBtnHit(half, sx, sy) { const { lx, ly } = opStripLocal(half, sx, sy); for (const b of agentHalfButtons(half)) if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return b; return null; }
function drawAgentButtons(i, ox, oy, w, h, flip) {
  const a = halfAgent(i); if (!a) return;
  ctx.save(); halfXform(ox, oy, w, h, flip);
  for (const b of agentHalfButtons(i)) {
    const on = b.id === 'camo' && a.cloak;
    ctx.fillStyle = on ? 'rgba(0,229,255,0.85)' : 'rgba(6,16,24,0.82)'; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = on ? '#04060b' : '#00ffe0'; ctx.lineWidth = 1.5; ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.fillStyle = on ? '#04060b' : '#00ffe0'; ctx.textAlign = 'center'; ctx.font = '700 13px var(--n-font, monospace)';
    ctx.fillText(b.id === 'use' ? 'USE' : (a.cloak ? 'CAMO ON' : 'CAMO'), b.x + b.w / 2, b.y + b.h / 2 + 5);
  }
  ctx.restore();
}
// ---- split-screen op/facility console: compact canvas control strip + tap input ----
// TOP/BOTTOM halves: P1 (half 0) = bottom, P2 (half 1) = top. Each is full-width, half-height.
function halfRect(half) { const hh = Math.floor(VH / 2); return half === 0 ? { ox: 0, oy: hh, w: VW, h: VH - hh } : { ox: 0, oy: 0, w: VW, h: hh }; }
const OP_STRIP_LABEL = { scan: 'SCAN', supply: 'SUPPLY', medevac: 'MEDIC', lights: 'LIGHTS', emp: 'EMP', decoy: 'DECOY', cdrone: 'DRONE', rally: 'RALLY', lock: 'LOCK', hack: 'ICE', facscan: 'SWEEP', swap: 'SWAP' };
const OP_STRIP_ICON = { scan: '◎', supply: '▽', medevac: '✚', lights: '☾', emp: '✺', decoy: '⦿', cdrone: '✈', rally: '⚑', lock: '⊠', hack: '☠', facscan: '◉', swap: '⇄' };
// buttons for a console half, laid out along the player's bottom edge in half-local coords
function opStripButtons(half) {
  const fac = halfKind(half) === 'facility';
  const ids = fac ? ['rally', 'lock', 'hack', 'facscan'] : ['scan', 'supply', 'medevac', 'lights', 'emp', 'decoy', 'cdrone'];
  if (halfCanToggle(half)) ids.push('swap');
  const { w, h } = halfRect(half); const n = ids.length, pad = 7;
  const bw = Math.min(96, (w - pad * (n + 1)) / n), bh = 42, y = h - bh - 10;
  const total = n * bw + (n - 1) * pad, x0 = (w - total) / 2;
  return ids.map((id, i) => ({ id, x: x0 + i * (bw + pad), y, w: bw, h: bh }));
}
// map a screen point to a console half's local coords (handles P2's 180° flip). Top/bottom layout.
function opStripLocal(half, sx, sy) { const { ox, oy, w, h } = halfRect(half); return half === 1 ? { lx: ox + w - sx, ly: oy + h - sy } : { lx: sx - ox, ly: sy - oy }; }
// a toggle half shows a small SWAP chip even while in agent view, so the player can jump to the console
function swapChipRect(half) { const { w } = halfRect(half); return { x: w - 74, y: 10, w: 64, h: 26 }; }
function swapChipHit(half, sx, sy) { if (!halfCanToggle(half)) return false; const r = swapChipRect(half); const { lx, ly } = opStripLocal(half, sx, sy); return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h; }
function drawSwapChip(i, ox, oy, w, h, flip) {
  if (!halfCanToggle(i) || halfView[i] !== 'agent') return;   // op view draws SWAP in its strip instead
  ctx.save();
  halfXform(ox, oy, w, h, flip);
  const r = swapChipRect(i);
  ctx.fillStyle = 'rgba(6,16,24,0.82)'; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'center'; ctx.font = '700 11px var(--n-font, monospace)';
  ctx.fillText('⇄ CONSOLE', r.x + r.w / 2, r.y + 17);
  ctx.restore();
}
function opStripHit(half, sx, sy) { const { lx, ly } = opStripLocal(half, sx, sy); for (const b of opStripButtons(half)) if (lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h) return b; return null; }
// map a screen point to world coords for a console half (its own op camera + flip)
function opHalfScreenToWorld(half, sx, sy) { const { w, h } = halfRect(half); const { lx, ly } = opStripLocal(half, sx, sy); const cam = half === 0 ? W.opCam : W.opCam2; return { x: (lx - w / 2) / cam.z + cam.x, y: (ly - h / 2) / cam.z + cam.y }; }
function opStripReady(half, id) {
  if (id === 'swap') return true;
  if (halfKind(half) === 'facility') { if (id === 'facscan') return W.def.power >= 8; return W.def.power >= (DEF_COST[id] || 0) && (W.def.cd[id] || 0) <= 0; }
  return owReady(id) && !owOffline();
}
function opStripAction(half, btn) {
  const id = btn.id;
  if (id === 'swap') { halfView[half] = halfView[half] === 'agent' ? 'op' : 'agent'; nToastShow(halfView[half] === 'op' ? 'CONSOLE' : 'FIELD AGENT'); return; }
  if (!opStripReady(half, id)) { nToastShow('NOT READY'); return; }
  if (halfKind(half) === 'facility') {
    if (id === 'facscan') { W.def.power -= 8; W.def.reveal = Math.max(W.def.reveal, 2.4); nToastShow('CAMERA SWEEP'); }
    else defAction(id);
    return;
  }
  // overwatch: instant abilities fire now; targeted ones arm owSelect for a map tap
  if (['scan', 'jam', 'spoof'].includes(id)) owFire(id, null);
  else { owSelect = (owSelect === id) ? null : id; nToastShow(owSelect ? 'TAP THE MAP TO PLACE ' + (OP_STRIP_LABEL[id] || id) : 'CANCELLED'); }
}
function drawOpStrip(i, ox, oy, w, h, flip, tag) {
  const fac = halfKind(i) === 'facility';
  ctx.save();
  halfXform(ox, oy, w, h, flip);
  const accent = fac ? '#ff2a6d' : nHex();
  // top banner: tag + resource
  ctx.textAlign = 'left'; ctx.fillStyle = accent; ctx.font = '700 12px var(--n-font, monospace)';
  ctx.fillText(tag + (fac ? ' · SENTINEL' : halfView[i] === 'op' ? ' · ' + U().op.toUpperCase() : ''), 12, 20);
  if (fac) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(12, 26, 120, 6); ctx.fillStyle = accent; ctx.fillRect(12, 26, 120 * clamp(W.def.power / 100, 0, 1), 6); ctx.fillStyle = accent; ctx.font = '700 10px var(--n-font, monospace)'; ctx.fillText('PWR ' + Math.round(W.def.power), 138, 33); }
  else { const o = W.ow; ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(12, 26, 120, 6); ctx.fillStyle = owOffline() ? '#ff2a6d' : accent; ctx.fillRect(12, 26, 120 * clamp(o.bw / 100, 0, 1), 6); ctx.fillStyle = accent; ctx.font = '700 10px var(--n-font, monospace)'; ctx.fillText(owOffline() ? 'OFFLINE' : 'BW ' + Math.round(o.bw), 138, 33); }
  // buttons
  for (const b of opStripButtons(i)) {
    const ready = opStripReady(i, b.id), armed = !fac && owSelect === b.id;
    ctx.fillStyle = armed ? accent : 'rgba(6,16,24,0.85)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = b.id === 'swap' ? '#ffd23f' : ready ? accent : 'rgba(120,140,150,0.4)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.textAlign = 'center'; ctx.fillStyle = armed ? '#04060b' : ready ? accent : 'rgba(150,165,175,0.6)';
    ctx.font = '16px "Share Tech Mono", monospace'; ctx.fillText(OP_STRIP_ICON[b.id] || '•', b.x + b.w / 2, b.y + 19);
    ctx.font = '700 9px var(--n-font, monospace)'; ctx.fillText(OP_STRIP_LABEL[b.id] || b.id, b.x + b.w / 2, b.y + 34);
  }
  ctx.restore();
}
// op/facility gesture tracking per touch id (tap = action/target, drag = pan the console)
const opGest = {};
function splitOpDown(half, t) {
  const btn = opStripHit(half, t.clientX, t.clientY);
  if (btn) { opStripAction(half, btn); opGest[t.identifier] = { half, btn: true }; return; }
  const cam = half === 0 ? W.opCam : W.opCam2;
  opGest[t.identifier] = { half, x0: t.clientX, y0: t.clientY, moved: 0, startC: { x: cam.x, y: cam.y }, t0: now() };
}
function splitOpMoveT(t) {
  const g = opGest[t.identifier]; if (!g || g.btn) return;
  const dx = t.clientX - g.x0, dy = t.clientY - g.y0; g.moved = Math.hypot(dx, dy);
  if (g.moved > 10) { const cam = g.half === 0 ? W.opCam : W.opCam2; const sgn = g.half === 1 ? -1 : 1; cam.x = g.startC.x - sgn * dx / cam.z; cam.y = g.startC.y - sgn * dy / cam.z; }
}
function splitOpEndT(t) {
  const g = opGest[t.identifier]; if (!g) return; delete opGest[t.identifier];
  if (g.btn) return;
  if (g.moved < 12 && now() - g.t0 < 450) { const w = opHalfScreenToWorld(g.half, t.clientX, t.clientY); if (halfKind(g.half) === 'facility') defClickWorld(w.x, w.y, 0); else owClickWorld(w.x, w.y, 0); }
}
// the overwatch guest: only decay local-only fx, pull snapshots, and let the op issue actions
function guestFrame(dt) {
  W.t += dt;
  W.tracers = W.tracers.filter(t => (t.t -= dt) > 0);
  W.emps = W.emps.filter(e => (e.t -= dt) > 0);
  W.decoys = W.decoys.filter(d => (d.t -= dt) > 0);
  W.pings = W.pings.filter(p => (p.t -= dt) > 0);
  W.reqPins = W.reqPins.filter(p => (p.t -= dt) > 0);
  if (W.waypoint) { W.waypoint.t -= dt; if (W.waypoint.t <= 0) W.waypoint = null; }
  for (const k in W.ow.cooldowns) if (W.ow.cooldowns[k] > 0) W.ow.cooldowns[k] -= dt;
  net.tick(dt);
}

// ============================================================= networking (room capability)
// Host = agent client (authoritative sim). Guest = op client (renders snapshot, sends actions).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const net = {
  mode: 'solo', role: 'agent', transport: 'claude', avail: 'connecting', lobby: null, squad: null, code: null, partner: null, pp: null, _peer: null,
  sid: Math.random().toString(36).slice(2, 10), seq: 0, ring: [], lastIn: -1, lastSid: null, sendAt: 0, lobbyPeers: [],
  out(kind, ...vals) { if (this.mode === 'solo' || !this.partner || game === 'menu') return; this.seq++; this.ring.push({ at: now(), e: [this.seq, kind, ...vals] }); },
  tick(dt) { if (!this.squad) return; const t = now(); if (t - this.sendAt < 66) return; this.sendAt = t; this.squad.presence(this.snapshot()).catch(() => {}); this.recv(); },
  snapshot() {
    const nowt = now(); this.ring = this.ring.filter(o => nowt - o.at < 1500).slice(-30);
    const ev = this.ring.map(o => o.e);
    if (this.mode === 'host') {
      if (!W || game === 'menu') return { role: 'host', pr: this.chosenRole, sid: this.sid, seed: game === 'play' ? mapSeed : 0, ph: game, ev };
      const o = W.obj;
      return { role: 'host', pr: this.chosenRole, sid: this.sid, seed: mapSeed, ph: game, ev,
        ag: [RR(W.ag.x), RR(W.ag.y), RR(W.ag.aim * 100), RR(W.ag.hp), W.ag.cloak ? 1 : 0, W.ag.nv ? 1 : 0, W.ag.dead ? 1 : 0, W.ag.keycard ? 1 : 0, W.ag.drive ? 1 : 0, RR(W.ag.bat), W.ag.mag, W.ag.res, W.ag.thermal ? 1 : 0, W.ag.downed ? 1 : 0, RR(W.ag.downT || 0)],
        ob: [o.step, o.access, RR(o.upload * 100), RR(o.sweep * 100), RR(o.alarm * 100), o.lockdown ? 1 : 0, o.vaultCracked ? 1 : 0, RR(o.cracking * 100)],
        g: W.guards.map(g => [RR(g.x), RR(g.y), RR(g.face * 100), g.dead ? 3 : g.state === 'alert' ? 2 : g.state === 'suspicious' ? 1 : 0, g.chief ? 1 : 0, RR(g.aw * 100), g.markT > 0 ? 1 : 0]),
        d: W.drones.map(dr => [RR(dr.x), RR(dr.y), dr.dead ? 1 : 0, dr.state === 'hunt' ? 1 : 0, dr.empT > 0 ? 1 : 0]),
        c: W.cams.map(c => [RR(c.face * 100), c.hacked ? 1 : 0, c.dead ? 1 : 0, RR(c.spotted * 100)]),
        dr: W.doors.map(d => (d.open ? 1 : 0) + (d.sealed ? 2 : 0) + (d.hacked ? 4 : 0)).join(''),
        bw: RR(W.ow.bw), dp: W.ow.drops, cd: W.ow.cdrones, it: W.items.map(i => i.got ? '1' : '0').join(''),
        al: W.allies.map(a => [RR(a.x), RR(a.y), RR(a.face * 100), RR(a.deployT * 100), RR(a.battery * 10)]), sa: W.allies.indexOf(W.ow.selAlly),
        lkp: (W.lkp && W.lkp.shown) ? [RR(W.lkp.x), RR(W.lkp.y), RR((W.lkp.aim || 0) * 100)] : 0,
        idr: W.items.map(i => RR((i.dropT || 0) * 100)),
        bd: W.bodies.map(b => [RR(b.x), RR(b.y), b.chief ? 1 : 0]), tm: RR(W.stats.time),
        io: [RR((W.ow.hack ? W.ow.hack.prog : -1) * 100), RR((W.ow.offline || 0) * 10)],
        cs: W.ow.casts.map(c => [RR(c.wx), RR(c.wy), RR(c.t * 100), RR(c.dur * 100), c.id]) };
    }
    return { role: 'guest', pr: this.chosenRole, sid: this.sid, ev };
  },
  recv() {
    const pp = this.pp; if (!pp) return;
    const evs = Array.isArray(pp.ev) ? pp.ev : [];
    const maxSeq = evs.reduce((m, e) => Math.max(m, +e[0] || 0), -1);
    if (pp.sid !== this.lastSid) { this.lastSid = pp.sid; this.lastIn = maxSeq; }
    for (const ev of evs) if (ev[0] > this.lastIn) handleNetEvent(ev);
    this.lastIn = Math.max(this.lastIn, maxSeq);
    if (this.mode === 'guest') applyHostSnapshot(pp);
  },
};
function handleNetEvent(ev) {
  const k = ev[1], v = ev.slice(2);
  if (net.mode === 'host') {
    // op actions arriving from guest
    switch (k) {
      case 'hack': { const d = W.doors[v[0] | 0]; if (d) owHackDoor(d); break; }
      case 'pay': owFire(v[0], +v[1], +v[2]); break;
      case 'click': owClickWorld(+v[0], +v[1], v[2] | 0); break;
      case 'crack': owIntentCrack = true; break;
      case 'sweep': W.ow.sweepFight = 0.8; break;
      case 'cm': comms('me', String(v[0]).slice(0, 60)); break;
      case 'cmd': applyOwCommandLocal(v[0], v[1] === '' ? null : +v[1], v[2] === '' ? null : +v[2], false); break;
      case 'purge': owPurge(); break;
    }
  } else {
    // host events arriving at guest
    switch (k) {
      case 'req': { const kind = v[0], wx = +v[1], wy = +v[2]; comms('req', 'Agent needs ' + (REQ_LABEL[kind] || kind) + '.'); if (isFinite(wx)) { W.reqPins.push({ x: wx, y: wy, kind, t: 10 }); if (kind === 'ping' || kind === 'mark') W.pings.push({ x: wx, y: wy, t: 6 }); } nToastShow('AGENT REQUEST · ' + String(REQ_LABEL[kind] || kind).toUpperCase()); break; }
      case 'cmag': comms('ag', String(v[0]).slice(0, 60)); break;
      case 'toast': nToastShow(String(v[0]).slice(0, 40)); break;
      case 'end': showResults(v[0] === 1, v[1]); game = 'over'; break;
    }
  }
}
function applyHostSnapshot(pp) {
  if (!W || pp.seed !== mapSeed) { if (pp.seed) { mapSeed = pp.seed; buildWorld(); game = 'play'; show(null); setView('op'); } return; }
  if (pp.ph === 'over' && game === 'play') {}
  if (Array.isArray(pp.ag)) { const a = pp.ag; W.ag.x = a[0]; W.ag.y = a[1]; W.ag.aim = a[2] / 100; W.ag.hp = a[3]; W.ag.cloak = !!a[4]; W.ag.nv = !!a[5]; W.ag.dead = !!a[6]; W.ag.keycard = !!a[7]; W.ag.drive = !!a[8]; W.ag.bat = a[9]; W.ag.mag = a[10]; W.ag.res = a[11]; W.ag.thermal = !!a[12]; W.ag.downed = !!a[13]; W.ag.downT = a[14] || 0; W.cam.x = a[0]; W.cam.y = a[1]; }
  if (Array.isArray(pp.ob)) { const o = W.obj, b = pp.ob; if (o.step !== b[0]) { o.step = b[0]; renderObjective(); } o.access = b[1]; o.upload = b[2] / 100; o.sweep = b[3] / 100; o.alarm = b[4] / 100; o.lockdown = !!b[5]; o.vaultCracked = !!b[6]; o.cracking = b[7] / 100; }
  if (Array.isArray(pp.g)) pp.g.forEach((s, i) => { const g = W.guards[i]; if (!g) return; g.x = s[0]; g.y = s[1]; g.face = s[2] / 100; g.dead = s[3] === 3; g.state = s[3] === 2 ? 'alert' : s[3] === 1 ? 'suspicious' : 'patrol'; g.chief = !!s[4]; g.aw = s[5] / 100; g.markT = s[6] ? 1 : 0; });
  if (Array.isArray(pp.d)) pp.d.forEach((s, i) => { const dr = W.drones[i]; if (!dr) return; dr.x = s[0]; dr.y = s[1]; dr.dead = !!s[2]; dr.state = s[3] ? 'hunt' : 'patrol'; dr.empT = s[4] ? 1 : 0; });
  if (Array.isArray(pp.c)) pp.c.forEach((s, i) => { const c = W.cams[i]; if (!c) return; c.face = s[0] / 100; c.hacked = !!s[1]; c.dead = !!s[2]; c.spotted = s[3] / 100; });
  if (typeof pp.dr === 'string') W.doors.forEach((d, i) => { const n = +pp.dr[i] || 0; d.open = !!(n & 1); d.sealed = !!(n & 2); d.hacked = !!(n & 4); });
  if (typeof pp.bw === 'number') W.ow.bw = pp.bw; if (typeof pp.dp === 'number') W.ow.drops = pp.dp; if (typeof pp.cd === 'number') W.ow.cdrones = pp.cd;
  if (Array.isArray(pp.al)) { W.allies = pp.al.map(s => ({ x: s[0], y: s[1], face: s[2] / 100, deployT: s[3] / 100, battery: s[4] / 10, dead: false, hitFlash: 0, moveTo: null })); W.ow.selAlly = (pp.sa >= 0 && pp.sa < W.allies.length) ? W.allies[pp.sa] : null; }
  if (Array.isArray(pp.idr)) pp.idr.forEach((v, i) => { if (W.items[i]) W.items[i].dropT = v / 100; });
  if ('lkp' in pp) W.lkp = Array.isArray(pp.lkp) ? { x: pp.lkp[0], y: pp.lkp[1], aim: pp.lkp[2] / 100, shown: true } : null;
  if (typeof pp.it === 'string') W.items.forEach((it, i) => it.got = pp.it[i] === '1');
  if (Array.isArray(pp.bd)) W.bodies = pp.bd.map(b => ({ x: b[0], y: b[1], a: 0, chief: !!b[2] }));
  if (typeof pp.tm === 'number') W.stats.time = pp.tm;
  if (Array.isArray(pp.io)) { const prog = pp.io[0] / 100; W.ow.hack = prog >= 0 ? { prog, rate: 0 } : null; W.ow.offline = (pp.io[1] || 0) / 10; }
  if (Array.isArray(pp.cs)) W.ow.casts = pp.cs.map(s => ({ wx: s[0], wy: s[1], t: s[2] / 100, dur: s[3] / 100, id: s[4], label: CAST_NAME[s[4]] || s[4] }));
  computeVision();
}

async function initNet() {
  let room = null;
  try { room = (window.claude && window.claude.use) ? await window.claude.use('room') : null; } catch (e) { room = null; }
  if (room) { net.transport = 'claude'; net.lobby = room; net.avail = 'on';
    room.onPeers(ch => { net.lobbyPeers = ch.peers; renderCoopPanel(); }, () => { net.avail = 'off'; net.lobby = null; renderCoopPanel(); });
    renderCoopPanel(); return;
  }
  // standalone (PWA / any web host): direct peer-to-peer via WebRTC (PeerJS).
  // The library loads from a CDN, so poll briefly in case it is still arriving.
  for (let i = 0; i < 30 && !window.Peer; i++) await new Promise(r => setTimeout(r, 150));
  if (window.Peer) { net.transport = 'peer'; net.avail = 'on'; renderCoopPanel(); return; }
  net.transport = 'off'; net.avail = 'off'; renderCoopPanel();
}

// ---------- peer-to-peer transport (standalone build) ----------
const PEER_PREFIX = 'coldarchive-op7-';
const PEER_OPTS = { config: { iceServers: [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' } ] } };
function peerAdapter(conn) {
  return { presence(obj) { try { if (conn.open) conn.send(obj); } catch (e) {} return Promise.resolve(); }, leave() { try { conn.close(); } catch (e) {} return Promise.resolve(); } };
}
function peerHost() {
  if (net.squad || net._peer) return;
  const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  net.code = code; net.chosenRole = 'agent'; net.mode = 'host'; net.avail = 'connecting'; renderCoopPanel();
  let peer;
  try { peer = new Peer(PEER_PREFIX + code.toLowerCase(), PEER_OPTS); } catch (e) { net.avail = 'on'; nToastShow('COULD NOT OPEN A GAME'); renderCoopPanel(); return; }
  net._peer = peer;
  peer.on('open', () => { net.avail = 'on'; renderCoopPanel(); });
  peer.on('error', err => { const fatal = /unavailable-id|network|server|socket|browser/i.test(err && err.type || ''); if (net.avail !== 'on' || fatal) { net.avail = 'on'; nToastShow(err && err.type === 'unavailable-id' ? 'CODE IN USE — TRY AGAIN' : 'CONNECTION ERROR'); peerLeave(); } });
  peer.on('connection', conn => {
    if (net.partner) { try { conn.close(); } catch (e) {} return; }   // one squadmate only
    conn.on('open', () => { net.squad = peerAdapter(conn); net.partner = conn.peer; nToastShow('OVERWATCH LINKED'); renderCoopPanel(); renderLobbyRoles(); });
    conn.on('data', d => { if (d && typeof d === 'object') net.pp = d; });
    conn.on('close', () => { net.partner = null; net.pp = null; net.squad = null; if (game === 'play') leaveSquad('Overwatch disconnected'); else { renderCoopPanel(); renderLobbyRoles(); } });
  });
}
function peerJoin(code) {
  if (net.squad || net._peer || !/^[A-Z0-9]{4}$/.test(code)) return;
  net.code = code; net.chosenRole = 'op'; net.mode = 'guest'; net.avail = 'connecting'; renderCoopPanel();
  let peer;
  try { peer = new Peer(PEER_OPTS); } catch (e) { net.avail = 'on'; nToastShow('COULD NOT CONNECT'); renderCoopPanel(); return; }
  net._peer = peer;
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
    const timer = setTimeout(() => { if (!net.partner) { nToastShow('NO GAME WITH THAT CODE'); peerLeave(); } }, 9000);
    conn.on('open', () => { clearTimeout(timer); net.squad = peerAdapter(conn); net.partner = conn.peer; net.avail = 'on'; nToastShow('LINKED TO AGENT'); renderCoopPanel(); renderLobbyRoles(); });
    conn.on('data', d => { if (d && typeof d === 'object') net.pp = d; });
    conn.on('close', () => { clearTimeout(timer); if (game === 'play') leaveSquad('The agent left the game'); else { net.partner = null; net.pp = null; net.squad = null; renderCoopPanel(); renderLobbyRoles(); } });
    conn.on('error', () => { clearTimeout(timer); });
  });
  peer.on('error', err => { nToastShow(/peer-unavailable/i.test(err && err.type || '') ? 'NO GAME WITH THAT CODE' : 'CONNECTION ERROR'); peerLeave(); });
}
function peerLeave() {
  if (net._peer) { try { net._peer.destroy(); } catch (e) {} net._peer = null; }
  net.squad = null; net.partner = null; net.pp = null; net.mode = 'solo'; net.code = null; net.avail = 'on';
}
async function hostSquad() {
  if (!net.lobby || net.squad) return;
  const code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  try { net.squad = await net.lobby.join('coa-' + code.toLowerCase()); } catch (e) { return; }
  net.code = code; net._pendRole = null;
  net.squad.onPeers(onSquadPeers, () => leaveSquad('Squad connection lost'));
  net.lobby.presence({ squad: code, open: true }).catch(() => {});
  renderLobbyRoles();
}
async function joinSquad(code) {
  if (!net.lobby || net.squad || !/^[A-Z0-9]{4}$/.test(code)) return;
  try { net.squad = await net.lobby.join('coa-' + code.toLowerCase()); } catch (e) { return; }
  net.code = code; net._joined = true;
  net.squad.onPeers(onSquadPeers, () => leaveSquad('Squad connection lost'));
  renderLobbyRoles();
}
function leaveSquad(msg) {
  if (net.transport === 'peer') { peerLeave(); }
  else { const sq = net.squad; net.squad = null; if (sq) sq.leave().catch(() => {}); if (net.lobby) net.lobby.presence({ squad: null, open: null }).catch(() => {}); }
  net.mode = 'solo'; net.code = null; net.partner = null; net.pp = null;
  if (game !== 'menu') { game = 'menu'; }
  show('lobby'); renderCoopPanel(); renderLobbyRoles();
  if (msg) nToastShow(msg);
}
function onSquadPeers(ch) {
  const want = net.chosenRole === 'agent' ? 'op' : 'agent';
  const cands = ch.peers.filter(p => !p.sameTab && p.presence && p.presence.pr === want);
  const p = cands.find(c => c.peer === net.partner) || cands[0];
  if (p) { net.partner = p.peer; net.pp = p.presence; }
  else if (net.partner) { net.partner = null; net.pp = null; }
  renderLobbyRoles();
}

// ============================================================= input
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (game === 'menu' || game === 'paused' || game === 'over') {
    if (k === 'escape' && game === 'paused') resumeGame();
    return;
  }
  if (!keys.has(k)) {
    if (humanDrivesAgent() && view === 'agent') {
      if (k === 'e') agentInteract();
      else if (k === 'q') { useAgentAbility(); }
      else if (k === 'n') { W.ag.nv = !W.ag.nv; if (W.ag.nv) W.ag.thermal = false; aToastShow(W.ag.nv ? 'NIGHT VISION ON' : 'NIGHT VISION OFF'); }
      else if (k === 't') { W.ag.thermal = !W.ag.thermal; if (W.ag.thermal) W.ag.nv = false; aToastShow(W.ag.thermal ? 'THERMAL ON' : 'THERMAL OFF'); }
      else if (k === 'r') startReload();
      else if (k === '1') agentRequest('door'); else if (k === '2') agentRequest('distract');
      else if (k === '3') agentRequest('supply'); else if (k === '4') agentRequest('lights');
      else if (k === '5') agentRequest('scan'); else if (k === 'f') agentRequest('ping');
    }
    if (humanDrivesOp() && view === 'op') {
      if (k === 'p' || k === ' ') { owPurge(); }
      else { const p = PAYLOADS.find(x => x.key === k); if (p) owSelectPayload(p.id); }
      if (k === 'z') opComm('Move up.'); if (k === 'x') opComm('Hold position.'); if (k === 'c') opComm('Clear — go.'); if (k === 'v') opComm('Fall back!');
    }
    if (k === 'tab' && (soloMode === 'both' || soloMode === 'duo')) { e.preventDefault(); setView(view === 'agent' ? 'op' : 'agent'); }
    if (k === 'escape') { if (agentReqMode) cancelAgentReq(); else pauseGame(); }
  }
  keys.add(k);
  if (k === ' ' || k === 'tab' || k.startsWith('arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
function opComm(txt) { if (net.mode === 'guest') net.out('cm', txt); else comms('me', 'Overwatch: ' + txt); }

// operator drag-and-drop: drag an ability onto the map to deploy it there (tap = select-then-tap)
let owDrag = null;
const TARGETED_PAYLOADS = ['emp', 'supply', 'lights', 'decoy', 'cdrone'];
function owDragStart(id, sx, sy) { if (!owReady(id)) { owSelectPayload(id); return; } owDrag = { id, sx, sy, cx: sx, cy: sy, moved: 0 }; }
window.addEventListener('pointermove', e => { if (!owDrag) return; owDrag.cx = e.clientX; owDrag.cy = e.clientY; owDrag.moved = Math.max(owDrag.moved, Math.hypot(e.clientX - owDrag.sx, e.clientY - owDrag.sy)); });
window.addEventListener('pointerup', e => {
  if (!owDrag) return; const d = owDrag; owDrag = null;
  if (game !== 'play' || view !== 'op' || !humanDrivesOp()) return;
  if (d.moved > 14) {                                   // dropped on the map
    const w = screenToOp(e.clientX, e.clientY);
    if (TARGETED_PAYLOADS.includes(d.id)) { if (net.mode === 'guest') net.out('pay', d.id, RR(w.x), RR(w.y)); else owFire(d.id, w.x, w.y); }
    else { owSelectPayload(d.id); }                     // instant abilities fire wherever dropped
  } else { owSelectPayload(d.id); }                      // a tap -> arm select-then-tap
});

// mouse: agent aim OR op interaction depending on view
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true; if (view === 'op' && W) opHoverAt(e.clientX, e.clientY); });
cv.addEventListener('mousedown', e => { initAudio(); if (game !== 'play') return; if (view === 'agent') { if (e.button === 2) { cancelAgentReq(); return; } if (agentReqMode) { const w = screenToAgentWorld(e.clientX, e.clientY); agentPlaceRequest(w.x, w.y); return; } mouse.down = true; } else if (humanDrivesOp() || humanDrivesDef()) { opPointer(e.clientX, e.clientY, e.button); } if (view === 'op') e.preventDefault(); });
window.addEventListener('mouseup', () => mouse.down = false);
cv.addEventListener('contextmenu', e => { e.preventDefault(); if (game === 'play' && view === 'op' && (humanDrivesOp() || humanDrivesDef())) opPointer(e.clientX, e.clientY, 2); });
cv.addEventListener('wheel', e => { if (view !== 'op' || !W) return; e.preventDefault(); const f = e.deltaY < 0 ? 1.12 : 0.89; const before = screenToOp(e.clientX, e.clientY); W.opCam.z = clamp(W.opCam.z * f, 0.25, 1.6); const after = screenToOp(e.clientX, e.clientY); W.opCam.x += before.x - after.x; W.opCam.y += before.y - after.y; }, { passive: false });
// op drag-pan (middle or left-drag empty)
let panning = null;
cv.addEventListener('pointerdown', e => { if (view === 'op' && (e.button === 1)) { panning = { x: e.clientX, y: e.clientY, cx: W.opCam.x, cy: W.opCam.y }; } });
window.addEventListener('pointermove', e => { if (panning) { W.opCam.x = panning.cx - (e.clientX - panning.x) / W.opCam.z; W.opCam.y = panning.cy - (e.clientY - panning.y) / W.opCam.z; } });
window.addEventListener('pointerup', () => panning = null);
function screenToOp(sx, sy) { const C = W.opCam; return { x: (sx - VW / 2) / C.z + C.x, y: (sy - VH / 2) / C.z + C.y }; }
let opHover = null;
function opHoverAt(sx, sy) {
  const w = screenToOp(sx, sy); let best = null, bd = 24, info = '<span class="k">Empty floor.</span>';
  for (const d of W.doors) { const q = hyp(d.x, d.y, w.x, w.y); if (q < bd) { bd = q; best = { x: d.x, y: d.y }; const z = zoneGrid[d.tx + d.ty * COLS]; info = '<b>Door</b> · ' + (zones[z] ? zones[z].name : '') + '<br><span class="k">' + (d.sealed ? 'Sealed (lockdown)' : d === W.vaultDoorRef ? 'Vault — needs crack + keycard' : d.open ? 'Open · click to seal' : 'Locked · click to open') + '</span>'; } }
  for (const c of W.cams) { if (c.dead) continue; const q = hyp(c.x, c.y, w.x, w.y); if (q < bd) { bd = q; best = { x: c.x, y: c.y }; info = '<b>Camera</b><br><span class="k">' + (c.hacked ? 'Looped' : 'Click to loop (10 bw)') + '</span>'; } }
  for (const v of W.devs) { const q = hyp(v.x, v.y, w.x, w.y); if (q < bd) { bd = q; best = { x: v.x, y: v.y }; info = '<b>' + esc(v.name) + '</b><br><span class="k">Click to trip a distraction (8 bw)</span>'; } }
  for (const g of W.guards) { if (g.dead) continue; const q = hyp(g.x, g.y, w.x, w.y); if (q < bd) { bd = q; best = { x: g.x, y: g.y }; info = '<b>' + (g.chief ? 'Site Chief' : 'Guard') + '</b> · ' + g.state + '<br><span class="k">Click to tag for the agent</span>'; } }
  opHover = best; const el = $('nInfo'); if (el && el.innerHTML !== info) el.innerHTML = info;
}
function opPointer(sx, sy, button) { const w = screenToOp(sx, sy);
  if (humanDrivesDef()) { defClickWorld(w.x, w.y, button); return; }
  if (cmdMoveMode && button !== 2) { owCommand(cmdMovePending, w.x, w.y); cmdMoveMode = false; $('cmdMove').classList.remove('on'); $('cmdGo').classList.remove('on'); return; }
  if (net.mode === 'guest') { if (owSelect && button !== 2) { net.out('pay', owSelect, RR(w.x), RR(w.y)); owSelect = null; renderAbilities(); } else net.out('click', RR(w.x), RR(w.y), button); } else owClickWorld(w.x, w.y, button); }

// touch controls (agent only; dual virtual sticks)
const touches = {};
cv.addEventListener('touchstart', e => {
  initAudio(); if (game !== 'play') return; if (!splitScreen() && view !== 'agent') return; e.preventDefault();
  const hw = VW / 2, hh = VH / 2;
  for (const t of e.changedTouches) {
    if (!splitScreen() && agentReqMode) { const w = screenToAgentWorld(t.clientX, t.clientY); agentPlaceRequest(w.x, w.y); return; }
    const s = { id: t.identifier, ox: t.clientX, oy: t.clientY, vx: 0, vy: 0, mag: 0 };
    if (splitScreen()) {
      const half = t.clientY >= hh ? 0 : 1;   // bottom half = P1, top half = P2 (players face each other)
      if (halfView[half] !== 'agent') { splitOpDown(half, t); continue; }   // console half: taps/pan, not sticks
      if (swapChipHit(half, t.clientX, t.clientY)) { halfView[half] = 'op'; nToastShow('CONSOLE'); continue; }   // jump to the console
      const abtn = agentBtnHit(half, t.clientX, t.clientY);
      if (abtn) { const a = halfAgent(half); if (abtn.id === 'use') agentInteract(a); else useAgentAbility(a); continue; }
      const p1 = half === 0, tc = p1 ? touch : touch2;
      // twin-stick per half: MOVE on the player's left, AIM/FIRE on their right (P2 is flipped, so their left is screen-right)
      const moveZone = p1 ? (t.clientX < hw) : (t.clientX > hw);
      if (moveZone && !tc.move) tc.move = s; else if (!moveZone && !tc.aim) tc.aim = s; else continue;
    } else {
      const left = t.clientX < hw;
      if (left && !touch.move) touch.move = s; else if (!left && !touch.aim) touch.aim = s; else continue;
    }
    touches[t.identifier] = s;
  }
}, { passive: false });
cv.addEventListener('touchmove', e => { if (!splitScreen() && view !== 'agent') return; e.preventDefault(); for (const t of e.changedTouches) { if (opGest[t.identifier]) { splitOpMoveT(t); continue; } const s = touches[t.identifier]; if (!s) continue; const dx = t.clientX - s.ox, dy = t.clientY - s.oy; const m = Math.hypot(dx, dy); const R = 54; s.mag = Math.min(1, m / R); if (m > 0) { s.vx = dx / m; s.vy = dy / m; } } }, { passive: false });
function endTouch(e) { for (const t of e.changedTouches) { if (opGest[t.identifier]) { splitOpEndT(t); continue; } const s = touches[t.identifier]; if (!s) continue; for (const st of [touch, touch2]) { if (st.move === s) st.move = null; if (st.aim === s) st.aim = null; } delete touches[t.identifier]; } }
cv.addEventListener('touchend', endTouch); cv.addEventListener('touchcancel', endTouch);

// perspective swap buttons
$('swap').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));

// ============================================================= menu / flow
function show(id) {
  for (const o of ['menu', 'solo', 'lobby', 'how', 'pause', 'results']) { const e = $(o); if (e) e.hidden = o !== id; }
  const inGame = id === null;
  $('ahud').hidden = !(inGame && view === 'agent');
  $('nhud').hidden = !(inGame && view === 'op');
  $('swap').hidden = !(inGame && (soloMode === 'both' || soloMode === 'duo'));
}
let soloChoice = null;
function wireMenu() {
  $('mSolo').onclick = () => { initAudio(); renderDiff('soloDiff'); renderKit('soloKit'); syncCyberBtns(); show('solo'); };
  const cyBtn = (id) => { const b = $(id); if (b) b.onclick = () => { initAudio(); cyberWar = !cyberWar; syncCyberBtns(); }; };
  cyBtn('soloCyber'); cyBtn('lobCyber');
  $('mCoop').onclick = () => { initAudio(); net.chosenRole = null; show('lobby'); renderCoopPanel(); renderLobbyRoles(); };
  $('howBtn').onclick = () => show('how');
  $('howBack').onclick = () => show('menu');
  $('soloBack').onclick = () => show('menu');
  document.querySelectorAll('#solo [data-solo]').forEach(b => b.onclick = () => { document.querySelectorAll('#solo [data-solo]').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); soloChoice = b.dataset.solo; $('soloStart').disabled = false; });
  $('soloStart').onclick = () => { if (!soloChoice) return; startSolo(soloChoice); };
  $('lobBack').onclick = () => { leaveSquad(); show('menu'); };
  $('deployBtn').onclick = () => { if (net.mode === 'host' && net.partner) startMission(true); };
  $('resumeBtn').onclick = resumeGame;
  const pb = $('pauseBtn'); if (pb) pb.addEventListener('pointerdown', e => { e.preventDefault(); initAudio(); if (game === 'play') pauseGame(); }, { passive: false });
  $('abortBtn').onclick = () => { if (net.mode !== 'solo') leaveSquad(); game = 'menu'; W = null; show('menu'); };
  $('againBtn').onclick = () => { mapSeed = 0; if (net.mode === 'solo') startSolo(soloMode); else if (net.mode === 'host') startMission(true); };
  $('resMenu').onclick = () => { if (net.mode !== 'solo') leaveSquad(); game = 'menu'; W = null; show('menu'); };
}
function startSolo(mode) {
  initAudio(); net.mode = 'solo'; net.role = 'agent';
  // split sub-modes arrive as 'split', 'split-op', 'split-toggle', 'split-fac'
  if (mode && mode.indexOf('split') === 0) {
    splitMode = mode === 'split-op' ? 'opagent' : mode === 'split-toggle' ? 'toggle' : mode === 'split-fac' ? 'facility' : 'agents';
    mode = 'split';
    halfView = splitMode === 'opagent' ? ['op', 'agent'] : splitMode === 'facility' ? ['facility', 'agent'] : ['agent', 'agent'];
  }
  autoDemo = (mode === 'auto'); soloMode = (mode === 'auto') ? 'both' : mode; mapSeed = 0;
  buildWorld(); game = 'play';
  setView(mode === 'op' || mode === 'versus' ? 'op' : 'agent');
  if (mode === 'practice') { W.obj.step = 99; renderObjective(); $('aObj').textContent = 'Range practice'; $('aObjSub').textContent = 'Move, camo, night vision, takedowns. No objectives.'; }
  if (mode === 'versus') { nToastShow('WARDEN ONLINE — STOP THE INTRUDER'); comms('sys', 'Warden online. Intruders inbound.'); }
  document.body.classList.toggle('split', mode === 'split');   // hides the single-player DOM HUD; canvas HUD per half
  syncFog(); show(null);
}
function startMission(coop) {
  initAudio();
  if (coop) { net.mode = net.chosenRole === 'agent' ? 'host' : 'guest'; soloMode = null; autoDemo = false; mapSeed = (Math.random() * 1e9) >>> 0; buildWorld(); game = 'play'; setView(net.chosenRole === 'agent' ? 'agent' : 'op'); syncFog(); show(null); net.tick(0); }
}
function renderCoopPanel() {
  const el = $('coop'); if (!el) return;
  if (net.avail === 'connecting') { el.innerHTML = '<div class="hd"><b>CO-OP</b><span>Connecting…</span></div>'; return; }
  if (net.transport === 'peer') return renderPeerPanel(el);
  if (net.avail === 'off') { el.innerHTML = '<div class="hd"><b>CO-OP</b><span>Unavailable here</span></div><p>Co-op works when both players open this page on claude.ai or in the Claude app, signed in. Use the Share menu to send your friend the link.</p>'; return; }
  if (!net.squad) {
    const open = net.lobbyPeers.filter(p => !p.sameTab && p.presence && typeof p.presence.squad === 'string' && p.presence.open && /^[A-Z0-9]{4}$/.test(p.presence.squad)).map(p => p.presence.squad);
    el.innerHTML = '<div class="hd"><b>CO-OP</b><span>2 players</span></div><p>Host a squad, then your friend opens this page and joins. One of you plays the agent, the other overwatch.</p><div class="row"><button class="btn2" id="hostBtn">Host a squad</button>' + open.map(c => '<button class="btn2" data-join="' + c + '">Join ' + c + '</button>').join('') + '</div>';
    const hb = $('hostBtn'); if (hb) hb.onclick = () => { initAudio(); hostSquad(); };
    el.querySelectorAll('[data-join]').forEach(b => b.onclick = () => { initAudio(); joinSquad(b.dataset.join); });
  } else {
    el.innerHTML = '<div class="hd"><b>SQUAD ' + net.code + '</b><span><i class="dot' + (net.partner ? ' live' : '') + '"></i>' + (net.partner ? 'Squadmate connected' : 'Waiting for your friend…') + '</span></div><div class="code">' + net.code + '</div><p>' + (net.partner ? 'Both of you pick a role below, then the host deploys.' : 'Your friend opens this page and taps Join ' + net.code + '.') + '</p>';
  }
}
// peer-to-peer lobby: the agent creates the game (becomes the P2P host), overwatch joins by code
function renderPeerPanel(el) {
  if (!net._peer && !net.squad) {
    el.innerHTML = '<div class="hd"><b>CO-OP</b><span>device to device</span></div><p>One of you creates the game as the Field Agent and reads out the code. The other joins as Overwatch. You connect directly — no sign-in.</p>'
      + '<div class="row"><button class="btn2" id="pHost">Create game · you’re the Agent</button></div>'
      + '<div class="row" style="margin-top:4px"><input id="pCode" inputmode="latin" autocapitalize="characters" autocomplete="off" maxlength="4" placeholder="CODE" style="font-family:var(--n-disp);font-size:20px;letter-spacing:.2em;text-transform:uppercase;width:120px;padding:8px 10px;background:rgba(3,14,24,.8);border:1px solid var(--n-edge);color:#fff;border-radius:4px"><button class="btn2" id="pJoin">Join as Overwatch</button></div>';
    const hb = $('pHost'); if (hb) hb.onclick = () => { initAudio(); peerHost(); renderLobbyRoles(); };
    const ci = $('pCode'); const jb = $('pJoin');
    if (ci) ci.addEventListener('input', () => { ci.value = ci.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
    if (jb) jb.onclick = () => { initAudio(); const c = (ci.value || '').toUpperCase(); if (/^[A-Z0-9]{4}$/.test(c)) { peerJoin(c); renderLobbyRoles(); } else nToastShow('ENTER THE 4-CHARACTER CODE'); };
    return;
  }
  const role = net.chosenRole === 'agent' ? 'FIELD AGENT' : 'OVERWATCH';
  el.innerHTML = '<div class="hd"><b>' + (net.chosenRole === 'agent' ? 'YOUR GAME' : 'JOINING') + '</b><span><i class="dot' + (net.partner ? ' live' : '') + '"></i>' + (net.partner ? 'Linked' : net.chosenRole === 'agent' ? 'Waiting for overwatch…' : 'Finding the agent…') + '</span></div>'
    + '<div class="code">' + (net.code || '····') + '</div>'
    + '<p>You are <b style="color:#fff">' + role + '</b>. ' + (net.chosenRole === 'agent' ? (net.partner ? 'Overwatch is linked — deploy when ready.' : 'Give your friend this code to join as Overwatch.') : (net.partner ? 'Linked. The agent will deploy you both.' : 'Connecting to the agent…')) + '</p>'
    + '<div class="row"><button class="btn2" id="pLeave">Leave</button></div>';
  const lb = $('pLeave'); if (lb) lb.onclick = () => leaveSquad();
}
function renderDiff(elId) {
  const el = $(elId); if (!el) return;
  el.innerHTML = Object.keys(DIFF).map(k => '<button data-d="' + k + '" class="' + (difficulty === k ? 'on' : '') + '"><b>' + DIFF[k].name + '</b><span>' + DIFF[k].tag + '</span></button>').join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { initAudio(); difficulty = b.dataset.d; renderDiff(elId); });
}
function syncCyberBtns() { ['soloCyber', 'lobCyber'].forEach(id => { const b = $(id); if (b) b.classList.toggle('on', cyberWar); }); }
// agent loadout picker (staging area) — mirrors the difficulty selector
function renderKit(elId) {
  const el = $(elId); if (!el) return;
  el.innerHTML = Object.keys(AGENT_KITS).map(k => { const d = AGENT_KITS[k]; return '<button data-k="' + k + '" class="' + (agentKit === k ? 'on' : '') + '"><b>' + d.glyph + ' ' + d.name + '</b><span>' + d.desc + '</span></button>'; }).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { initAudio(); agentKit = b.dataset.k; renderKit(elId); });
}
// operator console theme swatches
function wireUniverse() {
  applyUniverse();
  const el = $('uniSel'); if (!el) return;
  const mark = () => el.querySelectorAll('.uni').forEach(b => b.classList.toggle('sel', b.dataset.uni === universe));
  el.querySelectorAll('.uni').forEach(b => b.onclick = () => { initAudio(); universe = b.dataset.uni; applyUniverse(); applyOpTheme(); mark(); });
  mark();
}
function renderThemeSel() {
  const el = $('themeSel'); if (!el) return;
  el.innerHTML = Object.keys(OP_THEMES).map(k => { const t = OP_THEMES[k]; return '<button data-th="' + k + '" class="' + (opTheme === k ? 'on' : '') + '" style="color:' + t.hex + '"><span class="sw" style="background:' + t.hex + '"></span><span>' + t.name + '</span></button>'; }).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { initAudio(); opTheme = b.dataset.th; applyOpTheme(); renderThemeSel(); });
}
function renderLobbyRoles() {
  renderCoopPanel();
  const dw = $('lobDiffWrap'); if (dw) { const showDiff = net.chosenRole === 'agent' && net.partner; dw.hidden = !showDiff; if (showDiff) renderDiff('lobDiff'); }
  const kw = $('lobKitWrap'); if (kw) { const showKit = net.chosenRole === 'agent'; kw.hidden = !showKit; if (showKit) renderKit('lobKit'); }
  const cw = $('lobCyberWrap'); if (cw) { const showCy = net.chosenRole === 'agent'; cw.hidden = !showCy; if (showCy) syncCyberBtns(); }
  const roles = $('roles'), dep = $('deployBtn');
  if (net.transport === 'peer') {
    roles.hidden = true;
    const canDeploy = net.chosenRole === 'agent' && net.partner;
    dep.hidden = !(net._peer || net.squad);
    dep.disabled = !canDeploy;
    dep.textContent = net.chosenRole === 'op' ? 'Agent deploys' : canDeploy ? 'Deploy' : 'Waiting…';
    return;
  }
  if (!net.squad) { roles.hidden = true; dep.hidden = true; return; }
  roles.hidden = false; dep.hidden = false;
  roles.querySelectorAll('[data-role]').forEach(b => {
    b.classList.toggle('sel', net.chosenRole === b.dataset.role);
    const takenByOther = net.pp && net.pp.pr === b.dataset.role;
    b.disabled = takenByOther; b.querySelector('span').style.opacity = takenByOther ? 0.5 : 1;
    b.onclick = () => { net.chosenRole = b.dataset.role; net.mode = b.dataset.role === 'agent' ? 'host' : 'guest'; if (net.squad) net.squad.presence(net.snapshot()).catch(() => {}); renderLobbyRoles(); };
  });
  const ready = net.chosenRole && net.partner && net.pp && net.pp.pr && net.pp.pr !== net.chosenRole;
  dep.disabled = !(ready && net.chosenRole === 'agent');
  dep.textContent = net.chosenRole === 'op' ? 'Host deploys' : ready ? 'Deploy' : 'Pick roles';
}
function pauseGame() {
  if (net.mode !== 'solo') { show('pause'); $('pauseTitle').textContent = 'Holding position'; $('pauseText').textContent = 'Co-op keeps running — your squadmate is still live. Resume, or exit to the menu.'; renderThemeSel(); return; }
  if (game === 'play') { game = 'paused'; $('pauseTitle').textContent = soloMode === 'versus' ? 'Facility paused' : 'Mission paused'; $('pauseText').textContent = 'The simulation is frozen. Resume where you left off, or exit to the main menu.'; show('pause'); renderThemeSel(); }
}
function resumeGame() { if (net.mode === 'solo' && game === 'paused') game = 'play'; show(null); }
function showResults(win, msg) {
  game = 'over'; show('results');
  const s = W.stats; const detected = s.alarms > 0 || s.detections > 2;
  // versus: the human is the warden, so the intruder's win is the warden's loss
  if (soloMode === 'versus') {
    const held = !win;  // intruder failed -> facility held
    $('resTitle').textContent = held ? 'Facility secured' : 'Intruder escaped';
    $('resEyebrow').textContent = (held ? 'Warden — intruder stopped' : 'Warden — breach') + ' · ' + D().name;
    const rr = $('resRating'); rr.textContent = held ? 'SECURED' : 'BREACHED'; rr.className = 'rating' + (held ? '' : ' bad');
    $('resText').textContent = held ? (s.takedowns + s.kills > 0 ? 'The infiltration team was put down before they could exfil the drive.' : 'The intruder failed to exfil in time. Facility holds.') : 'The team recovered the drive and slipped the net. Review your patrol coverage.';
    $('resStats').innerHTML = [['Time', fmtT(s.time)], ['Guard takedowns', s.takedowns + s.kills], ['Alarms raised', s.alarms], ['Intruder HP', Math.max(0, Math.round(W.ag.hp))]].map(x => '<div class="stat"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>').join('');
    return;
  }
  $('resTitle').textContent = win ? 'Evidence recovered' : 'Mission failed';
  $('resEyebrow').textContent = (win ? 'Debrief — success' : 'Debrief') + ' · ' + D().name;
  let rating = 'GHOST', bad = false;
  if (!win) { rating = 'BURNED'; bad = true; } else if (s.alarms > 0) { rating = 'LOUD'; bad = true; } else if (s.kills > 0) rating = 'LETHAL'; else if (s.takedowns > 0) rating = 'SILENT'; else rating = 'GHOST';
  const rr = $('resRating'); rr.textContent = rating; rr.className = 'rating' + (bad ? ' bad' : '');
  $('resText').textContent = win ? (msg || 'Evidence recovered.') + ' ' + (s.alarms === 0 ? 'Nobody knew you were there.' : 'They know someone was in the building.') : (msg || 'The run went loud.');
  $('resStats').innerHTML = [['Time', fmtT(s.time)], ['Takedowns', s.takedowns], ['Kills', s.kills], ['Alarms', s.alarms], ['Hacks', s.hacks], ['Shots', s.shots]].map(x => '<div class="stat"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>').join('');
}

// ============================================================= boot
// let the player reposition the call-downs panel by dragging its header; remember where they put it
function wireReqPanelDrag() {
  const panel = $('aReqGrid'), handle = $('rpHandle'); if (!panel || !handle) return;
  const applyPos = (left, top) => { panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; };
  const clampPos = () => { const w = panel.offsetWidth, h = panel.offsetHeight; let x = parseFloat(panel.style.left), y = parseFloat(panel.style.top); if (isNaN(x)) return; x = clamp(x, 4, window.innerWidth - w - 4); y = clamp(y, 56, window.innerHeight - h - 4); applyPos(x, y); };
  const saved = store.get('reqPanelPos', null); if (saved && typeof saved.x === 'number') { applyPos(saved.x, saved.y); setTimeout(clampPos, 0); }
  let drag = null;
  handle.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); const r = panel.getBoundingClientRect(); drag = { ox: e.clientX - r.left, oy: e.clientY - r.top }; panel.classList.add('dragging'); });
  window.addEventListener('pointermove', e => { if (!drag) return; const w = panel.offsetWidth, h = panel.offsetHeight; const x = clamp(e.clientX - drag.ox, 4, window.innerWidth - w - 4), y = clamp(e.clientY - drag.oy, 56, window.innerHeight - h - 4); applyPos(x, y); });
  window.addEventListener('pointerup', () => { if (!drag) return; drag = null; panel.classList.remove('dragging'); store.set('reqPanelPos', { x: parseFloat(panel.style.left) || 0, y: parseFloat(panel.style.top) || 0 }); });
  window.addEventListener('resize', () => setTimeout(clampPos, 0));
}
function boot() {
  document.body.classList.add('view-agent');
  resize(); syncFog(); wireMenu(); wireTouchControls(); wireReqPanelDrag(); applyOpTheme(); wireUniverse();
  cv.addEventListener('touchstart', opTouchStart, { passive: false });
  cv.addEventListener('touchmove', opTouchMove, { passive: false });
  cv.addEventListener('touchend', opTouchEnd); cv.addEventListener('touchcancel', opTouchEnd);
  renderObjective_safe();
  show('menu');
  requestAnimationFrame(frame);
  initNet();
  window.__demo = (d) => { if (d) difficulty = d; startSolo('auto'); };
  window.__startSolo = (m) => startSolo(m);
  window.__forceDown = () => { if (W) hurtAgent(999, 0); };
  window.__state = () => W ? ({ hp: Math.round(W.ag.hp), alarm: W.obj.alarm.toFixed(2), seed: mapSeed, dead: W.ag.dead, ax: Math.round(W.ag.x), ay: Math.round(W.ag.y) }) : null;
  window.__orderDbg = () => W ? ({ order: W.agOrder || null, hold: !!W.agHold, wp: W.waypoint ? { x: Math.round(W.waypoint.x), y: Math.round(W.waypoint.y), order: !!W.waypoint.order } : null, ability: W.ag.ability, abilCd: +(W.ag.abilCd||0).toFixed(1) }) : null;
  window.__cyberDbg = () => W ? ({ cyberWar, offline: +(W.ow.offline||0).toFixed(1), hack: W.ow.hack ? +W.ow.hack.prog.toFixed(2) : null, intrCd: +(W.ow.intrCd||0).toFixed(1) }) : null;
  window.__forceHack = () => { if (W) { W.ow.hack = { prog: 0.0, rate: 0.14 }; } };
  window.__forceOffline = () => { if (W) { W.ow.hack = null; W.ow.offline = 6; } };
  window.__versus = () => startSolo('versus');
  window.__duo = () => startSolo('duo');
  window.__split = (sub) => startSolo('split' + (sub ? ('-' + sub) : ''));
  window.__splitDbg = () => W ? ({ soloMode, splitMode, halfView: halfView.slice(), kinds: halfKinds(), ag: !!W.ag, ag2: !!W.ag2, opBtns0: opStripButtons(0).map(b => b.id), opBtns1: opStripButtons(1).map(b => b.id), opCam2: !!W.opCam2 }) : null;
  window.__splitTapHalf = (half, sx, sy) => { const w = opHalfScreenToWorld(half, sx, sy); return { x: Math.round(w.x), y: Math.round(w.y) }; };
  window.__splitSwap = (half) => { halfView[half] = halfView[half] === 'agent' ? 'op' : 'agent'; return halfView.slice(); };
  window.__owSel = () => owSelect;
  window.__nw = (s) => nwText(s);
  window.__zoomAgs = (z) => { AGS = z; return AGS; };
  window.__peek = () => { if (!W) return null; const g = W.guards.find(x => !x.dead); const dr = W.drones.find(x => !x.dead); if (g) { W.ag.x = g.x - 40; W.ag.y = g.y; W.ag.aim = 0; W.marks.push(g.id); g.markT = 30; if (dr) { dr.x = g.x + 20; dr.y = g.y - 36; dr.markT = 30; } W.cam.x = g.x; W.cam.y = g.y; } return g ? { x: Math.round(g.x), y: Math.round(g.y) } : null; };
  window.__uni = () => universe;
  window.__fireOw = (id) => { try { owFire(id, W.ag.x + 20, W.ag.y); return 'ok'; } catch (e) { return e.message; } };
  window.__toStep7 = () => { if (!W) return null; W.ag.drive = true; W.obj.step = 7; W.obj.lockdown = true; triggerLockdown(); const d = W.dockDoorRef; return d ? { sealed: d.sealed, open: d.open, type: d.type, x: Math.round(d.x), y: Math.round(d.y) } : 'no-dock'; };
  window.__dockState = () => { if (!W || !W.dockDoorRef) return null; const d = W.dockDoorRef; return { sealed: d.sealed, open: !!d.open, hacked: !!d.hacked, openT: Math.round(d.openT || 0) }; };
  window.__owHackDock = () => { if (!W || !W.dockDoorRef) return null; owHackDoor(W.dockDoorRef); return W.ow.casts.map(c => c.id); };
  window.__forceCasts = () => { if (!W) return 0; let n = 0; for (const c of W.ow.casts) { c.t = c.dur + 1; n++; } return n; };
  window.__placeAgentAtDock = () => { if (!W || !W.dockDoorRef) return null; W.ag.x = W.dockDoorRef.x - 24; W.ag.y = W.dockDoorRef.y; return { x: Math.round(W.ag.x), y: Math.round(W.ag.y) }; };
  window.__pickState = () => pickState ? { t: +pickState.t.toFixed(2), dur: +pickState.dur.toFixed(2) } : null;
  window.__defAction = (k) => { defAction(k); return { armed: !!W.def.rallyArm, pwr: Math.round(W.def.power) }; };
  window.__fight = () => { if (!W) return null; return { agHp: Math.round(W.ag.hp), agDown: !!W.ag.downed, guardsAlive: W.guards.filter(g => !g.dead).length, guardsTotal: W.guards.length }; };
  window.__rallyAll = () => { if (!W) return 0; const ax = W.ag.x, ay = W.ag.y; for (const g of W.guards) { if (g.dead) continue; g.defGo = { x: ax, y: ay }; g.state = 'alert'; g.last = { x: ax, y: ay }; g.aw = 1; } return W.guards.filter(g => !g.dead).length; };
  window.__downAgent = () => { if (!W) return null; W.ag.hp = 0; W.ag.downed = true; W.ag.downT = 16; return { downed: W.ag.downed, agx: Math.round(W.ag.x), agy: Math.round(W.ag.y) }; };
  window.__agState = () => W ? ({ hp: Math.round(W.ag.hp), downed: !!W.ag.downed, dead: !!W.ag.dead, allies: W.allies.length, medics: W.allies.filter(a => a.medic).length }) : null;
  window.__agPos = () => W ? ({ x: W.ag.x, y: W.ag.y }) : null;
  window.__cloak0 = () => !!(W && W.ag && W.ag.cloak);
  window.__centerOpCamOnGuard = (half) => { if (!W) return null; const g = W.guards.find(x => !x.dead); if (!g) return null; const cam = half === 0 ? W.opCam : W.opCam2; cam.x = g.x; cam.y = g.y; cam.z = 0.9; return { x: Math.round(g.x), y: Math.round(g.y) }; };
  window.__guardsGo = () => W ? W.guards.filter(g => !g.dead && g.defGo).length : 0;
  // place one guard `dist` px east of the agent on clear ground and emit one running footstep; returns if it reacted
  window.__testStep = (dist, cloak) => { if (!W) return null; const g = W.guards.find(x => !x.dead); if (!g) return null; g.state = 'patrol'; g.target = null; g.aw = 0; g.stunT = 0; g.x = W.ag.x + dist; g.y = W.ag.y; W.ag.cloak = !!cloak; noise(W.ag.x, W.ag.y, W.ag.cloak ? 44 : 70, false); return { dist, cloak: !!cloak, reacted: g.state !== 'patrol', state: g.state }; };
  window.__cloak1 = () => !!(W && W.ag2 && W.ag2.cloak);
  // screen center of a split control (for input tests), inverting the half's local transform
  window.__ctrlScreen = (half, kind, id) => {
    const r = halfRect(half);
    let b = null;
    if (kind === 'op') b = opStripButtons(half).find(x => x.id === id);
    else if (kind === 'ag') b = agentHalfButtons(half).find(x => x.id === id);
    else if (kind === 'swap') b = swapChipRect(half);
    if (!b) return null;
    const lx = b.x + b.w / 2, ly = b.y + b.h / 2;
    return half === 1 ? { x: r.ox + r.w - lx, y: r.oy + r.h - ly } : { x: r.ox + lx, y: r.oy + ly };
  };
  window.__agWorldScreen = (half, wx, wy) => { const r = halfRect(half); const cam = half === 0 ? W.cam : W.cam2; const lx = (wx - cam.x) * AGS + r.w / 2, ly = (wy - cam.y) * AGS + r.h / 2; return half === 1 ? { x: r.ox + r.w - lx, y: r.oy + r.h - ly } : { x: r.ox + lx, y: r.oy + ly }; };
  window.__defClick = (x, y) => { defClickWorld(x, y, 0); return { rallyPt: W.def.rallyPt ? { x: Math.round(W.def.rallyPt.x), y: Math.round(W.def.rallyPt.y) } : null, pwr: Math.round(W.def.power), guardsGo: W.guards.filter(g => !g.dead && g.defGo).length, totalGuards: W.guards.filter(g => !g.dead).length }; };
  window.__supplyCount = () => W ? W.items.filter(i => i.kind === 'supply' && !i.got).length : 0;
  window.__defSelState = () => W ? ({ sel: !!W.def.sel, go: !!(W.def.sel && W.def.sel.defGo), pwr: Math.round(W.def.power) }) : null;
  window.__firstGuardWorld = () => { if (!W) return null; const g = W.guards.find(x => !x.dead); return g ? { x: g.x, y: g.y } : null; };
  window.__opCamOf = (half) => { if (!W) return null; const c = half === 0 ? W.opCam : W.opCam2; return { x: c.x, y: c.y, z: c.z }; };
  window.__agentsDbg = () => W ? agentList().map(a => ({ idx: a.idx, x: Math.round(a.x), y: Math.round(a.y), hp: Math.round(a.hp), dead: !!a.dead, downed: !!a.downed })) : null;
  window.__zoom = (z) => { if (W) W.opCam.z = z; };
  window.__mapDbg = () => { if (!roomList) return null; let rack = 0; for (let i = 0; i < base.length; i++) if (base[i] === 2) rack++; return { names: roomList.map(r => r.name), halls: roomList.filter(r => r.role === 'datahall').map(r => r.name), vault: (roomList.find(r => r.role === 'vault') || {}).name, net: (roomList.find(r => r.role === 'network') || {}).name, util: (roomList.find(r => r.role === 'utility') || {}).name, entry: (roomList.find(r => r.role === 'lobby') || {}).name, rackTiles: rack }; };
  window.__wardenHack = () => { if (W) defAction('hack'); };
  window.__win = () => { if (W) endMission(true, 'test exfil'); };
  window.__lose = () => { if (W) endMission(false, 'test down'); };
  window.__guardReroute = () => { if (!W) return false; const g = W.guards.find(x => !x.dead); if (!g) return false; W.def.sel = g; defClickWorld(g.x + 90, g.y + 10, 0); return !!g.target; };
  window.__droneReroute = () => { if (!W) return false; const d = W.drones.find(x => !x.dead); if (!d) return false; W.def.sel = d; defClickWorld(d.x + 80, d.y + 20, 0); return d.defGo ? ('moving to ' + Math.round(d.defGo.x) + ',' + Math.round(d.defGo.y)) : 'no-order'; };
  window.__testGuardOrder = () => { if (!W) return null; const g = W.guards.find(x => !x.dead); if (!g) return null; W.def.sel = g; const tx = g.x + 240, ty = g.y + 120; defClickWorld(tx, ty, 0); W._tg = g; W._dest = { x: tx, y: ty }; return { dist: Math.round(Math.hypot(tx - g.x, ty - g.y)), defGo: !!g.defGo }; };
  window.__testGuardState = () => W && W._tg ? ({ dist: Math.round(Math.hypot(W._dest.x - W._tg.x, W._dest.y - W._tg.y)), state: W._tg.state, holding: !!W._tg.defGo }) : null;
  window.__visCounts = () => { if (!W) return null; const gVis = W.guards.filter(g => !g.dead).length, dVis = W.drones.filter(d => !d.dead).length; return { guards: gVis, drones: dVis, access: W.obj.access }; };
  window.__maintDbg = () => W && W.maintDoorRef ? ({ type: W.maintDoorRef.type, open: W.maintDoorRef.open, agx: Math.round(W.ag.x / T), mx: W.maintDoorRef.tx }) : null;
  window.__castDbg = () => W ? ({ casts: W.ow.casts.map(c => ({ id: c.id, t: +c.t.toFixed(2), dur: c.dur })), scanT: +W.ow.scanT.toFixed(2) }) : null;
  window.__opScan = () => { if (W) owFire('scan', null); };
  window.__opCamHack = () => { if (!W) return 'no-world'; const c = W.cams.find(x => !x.dead && !x.hacked); if (!c) return 'no-cam'; W.ow.bw = 100; startCast('camhack', 'Camera hack', c.x, c.y, CAST.camhack, c); W._tc = c; return { hackedNow: c.hacked }; };
  window.__camHacked = () => W && W._tc ? W._tc.hacked : null;
  window.__defDbg = () => W ? ({ mode: soloMode, power: Math.round(W.def.power), sel: !!W.def.sel, reveal: +(W.def.reveal||0).toFixed(1), cd: W.def.cd, step: W.obj.step, sees: defSeesAgent(), sealed: W.doors.filter(d=>d.sealed).length }) : null;
  window.__allyPos = () => W ? W.allies.map(a => ({ x: Math.round(a.x), y: Math.round(a.y), medic: !!a.medic, moveTo: a.moveTo ? { x: Math.round(a.moveTo.x), y: Math.round(a.moveTo.y) } : null, state: a.state })) : null;
  window.__dbg = () => { if (!W) return null; const ai = W._agAI || {}; return { step: W.obj.step, ax: Math.round(W.ag.x / T), ay: Math.round(W.ag.y / T), pl: ai.path ? ai.path.length : -1, scanT: +W.ow.scanT.toFixed(1), bw: Math.round(W.ow.bw), transport: net.transport, mode: net.mode, diff: difficulty, maxHp: W.ag.maxHp, reqMode: agentReqMode, reqPins: W.reqPins.length, cues: W.cues.length, allies: W.allies.length, medics: W.allies.filter(a=>a.medic).length, downed: !!W.ag.downed, downT: +(W.ag.downT||0).toFixed(1), hp: Math.round(W.ag.hp) }; };
  if (location.hash === '#demo') startSolo('auto');
}
function renderObjective_safe() { try { const no = $('nObj'); } catch (e) {} }
window.addEventListener('resize', () => { resize(); syncFog(); if (W) W.opCam.z = clamp(W.opCam.z, 0.25, 1.6); });
boot();

// ============================================================= mobile / touch UI + two-way commands
let touchFire = false, cmdMoveMode = false, cmdMovePending = 'move';
function isTouch() { return document.body.classList.contains('touch'); }
function markTouch() { if (!document.body.classList.contains('touch')) { document.body.classList.add('touch'); } }
if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) markTouch();
window.addEventListener('touchstart', markTouch, { passive: true });

function bindPress(id, down, up) {
  const el = $(id); if (!el) return;
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (down) down(); }, { passive: false });
  if (up) { el.addEventListener('pointerup', e => { e.preventDefault(); up(); }); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', e => { if (el._held) up(); }); }
}
function wireTouchControls() {
  bindPress('tAct', () => { if (game === 'play' && humanDrivesAgent()) agentInteract(); });
  bindPress('tReload', () => { if (game === 'play' && humanDrivesAgent()) startReload(); });
  bindPress('tFire', () => { touchFire = true; }, () => { touchFire = false; });
  $('tFire').addEventListener('pointerdown', e => $('tFire')._held = true);
  $('tFire').addEventListener('pointerup', e => $('tFire')._held = false);
  bindPress('tCamo', () => { if (game === 'play') { W.ag.cloak = !W.ag.cloak && W.ag.bat > 5; $('tCamo').classList.toggle('on', W.ag.cloak); aToastShow(W.ag.cloak ? 'OPTIC CAMO ON' : 'CAMO OFF'); } });
  bindPress('tAbility', () => useAgentAbility());
  bindPress('nPurge', () => owPurge());
  bindPress('tNv', () => { if (game === 'play') { W.ag.nv = !W.ag.nv; if (W.ag.nv) W.ag.thermal = false; $('tNv').classList.toggle('on', W.ag.nv); $('tTherm').classList.toggle('on', W.ag.thermal); aToastShow(W.ag.nv ? 'NIGHT VISION ON' : 'NIGHT VISION OFF'); } });
  bindPress('tTherm', () => { if (game === 'play') { W.ag.thermal = !W.ag.thermal; if (W.ag.thermal) W.ag.nv = false; $('tTherm').classList.toggle('on', W.ag.thermal); $('tNv').classList.toggle('on', W.ag.nv); aToastShow(W.ag.thermal ? 'THERMAL ON' : 'THERMAL OFF'); } });
  $('aReqGrid').querySelectorAll('button').forEach(b => { b.style.touchAction = 'none'; b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (game === 'play') agentReqDragStart(b.dataset.r, e.clientX, e.clientY); }, { passive: false }); });
  // overwatch command bar
  // plain commands fire on tap
  const cmdSimple = (id, kind) => { const el = $(id); if (!el) return; el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (game !== 'play') return; owCommand(kind); }, { passive: false }); };
  // MOVE / GO are drag-and-drop: hold the button, drag onto the map, release to drop the order there.
  // A plain tap arms tap-to-place (MOVE) or resumes the advance (GO).
  const cmdDragBtn = (id, kind) => {
    const el = $(id); if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); initAudio(); if (game !== 'play') return;
      const sx = e.clientX, sy = e.clientY; let moved = false;
      el.classList.add('arming');
      const mv = ev => { if (Math.hypot((ev.clientX || sx) - sx, (ev.clientY || sy) - sy) > 14) moved = true; };
      const up = ev => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); el.classList.remove('arming');
        const ex = ev.clientX != null ? ev.clientX : sx, ey = ev.clientY != null ? ev.clientY : sy;
        $('cmdMove').classList.remove('on'); $('cmdGo').classList.remove('on');
        if (moved && view === 'op' && W) { const w = screenToOp(ex, ey); owCommand(kind, w.x, w.y); cmdMoveMode = false; nToastShow(kind === 'go' ? 'ADVANCE TO MARK' : 'MOVE ORDER DROPPED'); }
        else if (kind === 'go') { owCommand('go'); }  // plain tap on GO = resume the advance
        else { cmdMoveMode = true; cmdMovePending = kind; el.classList.add('on'); nToastShow('TAP THE MAP TO MOVE'); }
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    }, { passive: false });
  };
  cmdDragBtn('cmdMove', 'move'); cmdDragBtn('cmdGo', 'go'); cmdSimple('cmdHold', 'hold'); cmdSimple('cmdBack', 'back'); cmdSimple('cmdWake', 'wake');
  // versus warden actions
  const defBtn = (id, kind) => { const el = $(id); if (!el) return; el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (game === 'play') defAction(kind); }, { passive: false }); };
  defBtn('dRally', 'rally'); defBtn('dLock', 'lock'); defBtn('dHack', 'hack'); defBtn('dScan', 'scan');
}
// overwatch -> agent commands (work in solo-both, and across the network in co-op)
const CMD_TEXT = { hold: 'Hold position.', go: 'Clear — move up.', back: 'Fall back now!', wake: 'Eyes up — contact near you.', move: 'Move to the marker.' };
function owCommand(kind, wx, wy) {
  if (owOffline()) { nToastShow('CONSOLE OFFLINE'); return; }
  if (net.mode === 'guest') { net.out('cmd', kind, wx == null ? '' : RR(wx), wy == null ? '' : RR(wy)); applyOwCommandLocal(kind, wx, wy, true); return; }
  applyOwCommandLocal(kind, wx, wy, false);
}
function applyOwCommandLocal(kind, wx, wy, echoOnly) {
  if ((kind === 'move' || kind === 'go') && wx != null) { W.waypoint = { x: wx, y: wy, t: 20, order: true }; W.agOrder = { kind: 'move', x: wx, y: wy }; W.agHold = false; }
  else if (kind === 'hold') { W.agHold = true; W.agOrder = null; }
  else if (kind === 'go') { W.agHold = false; W.agOrder = null; }
  else if (kind === 'back') { W.agHold = false; W.agOrder = { kind: 'retreat' }; }
  const txt = CMD_TEXT[kind] || 'Command.';
  // show on overwatch comms
  comms('me', 'Overwatch: ' + txt);
  // show on the agent's HUD (locally if agent is here; the agent client also applies via net event)
  if (!echoOnly) pushAgentMsg(txt);
  if (kind === 'wake') { /* flashes the EYES UP banner on agent */ aBannerFlash('EYES UP', 'warn'); }
}
function aBannerFlash(txt, cls) { const b = $('aBanner'); b.hidden = false; b.className = 'a-banner ' + (cls || ''); b.textContent = txt; clearTimeout(aBannerFlash._t); aBannerFlash._t = setTimeout(() => { b.hidden = true; }, 2200); }

// op map touch gestures: tap=action, drag=pan, pinch=zoom, long-press=waypoint
let opTouch = { pts: {}, tapStart: 0, moved: 0, startC: null, pinchD: 0, pressT: null };
function opTouchStart(e) {
  if (view !== 'op' || !W) return; e.preventDefault(); markTouch();
  for (const t of e.changedTouches) opTouch.pts[t.identifier] = { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY };
  const ids = Object.keys(opTouch.pts);
  if (ids.length === 1) { opTouch.tapStart = now(); opTouch.moved = 0; opTouch.startC = { x: W.opCam.x, y: W.opCam.y }; clearTimeout(opTouch.pressT); opTouch.pressT = setTimeout(() => { const p = opTouch.pts[ids[0]]; if (p && opTouch.moved < 12) { const w = screenToOp(p.x, p.y); owCommand('move', w.x, w.y); opTouch.moved = 999; } }, 480); }
  else if (ids.length === 2) { const a = opTouch.pts[ids[0]], b = opTouch.pts[ids[1]]; opTouch.pinchD = Math.hypot(a.x - b.x, a.y - b.y); opTouch.startC = { x: W.opCam.x, y: W.opCam.y }; }
}
function opTouchMove(e) {
  if (view !== 'op' || !W) return; e.preventDefault();
  for (const t of e.changedTouches) { const p = opTouch.pts[t.identifier]; if (p) { p.x = t.clientX; p.y = t.clientY; } }
  const ids = Object.keys(opTouch.pts);
  if (ids.length === 1) { const p = opTouch.pts[ids[0]]; const dx = p.x - p.x0, dy = p.y - p.y0; opTouch.moved = Math.hypot(dx, dy); if (opTouch.moved > 10) { W.opCam.x = opTouch.startC.x - dx / W.opCam.z; W.opCam.y = opTouch.startC.y - dy / W.opCam.z; } }
  else if (ids.length === 2) { const a = opTouch.pts[ids[0]], b = opTouch.pts[ids[1]]; const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const before = screenToOp(mid.x, mid.y); if (opTouch.pinchD > 0) W.opCam.z = clamp(W.opCam.z * (d / opTouch.pinchD), 0.25, 1.8); opTouch.pinchD = d; const after = screenToOp(mid.x, mid.y); W.opCam.x += before.x - after.x; W.opCam.y += before.y - after.y; }
}
function opTouchEnd(e) {
  if (view !== 'op' || !W) { for (const t of e.changedTouches) delete opTouch.pts[t.identifier]; return; }
  clearTimeout(opTouch.pressT);
  const wasOne = Object.keys(opTouch.pts).length === 1;
  for (const t of e.changedTouches) delete opTouch.pts[t.identifier];
  if (wasOne && now() - opTouch.tapStart < 400 && opTouch.moved < 12) {
    const t = e.changedTouches[0]; const w = screenToOp(t.clientX, t.clientY);
    if (cmdMoveMode) { owCommand(cmdMovePending, w.x, w.y); cmdMoveMode = false; $('cmdMove').classList.remove('on'); $('cmdGo').classList.remove('on'); }
    else if (humanDrivesOp() || humanDrivesDef()) opPointer(t.clientX, t.clientY, 0);
  }
}

})();
