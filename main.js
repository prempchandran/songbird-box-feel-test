// The Songbird Box: hand-interaction feel test.
// Pinch to grab, two-hand pinch to scale, ports that glow and click together, pull apart to undo,
// pin / fixed / rail joints solved on the bench, gears that mesh, and motion trails.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const SNAP_GLOW = 0.05, SNAP_DIST = 0.025, COINCIDE = 0.007;
const PINCH_ON = 0.02, PINCH_OFF = 0.04, PICK_DIST = 0.022;
const BREAK_DIST = 0.1, BREAK_TIME = 0.45;
const ITER = 24, TRAIL_LIFE = 1.6;
const BENCH = { w: 0.60, d0: -0.28, d1: 0.29 };

// ---------- renderer, scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const scene = new THREE.Scene();
const deskBg = new THREE.Color(0x1b2436);
scene.background = deskBg;
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 20);
camera.position.set(0, 1.2, -0.02); camera.lookAt(0, 0.75, -0.43);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3020, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(0.3, 2, 0.6); scene.add(sun);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const std = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...extra });

// ---------- the bench ----------
const bench = new THREE.Group();
bench.position.set(0, 0.75, -0.43);
scene.add(bench);
{
  const d = BENCH.d1 - BENCH.d0;
  const board = new THREE.Mesh(new THREE.BoxGeometry(BENCH.w, 0.006, d), std(0x7d5f42));
  board.position.set(0, -0.003, (BENCH.d0 + BENCH.d1) / 2); bench.add(board);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(BENCH.w - 0.02, 0.0008, 0.12), std(0x8d6c4c));
  tray.position.set(0, 0.0004, 0.225); bench.add(tray);
  const back = new THREE.Mesh(new THREE.BoxGeometry(BENCH.w - 0.02, 0.0008, 0.12), std(0x8d6c4c));
  back.position.set(0, 0.0004, -0.21); bench.add(back);
}
const pegs = [];
for (let i = -5; i <= 5; i++) for (let j = 0; j < 6; j++) pegs.push({ x: i * 0.05, z: -0.125 + j * 0.05 });
{
  const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 10), std(0x1f2c45), pegs.length);
  const m = new THREE.Matrix4();
  pegs.forEach((p, i) => { m.makeTranslation(p.x, 0.002, p.z); im.setMatrixAt(i, m); });
  bench.add(im);
}
const pegGlow = new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 10), new THREE.MeshBasicMaterial({ color: 0x7fc4ff, transparent: true, opacity: 0.7 }));
pegGlow.visible = false; bench.add(pegGlow);

// ---------- parts ----------
const KIND = {
  bar10: { len: 0.10, n: 2, color: 0xc99a68 },
  brace: { len: Math.SQRT2 * 0.10, n: 2, color: 0xe0b98c },
  bar20: { len: 0.20, n: 3, color: 0xb07f4f },
  gearS: { r: 0.025, teeth: 10, color: 0xc99a68 },
  gearL: { r: 0.075, teeth: 30, crank: 0.05, color: 0xb07f4f },
  rail: { len: 0.20, lim: 0.075 },
  slider: {}
};
const parts = [], joints = [];
let nextId = 1, layerCounter = 1;

function gearGeometry(r, n) {
  const s = new THREE.Shape(), ro = r + 0.0035, ri = r - 0.0035;
  for (let k = 0; k < n; k++) {
    const a0 = k / n * TAU;
    [[ri, a0], [ro, a0 + 0.25 / n * TAU], [ro, a0 + 0.5 / n * TAU], [ri, a0 + 0.75 / n * TAU]].forEach(([rr, a], j) => {
      const x = rr * Math.cos(a), y = rr * Math.sin(a);
      if (k === 0 && j === 0) s.moveTo(x, y); else s.lineTo(x, y);
    });
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}
const ringGeo = new THREE.TorusGeometry(0.0065, 0.0017, 8, 20); ringGeo.rotateX(Math.PI / 2);

function makePart(kind, x, z, th = 0) {
  const K = KIND[kind], g = new THREE.Group();
  const P = { id: nextId++, kind, mesh: g, ports: [], rings: [], scale: 1, mode: 'bench', x, z, th, layer: layerCounter++, world: new THREE.Matrix4(), trail: null, trailPts: [] };
  let top = 0.006;
  if (K.len && kind !== 'rail') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(K.len + 0.02, 0.006, 0.018), std(K.color));
    body.position.y = 0.003; g.add(body);
    for (let i = 0; i < K.n; i++) P.ports.push({ x: -K.len / 2 + i * K.len / (K.n - 1), z: 0, type: 'pin' });
    P.half = [K.len / 2 + 0.01, 0.006, 0.009];
    P.m = K.len * 10; P.I = P.m * K.len * K.len / 12 + P.m * 1e-4;
    P.trail = [K.len / 2, 0];
  } else if (K.r) {
    const body = new THREE.Mesh(gearGeometry(K.r, K.teeth), std(K.color)); g.add(body);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.007, 16), std(0x7c5431)); hub.position.y = 0.0035; g.add(hub);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(K.r * 0.75, 0.0012, 0.004), std(0x7c5431)); spoke.position.set(K.r * 0.42, 0.0066, 0); g.add(spoke);
    P.ports.push({ x: 0, z: 0, type: 'pin' });
    if (K.crank) P.ports.push({ x: K.crank, z: 0, type: 'pin' });
    P.half = [K.r + 0.004, 0.006, K.r + 0.004];
    P.r = K.r; P.m = K.r * 20; P.I = 0.5 * P.m * K.r * K.r;
    P.trail = [K.crank || K.r * 0.7, 0];
  } else if (kind === 'rail') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(K.len + 0.02, 0.006, 0.03), std(0xe8dcc3)); body.position.y = 0.003; g.add(body);
    P.slot = new THREE.Mesh(new THREE.BoxGeometry(K.len - 0.02, 0.0012, 0.006), new THREE.MeshStandardMaterial({ color: 0x3b2a1a, emissive: 0x000000 }));
    P.slot.position.y = 0.0066; g.add(P.slot);
    P.ports.push({ x: -K.len / 2, z: 0, type: 'pin' }, { x: K.len / 2, z: 0, type: 'pin' });
    P.half = [K.len / 2 + 0.01, 0.006, 0.015];
    P.m = 2; P.I = 2 * K.len * K.len / 12;
    P.lim = K.lim;
  } else if (kind === 'slider') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.03), std(0xf0a03c)); body.position.y = 0.006; g.add(body);
    top = 0.012;
    P.ports.push({ x: 0, z: 0, type: 'pin' }, { x: 0, z: 0, type: 'rail' });
    P.half = [0.015, 0.012, 0.015];
    P.m = 0.3; P.I = 0.3 * 3e-4;
    P.trail = [0, 0];
  }
  P.top = top;
  P.ports.forEach(pt => {
    if (pt.type !== 'pin') { P.rings.push(null); return; }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x2a8fd6 }));
    ring.position.set(pt.x, top + 0.0009, pt.z); g.add(ring); P.rings.push(ring);
  });
  g.matrixAutoUpdate = false;
  scene.add(g);
  parts.push(P);
  return P;
}

// ---------- poses ----------
const rot = (x, z, th) => { const c = Math.cos(th), s = Math.sin(th); return [x * c - z * s, x * s + z * c]; };
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
let benchRank = new Map(), benchY = new Map();
function layerY(P) { return benchY.get(P) ?? 0.0005; }
const radiusOf = P => Math.max(P.half[0], P.half[2]) * P.scale;
// parts lie on the bench; a part sits on top of any earlier-placed part it overlaps
function stackParts() {
  const list = parts.filter(P => P.mode === 'bench').sort((a, b) => a.layer - b.layer);
  benchRank = new Map(list.map((P, k) => [P, k]));
  benchY = new Map();
  for (let k = 0; k < list.length; k++) {
    const P = list[k]; let y = 0.0005;
    for (let m = 0; m < k; m++) { const Q = list[m]; if (Math.hypot(P.x - Q.x, P.z - Q.z) < radiusOf(P) + radiusOf(Q) - 0.004) y = Math.max(y, benchY.get(Q) + Q.top + 0.0006); }
    benchY.set(P, y);
  }
}
function worldMatrix(P, out = new THREE.Matrix4()) {
  if (P.mode === 'free') return out.copy(P.world);
  _q.setFromAxisAngle(UP, -P.th);
  _m.compose(_v.set(P.x, layerY(P), P.z), _q, _s.set(P.scale, P.scale, P.scale));
  bench.updateMatrixWorld();
  return out.multiplyMatrices(bench.matrixWorld, _m);
}
function portWorld(P, i, out = new THREE.Vector3()) {
  const pt = P.ports[i];
  return out.set(pt.x, 0, pt.z).applyMatrix4(worldMatrix(P));
}
function portBench(P, i) { const pt = P.ports[i]; const [rx, rz] = rot(pt.x * P.scale, pt.z * P.scale, P.th); return [P.x + rx, P.z + rz]; }
function benchLocal(v) { bench.updateMatrixWorld(); return bench.worldToLocal(v.clone()); }
function benchWorld(x, y, z) { bench.updateMatrixWorld(); return bench.localToWorld(new THREE.Vector3(x, y, z)); }

// ---------- joints and assemblies ----------
function jointed(P, i, Q, j) { return joints.some(J => J.b && ((J.a === P && J.ai === i && J.b === Q && J.bi === j) || (J.a === Q && J.ai === j && J.b === P && J.bi === i))); }
function assemblyOf(P) {
  const seen = new Set([P]), st = [P];
  while (st.length) { const X = st.pop(); for (const J of joints) { if (!J.b) continue; const Y = J.a === X ? J.b : J.b === X ? J.a : null; if (Y && !seen.has(Y)) { seen.add(Y); st.push(Y); } } }
  return [...seen];
}
const hasPeg = A => joints.some(J => J.peg != null && A.includes(J.a));
const isLoose = P => !joints.some(J => J.a === P || J.b === P);
const markerGeo = new THREE.BoxGeometry(0.011, 0.0022, 0.011);
function addJoint(J) {
  joints.push(J);
  if (J.type === 'fixed') makeMarker(J);
  return J;
}
function makeMarker(J) { J.marker = new THREE.Mesh(markerGeo, std(0x1f2c45)); scene.add(J.marker); }
function removeJoint(J) { const k = joints.indexOf(J); if (k >= 0) joints.splice(k, 1); if (J.marker) { scene.remove(J.marker); J.marker = null; } }
function detachPart(P) { let n = 0; for (const J of [...joints]) if (J.a === P || J.b === P) { removeJoint(J); n++; } if (n) { sound('pop'); detachCount++; } return n; }

function toFree(A) {
  for (const P of A) { if (P.mode === 'bench') { worldMatrix(P, P.world); P.mode = 'free'; } }
  let popped = 0;
  for (const J of [...joints]) if (J.peg != null && A.includes(J.a)) { removeJoint(J); popped++; }
  if (popped) sound('pop');
}
function toBench(A) {
  bench.updateMatrixWorld();
  const bq = bench.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const P of A) {
    if (P.mode !== 'free') continue;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    P.world.decompose(pos, q, s);
    const l = benchLocal(pos), ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q).applyQuaternion(bq);
    P.x = l.x; P.z = l.z; P.th = Math.atan2(ax.z, ax.x); P.mode = 'bench'; P.layer = layerCounter++;
  }
}
function nearBench(P) {
  const l = benchLocal(new THREE.Vector3().setFromMatrixPosition(P.world));
  return l.y < 0.08 && Math.abs(l.x) < BENCH.w / 2 + 0.05 && l.z > BENCH.d0 - 0.05 && l.z < BENCH.d1 + 0.05;
}

// ---------- snapping ----------
function railOf(S) { return joints.find(J => J.type === 'rail' && J.a === S); }
function findCandidates(A, maxD) {
  const out = [], inA = new Set(A), pw = new THREE.Vector3(), qw = new THREE.Vector3();
  for (const P of A) P.ports.forEach((pt, i) => {
    portWorld(P, i, pw);
    if (pt.type === 'pin') {
      for (const Q of parts) {
        if (Q === P) continue;
        const same = inA.has(Q);
        if (same && (P.mode !== 'bench' || Q.mode !== 'bench')) continue;
        if (same && joints.some(J => (J.a === P && J.b === Q) || (J.a === Q && J.b === P))) continue;
        Q.ports.forEach((qt, j) => {
          if (qt.type !== 'pin' || jointed(P, i, Q, j)) return;
          let d;
          if (P.mode === 'bench' && Q.mode === 'bench') { const [ax, az] = portBench(P, i), [bx, bz] = portBench(Q, j); d = Math.hypot(ax - bx, az - bz); }
          else d = pw.distanceTo(portWorld(Q, j, qw));
          if (d < maxD) out.push({ kind: 'port', P, i, Q, j, d, same });
        });
      }
      const l = benchLocal(pw);
      if (!hasPeg(A) && Math.abs(l.y) < 0.1) pegs.forEach((g, k) => {
        const d = Math.hypot(l.x - g.x, l.z - g.z) + (P.mode === 'free' ? Math.abs(l.y) * 0.3 : 0) + 0.004;
        if (d < maxD) out.push({ kind: 'peg', P, i, peg: k, d });
      });
    } else if (pt.type === 'rail' && !railOf(P)) {
      for (const R of parts) {
        if (R.kind !== 'rail' || inA.has(R) || R.mode !== 'bench') continue;
        const l = benchLocal(pw), rel = [l.x - R.x, l.z - R.z], [dx, dz] = rot(1, 0, R.th);
        const t = rel[0] * dx + rel[1] * dz;
        if (Math.abs(t) > R.lim + 0.01) continue;
        const d = Math.hypot(rel[0] - t * dx, rel[1] - t * dz) + (P.mode === 'free' ? Math.abs(l.y) * 0.3 : 0);
        if (d < maxD) out.push({ kind: 'rail', P, i, R, t, d });
      }
    }
  });
  out.sort((a, b) => a.d - b.d);
  return out;
}
function translateAssembly(A, dx, dz) { for (const P of A) { P.x += dx; P.z += dz; } }
function rotateAssembly(A, cx, cz, dth) { for (const P of A) { const [rx, rz] = rot(P.x - cx, P.z - cz, dth); P.x = cx + rx; P.z = cz + rz; P.th += dth; } }

function trySnap(A) {
  let cands = findCandidates(A, SNAP_DIST);
  if (!cands.length) return false;
  // a loose, scaled part goes back to page size before it connects
  if (A.length === 1 && A[0].scale !== 1) { A[0].scale = 1; if (A[0].mode === 'free') { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); A[0].world.decompose(p, q, s); A[0].world.compose(p, q, new THREE.Vector3(1, 1, 1)); } cands = findCandidates(A, SNAP_DIST * 1.6); if (!cands.length) return false; }
  const c = cands[0];
  if (c.kind === 'port' && A[0].mode === 'free' && c.Q.mode === 'bench') { toBench(A); }
  if (c.kind !== 'port' && A[0].mode === 'free') toBench(A);
  if (c.kind === 'port' && A[0].mode === 'free' && c.Q.mode === 'free') {
    // in the air: align the ports' up directions, then bring the ports together
    const qa = new THREE.Quaternion().setFromRotationMatrix(c.P.world), qb = new THREE.Quaternion().setFromRotationMatrix(c.Q.world);
    const ua = UP.clone().applyQuaternion(qa), ub = UP.clone().applyQuaternion(qb);
    const align = new THREE.Quaternion().setFromUnitVectors(ua, ub);
    const pa = portWorld(c.P, c.i), pb = portWorld(c.Q, c.j);
    const R = new THREE.Matrix4().makeTranslation(pb.x, pb.y, pb.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(align)).multiply(new THREE.Matrix4().makeTranslation(-pa.x, -pa.y, -pa.z));
    for (const P of A) P.world.premultiply(R);
    addJoint({ type: 'pin', a: c.P, ai: c.i, b: c.Q, bi: c.j });
    sound('click');
    return true;
  }
  if (c.kind === 'port') {
    const anchored = hasPeg(A);
    if (!c.same && !anchored) { const [ax, az] = portBench(c.P, c.i), [bx, bz] = portBench(c.Q, c.j); translateAssembly(A, bx - ax, bz - az); }
    addJoint({ type: 'pin', a: c.P, ai: c.i, b: c.Q, bi: c.j });
  } else if (c.kind === 'peg') {
    const g = pegs[c.peg];
    if (!hasPeg(A)) { const [ax, az] = portBench(c.P, c.i); translateAssembly(A, g.x - ax, g.z - az); }
    addJoint({ type: 'peg', a: c.P, ai: c.i, peg: c.peg });
    if (!c.P.r) c.P.ports.forEach((pt, i) => { if (i === c.i || pt.type !== 'pin') return; const [x, z] = portBench(c.P, i); const k = pegs.findIndex(q => Math.hypot(q.x - x, q.z - z) < COINCIDE); if (k >= 0) addJoint({ type: 'peg', a: c.P, ai: i, peg: k }); });
  } else if (c.kind === 'rail') {
    const S = c.P, R = c.R;
    let d = R.th - S.th; d = Math.atan2(Math.sin(d), Math.cos(d));
    const th0 = Math.abs(d) <= Math.PI / 2 ? 0 : Math.PI;
    const target = R.th - th0;
    if (!hasPeg(A)) {
      rotateAssembly(A, S.x, S.z, target - S.th);
      const t = Math.max(-R.lim, Math.min(R.lim, c.t)), [dx, dz] = rot(1, 0, R.th);
      translateAssembly(A, R.x + dx * t - S.x, R.z + dz * t - S.z);
    }
    addJoint({ type: 'rail', a: S, ai: c.i, b: R, th0: th0 === 0 ? 0 : Math.PI });
  }
  sound('click');
  // the part just placed may close a loop with its other ports: join them if they're within reach
  if (c.P.mode === 'bench') c.P.ports.forEach((pt, i) => {
    if (i === c.i || pt.type !== 'pin') return;
    const [ax, az] = portBench(c.P, i);
    let best = null, bd = SNAP_DIST;
    for (const Q of parts) {
      if (Q === c.P || Q.mode !== 'bench' || joints.some(J => (J.a === c.P && J.b === Q) || (J.a === Q && J.b === c.P))) continue;
      Q.ports.forEach((qt, j) => { if (qt.type !== 'pin') return; const [bx, bz] = portBench(Q, j), d = Math.hypot(ax - bx, az - bz); if (d < bd) { bd = d; best = [Q, j]; } });
    }
    if (best) addJoint({ type: 'pin', a: c.P, ai: i, b: best[0], bi: best[1] });
  });
  addCoincident(assemblyOf(c.P));
  return true;
}
function addCoincident(A) {
  if (A[0].mode !== 'bench') return;
  for (const P of A) P.ports.forEach((pt, i) => {
    if (pt.type !== 'pin') return;
    const [ax, az] = portBench(P, i);
    for (const Q of parts) {
      if (Q === P || Q.mode !== 'bench' || Q.id < P.id && A.includes(Q)) continue;
      Q.ports.forEach((qt, j) => {
        if (qt.type !== 'pin' || jointed(P, i, Q, j)) return;
        const [bx, bz] = portBench(Q, j);
        if (Math.hypot(ax - bx, az - bz) < COINCIDE) addJoint({ type: 'pin', a: P, ai: i, b: Q, bi: j });
      });
    }
  });
}

// ---------- the bench solver (2D position-based) ----------
const drags = [];
let gearPairs = new Map();
function wpt(P, lx, lz) { const [rx, rz] = rot(lx, lz, P.th); return [P.x + rx, P.z + rz, rx, rz]; }
function pointC(A, la, B, lb, tx, tz, k = 1) {
  const a = wpt(A, la[0], la[1]);
  let bx = tx, bz = tz, rbx = 0, rbz = 0;
  if (B) { const b = wpt(B, lb[0], lb[1]); bx = b[0]; bz = b[1]; rbx = b[2]; rbz = b[3]; }
  const dx = a[0] - bx, dz = a[1] - bz, c = Math.hypot(dx, dz);
  if (c < 1e-8) return;
  const nx = dx / c, nz = dz / c, ca = a[2] * nz - a[3] * nx;
  let w = 1 / A.m + ca * ca / A.I, cb = 0;
  if (B) { cb = rbx * nz - rbz * nx; w += 1 / B.m + cb * cb / B.I; }
  const lam = -c / w * k, px = lam * nx, pz = lam * nz;
  A.x += px / A.m; A.z += pz / A.m; A.th += (a[2] * pz - a[3] * px) / A.I;
  if (B) { B.x -= px / B.m; B.z -= pz / B.m; B.th -= (rbx * pz - rbz * px) / B.I; }
}
function angleC(A, B, th0) {
  let c = A.th - B.th - th0; c = Math.atan2(Math.sin(c), Math.cos(c));
  const lam = -c / (1 / A.I + 1 / B.I);
  A.th += lam / A.I; B.th -= lam / B.I;
}
function railC(S, R, th0) {
  const [dx, dz] = rot(1, 0, R.th), nx = -dz, nz = dx;
  const rel = [S.x - R.x, S.z - R.z];
  const along = (cdir, cval, ux, uz) => {
    const cr = rel[0] * uz - rel[1] * ux, w = 1 / S.m + 1 / R.m + cr * cr / R.I, lam = -cval / w;
    S.x += lam * ux / S.m; S.z += lam * uz / S.m;
    R.x -= lam * ux / R.m; R.z -= lam * uz / R.m; R.th -= lam * cr / R.I;
  };
  along(0, rel[0] * nx + rel[1] * nz, nx, nz);
  const t = rel[0] * dx + rel[1] * dz;
  if (Math.abs(t) > R.lim) along(1, t - Math.sign(t) * R.lim, dx, dz);
  angleC(S, R, th0);
}
function updateGearCouplings() {
  const centered = parts.filter(P => P.r && P.mode === 'bench' && joints.some(J => J.peg != null && J.a === P && J.ai === 0));
  const live = new Map();
  for (let a = 0; a < centered.length; a++) for (let b = a + 1; b < centered.length; b++) {
    const A = centered[a], B = centered[b], d = Math.hypot(A.x - B.x, A.z - B.z);
    if (Math.abs(d - (A.r + B.r)) < 0.006) {
      const key = A.id + '-' + B.id;
      live.set(key, gearPairs.get(key) || { A, B, C: A.r * A.th + B.r * B.th });
    }
  }
  gearPairs = live;
}
function gearC({ A, B, C }) {
  const c = A.r * A.th + B.r * B.th - C, w = A.r * A.r / A.I + B.r * B.r / B.I, lam = -c / w;
  A.th += lam * A.r / A.I; B.th += lam * B.r / B.I;
}
function solve() {
  updateGearCouplings();
  // the hand pulls once per frame; the joints then get the last word
  for (const d of drags) pointC(d.P, d.local, null, null, d.tx, d.tz, 0.6);
  for (let it = 0; it < ITER; it++) {
    for (const J of joints) {
      if (J.a.mode !== 'bench' || (J.b && J.b.mode !== 'bench')) continue;
      if (J.type === 'peg') { const g = pegs[J.peg], pt = J.a.ports[J.ai]; pointC(J.a, [pt.x * J.a.scale, pt.z * J.a.scale], null, null, g.x, g.z); }
      else if (J.type === 'rail') railC(J.a, J.b, J.th0);
      else {
        const pa = J.a.ports[J.ai], pb = J.b.ports[J.bi];
        pointC(J.a, [pa.x * J.a.scale, pa.z * J.a.scale], J.b, [pb.x * J.b.scale, pb.z * J.b.scale]);
        if (J.type === 'fixed') angleC(J.a, J.b, J.th0);
      }
    }
    for (const g of gearPairs.values()) gearC(g);
  }
}

// ---------- hands ----------
const hands = [0, 1].map(i => ({ i, name: i ? 'right' : 'left', tracked: false, pinch: false, wasPinch: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tip: new THREE.Vector3(), tipPrev: new THREE.Vector3(), grab: null, test: false, xr: null }));
const handMatrix = h => new THREE.Matrix4().compose(h.pos, h.quat, new THREE.Vector3(1, 1, 1));

function pickPart(p) {
  let best = null, bd = PICK_DIST;
  const inv = new THREE.Matrix4(), q = new THREE.Vector3();
  for (const P of parts) {
    const W = worldMatrix(P);
    q.copy(p).applyMatrix4(inv.copy(W).invert());
    const hx = P.half[0], hy = P.half[1], hz = P.half[2];
    const cx = Math.max(-hx, Math.min(hx, q.x)), cy = Math.max(0, Math.min(hy, q.y)), cz = Math.max(-hz, Math.min(hz, q.z));
    const d = Math.hypot(q.x - cx, q.y - cy, q.z - cz) * P.scale - (P.mode === 'bench' ? (benchRank.get(P) || 0) * 0.0004 : 0);
    if (d < bd) { bd = d; best = P; }
  }
  return best;
}
function relsFor(A, h) { const inv = handMatrix(h).invert(), rels = new Map(); for (const P of A) rels.set(P, new THREE.Matrix4().multiplyMatrices(inv, P.world)); return rels; }
function startFreeGrab(h, P) { const A = assemblyOf(P); toFree(A); h.grab = { P, mode: 'free', rels: relsFor(A, h) }; }

function onPinchStart(h) {
  if (calibrating) { calibrate(h.pos); return; }
  const P = pickPart(h.pos);
  if (!P) return;
  sound('tick');
  const o = hands[1 - h.i];
  if (o.grab && o.grab.P === P && isLoose(P)) {
    if (P.mode === 'bench') toFree([P]);
    const pos = new THREE.Vector3().setFromMatrixPosition(P.world);
    scaleState = { P, d0: h.pos.distanceTo(o.pos), s0: P.scale, mid0: h.pos.clone().add(o.pos).multiplyScalar(0.5), off: null, rotM: new THREE.Matrix4().extractRotation(P.world) };
    scaleState.off = pos.sub(scaleState.mid0);
    h.grab = { P, mode: 'scale' }; o.grab = { P, mode: 'scale' };
    return;
  }
  const A = assemblyOf(P);
  if (o.grab && o.grab.mode === 'free' && o.grab.rels.has(P)) {
    h.grab = { P, mode: 'pullapart', d0: h.pos.distanceTo(o.pos) };
    return;
  }
  P.layer = layerCounter++;
  if (P.mode === 'bench') {
    const l = benchLocal(h.pos);
    h.grab = { P, mode: 'bench', local: rot(l.x - P.x, l.z - P.z, -P.th), stretch: 0 };
  } else startFreeGrab(h, P);
}
function onPinchEnd(h) {
  const g = h.grab; h.grab = null;
  if (!g) return;
  const o = hands[1 - h.i];
  if (g.mode === 'scale') {
    scaleState = null;
    if (o.grab && o.grab.mode === 'scale') { startFreeGrab(o, g.P); }
    return;
  }
  if (g.mode === 'pullapart') return;
  const A = assemblyOf(g.P);
  if (o.grab && A.includes(o.grab.P)) return; // the other hand is still holding this assembly
  if (g.mode === 'free' && nearBench(g.P)) toBench(A);
  trySnap(A);
}
let scaleState = null;
function onHandMove(h, dt) {
  const g = h.grab;
  if (!g) return;
  const o = hands[1 - h.i];
  if (g.mode === 'free') {
    const M = handMatrix(h);
    for (const [P, rel] of g.rels) if (P.mode === 'free') P.world.multiplyMatrices(M, rel);
  } else if (g.mode === 'bench') {
    const l = benchLocal(h.pos), A = assemblyOf(g.P);
    const liftH = hasPeg(A) ? 0.13 : 0.09;
    if (l.y > liftH && !(o.grab && o.grab.mode === 'bench' && A.includes(o.grab.P))) {
      // lift: the assembly jumps up into your fingers, keeping the pinched spot under them
      const [gx, gz] = wpt(g.P, g.local[0], g.local[1]), gw = benchWorld(gx, layerY(g.P) + g.P.top * 0.5, gz);
      toFree(A);
      const T = new THREE.Matrix4().makeTranslation(h.pos.x - gw.x, h.pos.y - gw.y, h.pos.z - gw.z);
      for (const P of A) P.world.premultiply(T);
      h.grab = { P: g.P, mode: 'free', rels: relsFor(A, h) };
      return;
    }
    drags.push({ P: g.P, local: g.local, tx: l.x, tz: l.z, h });
  } else if (g.mode === 'scale' && h.i === 0 && scaleState) {
    const s = scaleState, d = h.pos.distanceTo(o.pos), k = Math.max(0.5, Math.min(3, s.s0 * d / s.d0));
    const mid = h.pos.clone().add(o.pos).multiplyScalar(0.5), pos = mid.add(s.off.clone().multiplyScalar(k / s.s0));
    s.P.scale = k;
    s.P.world.copy(s.rotM).scale(new THREE.Vector3(k, k, k)).setPosition(pos);
  } else if (g.mode === 'pullapart') {
    if (h.pos.distanceTo(o.pos) - g.d0 > 0.05) {
      detachPart(g.P);
      if (o.grab && o.grab.mode === 'free') o.grab.rels.delete(g.P);
      if (o.grab && o.grab.P === g.P) { o.grab = null; }
      startFreeGrab(h, g.P);
    }
  }
}
function checkBreaks(dt) {
  for (const d of drags) {
    const g = d.h.grab; if (!g || g.mode !== 'bench') continue;
    const [wx, wz] = wpt(d.P, d.local[0], d.local[1]);
    const far = Math.hypot(wx - d.tx, wz - d.tz) > BREAK_DIST;
    g.stretch = far ? g.stretch + dt : 0;
    if (g.stretch > BREAK_TIME && !isLoose(d.P)) {
      detachPart(d.P); g.stretch = 0;
      d.P.x += d.tx - wx; d.P.z += d.tz - wz;
    }
  }
}

// ---------- poke: toggle pin <-> fixed, and the bench buttons ----------
let pokeCooldown = 0;
function jointPos(J) { return J.peg != null ? null : portWorld(J.a, J.ai); }
function poke(tip) {
  if (pokeCooldown > 0) return false;
  for (const btn of buttons) { const w = btn.mesh.getWorldPosition(new THREE.Vector3()); if (btn.mesh.visible && tip.distanceTo(w) < 0.022) { btn.fn(); pokeCooldown = 1; sound('click'); return true; } }
  for (const J of joints) {
    if (J.type !== 'pin' && J.type !== 'fixed') continue;
    const p = jointPos(J); if (!p) continue;
    const top = p.clone().add(UP.clone().multiplyScalar(0.008));
    if (tip.distanceTo(top) < 0.012) {
      if (J.type === 'pin') { J.type = 'fixed'; J.th0 = J.a.th - J.b.th; makeMarker(J); }
      else { J.type = 'pin'; scene.remove(J.marker); J.marker = null; }
      pokeCooldown = 0.8; sound('click'); return true;
    }
  }
  return false;
}

// ---------- sound ----------
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); }
function sound(kind) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  if (kind === 'chime') { [880, 1320].forEach((f, k) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = t + k * 0.11; o.type = 'sine'; o.frequency.setValueAtTime(f, t0); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5); o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.55); }); return; }
  const spec = { click: [1500, 900, 0.05, 0.25], pop: [420, 160, 0.12, 0.3], tick: [2200, 2000, 0.02, 0.06] }[kind];
  o.frequency.setValueAtTime(spec[0], t); o.frequency.exponentialRampToValueAtTime(spec[1], t + spec[2]);
  g.gain.setValueAtTime(spec[3], t); g.gain.exponentialRampToValueAtTime(0.001, t + spec[2] + 0.04);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + spec[2] + 0.05);
}

// ---------- calibration, buttons, panel ----------
let calibrating = false;
function textTexture(lines, w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = 'rgba(31,44,69,0.92)'; x.beginPath(); x.roundRect(0, 0, w, h, 40); x.fill();
  x.fillStyle = '#f6efdf'; x.font = '600 56px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 70));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.08), new THREE.MeshBasicMaterial({ map: textTexture(['Pinch on your table', 'to place the bench']), transparent: true }));
panel.visible = false; scene.add(panel);
function calibrate(p) {
  const xrCam = renderer.xr.getCamera();
  const head = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(xrCam.matrixWorld)); f.y = 0; f.normalize();
  bench.position.set(head.x + f.x * 0.42, p.y - 0.012, head.z + f.z * 0.42);
  bench.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
  calibrating = false; panel.visible = false; setBenchVisible(true); sound('click');
}
function setBenchVisible(v) { bench.visible = v; for (const P of parts) P.mesh.visible = v; }
const buttons = [];
function makeButton(label, x, z, fn) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 24), [std(0xf0a03c), new THREE.MeshBasicMaterial({ map: textTexture([label], 256, 256) }), std(0xf0a03c)]);
  m.position.set(x, 0.012, z); bench.add(m); buttons.push({ mesh: m, fn });
}
makeButton('reset', 0.34, 0.24, () => resetParts());
makeButton('move', 0.34, 0.18, () => { calibrating = true; panel.visible = true; setBenchVisible(false); });

// ---------- trails ----------
const TRAIL_MAX = 1600;
const trailMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf0a03c, transparent: true, opacity: 0.85 }), TRAIL_MAX);
trailMesh.frustumCulled = false; scene.add(trailMesh);
let clock = 0;
function updateTrails() {
  let n = 0; const m = new THREE.Matrix4();
  for (const P of parts) {
    if (!P.trail || P.mode !== 'bench') { P.trailPts.length = 0; continue; }
    const W = worldMatrix(P), p = new THREE.Vector3(P.trail[0], P.top + 0.002, P.trail[1]).applyMatrix4(W);
    const last = P.trailPts[P.trailPts.length - 1];
    if (!last || last.p.distanceTo(p) > 0.0015) P.trailPts.push({ p, t: clock });
    while (P.trailPts.length && clock - P.trailPts[0].t > TRAIL_LIFE) P.trailPts.shift();
    if (P.trailPts.length < 4) continue;
    for (const q of P.trailPts) {
      if (n >= TRAIL_MAX) break;
      const k = 1 - (clock - q.t) / TRAIL_LIFE, r = 0.0008 + 0.0026 * k;
      m.compose(q.p, _q.identity(), _s.set(r, r, r)); trailMesh.setMatrixAt(n++, m);
    }
  }
  trailMesh.count = n; trailMesh.instanceMatrix.needsUpdate = true;
}

// ---------- visuals per frame ----------
const handJoints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xdfe9f7, transparent: true, opacity: 0.55 }), 60);
handJoints.frustumCulled = false; handJoints.count = 0; scene.add(handJoints);
const pinchRings = hands.map(() => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0015, 8, 24), new THREE.MeshBasicMaterial({ color: 0xf0a03c, transparent: true })); r.visible = false; scene.add(r); return r; });
function updateVisuals() {
  for (const P of parts) { worldMatrix(P, P.mesh.matrix); P.mesh.matrixWorldNeedsUpdate = true; }
  // ports: connected ports look like navy bolts; glowing ones are near a match
  const connected = new Set();
  for (const J of joints) { connected.add(J.a.id + ':' + J.ai); if (J.b) connected.add(J.b.id + ':' + J.bi); }
  for (const P of parts) P.rings.forEach((r, i) => { if (!r) return; r.material.color.setHex(connected.has(P.id + ':' + i) ? 0x1f2c45 : 0x2a8fd6); r.scale.setScalar(1); });
  for (const P of parts) if (P.slot) P.slot.material.emissive.setHex(0x000000);
  pegGlow.visible = false;
  const held = new Set(); for (const h of hands) if (h.grab && h.grab.mode !== 'pullapart') held.add(assemblyOf(h.grab.P)[0]);
  for (const h of hands) {
    if (!h.grab || h.grab.mode === 'pullapart') continue;
    const cands = findCandidates(assemblyOf(h.grab.P), SNAP_GLOW).slice(0, 3);
    for (const c of cands) {
      const strong = c.d < SNAP_DIST, col = strong ? 0xe6f6ff : 0x7fc4ff, sc = strong ? 1.8 : 1.35;
      if (c.P.rings[c.i]) { c.P.rings[c.i].material.color.setHex(col); c.P.rings[c.i].scale.setScalar(sc); }
      if (c.kind === 'port' && c.Q.rings[c.j]) { c.Q.rings[c.j].material.color.setHex(col); c.Q.rings[c.j].scale.setScalar(sc); }
      if (c.kind === 'peg' && !pegGlow.visible) { pegGlow.visible = true; pegGlow.position.set(pegs[c.peg].x, 0.004, pegs[c.peg].z); pegGlow.scale.setScalar(strong ? 1.2 : 0.8); }
      if (c.kind === 'rail') c.R.slot.material.emissive.setHex(strong ? 0x2a8fd6 : 0x154870);
    }
  }
  for (const J of joints) if (J.marker) { const p = portWorld(J.a, J.ai); J.marker.position.copy(p).add(UP.clone().multiplyScalar(J.a.top + 0.004)); J.marker.quaternion.copy(bench.quaternion); }
  // hands
  let n = 0; const m = new THREE.Matrix4();
  for (const h of hands) {
    const ring = pinchRings[h.i];
    ring.visible = h.tracked && renderer.xr.isPresenting;
    if (ring.visible) { ring.position.copy(h.pos); ring.quaternion.copy(h.quat); ring.material.color.setHex(h.pinch ? 0xf0a03c : (pickPart(h.pos) ? 0x7fc4ff : 0xdfe9f7)); ring.material.opacity = h.pinch ? 1 : 0.6; }
    if (!h.xr || !h.tracked) continue;
    for (const name in h.xr.joints) { const j = h.xr.joints[name]; if (!j.visible || n >= 60) continue; const r = (j.jointRadius || 0.008) * 0.8; m.compose(j.getWorldPosition(_v), _q.identity(), _s.set(r, r, r)); handJoints.setMatrixAt(n++, m); }
  }
  handJoints.count = n; handJoints.instanceMatrix.needsUpdate = true;
  if (calibrating) {
    const xrCam = renderer.xr.getCamera(), head = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(xrCam.matrixWorld));
    panel.position.copy(head).add(f.multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.12, 0)); panel.lookAt(head);
  }
}

// ---------- input: XR hands ----------
for (let i = 0; i < 2; i++) {
  const hg = renderer.xr.getHand(i); scene.add(hg);
  hg.addEventListener('connected', e => { const h = hands[e.data.handedness === 'left' ? 0 : 1]; h.xr = hg; hg.userData.h = h; });
  hg.addEventListener('disconnected', () => { const h = hg.userData.h; if (h) { h.tracked = false; if (h.pinch) { h.pinch = false; } h.xr = null; } });
}
function readXRHands() {
  for (const h of hands) {
    if (h.test || !h.xr) continue;
    const it = h.xr.joints['index-finger-tip'], th = h.xr.joints['thumb-tip'], wr = h.xr.joints['wrist'];
    h.tracked = !!(it && th && wr && it.visible && th.visible);
    if (!h.tracked) { h.pinch = false; continue; }
    const a = it.getWorldPosition(new THREE.Vector3()), b = th.getWorldPosition(new THREE.Vector3());
    const d = a.distanceTo(b);
    h.pinch = h.pinch ? d < PINCH_OFF : d < PINCH_ON;
    h.pos.copy(a).add(b).multiplyScalar(0.5);
    wr.getWorldQuaternion(h.quat);
    h.tipPrev.copy(h.tip); h.tip.copy(a);
  }
}

// ---------- input: desktop mouse (drives the right hand) ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let shift = false, mouseDown = false, lastMouse = null;
addEventListener('keydown', e => { if (e.key === 'Shift') shift = true; });
addEventListener('keyup', e => { if (e.key === 'Shift') shift = false; });
function mouseToHand(e) {
  const h = hands[1]; if (h.test || renderer.xr.isPresenting) return;
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  bench.updateMatrixWorld();
  const y = shift ? 0.15 : 0.008, n = UP.clone().applyQuaternion(bench.quaternion);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, benchWorld(0, y, 0));
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(plane, hit)) { h.pos.copy(hit); h.quat.copy(bench.quaternion); h.tracked = true; }
}
canvas.addEventListener('pointerdown', e => { audio(); mouseToHand(e); mouseDown = true; hands[1].pinch = true; lastMouse = e; });
addEventListener('pointermove', e => { lastMouse = e; mouseToHand(e); });
addEventListener('pointerup', () => { mouseDown = false; if (!hands[1].test) hands[1].pinch = false; });
canvas.addEventListener('wheel', e => { const P = pickPart(hands[1].pos); if (P && isLoose(P) && P.mode === 'bench') { P.scale = Math.max(0.5, Math.min(3, P.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); } e.preventDefault(); }, { passive: false });
canvas.addEventListener('dblclick', () => { const tip = hands[1].pos.clone(); pokeCooldown = 0; for (const J of joints) { const p = jointPos(J); if (p && p.distanceTo(tip) < 0.02) { poke(p.clone().add(UP.clone().multiplyScalar(0.008))); break; } } });

// ---------- parts layout ----------
function resetParts() {
  for (const J of [...joints]) removeJoint(J);
  for (const P of parts) scene.remove(P.mesh);
  parts.length = 0; gearPairs = new Map();
  for (const h of hands) h.grab = null;
  [-0.25, -0.13, -0.01, 0.11].forEach(x => makePart('bar10', x, 0.20));
  makePart('slider', 0.235, 0.20);
  makePart('brace', -0.17, 0.255);
  makePart('bar20', 0.07, 0.255);
  makePart('gearS', -0.245, -0.205);
  makePart('gearL', -0.10, -0.195);
  makePart('rail', 0.16, -0.20);
  setBenchVisible(bench.visible);
  if (typeof guide !== 'undefined') { guide.learned = []; enterStep(0); }
}
document.getElementById('reset').addEventListener('click', () => { audio(); resetParts(); });

// ---------- guided walkthrough ----------
// Each step shows outlines of where parts go, checks itself, and adds what you learned to the board.
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.3, depthWrite: false });
const ghostGroup = new THREE.Group(); bench.add(ghostGroup);
const targetRings = [];
function clearGhosts() { while (ghostGroup.children.length) ghostGroup.remove(ghostGroup.children[0]); targetRings.length = 0; }
function addGhost(kind, x, z, th = 0) {
  const P = makePart(kind, x, z, th); parts.pop(); nextId--;
  scene.remove(P.mesh); P.mesh.matrixAutoUpdate = true;
  P.mesh.traverse(o => { if (o.isMesh) o.material = ghostMat; });
  P.mesh.position.set(x, 0.0012, z); P.mesh.rotation.set(0, -th, 0);
  ghostGroup.add(P.mesh);
}
function pegTarget(x, z) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.002, 8, 24), new THREE.MeshBasicMaterial({ color: 0xf0a03c, transparent: true }));
  m.rotation.x = Math.PI / 2; m.position.set(x, 0.005, z); ghostGroup.add(m); targetRings.push(m);
}
const pegAt = (x, z) => pegs.findIndex(g => Math.abs(g.x - x) < 1e-6 && Math.abs(g.z - z) < 1e-6);
const near2 = (a, x, z, d = 0.02) => Math.hypot(a[0] - x, a[1] - z) < d;
const linked = (P, Q) => joints.some(J => (J.a === P && J.b === Q) || (J.a === Q && J.b === P));
let detachCount = 0;
function square() {
  const bars = parts.filter(P => P.kind === 'bar10' && P.mode === 'bench');
  const B = bars.find(P => { const pg = joints.filter(J => J.a === P && J.peg != null).map(J => J.peg); return pg.includes(pegAt(0, 0.075)) && pg.includes(pegAt(0.1, 0.075)); });
  if (!B) return {};
  // once the square is closed it's recognised by its joints, so it still counts while it leans over
  const sides = bars.filter(P => P !== B && linked(P, B));
  for (const L of sides) for (const R of sides) {
    if (L === R) continue;
    const T = bars.find(P => P !== B && P !== L && P !== R && linked(P, L) && linked(P, R));
    if (T) { const lx = Math.min(...L.ports.map((_, i) => portBench(L, i)[0])), rx = Math.min(...R.ports.map((_, i) => portBench(R, i)[0])); return lx <= rx ? { B, L, R, T } : { B, L: R, R: L, T }; }
  }
  const endAt = (P, x, z) => P.ports.some((_, i) => near2(portBench(P, i), x, z, 0.025));
  const L = sides.find(P => endAt(P, 0, 0.075) && endAt(P, 0, -0.025));
  const R = sides.find(P => P !== L && endAt(P, 0.1, 0.075) && endAt(P, 0.1, -0.025));
  return { B, L, R, T: null };
}
const held = P => hands.some(h => h.grab && h.grab.P === P);
const STEPS = [
  { title: 'Pick up a part', text: 'Pinch a bar between your thumb and finger, then lift your hand. The bar comes up with you.',
    learn: 'Pinch to grab. Lift your hand to pick a part up off the bench.',
    check: () => hands.some(h => h.grab && h.grab.mode === 'free') },
  { title: 'Pin it to the pegs', text: 'Lay a bar on the two glowing pegs. When its blue rings light up, let go: it clicks in.',
    learn: 'Blue rings are ports. Bring one near a peg until it glows, let go, and the part is pinned there.',
    ghosts() { addGhost('bar10', 0.05, 0.075); pegTarget(0, 0.075); pegTarget(0.1, 0.075); }, check: () => !!square().B },
  { title: 'Join a second bar', text: 'Put another bar’s ring on the left end of the first bar so it clicks. Then swing its free end up to the outline.',
    learn: 'Ring on ring makes a pin joint: the parts stay together but can still turn.',
    ghosts() { addGhost('bar10', 0, 0.025, Math.PI / 2); }, check: () => !!square().L },
  { title: 'And on the right', text: 'Do the same on the right end: click a bar on, then swing it up to the outline.',
    learn: null, ghosts() { addGhost('bar10', 0.1, 0.025, Math.PI / 2); }, check: () => !!square().R },
  { title: 'Close the square', text: 'Lay the last bar across the top so both of its rings meet the tops of the side bars.',
    learn: 'Bring a bar’s two rings to two ports at once and it closes the loop.',
    ghosts() { addGhost('bar10', 0.05, -0.025); }, check: () => !!square().T },
  { title: 'Push the top', text: 'Pinch the top bar and push it sideways. Watch what the square does.',
    learn: 'Four pins make a linkage: the square leans over. It’s a shape that moves.',
    enter() { const { T } = square(); this.t0 = T ? [T.x, T.z] : null; },
    check() { const { T } = square(); return !!(T && this.t0 && Math.hypot(T.x - this.t0[0], T.z - this.t0[1]) > 0.025); } },
  { title: 'Add the brace', text: 'Click the long diagonal bar onto the bottom-left corner, then swing its other end to the top-right corner.',
    learn: 'A diagonal splits the square into two triangles.',
    ghosts() { addGhost('brace', 0.05, 0.025, -Math.PI / 4); pegTarget(0, 0.075); },
    check() { const Q = parts.find(P => P.kind === 'brace'), s = square(); return !!(Q && s.B && joints.filter(J => J.b && (J.a === Q || J.b === Q)).length >= 2 && assemblyOf(Q).includes(s.B)); } },
  { title: 'Push it again', text: 'Push the top bar sideways again, the same way as before.',
    learn: 'Triangles can’t change shape. Now it’s a frame: it holds.',
    enter() { this.t = 0; }, tick(dt) { const { T } = square(); if (T && held(T)) this.t += dt; }, check() { return this.t > 1; } },
  { title: 'Lock a joint', text: 'Tap one of the corner rings with your fingertip (on a computer: double-click it).',
    learn: 'Tap a ring to lock that joint (it turns into a square). Tap again to free it.',
    check: () => joints.some(J => J.type === 'fixed') },
  { title: 'Mesh two gears', text: 'Pin the small gear and the big gear on the glowing pegs, so their teeth touch.',
    learn: 'Gears pinned side by side mesh: turning one turns the other.',
    ghosts() { addGhost('gearS', -0.2, -0.125); addGhost('gearL', -0.1, -0.125); pegTarget(-0.2, -0.125); pegTarget(-0.1, -0.125); },
    check: () => gearPairs.size > 0 },
  { title: 'Turn the big gear', text: 'Pinch the big gear near its edge and drag it round in a circle.',
    learn: 'The small gear spins three times as fast, the other way. A circle trail means rotary motion.',
    enter() { const G = parts.find(P => P.kind === 'gearL'); this.th0 = G ? G.th : 0; },
    check() { const G = parts.find(P => P.kind === 'gearL'); return !!G && Math.abs(G.th - this.th0) > 1.2; } },
  { title: 'Slider on the rail', text: 'Put the orange slider on the rail at the back. The rail’s slot glows when it lines up.',
    learn: 'A rail joint: the slider can only move along the rail.',
    ghosts() { addGhost('slider', 0.16, -0.2); }, check: () => joints.some(J => J.type === 'rail') },
  { title: 'Slide it', text: 'Push the slider along the rail from one end to the other.',
    learn: 'A straight trail means linear motion. The slider stops at the rail’s ends.',
    enter() { this.lo = Infinity; this.hi = -Infinity; },
    tick() { const J = joints.find(J => J.type === 'rail'); if (!J) return; const S = J.a, R = J.b, [dx, dz] = rot(1, 0, R.th), t = (S.x - R.x) * dx + (S.z - R.z) * dz; this.lo = Math.min(this.lo, t); this.hi = Math.max(this.hi, t); },
    check() { return this.hi - this.lo > 0.1; } },
  { title: 'Stretch to look closer', text: 'Pinch the long bar with both hands and pull your hands apart (on a computer: scroll over it).',
    learn: 'Two hands scale a loose part up for a closer look. It returns to size when you connect it.',
    check: () => parts.some(P => P.scale > 1.4) },
  { title: 'Take something apart', text: 'Pinch any connected part and pull it firmly away from its group.',
    learn: 'Pull hard to undo a joint.', enter() { this.d0 = detachCount; }, check() { return detachCount > this.d0; } }
];
const guide = { i: 0, learned: [], doneT: 0, dirty: true, finished: false };
function enterStep(i) {
  guide.i = Math.max(0, Math.min(STEPS.length, i)); guide.doneT = 0; guide.dirty = true; clearGhosts();
  guide.finished = guide.i >= STEPS.length;
  const s = STEPS[guide.i]; if (!s) return;
  if (s.enter) s.enter(); if (s.ghosts) s.ghosts();
}
function guideTick(dt) {
  ghostMat.opacity = 0.2 + 0.14 * (0.5 + 0.5 * Math.sin(clock * 4));
  for (const r of targetRings) r.scale.setScalar(1 + 0.25 * (0.5 + 0.5 * Math.sin(clock * 5)));
  const s = STEPS[guide.i]; if (!s) return;
  if (guide.doneT > 0) { guide.doneT += dt; if (guide.doneT > 1.2) enterStep(guide.i + 1); return; }
  if (s.tick) s.tick(dt);
  if (s.check.call(s)) {
    guide.doneT = 0.001; guide.dirty = true; clearGhosts(); sound('chime');
    if (s.learn && !guide.learned.includes(s.learn)) guide.learned.push(s.learn);
  }
}
// the board beside the bench: current step on top, what you've learned below
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 1344; boardCanvas.id = 'board';
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace;
const board = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.3675), new THREE.MeshBasicMaterial({ map: boardTex, transparent: true }));
board.position.set(-0.47, 0.19, 0.02); board.rotation.set(-0.12, 0.5, 0, 'YXZ'); bench.add(board);
function wrap(x, text, maxW) { const words = text.split(' '), lines = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; }
function drawBoard() {
  const x = boardCanvas.getContext('2d'), W = 1024, H = 1344, pad = 56;
  x.clearRect(0, 0, W, H);
  x.fillStyle = 'rgba(31,44,69,0.94)'; x.beginPath(); x.roundRect(0, 0, W, H, 44); x.fill();
  let y = 92;
  const s = STEPS[guide.i];
  x.fillStyle = '#f0a03c'; x.font = '600 34px system-ui, sans-serif';
  x.fillText(guide.finished ? 'ALL DONE' : `STEP ${guide.i + 1} OF ${STEPS.length}`, pad, y);
  y += 72; x.fillStyle = '#f6efdf'; x.font = '700 62px system-ui, sans-serif';
  x.fillText(guide.finished ? 'Free play' : s.title, pad, y);
  y += 60; x.font = '400 40px system-ui, sans-serif'; x.fillStyle = '#e3e6ee';
  for (const l of wrap(x, guide.finished ? 'You’ve tried every interaction. Build anything you like, or press reset to start again.' : s.text, W - pad * 2)) { x.fillText(l, pad, y); y += 52; }
  if (guide.doneT > 0) { y += 10; x.fillStyle = '#5fbf6a'; x.font = '700 48px system-ui, sans-serif'; x.fillText('✓ Nice!', pad, y); y += 30; }
  y += 34; x.strokeStyle = 'rgba(246,239,223,0.25)'; x.lineWidth = 3; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
  y += 62; x.fillStyle = '#f0a03c'; x.font = '600 34px system-ui, sans-serif'; x.fillText('WHAT YOU’VE LEARNED', pad, y);
  y += 20;
  // shrink the list's type until everything learned so far fits
  let fs = 34, flat = [];
  for (; fs >= 22; fs -= 2) {
    x.font = `400 ${fs}px system-ui, sans-serif`;
    flat = guide.learned.flatMap(t => wrap(x, t, W - pad * 2 - 56).map((l, j) => ({ l, first: j === 0 })));
    if (flat.length * fs * 1.28 + guide.learned.length * 6 < H - y - 36) break;
  }
  if (!flat.length) { y += 52; x.fillStyle = 'rgba(227,230,238,0.55)'; x.fillText('Each step you finish adds a line here.', pad, y); }
  for (const f of flat) { y += fs * 1.28 + (f.first ? 6 : 0); if (f.first) { x.fillStyle = '#5fbf6a'; x.fillText('✓', pad, y); } x.fillStyle = '#e3e6ee'; x.fillText(f.l, pad + 48, y); }
  boardTex.needsUpdate = true;
}
makeButton('back', -0.37, 0.27, () => enterStep(guide.i - 1));
makeButton('skip', -0.37, 0.21, () => { if (STEPS[guide.i]) enterStep(guide.i + 1); });
boardCanvas.style.cssText = 'position:fixed;right:16px;top:16px;width:min(330px,42vw);border-radius:14px;pointer-events:none';
document.body.appendChild(boardCanvas);
document.getElementById('back').addEventListener('click', () => { audio(); enterStep(guide.i - 1); });
document.getElementById('skip').addEventListener('click', () => { audio(); if (STEPS[guide.i]) enterStep(guide.i + 1); });

// ---------- main loop ----------
let lastT = performance.now();
function update(dt) {
  clock += dt; pokeCooldown = Math.max(0, pokeCooldown - dt);
  if (renderer.xr.isPresenting) readXRHands();
  for (const h of hands) {
    if (h.pinch && !h.wasPinch) onPinchStart(h);
    else if (!h.pinch && h.wasPinch) onPinchEnd(h);
    h.wasPinch = h.pinch;
  }
  stackParts();
  drags.length = 0;
  for (const h of hands) onHandMove(h, dt);
  solve();
  checkBreaks(dt);
  if (renderer.xr.isPresenting) for (const h of hands) if (h.tracked && !h.pinch && h.tipPrev.y - h.tip.y > 0.0005) poke(h.tip);
  guideTick(dt);
  if (guide.dirty || guide.doneT > 0) { drawBoard(); guide.dirty = false; }
  updateTrails();
  updateVisuals();
}
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  update(dt);
  renderer.render(scene, camera);
});

// ---------- entering mixed reality ----------
const enterBtn = document.getElementById('enter');
async function setupXR() {
  if (!navigator.xr) return;
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = ar ? false : await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!ar && !vr) return;
  enterBtn.hidden = false;
  enterBtn.textContent = ar ? 'Enter mixed reality' : 'Enter VR';
  enterBtn.addEventListener('click', async () => {
    audio();
    const session = await navigator.xr.requestSession(ar ? 'immersive-ar' : 'immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    if (ar) scene.background = null;
    await renderer.xr.setSession(session);
    calibrating = true; panel.visible = true; setBenchVisible(false);
    session.addEventListener('end', () => { scene.background = deskBg; calibrating = false; panel.visible = false; setBenchVisible(true); bench.position.set(0, 0.75, -0.43); bench.rotation.set(0, 0, 0); });
  });
}
setupXR();
resetParts();
enterStep(0);

// ---------- test hooks (used by automated tests; harmless otherwise) ----------
window.__ft = {
  parts, joints, hands, pegs, bench, KIND,
  find: (kind, k = 0) => parts.filter(P => P.kind === kind)[k],
  portBench, isLoose, findCandidates, assemblyOf: P => assemblyOf(P).map(Q => Q.id),
  hand(i, x, y, z, pinch, yaw = 0) { const h = hands[i]; h.test = true; h.tracked = true; h.pos.copy(benchWorld(x, y, z)); h.quat.copy(bench.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw)); h.pinch = pinch; },
  tip(i, x, y, z) { hands[i].tip.copy(benchWorld(x, y, z)); },
  step(n = 1, dt = 1 / 60) { for (let k = 0; k < n; k++) update(dt); },
  poke(x, y, z) { pokeCooldown = 0; return poke(benchWorld(x, y, z)); },
  gearPairs: () => [...gearPairs.values()].map(g => [g.A.id, g.B.id]),
  trails: () => parts.map(P => P.trailPts.length),
  freeY: P => benchLocal(new THREE.Vector3().setFromMatrixPosition(P.world)).y,
  reset: resetParts, guide, STEPS, enterStep, square: () => { const s = square(); return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && v.id])); }
};
