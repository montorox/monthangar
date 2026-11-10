/* Model doctor (runs in the browser page that doctor.mjs opens).
   1. finds the heading: up = thinnest axis, span = the mirror-symmetric axis, nose = the end without the tall fin
   2. splits landing gear and propellers out of merged meshes into named nodes (gear_N, prop_N) with pivots at the hub
   3. grades the detail and reports what it found
   Everything is measured, then written back as a clean GLB that the engine loads as-is. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const AX = ['x', 'y', 'z'];
const log = [];
const say = m => { log.push(m); console.log('MH doctor: ' + m); };

function samplePoints(root, max = 160000) {
  const pts = []; root.updateMatrixWorld(true); let total = 0;
  root.traverse(o => { if (o.isMesh) total += o.geometry.attributes.position.count; });
  const step = Math.max(1, Math.floor(total / max)); const v = new THREE.Vector3();
  root.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push(v.x, v.y, v.z); } });
  return new Float32Array(pts);
}
function bbox(P) { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); } return { mn, mx, ex: mx.map((m, k) => m - mn[k]), c: mx.map((m, k) => (m + mn[k]) / 2) }; }
/* mirror error: reflect across the centre plane of an axis, mean distance to the nearest original point (grid hash) */
function mirrorError(P, b, axis) {
  const cell = Math.max(...b.ex) / 60; const grid = new Map(); const key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < P.length; i += 3) { const k = key(P[i], P[i + 1], P[i + 2]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
  let err = 0, n = 0; const step = Math.max(3, Math.floor(P.length / 3 / 6000)) * 3;
  for (let i = 0; i < P.length; i += step) {
    const q = [P[i], P[i + 1], P[i + 2]]; q[axis] = 2 * b.c[axis] - q[axis];
    let best = cell * 3; const cx = Math.floor(q[0] / cell), cy = Math.floor(q[1] / cell), cz = Math.floor(q[2] / cell);
    for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c = -1; c <= 1; c++) { const L = grid.get(`${cx + a},${cy + bb},${cz + c}`); if (!L) continue; for (const j of L) { const d = Math.hypot(P[j] - q[0], P[j + 1] - q[1], P[j + 2] - q[2]); if (d < best) best = d; } }
    err += best; n++;
  }
  return err / n / Math.max(...b.ex);
}
function bodyPoints(root, fus, b) {
  const out = []; const v = new THREE.Vector3(); const L = b.ex[fus];
  root.traverse(o => { if (!o.isMesh || o.geometry.attributes.position.count > 1.5e6) return;
    const comps = components(o.geometry);
    for (const tris of comps) { const bb = triBox(o.geometry, tris, o.matrixWorld); const sz = bb.getSize(new THREE.Vector3()).toArray(); const others = Math.max(...sz.filter((_, k) => k !== fus));
      if (sz[fus] < 0.15 * others && Math.max(...sz) < 0.4 * L) continue;
      const g = o.geometry, idx = g.index ? g.index.array : null, p = g.attributes.position; const step = Math.max(1, Math.floor(tris.length / 400));
      for (let i = 0; i < tris.length; i += step) { const vi = idx ? idx[3 * tris[i]] : 3 * tris[i]; v.fromBufferAttribute(p, vi).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); } } });
  return new Float32Array(out);
}
/* the end of the fuselage axis whose points reach highest above the axis line is the tail (the fin) */
function finEnd(P, b, fus, up) {
  const L = b.ex[fus]; const res = {};
  for (const end of [-1, 1]) {
    const lim = end < 0 ? b.mn[fus] + L * 0.18 : b.mx[fus] - L * 0.18; let hi = -1e9, lo = 1e9; let n = 0;
    for (let i = 0; i < P.length; i += 3) { const f = P[i + fus]; if (end < 0 ? f < lim : f > lim) { hi = Math.max(hi, P[i + up]); lo = Math.min(lo, P[i + up]); n++; } }
    res[end] = { hi, lo, n };
  }
  return res;
}
export function heading(root) {
  const P = samplePoints(root); const b = bbox(P);
  const order = [0, 1, 2].sort((a, c) => b.ex[a] - b.ex[c]);
  let up = order[0];
  const horiz = [0, 1, 2].filter(a => a !== up);
  const e0 = mirrorError(P, b, horiz[0]), e1 = mirrorError(P, b, horiz[1]);
  const span = e0 < e1 ? horiz[0] : horiz[1], fus = span === horiz[0] ? horiz[1] : horiz[0];
  const conf = Math.abs(e0 - e1) / Math.max(e0, e1, 1e-9);
  say(`extents ${b.ex.map(x => x.toFixed(2)).join(' x ')}; up=${AX[up]}; mirror error ${AX[horiz[0]]} ${e0.toFixed(4)} vs ${AX[horiz[1]]} ${e1.toFixed(4)} -> span=${AX[span]}, fuselage=${AX[fus]} (confidence ${(conf * 100).toFixed(0)}%)`);
  /* drop prop blades and discs (thin along the fuselage axis) so they can't pose as a fin or a tailplane */
  const keep = bodyPoints(root, fus, b);
  const Q = keep.length > 300 ? keep : P;
  const ends = finEnd(Q, b, fus, up);
  /* nose = the end that is narrower in span (the tail carries a tailplane or the wing's trailing area); the fin breaks ties */
  const spread = end => { const L = b.ex[fus]; const lim = end < 0 ? b.mn[fus] + L * 0.16 : b.mx[fus] - L * 0.16; let lo = 1e9, hi = -1e9; for (let i = 0; i < Q.length; i += 3) { const f = Q[i + fus]; if (end < 0 ? f < lim : f > lim) { lo = Math.min(lo, Q[i + span]); hi = Math.max(hi, Q[i + span]); } } return hi - lo; };
  const sN = spread(-1), sP = spread(1); const mid = b.c[up];
  const finN = ends[-1].hi - mid, finP = ends[1].hi - mid;
  let tailEnd;
  if (Math.abs(sN - sP) > 0.12 * Math.max(sN, sP)) tailEnd = sN > sP ? -1 : 1; else tailEnd = finN > finP ? -1 : 1;
  /* glTF is Y-up by specification, so trust +Y; other exports: the fin rises above the tail more than anything hangs below it */
  const t = ends[tailEnd]; const upSign = up === 1 ? 1 : ((t.hi - mid) >= (mid - t.lo) ? 1 : -1);
  const noseSign = -tailEnd;
  say(`span at the ends: ${sN.toFixed(2)} (-${AX[fus]}) vs ${sP.toFixed(2)} (+${AX[fus]}); fin height ${finN.toFixed(2)} vs ${finP.toFixed(2)} -> tail at ${tailEnd < 0 ? '-' : '+'}${AX[fus]}, up ${upSign > 0 ? '+' : '-'}${AX[up]}`);
  /* rotation that sends nose -> +Z and up -> +Y */
  const nose = new THREE.Vector3(); nose.setComponent(fus, noseSign);
  const upv = new THREE.Vector3(); upv.setComponent(up, upSign);
  const side = new THREE.Vector3().crossVectors(upv, nose); /* +X in engine frame = up x nose */
  const m = new THREE.Matrix4().makeBasis(side, upv, nose).invert();
  const e = new THREE.Euler().setFromRotationMatrix(m, 'YXZ');
  const deg = [e.x, e.y, e.z].map(r => { let d = r * 180 / Math.PI; const q = Math.round(d / 90) * 90; return Math.abs(d - q) < 1 ? (q === -0 ? 0 : q) : +d.toFixed(2); });
  return { rotate: deg, confidence: +conf.toFixed(2), up: (upSign > 0 ? '+' : '-') + AX[up], nose: (noseSign > 0 ? '+' : '-') + AX[fus], span: AX[span] };
}

/* ---------- connected components ---------- */
function components(geom) {
  const pos = geom.attributes.position; const idx = geom.index ? geom.index.array : null; const nTri = (idx ? idx.length : pos.count) / 3;
  const q = 1e4; const keyOf = new Int32Array(pos.count); const map = new Map(); let nk = 0;
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`; let id = map.get(k); if (id === undefined) { id = nk++; map.set(k, id); } keyOf[i] = id; }
  const par = new Int32Array(nk); for (let i = 0; i < nk; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const v = t => idx ? idx[t] : t;
  for (let t = 0; t < nTri; t++) { const a = find(keyOf[v(3 * t)]), b = find(keyOf[v(3 * t + 1)]), c = find(keyOf[v(3 * t + 2)]); if (a !== b) par[a] = b; const b2 = find(b); if (find(c) !== b2) par[find(c)] = b2; }
  const comp = new Map();
  for (let t = 0; t < nTri; t++) { const r = find(keyOf[v(3 * t)]); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(t); }
  return [...comp.values()];
}
function subGeometry(geom, tris) {
  const idx = geom.index ? geom.index.array : null; const used = new Map(); const newIdx = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { const vi = idx ? idx[3 * t + k] : 3 * t + k; let ni = used.get(vi); if (ni === undefined) { ni = used.size; used.set(vi, ni); } newIdx.push(ni); }
  const g = new THREE.BufferGeometry(); const order = [...used.keys()];
  for (const name in geom.attributes) { const a = geom.attributes[name]; const arr = new a.array.constructor(order.length * a.itemSize); order.forEach((vi, j) => { for (let c = 0; c < a.itemSize; c++) arr[j * a.itemSize + c] = a.array[vi * a.itemSize + c]; }); g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized)); }
  g.setIndex(newIdx); return g;
}
function triBox(geom, tris, mw) {
  const idx = geom.index ? geom.index.array : null; const p = geom.attributes.position; const b = new THREE.Box3(); const v = new THREE.Vector3();
  for (const t of tris) for (let k = 0; k < 3; k++) { const vi = idx ? idx[3 * t + k] : 3 * t + k; v.fromBufferAttribute(p, vi).applyMatrix4(mw); b.expandByPoint(v); }
  return b;
}

/* ---------- the splitter ----------
   In the normalised frame (metres, nose +Z, up +Y, wheels on y=0):
   gear  = small parts whose box sits low (below gearY) — wheels, struts, doors hanging down
   props = thin discs across the nose axis in front of an engine; blades and spinner grouped by hub */
export function split(root, opt) {
  root.updateMatrixWorld(true);
  const all = new THREE.Box3().setFromObject(root); const S = all.getSize(new THREE.Vector3());
  const L = S.z, H = S.y; const gearY = opt.gearY ?? 0.3 * H; const maxPart = opt.maxPart ?? 0.3;
  const named = { gear: [], prop: [] };
  root.traverse(o => { if (!o.name) return; if (/(^|_)(gear|wheel|tyre|tire|strut|undercarriage|landing)/i.test(o.name) && !/door/i.test(o.name)) named.gear.push(o); if (/(prop|propeller|rotor|airscrew|blades?)(_|\b|$)/i.test(o.name) && !/(proper|property)/i.test(o.name)) named.prop.push(o); });
  const gearCand = [], propCand = [];
  const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const allTris = g => [...Array((g.index ? g.index.count : g.attributes.position.count) / 3).keys()];
  const useNames = opt.useNames !== false && (named.gear.length || named.prop.length);
  for (const m of meshes) {
    const isG = /(^|_)(gear|wheel|tyre|tire|strut|undercarriage|landing)/i.test(m.name) && !/door/i.test(m.name);
    const isP = /(prop|propeller|rotor|airscrew|blades?)(_|\b|$)/i.test(m.name) && !/(proper|property)/i.test(m.name);
    if (useNames) {
      if (isG || isP) { const tris = allTris(m.geometry); const b = triBox(m.geometry, tris, m.matrixWorld); const k = { m, tris, b, c: b.getCenter(new THREE.Vector3()), sz: b.getSize(new THREE.Vector3()), named: true }; (isG ? gearCand : propCand).push(k); }
      continue;
    }
    if (m.geometry.attributes.position.count > 1.5e6) continue;
    const comps = components(m.geometry);
    if (opt.debug) { const bb = new THREE.Box3().setFromObject(m); say(`mesh ${m.name} comps ${comps.length} box ${bb.min.toArray().map(v=>v.toFixed(1))} .. ${bb.max.toArray().map(v=>v.toFixed(1))}`); }
    for (const tris of comps) {
      const b = triBox(m.geometry, tris, m.matrixWorld); const sz = b.getSize(new THREE.Vector3()); const c = b.getCenter(new THREE.Vector3()); const md = Math.max(sz.x, sz.y, sz.z);
      if (opt.props !== false && sz.z < (md > 0.12 * L ? 0.35 : 0.18) * Math.max(sz.x, sz.y) && md > 0.04 * L && md < 0.65 * L && c.y > 0.05 * H) { propCand.push({ m, tris, b, c, sz }); continue; }
      if (md > maxPart * L) continue;
      if (b.max.y < gearY + 0.04 * H && b.min.y < 0.22 * H && opt.gear !== false) gearCand.push({ m, tris, b, c });
    }
  }
  /* group candidates into sets by distance in the horizontal plane */
  const group = (cands, rad) => { const sets = []; for (const k of cands) { let s = sets.find(S2 => S2.some(o => Math.hypot(o.c.x - k.c.x, o.c.z - k.c.z) < rad)); if (s) s.push(k); else sets.push([k]); } return sets; };
  const gearSets = group(gearCand, 0.12 * L);
  /* a prop is a ring of blades: keep sets whose box is as tall as it is wide */
  const groupBy = cands => { const sets = []; for (const k of cands) { const md = k2 => Math.max(k2.sz ? Math.max(k2.sz.x, k2.sz.y) : 0, 0.02 * L); let s2 = sets.find(S2 => S2.some(o => o.c.distanceTo(k.c) < 0.75 * (md(o) + md(k)))); if (s2) s2.push(k); else sets.push([k]); } return sets; };
  if (opt.debug) groupBy(propCand).forEach(set => { const b = new THREE.Box3(); set.forEach(k => b.union(k.b)); say(`prop group of ${set.length}: size ${b.getSize(new THREE.Vector3()).toArray().map(v=>v.toFixed(2))} centre ${b.getCenter(new THREE.Vector3()).toArray().map(v=>v.toFixed(2))} parts at ${set.map(k=>k.c.toArray().map(v=>v.toFixed(1)).join('/')).join(' ')}`); });
  const propSets = groupBy(propCand).filter(set => { if (set.some(k => k.named)) return true; const b = new THREE.Box3(); set.forEach(k => b.union(k.b)); const sz = b.getSize(new THREE.Vector3()); return Math.abs(sz.x - sz.y) < 0.35 * Math.max(sz.x, sz.y) && sz.z < 0.35 * sz.x && Math.max(sz.x, sz.y) > 0.1 * L; });
  const made = { gear: [], prop: [] };
  const take = (sets, kind) => sets.forEach((set, i) => {
    const b = new THREE.Box3(); set.forEach(k => b.union(k.b)); const pivotW = b.getCenter(new THREE.Vector3());
    if (kind === 'prop') { /* hub: blades are alike, so the mean of their centres is the hub */ const m2 = new THREE.Vector3(); set.forEach(k => m2.add(k.c)); m2.divideScalar(set.length); pivotW.x = m2.x; pivotW.y = m2.y; }
    const node = new THREE.Group(); node.name = `${kind}_${i + 1}`;
    root.add(node); node.position.copy(root.worldToLocal(pivotW.clone()));
    for (const k of set) {
      const g = subGeometry(k.m.geometry, k.tris); const part = new THREE.Mesh(g, k.m.material); part.name = `${kind}_${i + 1}_part`;
      /* bake the source mesh transform, then offset by the pivot */
      g.applyMatrix4(k.m.matrixWorld); g.applyMatrix4(new THREE.Matrix4().makeTranslation(-pivotW.x, -pivotW.y, -pivotW.z));
      node.add(part); k.m.userData.remove = (k.m.userData.remove || new Set()); k.tris.forEach(t => k.m.userData.remove.add(t));
    }
    made[kind].push({ node: node.name, at: pivotW.toArray().map(v => +v.toFixed(3)), size: b.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)), parts: set.length });
  });
  take(gearSets, 'gear'); take(propSets, 'prop');
  /* rebuild the source meshes without the triangles that moved */
  for (const m of meshes) if (m.userData.remove) { const geo = m.geometry; const n = (geo.index ? geo.index.count : geo.attributes.position.count) / 3; const keep = []; for (let t = 0; t < n; t++) if (!m.userData.remove.has(t)) keep.push(t); m.geometry = subGeometry(geo, keep); delete m.userData.remove; }
  for (const m of meshes) if (((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) || 0) === 0) m.parent.remove(m);
  say(`prop candidates: ${propCand.map(k => k.sz ? k.sz.toArray().map(v => v.toFixed(2)).join('x') : '?').join(' ')}`);
  say(`gear: ${made.gear.length} set(s) ${useNames ? '(from part names)' : `from ${gearCand.length} low parts`}; props: ${made.prop.length} ${useNames ? '(from part names)' : `from ${propCand.length} disc parts`}`);
  return made;
}

export function grade(root) {
  let tris = 0, meshes = 0; const mats = new Set(), tex = new Set();
  root.traverse(o => { if (!o.isMesh) return; meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { mats.add(m.uuid); ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(k => m[k] && tex.add(m[k].uuid)); }); });
  let g = tris >= 250000 ? 'A' : tris >= 80000 ? 'B' : tris >= 25000 ? 'C' : 'D';
  if (!tex.size && g < 'C') g = String.fromCharCode(g.charCodeAt(0) + 1);
  const why = `${Math.round(tris).toLocaleString()} triangles, ${meshes} meshes, ${mats.size} materials, ${tex.size} textures`;
  say(`detail grade ${g}: ${why}`);
  return { grade: g, triangles: Math.round(tris), meshes, materials: mats.size, textures: tex.size, note: { A: 'hero: close-ups and thumbnails', B: 'good: walkarounds, flight, medium close-ups', C: 'background and distant flight only', D: 'too crude for a hero; find a better model' }[g] };
}

/* driver: load, orient, scale, ground, split, export */
export async function run(url, opt = {}) {
  const loader = new GLTFLoader(); const dr = new DRACOLoader(); dr.setDecoderPath('/nm/three/examples/jsm/libs/draco/'); loader.setDRACOLoader(dr); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url); const scene = gltf.scene;
  const head = opt.rotate ? { rotate: opt.rotate, confidence: 1, given: true } : heading(scene);
  if (opt.rotate) say(`rotation given: ${opt.rotate}`);
  const r = head.rotate.map(d => d * Math.PI / 180);
  /* bake orientation, scale and grounding into one root so the exported model needs no rotate */
  const root = new THREE.Group(); root.name = 'monthangar_root';
  const holder = new THREE.Group(); holder.rotation.set(r[0], r[1], r[2], 'YXZ'); holder.add(scene); root.add(holder);
  root.updateMatrixWorld(true);
  let b = new THREE.Box3().setFromObject(scene); const sz = b.getSize(new THREE.Vector3());
  const k = opt.length_m ? opt.length_m / sz.z : 1; holder.scale.setScalar(k);
  root.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(scene); const c = b.getCenter(new THREE.Vector3());
  holder.position.set(-c.x, -b.min.y, -c.z); root.updateMatrixWorld(true);
  /* flatten: bake every mesh into root space so splitting and export see one clean frame */
  const flat = new THREE.Group(); flat.name = opt.id || 'aircraft';
  const ms = []; scene.traverse(o => { if (o.isMesh) ms.push(o); });
  const keepNames = /(gear|wheel|tyre|tire|strut|prop|rotor|blade|aileron|elevator|rudder|flap|canopy|door|bay)/i;
  for (const m of ms) { const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); const mesh = new THREE.Mesh(g, m.material); let nm = m.name; let p = m.parent; while ((!nm || !keepNames.test(nm)) && p && p !== scene) { if (p.name && keepNames.test(p.name)) { nm = p.name; break; } p = p.parent; } mesh.name = nm || m.name; flat.add(mesh); }
  const sizeNow = new THREE.Box3().setFromObject(flat).getSize(new THREE.Vector3());
  say(`normalised size ${sizeNow.z.toFixed(2)} m long, ${sizeNow.x.toFixed(2)} m span, ${sizeNow.y.toFixed(2)} m tall`);
  const made = opt.split === false ? { gear: [], prop: [] } : split(flat, opt);
  const gr = grade(flat);
  const exp = new GLTFExporter();
  const glb = await exp.parseAsync(flat, { binary: true, onlyVisible: false });
  const bytes = new Uint8Array(glb); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const bbox2 = new THREE.Box3().setFromObject(flat);
  return { glb: btoa(bin), heading: head, dims: { length_m: +sizeNow.z.toFixed(2), span_m: +sizeNow.x.toFixed(2), height_m: +sizeNow.y.toFixed(2) }, box: { min: bbox2.min.toArray(), max: bbox2.max.toArray() }, made, grade: gr, log };
}
