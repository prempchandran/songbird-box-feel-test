// The Songbird Box: hand-interaction feel test.
// Pinch to grab, two-hand pinch to scale, ports that glow and click together, pull apart to undo,
// pin / fixed / rail joints solved on the bench, gears that mesh, and motion trails.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const SNAP_GLOW = 0.05, SNAP_DIST = 0.025, COINCIDE = 0.007;
const PINCH_ON = 0.02, PINCH_OFF = 0.04, PICK_DIST = 0.026;
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
function fitCamera() { // pull back in tall or narrow windows so the whole bench stays in view
  const k = Math.max(1, 1.5 / (innerWidth / innerHeight));
  camera.position.set(0, 0.75 + 0.45 * k, -0.43 + 0.41 * k); camera.lookAt(0, 0.75, -0.43);
}
fitCamera();
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a3020, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(0.3, 2, 0.6); scene.add(sun);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); fitCamera(); });

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
// ports: >= 16 mm visual ring; pokes use a >= 24 mm collider (Meta: 22 mm minimum hit target, 12 mm spacing)
const ringGeo = new THREE.TorusGeometry(0.0078, 0.0022, 8, 24); ringGeo.rotateX(Math.PI / 2);

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
function layerY(P) { return (benchY.get(P) ?? 0.0005) + (typeof held === 'function' && held(P) ? 0.004 : 0); }
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
      const own = joints.find(J => J.peg != null && J.a === P), thisPegged = joints.some(J => J.peg != null && J.a === P && J.ai === i);
      const swing = own && !thisPegged && A.length === 1 && P.mode === 'bench' && !P.r;
      if ((!hasPeg(A) || swing) && Math.abs(l.y) < 0.1) pegs.forEach((g, k) => {
        if (swing) { const o = pegs[own.peg], pt = P.ports[i], q = P.ports[own.ai], span = Math.hypot(pt.x - q.x, pt.z - q.z) * P.scale; if (k === own.peg || Math.abs(Math.hypot(g.x - o.x, g.z - o.z) - span) > 0.004) return; }
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
    if (A.length === 1 && !c.P.r && joints.filter(J => J.a === c.P && J.peg != null).length === 1) {
      const q = c.P.ports[c.i]; let best = null;
      c.P.ports.forEach((pt, i) => {
        if (i === c.i || pt.type !== 'pin') return;
        const [x, z] = portBench(c.P, i), span = Math.hypot(pt.x - q.x, pt.z - q.z) * c.P.scale;
        pegs.forEach((h, k) => { if (k === c.peg) return; const d = Math.hypot(h.x - x, h.z - z); if (d < SNAP_DIST * 1.4 && Math.abs(Math.hypot(h.x - g.x, h.z - g.z) - span) < 0.004 && (!best || d < best.d)) best = { i, k, d, x, z }; });
      });
      if (best) {
        const h = pegs[best.k], a0 = Math.atan2(best.z - g.z, best.x - g.x), a1 = Math.atan2(h.z - g.z, h.x - g.x);
        rotateAssembly(A, g.x, g.z, a1 - a0);
        addJoint({ type: 'peg', a: c.P, ai: best.i, peg: best.k });
      }
    }
    if (!c.P.r) c.P.ports.forEach((pt, i) => { if (i === c.i || pt.type !== 'pin' || joints.some(J => J.a === c.P && J.ai === i && J.peg != null)) return; const [x, z] = portBench(c.P, i); const k = pegs.findIndex(q => Math.hypot(q.x - x, q.z - z) < COINCIDE); if (k >= 0) addJoint({ type: 'peg', a: c.P, ai: i, peg: k }); });
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
  sound('click'); flash(portWorld(c.P, c.i));
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

function pickPart(p, reach = PICK_DIST) {
  let best = null, bd = reach;
  const inv = new THREE.Matrix4(), q = new THREE.Vector3();
  for (const P of parts) {
    const W = worldMatrix(P);
    q.copy(p).applyMatrix4(inv.copy(W).invert());
    const hx = P.half[0], hy = P.half[1], hz = P.half[2];
    const cx = Math.max(-hx, Math.min(hx, q.x)), cy = Math.max(P.mode === 'bench' ? -layerY(P) / P.scale : 0, Math.min(hy, q.y)), cz = Math.max(-hz, Math.min(hz, q.z));
    const d = Math.hypot(q.x - cx, q.y - cy, q.z - cz) * P.scale - (P.mode === 'bench' ? (benchRank.get(P) || 0) * 0.001 : 0);
    if (d < bd) { bd = d; best = P; }
  }
  return best;
}
function relsFor(A, h) { const inv = handMatrix(h).invert(), rels = new Map(); for (const P of A) rels.set(P, new THREE.Matrix4().multiplyMatrices(inv, P.world)); return rels; }
function startFreeGrab(h, P) { const A = assemblyOf(P); toFree(A); h.grab = { P, mode: 'free', rels: relsFor(A, h) }; }

function onPinchStart(h) {
  if (renderer.xr.isPresenting) {
    const head = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
    if (palmFacesHead(h, head)) { if (h.i === 0 && !calibrating) togglePause(); h.ignore = true; return; }
    if (h.pos.distanceTo(head) < 0.1) { h.ignore = true; return; }
  }
  h.ignore = false;
  if (paused) return;
  if (calibrating) { calibrate(h.pos); return; }
  const P = pickPart(h.pos) || (h.near && clock - h.nearT < 0.3 ? h.near : null);
  lastActivity = clock;
  if (!P) return;
  lastTouched = P;
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
  if (g.P.inspect) { g.P.inspect = false; g.P.scale = 1; if (g.P.mode === 'free') { const pp = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(); g.P.world.decompose(pp, q, sc); g.P.world.compose(pp, q, new THREE.Vector3(1, 1, 1)); } }
  sound('drop');
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
    if (renderer.xr.isPresenting && g.rels.size === 1 && isLoose(g.P)) {
      const head = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld), pp = new THREE.Vector3().setFromMatrixPosition(g.P.world);
      const want = pp.distanceTo(head) < 0.3 ? 2 : 1;
      if (want > 1) g.P.inspect = true;
      if (g.P.inspect) {
        g.P.scale += (want - g.P.scale) * 0.12;
        const q = new THREE.Quaternion(), sc = new THREE.Vector3(); g.P.world.decompose(pp, q, sc); g.P.world.compose(pp, q, new THREE.Vector3(g.P.scale, g.P.scale, g.P.scale));
      }
    }
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
  for (const btn of buttons) { const w = btn.mesh.getWorldPosition(new THREE.Vector3()); if (btn.mesh.visible && tip.distanceTo(w) < 0.022) { btn.fn(); pokeCooldown = 1; sound('press'); btn.pressT = 0.25; return true; } }
  for (const J of joints) {
    if (J.type !== 'pin' && J.type !== 'fixed') continue;
    if (J.a.mode !== 'bench' || (J.b && J.b.mode !== 'bench') || held(J.a) || (J.b && held(J.b))) continue;
    const p = jointPos(J); if (!p) continue;
    const top = p.clone().add(UP.clone().multiplyScalar(0.008));
    if (tip.distanceTo(top) < 0.013) {
      if (J.type === 'pin') { J.type = 'fixed'; J.th0 = J.a.th - J.b.th; makeMarker(J); }
      else { J.type = 'pin'; scene.remove(J.marker); J.marker = null; }
      pokeCooldown = 0.8; sound('press'); flash(p, 0x1f2c45); return true;
    }
  }
  return false;
}

// ---------- sound ----------
let actx = null;
const audioState = () => actx ? actx.state : 'off';
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); }
function sound(kind) {
  if (!actx) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  if (kind === 'note') { const f = arguments[1] || 784, o = actx.createOscillator(), g = actx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.95); return; }
  if (kind === 'click') {
    const len = 0.06, buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 4);
    const n = actx.createBufferSource(), bp = actx.createBiquadFilter(), ng = actx.createGain();
    n.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3; ng.gain.value = 0.9;
    n.connect(bp).connect(ng).connect(actx.destination); n.start(t);
    o.type = 'triangle'; o.frequency.setValueAtTime(1320, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.2); return;
  }
  if (kind === 'chime') { [880, 1320].forEach((f, k) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = t + k * 0.11; o.type = 'sine'; o.frequency.setValueAtTime(f, t0); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5); o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.55); }); return; }
  const spec = { click: [1500, 900, 0.05, 0.25], pop: [420, 160, 0.12, 0.3], tick: [2200, 2000, 0.02, 0.08], drop: [520, 380, 0.06, 0.1], press: [1000, 1000, 0.03, 0.18] }[kind];
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
function tablePlaneY(p) { // a detected horizontal plane near the pinch, if the browser offers plane detection
  try {
    const frame = renderer.xr.getFrame(), ref = renderer.xr.getReferenceSpace();
    if (!frame || !frame.detectedPlanes) return null;
    let best = null;
    frame.detectedPlanes.forEach(pl => { if (pl.orientation !== 'horizontal') return; const pose = frame.getPose(pl.planeSpace, ref); if (!pose) return; const y = pose.transform.position.y; if (Math.abs(y - p.y) < 0.08 && (best == null || Math.abs(y - p.y) < Math.abs(best - p.y))) best = y; });
    return best;
  } catch (e) { return null; }
}
let benchIntro = 1;
function calibrate(p) {
  const planeY = tablePlaneY(p);
  const xrCam = renderer.xr.getCamera();
  const head = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(xrCam.matrixWorld)); f.y = 0; f.normalize();
  bench.position.set(head.x + f.x * 0.42, planeY != null ? planeY + 0.003 : p.y - 0.012, head.z + f.z * 0.42); benchIntro = 0;
  bench.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
  calibrating = false; panel.visible = false; setBenchVisible(true); sound('click');
}
function setBenchVisible(v) { bench.visible = v; for (const P of parts) P.mesh.visible = v; }
const buttons = [];
function makeButton(label, x, z, fn) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 24), [std(0xf0a03c), new THREE.MeshBasicMaterial({ map: textTexture([label], 256, 256) }), std(0xf0a03c)]);
  m.position.set(x, 0.012, z); bench.add(m); buttons.push({ mesh: m, fn, pressT: 0 });
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
    const cands = findCandidates(assemblyOf(h.grab.P), SNAP_GLOW).slice(0, 1);
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
    const near = h.tracked && pickPart(h.pos), ready = Math.max(0, Math.min(1, (0.07 - (h.pinchD || 0.07)) / 0.05));
    ring.visible = h.tracked && renderer.xr.isPresenting && !paused && (h.pinch || !!near || ready > 0.3);
    if (ring.visible) { ring.position.copy(h.pos); ring.quaternion.copy(h.quat); ring.material.color.setHex(h.pinch ? 0xf0a03c : (near ? 0x7fc4ff : 0xdfe9f7)); ring.material.opacity = h.pinch ? 1 : 0.3 + 0.6 * ready; ring.scale.setScalar(h.pinch ? 1 : 1.8 - 0.8 * ready); }
    if (!h.xr || !h.tracked) continue;
    for (const name in h.xr.joints) { const j = h.xr.joints[name]; if (!j.visible || n >= 60) continue; const r = (j.jointRadius || 0.008) * (passthrough ? 1.15 : 0.8); m.compose(j.getWorldPosition(_v), _q.identity(), _s.set(r, r, r)); handJoints.setMatrixAt(n++, m); }
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
function readXRHands(dt) {
  for (const h of hands) {
    if (h.test || !h.xr) continue;
    const it = h.xr.joints['index-finger-tip'], th = h.xr.joints['thumb-tip'], wr = h.xr.joints['wrist'];
    h.tracked = !!(it && th && wr && it.visible && th.visible);
    if (!h.tracked) {
      h.lostT = (h.lostT || 0) + dt;
      if (h.grab && h.lostT > 0.5) setDown(h);
      else if (!h.grab) h.pinch = false;
      continue;
    }
    h.lostT = 0;
    const a = it.getWorldPosition(new THREE.Vector3()), b = th.getWorldPosition(new THREE.Vector3());
    const d = a.distanceTo(b); h.pinchD = d;
    h.pinch = h.pinch ? d < PINCH_OFF : d < PINCH_ON;
    h.pos.copy(a).add(b).multiplyScalar(0.5);
    if (!h.pinch && !h.grab && d < 0.06) { const n = pickPart(h.pos, 0.035); if (n) { h.near = n; h.nearT = clock; } }
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
  [-0.24, -0.1, 0.04, 0.18].forEach(x => makePart('bar10', x, 0.195));
  makePart('slider', 0.255, 0.26);
  makePart('brace', -0.19, 0.26);
  makePart('bar20', 0.06, 0.26);
  makePart('gearS', -0.245, -0.205);
  makePart('gearL', -0.10, -0.195);
  makePart('rail', 0.16, -0.20);
  setBenchVisible(bench.visible);
  if (typeof guide !== 'undefined') { guide.learned = []; enterStep(0); }
}
document.getElementById('reset').addEventListener('click', () => { audio(); resetParts(); });


// ---------- pictures for the "what you've learned" board ----------
const LEARN_ICONS = { 0: 'pinch', 1: 'peg', 2: 'pin', 4: 'loop', 5: 'linkage', 6: 'diagonal', 7: 'frame', 8: 'lock', 9: 'mesh', 10: 'rotary', 11: 'rail', 12: 'linear', 13: 'inspect', 14: 'pull' };
const LEARN_LABELS = { 0: 'Pinch = grab', 1: 'Ring on peg', 2: 'Pin joint', 4: 'Close a loop', 5: 'Linkage moves', 6: 'Add a diagonal', 7: 'Frame holds', 8: 'Tap to lock', 9: 'Gears mesh', 10: 'Rotary', 11: 'Rail joint', 12: 'Linear', 13: 'Look closer', 14: 'Pull apart' };
function drawIcon(x, kind) {
  const KR = '#c99a68', BL = '#2a8fd6', OR = '#f0a03c', CR = '#e3e6ee', NV = '#1f2c45', GR = '#5fbf6a';
  const bar = (x1, y1, x2, y2, c = KR, w = 13) => { x.strokeStyle = c; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); };
  const ring = (cx, cy, c = BL, r = 9) => { x.strokeStyle = c; x.lineWidth = 5; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke(); };
  const dot = (cx, cy, r, c) => { x.fillStyle = c; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); };
  const arrow = (x1, y1, x2, y2, c = OR) => { bar(x1, y1, x2, y2, c, 6); const a = Math.atan2(y2 - y1, x2 - x1); x.fillStyle = c; x.beginPath(); x.moveTo(x2 + 10 * Math.cos(a), y2 + 10 * Math.sin(a)); x.lineTo(x2 + 10 * Math.cos(a + 2.4), y2 + 10 * Math.sin(a + 2.4)); x.lineTo(x2 + 10 * Math.cos(a - 2.4), y2 + 10 * Math.sin(a - 2.4)); x.fill(); };
  const arcArrow = (cx, cy, r, a0, a1, c = OR) => { x.strokeStyle = c; x.lineWidth = 6; x.lineCap = 'round'; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke(); const ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1), t = a1 + Math.PI / 2; x.fillStyle = c; x.beginPath(); x.moveTo(ex + 11 * Math.cos(t), ey + 11 * Math.sin(t)); x.lineTo(ex + 9 * Math.cos(t + 2.3), ey + 9 * Math.sin(t + 2.3)); x.lineTo(ex + 9 * Math.cos(t - 2.3), ey + 9 * Math.sin(t - 2.3)); x.fill(); };
  const check = (cx, cy) => { x.strokeStyle = GR; x.lineWidth = 8; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx - 10, cy); x.lineTo(cx - 2, cy + 9); x.lineTo(cx + 14, cy - 10); x.stroke(); };
  const sq = (s = 38, lean = 0, diag = false) => { const p = [[-s + lean, -s], [s + lean, -s], [s, s], [-s, s]]; bar(p[3][0], p[3][1], p[2][0], p[2][1]); bar(p[0][0], p[0][1], p[3][0], p[3][1]); bar(p[1][0], p[1][1], p[2][0], p[2][1]); bar(p[0][0], p[0][1], p[1][0], p[1][1]); if (diag) bar(p[3][0], p[3][1], p[1][0], p[1][1], '#e0b98c'); p.forEach(q => ring(q[0], q[1], NV, 7)); };
  switch (kind) {
    case 'pinch': bar(-34, 34, 0, 2, CR, 14); bar(-30, -34, 0, -4, CR, 14); dot(2, -1, 8, OR); break;
    case 'peg': bar(-38, 10, 38, 10); dot(-38, 10, 11, OR); dot(38, 10, 11, OR); ring(-38, 10, NV); ring(38, 10, NV); arrow(0, -40, 0, -12); break;
    case 'pin': bar(-40, 30, 0, 0); bar(0, 0, 38, -26); ring(0, 0, BL, 10); arcArrow(0, 0, 30, -2.6, -1.4); break;
    case 'loop': sq(34); break;
    case 'linkage': sq(32, 22); arcArrow(-32, 32, 64, -1.9, -1.2); break;
    case 'diagonal': sq(34, 0, true); break;
    case 'frame': sq(30, 0, true); check(34, -40); break;
    case 'lock': bar(-40, 24, 0, 24); bar(0, 24, 30, -10); x.fillStyle = NV; x.fillRect(-10, 14, 20, 20); bar(16, -46, 4, 6, CR, 10); break;
    case 'mesh': for (const [cx, r] of [[-22, 22], [26, 26]]) { x.strokeStyle = KR; x.lineWidth = 9; x.setLineDash([6, 5]); x.beginPath(); x.arc(cx, 4, r, 0, TAU); x.stroke(); x.setLineDash([]); dot(cx, 4, r - 5, KR); dot(cx, 4, 5, NV); } break;
    case 'rotary': dot(0, 4, 26, KR); dot(0, 4, 5, NV); arcArrow(0, 4, 40, -2.8, 1.9); break;
    case 'rail': x.fillStyle = '#e8dcc3'; x.fillRect(-48, -4, 96, 18); x.fillStyle = '#3b2a1a'; x.fillRect(-40, 3, 80, 4); x.fillStyle = OR; x.fillRect(4, -12, 22, 34); arrow(-28, -30, 26, -30); break;
    case 'linear': for (let k = 0; k < 4; k++) dot(-46 + k * 12, 4, 3 + k * 0.6, OR); arrow(-6, 4, 40, 4); break;
    case 'inspect': bar(-14, 0, 14, 0, KR, 9); ring(-14, 0, BL, 5); ring(14, 0, BL, 5); x.strokeStyle = CR; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, 30, 0, TAU); x.stroke(); bar(21, 21, 42, 42, CR, 9); break;
    case 'pull': bar(-44, 6, -10, 6); bar(10, 6, 44, 6); ring(-10, 6, BL, 8); ring(10, 6, BL, 8); arrow(-14, -26, -42, -26); arrow(14, -26, 42, -26); break;
  }
}

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
  { title: 'Pick up a part', text: 'Find the bar with the orange arrow over it. Pinch it between your thumb and finger and lift your hand: the bar comes with you. (On a computer: drag it.)',
    learn: 'Pinch to grab. Lift your hand to pick a part up off the bench.',
    ghosts() { addGhost('bar10', 0.05, 0.075); pegTarget(0, 0.075); pegTarget(0.1, 0.075); },
    enter() { this.starts = new Map(parts.map(P => [P, [P.x, P.z]])); },
    check() { return hands.some(h => h.grab && (h.grab.mode === 'free' || (h.grab.mode === 'bench' && this.starts.has(h.grab.P) && Math.hypot(h.grab.P.x - this.starts.get(h.grab.P)[0], h.grab.P.z - this.starts.get(h.grab.P)[1]) > 0.03))); } },
  { title: 'Pin it to the pegs', text: 'Follow the dotted path and lay the bar on the outline, over the two orange pegs. When its blue rings light up, let go: it clicks in.',
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
  { title: 'Look closer', text: 'Pick up the long bar and bring it close to your face: it grows so you can see the detail. Or pinch it with both hands and pull apart. (On a computer: scroll over it.)',
    learn: 'Bring a loose part close (or stretch it with two hands) to look closer. It goes back to size when you let go or connect it.',
    check: () => parts.some(P => P.scale > 1.4) },
  { title: 'Take something apart', text: 'Pinch any connected part and pull it firmly away from its group.',
    learn: 'Pull hard to undo a joint.', enter() { this.d0 = detachCount; }, check() { return detachCount > this.d0; } }
];
// which part to use (an arrow bobs over it and it glows) and where it goes (a dotted path to its outline)
const looseOf = kind => parts.filter(P => P.kind === kind && isLoose(P));
function nearestTo(list, x, z) { let best = null, bd = Infinity; for (const P of list) { const d = Math.hypot(P.x - x, P.z - z); if (d < bd) { bd = d; best = P; } } return best; }
function sideCandidate(endX) { // a bar hanging off the bottom bar that hasn't been swung up yet, else a loose one
  const s = square(); if (!s.B) return null;
  const hanging = parts.filter(P => P.kind === 'bar10' && P !== s.B && P !== s.L && P !== s.R && linked(P, s.B) && P.ports.some((_, i) => near2(portBench(P, i), endX, 0.075, 0.025)));
  return hanging[0] || nearestTo(looseOf('bar10'), endX, 0.075);
}
const CUES = [
  () => [{ P: nearestTo(looseOf('bar10'), 0.05, 0.075), to: [0.05, 0.075] }],
  () => [{ P: nearestTo(looseOf('bar10'), 0.05, 0.075), to: [0.05, 0.075] }],
  () => [{ P: sideCandidate(0), to: [0, 0.025] }],
  () => [{ P: sideCandidate(0.1), to: [0.1, 0.025] }],
  () => [{ P: nearestTo(looseOf('bar10'), 0.05, -0.025), to: [0.05, -0.025] }],
  () => [{ P: square().T }],
  () => [{ P: parts.find(P => P.kind === 'brace'), to: [0.05, 0.025] }],
  () => [{ P: square().T }],
  () => { const s = square(); return s.B ? [{ pt: portBench(s.B, 0) }] : []; },
  () => [{ P: parts.find(P => P.kind === 'gearS'), to: [-0.2, -0.125] }, { P: parts.find(P => P.kind === 'gearL'), to: [-0.1, -0.125] }],
  () => { const G = parts.find(P => P.kind === 'gearL'); return G ? [{ pt: wpt(G, G.r * 0.8, 0) }] : []; },
  () => [{ P: parts.find(P => P.kind === 'slider'), to: [0.16, -0.2] }],
  () => [{ P: parts.find(P => P.kind === 'slider') }],
  () => [{ P: parts.find(P => P.kind === 'bar20') }],
  () => [{ P: square().T || parts.find(P => !isLoose(P) && P.kind !== 'rail') }]
];
const cueArrows = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.026, 18), new THREE.MeshBasicMaterial({ color: 0xf0a03c })); m.rotation.x = Math.PI; m.visible = false; bench.add(m); return m; });
const PATH_N = 16;
const pathDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0028, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf0a03c, transparent: true, opacity: 0.85 }), PATH_N * 2);
pathDots.frustumCulled = false; pathDots.count = 0; bench.add(pathDots);
let glowing = new Set();
function updateCues() {
  for (const P of glowing) P.mesh.traverse(o => { if (o.isMesh && o.material.emissive && !P.rings.includes(o)) o.material.emissive.setHex(0x000000); });
  glowing = new Set(); cueArrows.forEach(a => (a.visible = false)); pathDots.count = 0;
  const f = CUES[guide.i];
  if (!f || guide.doneT > 0 || calibrating) return;
  const items = f().filter(c => c && (c.P || c.pt)), m = new THREE.Matrix4(), bob = 0.012 * Math.sin(clock * 5);
  const glow = new THREE.Color(0x8a5414).multiplyScalar(0.55 + 0.45 * Math.sin(clock * 5));
  let n = 0;
  items.slice(0, 2).forEach((c, k) => {
    let x, z, y = 0.05;
    if (c.P) {
      if (held(c.P) && !c.to) { return; }
      x = c.P.mode === 'bench' ? c.P.x : null; z = c.P.mode === 'bench' ? c.P.z : null;
      if (x == null) return;
      y = layerY(c.P) + c.P.top + 0.045;
      glowing.add(c.P); c.P.mesh.traverse(o => { if (o.isMesh && o.material.emissive && !c.P.rings.includes(o)) o.material.emissive.copy(glow); });
    } else { [x, z] = c.pt; y = 0.04; }
    const a = cueArrows[k]; a.visible = !(c.P && held(c.P)); a.position.set(x, y + bob, z);
    if (c.to && c.P && !held(c.P) && Math.hypot(c.to[0] - x, c.to[1] - z) > 0.03) {
      for (let s = 1; s < PATH_N; s++) {
        const t = s / PATH_N, ph = (t + clock * 0.35) % 1, px = x + (c.to[0] - x) * t, pz = z + (c.to[1] - z) * t, py = 0.012 + 0.06 * Math.sin(Math.PI * t);
        const r = 0.6 + 0.6 * (ph < 0.15 ? 1 - ph / 0.15 : 0);
        m.compose(_v.set(px, py, pz), _q.identity(), _s.set(r, r, r)); pathDots.setMatrixAt(n++, m);
      }
    }
  });
  pathDots.count = n; pathDots.instanceMatrix.needsUpdate = true;
}
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
    guide.doneT = 0.001; guide.dirty = true; clearGhosts(); rewardStep(guide.i);
    if (s.learn && !guide.learned.includes(guide.i)) guide.learned.push(guide.i);
  }
}
// the board beside the bench: current step on top, what you've learned below
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 1344; boardCanvas.id = 'board';
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace;
const board = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.44625), new THREE.MeshBasicMaterial({ map: boardTex, transparent: true, opacity: 0.94 }));
// beyond the far edge of the bench: ~1 m from the eyes, inside the forward view, tilted up toward the player
board.position.set(0, 0.26, -0.5); board.rotation.set(-0.18, 0, 0); bench.add(board);
function wrap(x, text, maxW) { const words = text.split(' '), lines = []; let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; } if (line) lines.push(line); return lines; }
function drawBoard() {
  const x = boardCanvas.getContext('2d'), W = 1024, H = 1344, pad = 56;
  x.clearRect(0, 0, W, H);
  x.fillStyle = 'rgba(31,44,69,0.94)'; x.beginPath(); x.roundRect(0, 0, W, H, 44); x.fill();
  let y = 92;
  const s = STEPS[guide.i];
  x.fillStyle = '#f0a03c'; x.font = '600 34px system-ui, sans-serif';
  const chapter = i => (i < 5 ? 'BASICS' : i < 9 ? 'FRAMES' : i < 13 ? 'MOTION' : 'EXTRAS');
  x.fillText(paused ? 'PAUSED' : guide.finished ? 'ALL DONE' : `${chapter(guide.i)} · STEP ${guide.i + 1} OF ${STEPS.length}`, pad, y);
  y += 72; x.fillStyle = '#f6efdf'; x.font = '700 62px system-ui, sans-serif';
  x.fillText(paused ? 'Taking a break' : guide.finished ? 'Free play' : s.title, pad, y);
  y += 60; x.font = '400 40px system-ui, sans-serif'; x.fillStyle = '#e3e6ee';
  const body = paused ? 'Nothing moves while you rest. Turn your left palm toward you and pinch to carry on (on a computer: press P).' : guide.finished ? 'You’ve tried every interaction. Build anything you like, or press reset to start again.' : s.text;
  for (const l of wrap(x, body, W - pad * 2)) { x.fillText(l, pad, y); y += 52; }
  if (guide.doneT > 0 && !paused) { y += 10; x.fillStyle = '#5fbf6a'; x.font = '700 48px system-ui, sans-serif'; x.fillText(guide.i === 4 ? '✓ Basics done: the first bar of the song!' : '✓ Nice!  ♪', pad, y); y += 30; }
  y += 34; x.strokeStyle = 'rgba(246,239,223,0.25)'; x.lineWidth = 3; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
  y += 62; x.fillStyle = '#f0a03c'; x.font = '600 34px system-ui, sans-serif'; x.fillText('WHAT YOU’VE LEARNED', pad, y);
  // pictures, not sentences: one tile per thing learned, with a short label; the newest one's full sentence underneath
  const cols = 4, gap = 18, tw = (W - pad * 2 - gap * (cols - 1)) / cols, th = 168, top0 = y + 22;
  if (!guide.learned.length) { x.fillStyle = 'rgba(227,230,238,0.55)'; x.font = '400 34px system-ui, sans-serif'; x.fillText('Each step you finish adds a picture here.', pad, y + 60); }
  guide.learned.forEach((si, k) => {
    const cx = pad + (k % cols) * (tw + gap), cy = top0 + Math.floor(k / cols) * (th + gap), fresh = k === guide.learned.length - 1 && guide.doneT > 0;
    x.fillStyle = fresh ? 'rgba(95,191,106,0.22)' : 'rgba(246,239,223,0.07)'; x.beginPath(); x.roundRect(cx, cy, tw, th, 18); x.fill();
    if (fresh) { x.strokeStyle = '#5fbf6a'; x.lineWidth = 4; x.stroke(); }
    x.save(); x.translate(cx + tw / 2, cy + 64); drawIcon(x, LEARN_ICONS[si] || 'pinch'); x.restore();
    x.fillStyle = '#e3e6ee'; x.font = '600 27px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText(LEARN_LABELS[si] || '', cx + tw / 2, cy + th - 22); x.textAlign = 'left';
  });
  const rows = Math.ceil(guide.learned.length / cols), last = guide.learned[guide.learned.length - 1];
  if (last != null && STEPS[last]) { let yy = top0 + rows * (th + gap) + 30; x.fillStyle = 'rgba(227,230,238,0.8)'; x.font = '400 30px system-ui, sans-serif'; for (const l of wrap(x, STEPS[last].learn, W - pad * 2)) { if (yy > H - 24) break; x.fillText(l, pad, yy); yy += 38; } }
  boardTex.needsUpdate = true;
}
makeButton('back', -0.37, 0.27, () => enterStep(guide.i - 1));
makeButton('skip', -0.37, 0.21, () => { if (STEPS[guide.i]) enterStep(guide.i + 1); });
boardCanvas.style.cssText = 'position:fixed;right:16px;top:16px;width:min(330px,42vw);border-radius:14px;pointer-events:none';
document.body.appendChild(boardCanvas);
document.getElementById('back').addEventListener('click', () => { audio(); enterStep(guide.i - 1); });
document.getElementById('skip').addEventListener('click', () => { audio(); if (STEPS[guide.i]) enterStep(guide.i + 1); });

// ---------- Meta design guidelines: feedback, comfort and safety helpers ----------
let passthrough = false, paused = false, lastActivity = 0;
// a visual twin for every click: a ring that pulses out from the joint
const flashes = [0, 1, 2, 3].map(() => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.0018, 8, 28), new THREE.MeshBasicMaterial({ color: 0xe6f6ff, transparent: true, depthWrite: false })); m.rotation.x = Math.PI / 2; m.visible = false; m.userData.t = 1; scene.add(m); return m; });
function flash(p, color = 0xe6f6ff) { const m = flashes.find(f => f.userData.t >= 1) || flashes[0]; m.position.copy(p).add(new THREE.Vector3(0, 0.008, 0)); m.material.color.setHex(color); m.userData.t = 0; m.visible = true; m.quaternion.copy(bench.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)); }
function updateFlashes(dt) { for (const m of flashes) { if (m.userData.t >= 1) { m.visible = false; continue; } m.userData.t = Math.min(1, m.userData.t + dt / 0.35); m.scale.setScalar(1 + 2.2 * m.userData.t); m.material.opacity = 1 - m.userData.t; } }
// lost tracking while holding something: keep it for half a second, then set it down gently (no snapping)
function setDown(h) {
  const g = h.grab; h.grab = null; h.pinch = false; h.wasPinch = false;
  if (!g) return;
  const o = hands[1 - h.i];
  if (g.mode === 'scale') { scaleState = null; if (o.grab && o.grab.mode === 'scale') o.grab = null; }
  if (g.mode === 'pullapart') return;
  const A = assemblyOf(g.P);
  if (g.P.mode === 'free') { toBench(A); for (const P of A) { P.x = Math.max(-0.28, Math.min(0.28, P.x)); P.z = Math.max(BENCH.d0 + 0.02, Math.min(BENCH.d1 - 0.02, P.z)); } }
  g.P.scale = isLoose(g.P) && g.P.inspect ? 1 : g.P.scale; g.P.inspect = false;
  sound('drop');
}
// palm turned toward your face = the system / options gesture: never treat it as a grab
function palmFacesHead(h, head) {
  if (h.test || !h.xr || !h.xr.joints.wrist) return false;
  const w = h.xr.joints.wrist.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(0, -1, 0).applyQuaternion(h.quat);
  return n.dot(head.clone().sub(w).normalize()) > 0.55;
}
function togglePause() { paused = !paused; guide.dirty = true; sound('press'); }
addEventListener('keydown', e => { if (e.key === 'p' || e.key === 'P') togglePause(); });
// hover: a cool rim light on the part your fingers are near (separate from the orange "use this" glow)
let hovered = new Set();
function updateHover() {
  for (const P of hovered) if (!glowing.has(P)) P.mesh.traverse(o => { if (o.isMesh && o.material.emissive && !P.rings.includes(o)) o.material.emissive.setHex(0x000000); });
  hovered = new Set();
  for (const h of hands) {
    if (!h.tracked || h.grab || h.pinch) continue;
    const P = pickPart(h.pos); if (!P || glowing.has(P)) continue;
    hovered.add(P); P.mesh.traverse(o => { if (o.isMesh && o.material.emissive && !P.rings.includes(o)) o.material.emissive.setHex(0x1d3a50); });
  }
}
// grabbed: the part lifts a little and casts a soft shadow on the bench
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const shadows = hands.map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.visible = false; bench.add(m); return m; });
function updateShadows() {
  hands.forEach((h, k) => {
    const m = shadows[k]; m.visible = false;
    if (!h.grab || h.grab.mode === 'pullapart') return;
    const P = h.grab.P, p = P.mode === 'bench' ? new THREE.Vector3(P.x, 0, P.z) : benchLocal(new THREE.Vector3().setFromMatrixPosition(P.world));
    if (Math.abs(p.x) > 0.34 || p.z < BENCH.d0 - 0.05 || p.z > BENCH.d1 + 0.05) return;
    const r = radiusOf(P) * 2.2 * (P.mode === 'free' ? Math.max(0.6, 1 - (p.y || 0) * 2) : 1);
    m.position.set(p.x, 0.0009, p.z); m.scale.set(r, r, 1); m.visible = true;
  });
}
// hands in passthrough: a depth-only mask so your real hands show in front of virtual parts (never a full virtual hand)
const FINGERS = [['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']].concat(['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'].map(f => [f + '-metacarpal', f + '-phalanx-proximal', f + '-phalanx-intermediate', f + '-phalanx-distal', f + '-tip']));
const BONES = [];
for (const chain of FINGERS) { BONES.push(['wrist', chain[0]]); for (let k = 0; k < chain.length - 1; k++) BONES.push([chain[k], chain[k + 1]]); }
BONES.push(['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal'], ['middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'], ['ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal'], ['wrist', 'middle-finger-phalanx-proximal'], ['thumb-metacarpal', 'index-finger-phalanx-proximal']);
const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false });
const handVisibleMat = new THREE.MeshBasicMaterial({ color: 0xdfe9f7, transparent: true, opacity: 0.55 });
const handBones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), handVisibleMat, BONES.length * 2);
handBones.frustumCulled = false; handBones.count = 0; handBones.renderOrder = -1; scene.add(handBones);
function updateHandMask() {
  const mat = passthrough ? maskMat : handVisibleMat;
  handBones.material = mat; handJoints.material = mat; handJoints.renderOrder = -1;
  let n = 0; const m = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  for (const h of hands) {
    if (!h.xr || !h.tracked) continue;
    for (const [u, v] of BONES) {
      const ju = h.xr.joints[u], jv = h.xr.joints[v]; if (!ju || !jv || !ju.visible || !jv.visible) continue;
      ju.getWorldPosition(a); jv.getWorldPosition(b);
      const len = a.distanceTo(b); if (len < 1e-4) continue;
      const r = Math.max(0.006, ((ju.jointRadius || 0.008) + (jv.jointRadius || 0.008)) * 0.55);
      q.setFromUnitVectors(Y, b.clone().sub(a).normalize());
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, _s.set(r, len, r)); handBones.setMatrixAt(n++, m);
    }
  }
  handBones.count = n; handBones.instanceMatrix.needsUpdate = true;
}
// each finished step plays the next note of a little tune, and a paper note floats up (sound and sight together)
const MELODY = [523, 587, 659, 784, 659, 880, 784, 659, 587, 659, 784, 1047, 880, 784, 1047];
const noteGeoHead = new THREE.SphereGeometry(0.008, 12, 8), noteGeoStem = new THREE.BoxGeometry(0.0022, 0.03, 0.0022);
const floatNotes = [0, 1, 2, 3, 4].map(() => { const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0xf0a03c, transparent: true }); const hd = new THREE.Mesh(noteGeoHead, mat); hd.scale.set(1.2, 0.8, 1); const st = new THREE.Mesh(noteGeoStem, mat); st.position.set(0.008, 0.015, 0); g.add(hd, st); g.visible = false; g.userData = { t: 1, mat }; scene.add(g); return g; });
function floatNote(p) { const g = floatNotes.find(n => n.userData.t >= 1) || floatNotes[0]; g.position.copy(p); g.userData.t = 0; g.userData.y0 = p.y; g.visible = true; }
function updateNotes(dt) { const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera, cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld); for (const g of floatNotes) { if (g.userData.t >= 1) { g.visible = false; continue; } g.userData.t = Math.min(1, g.userData.t + dt / 1.6); g.position.y = g.userData.y0 + 0.18 * g.userData.t; g.position.x += Math.sin(clock * 6) * 0.0004; g.userData.mat.opacity = 1 - g.userData.t * g.userData.t; g.lookAt(cp.x, g.position.y, cp.z); } }
let lastTouched = null;
function rewardStep(i) {
  const at = lastTouched ? (lastTouched.mode === 'bench' ? benchWorld(lastTouched.x, 0.03, lastTouched.z) : new THREE.Vector3().setFromMatrixPosition(lastTouched.world)) : benchWorld(0.05, 0.03, 0.025);
  floatNote(at);
  if (i === 4) { [0, 1, 2, 3, 4].forEach(k => setTimeout(() => sound('note', MELODY[k]), k * 170)); [0.12, 0.3].forEach(d => setTimeout(() => floatNote(at.clone().add(new THREE.Vector3(d - 0.2, 0, 0))), d * 900)); }
  else sound('note', MELODY[i % MELODY.length]);
}
// a ghost hand shows the pinch over the part to use (steps 1-2, or whenever you have been idle for 20 s)
const ghostHand = new THREE.Group();
{
  // a slim outline-like hand: palm behind the part (toward you), thumb and index reaching down to it
  const mat = new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.3, depthWrite: false });
  const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.02, 4, 10), mat); palm.rotation.x = Math.PI / 2; palm.scale.set(1, 1, 0.45); palm.position.set(0, 0.05, 0.065); ghostHand.add(palm);
  const mk = (x, len) => { const piv = new THREE.Group(); piv.position.set(x, 0.045, 0.045); piv.rotation.x = -0.75; const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0055, len, 4, 8), mat); f.position.set(0, -len / 2, 0); piv.add(f); ghostHand.add(piv); return piv; };
  ghostHand.userData.index = mk(0.009, 0.05); ghostHand.userData.thumb = mk(-0.012, 0.04);
  ghostHand.visible = false; bench.add(ghostHand);
}
function updateGhostHand() {
  ghostHand.visible = false;
  if (calibrating || paused || guide.doneT > 0 || hands.some(h => h.grab)) return;
  if (!(guide.i <= 1 || clock - lastActivity > 20)) return;
  const f = CUES[guide.i]; if (!f) return;
  const c = f().find(c => c && c.P && c.P.mode === 'bench'); if (!c) return;
  const t = (clock % 2.4) / 2.4, ease = u => u * u * (3 - 2 * u);
  let y, close;
  if (t < 0.35) { y = 0.1 - 0.075 * ease(t / 0.35); close = 0; }
  else if (t < 0.5) { y = 0.025; close = (t - 0.35) / 0.15; }
  else if (t < 0.85) { y = 0.025 + 0.06 * ease((t - 0.5) / 0.35); close = 1; }
  else { y = 0.085; close = 1 - (t - 0.85) / 0.15; }
  ghostHand.position.set(c.P.x, y + layerY(c.P) - 0.01, c.P.z);
  ghostHand.userData.index.rotation.z = 0.2 - 0.18 * close; ghostHand.userData.thumb.rotation.z = -0.35 + 0.3 * close;
  ghostHand.visible = true;
}

// ---------- main loop ----------
let lastT = performance.now();
function update(dt) {
  clock += dt; pokeCooldown = Math.max(0, pokeCooldown - dt);
  if (renderer.xr.isPresenting) readXRHands(dt);
  for (const h of hands) {
    if (h.lostT) continue; // frozen while tracking is lost
    if (h.pinch && !h.wasPinch) onPinchStart(h);
    else if (!h.pinch && h.wasPinch) { if (h.ignore) h.ignore = false; else onPinchEnd(h); h.releasedT = clock; }
    h.wasPinch = h.pinch;
  }
  stackParts();
  drags.length = 0;
  if (!paused) { for (const h of hands) if (!h.lostT && !h.ignore) onHandMove(h, dt); solve(); }
  checkBreaks(dt);
  if (renderer.xr.isPresenting && !paused) for (const h of hands) if (h.tracked && !h.pinch && !h.grab && clock - (h.releasedT || -9) > 0.4 && h.tipPrev.y - h.tip.y > 0.0005) poke(h.tip);
  board.visible = renderer.xr.isPresenting;
  if (!paused) guideTick(dt);
  updateCues(); updateHover(); updateShadows(); updateGhostHand(); updateFlashes(dt); updateNotes(dt);
  if (renderer.xr.isPresenting) updateHandMask();
  for (const b of buttons) { b.pressT = Math.max(0, b.pressT - dt); b.mesh.position.y = 0.012 - 0.007 * Math.min(1, b.pressT / 0.12); }
  if (benchIntro < 1) { benchIntro = Math.min(1, benchIntro + dt / 0.5); const e = 1 - Math.pow(1 - benchIntro, 3); bench.scale.setScalar(0.85 + 0.15 * e); }
  if (guide.dirty || guide.doneT > 0) { drawBoard(); guide.dirty = false; }
  updateTrails();
  updateVisuals();
}
// ---------- performance meter: is it holding 72 Hz on the headset? ----------
const perf = { target: 72, n: 0, slow: 0, sum: 0, worst: 0, win: [], calls: 0, tris: 0, shownT: 0, startT: 0 };
const perfCanvas = document.createElement('canvas'); perfCanvas.width = 640; perfCanvas.height = 300;
const perfTex = new THREE.CanvasTexture(perfCanvas); perfTex.colorSpace = THREE.SRGBColorSpace;
const perfPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.075), new THREE.MeshBasicMaterial({ map: perfTex, transparent: true }));
perfPanel.position.set(0.26, 0.09, -0.46); perfPanel.rotation.set(-0.18, -0.22, 0, 'YXZ'); bench.add(perfPanel);
function perfReset() { Object.assign(perf, { n: 0, slow: 0, sum: 0, worst: 0, win: [], startT: performance.now() }); }
function perfFrame(ms) {
  if (ms <= 0 || ms > 1000) return;
  const budget = 1000 / perf.target;
  perf.n++; perf.sum += ms; if (ms > budget * 1.5) perf.slow++; if (perf.n > 30) perf.worst = Math.max(perf.worst, ms);
  perf.win.push(ms); if (perf.win.length > perf.target * 5) perf.win.shift();
}
function perfStats() {
  const w = perf.win, avg = w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0, sorted = [...w].sort((a, b) => a - b);
  return { fps: avg ? 1000 / avg : 0, p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0, sessionFps: perf.sum ? 1000 * perf.n / perf.sum : 0, slowPct: perf.n ? 100 * perf.slow / perf.n : 0, worst: perf.worst, secs: (performance.now() - perf.startT) / 1000 };
}
function drawPerf() {
  const x = perfCanvas.getContext('2d'), st = perfStats(), ok = st.fps >= perf.target * 0.97 && st.slowPct < 1;
  x.clearRect(0, 0, 640, 300); x.fillStyle = 'rgba(31,44,69,0.92)'; x.beginPath(); x.roundRect(0, 0, 640, 300, 30); x.fill();
  x.fillStyle = '#f0a03c'; x.font = '600 30px system-ui, sans-serif'; x.fillText(`PERFORMANCE \u00b7 TARGET ${perf.target} Hz`, 30, 50);
  x.fillStyle = ok ? '#5fbf6a' : st.fps >= 60 ? '#f0a03c' : '#e0645a'; x.font = '700 64px system-ui, sans-serif';
  x.fillText(`${st.fps.toFixed(1)} fps ${ok ? '\u2713' : '!'}`, 30, 125);
  x.fillStyle = '#e3e6ee'; x.font = '400 30px system-ui, sans-serif';
  x.fillText(`slow frames ${st.slowPct.toFixed(1)}% \u00b7 95th pct ${st.p95.toFixed(1)} ms`, 30, 178);
  x.fillText(`${perf.calls} draws \u00b7 ${(perf.tris / 1000).toFixed(0)}k triangles \u00b7 sound ${audioState()}`, 30, 222);
  x.fillStyle = 'rgba(227,230,238,0.7)'; x.fillText(`over ${st.secs.toFixed(0)} s: ${st.sessionFps.toFixed(1)} fps avg`, 30, 266);
  perfTex.needsUpdate = true;
  const d = document.getElementById('perf'); if (d) d.textContent = `${perf.calls} draws · ${(perf.tris / 1000).toFixed(0)}k triangles · ${st.fps.toFixed(0)} fps (browser)`;
}
let lastFrameT = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (lastFrameT) perfFrame(now - lastFrameT); lastFrameT = now;
  update(dt);
  perfPanel.visible = renderer.xr.isPresenting && bench.visible;
  renderer.render(scene, camera);
  perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;
  if (now - perf.shownT > 500) { perf.shownT = now; drawPerf(); }
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
    const session = await navigator.xr.requestSession(ar ? 'immersive-ar' : 'immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'plane-detection'] });
    passthrough = ar;
    if (ar) scene.background = null;
    renderer.xr.setFoveation(1);
    await renderer.xr.setSession(session);
    // ask for a steady 72 Hz (Meta's minimum refresh rate for Quest apps)
    try { if (session.updateTargetFrameRate && session.supportedFrameRates) { const rates = [...session.supportedFrameRates]; const want = rates.includes(72) ? 72 : Math.min(...rates.filter(r => r >= 72)); if (isFinite(want)) { await session.updateTargetFrameRate(want); perf.target = want; } } } catch (e) {}
    for (const ev of ['selectstart', 'select', 'squeezestart']) session.addEventListener(ev, audio);
    document.addEventListener('visibilitychange', audio);
    audio(); setTimeout(() => sound('chime'), 400);
    perfReset(); lastFrameT = 0;
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
  screen(x, y, z) { const v = benchWorld(x, y, z).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, pick(x, y, z) { const P = pickPart(benchWorld(x, y, z)); return P && P.id; },
  reset: resetParts, perf, perfStats, perfCanvas, guide, STEPS, enterStep, square: () => { const s = square(); return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && v.id])); }
};
