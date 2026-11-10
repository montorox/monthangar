/* Subjects: load a verified model from the shared library, normalise it to metres
   (nose +Z, up +Y, port wing +X, wheels on y = 0), and give shots what they need:
   anchors, named parts, gear, spinning parts, rim light for dark paint, x-ray and highlight. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { R, warn, rad } from './mh-core.js';

const loader = new GLTFLoader();
const draco = new DRACOLoader(); draco.setDecoderPath('/nm/three/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco); loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

/* subject spec from the timeline: { id, url, meta } where meta is the library's subject.json */
export function loadSubject(id) {
  if (cache.has(id)) return cache.get(id);
  const spec = (R.tl.subjects || {})[id];
  if (!spec) { warn(`subject "${id}" is not in the timeline; add it to config.json subjects`); return Promise.resolve(null); }
  const p = loader.loadAsync(spec.url).then(g => normalise(g.scene, spec.meta || {}, id));
  cache.set(id, p); return p;
}

function normalise(scene, meta, id) {
  const pivot = new THREE.Group(); pivot.name = 'pivot';
  const r = meta.rotate || [0, 0, 0]; pivot.rotation.set(rad(r[0]), rad(r[1]), rad(r[2]), 'YXZ');
  pivot.add(scene);
  const root = new THREE.Group(); root.name = id; root.add(pivot);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const k = meta.length_m ? meta.length_m / Math.max(1e-6, size.z) : 1;
  pivot.scale.setScalar(k);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(scene);
  const c = b2.getCenter(new THREE.Vector3());
  pivot.position.set(-c.x, -b2.min.y, -c.z);
  root.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(scene), dims = box3.getSize(new THREE.Vector3());
  /* materials: sharper textures, shadows, and a luminance estimate for dark paint */
  let lum = 0, n = 0;
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.geometry.userData.shared = true;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      m.userData.shared = true;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (m[key]) { m[key].anisotropy = 8; m[key].userData.shared = true; }
      if (m.color) { const cc = m.color; const l = 0.2126 * cc.r + 0.7152 * cc.g + 0.0722 * cc.b; lum += m.map ? Math.max(l * 0.6, 0.25) : l; n++; }
    });
  });
  const dark = n ? lum / n < 0.12 : false;
  const nodes = {}; scene.traverse(o => { if (o.name) nodes[o.name] = o; });
  const gearNodes = (meta.gear || []).flatMap(g => findNodes(nodes, g));
  if ((meta.gear || []).length && !gearNodes.length) warn(`${id}: gear nodes ${JSON.stringify(meta.gear)} not found in the model; run the model doctor`);
  const spin = (meta.spin || []).map(s => ({ ...s, objs: findNodes(nodes, s.node) })).filter(s => s.objs.length);
  const skip = new Set([...gearNodes, ...spin.flatMap(x => x.objs)]); scene.updateMatrixWorld(true);
  const anchors = { ...autoAnchors(box3, surfacePoints(scene, skip)), ...(meta.anchors || {}) };
  const S = { id, meta, root, dims: { length: dims.z, span: dims.x, height: dims.y }, box: box3, dark, nodes, gearNodes, spin, anchors,
    radius: Math.max(dims.x, dims.z) * 0.5, name: meta.name || id };
  return S;
}
function findNodes(nodes, pat) {
  if (nodes[pat]) return [nodes[pat]];
  let re; try { re = new RegExp(pat, 'i'); } catch { return []; }
  return Object.values(nodes).filter(o => re.test(o.name));
}
/* anchors from the real surface, not the bounding box: the box's corners float in the air (a propeller blade sets "top",
   a gull wing's tip is not at mid height). Spinning parts and gear are left out where they would mislead. */
function surfacePoints(scene, skip) {
  const pts = []; const v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    for (let q = o; q; q = q.parent) if (skip.has(q)) return;
    const a = o.geometry.attributes.position; const step = Math.max(1, Math.floor(a.count / 4000));
    for (let i = 0; i < a.count; i += step) { v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); pts.push([v.x, v.y, v.z]); }
  });
  return pts;
}
function autoAnchors(b, pts) {
  const midY = (b.min.y + b.max.y) / 2;
  const A = { center: [0, midY, 0], nose: [0, midY, b.max.z], tail: [0, midY, b.min.z], top: [0, b.max.y, b.min.z * 0.7], belly: [0, b.min.y, 0],
    wingtip_l: [b.max.x, midY, 0], wingtip_r: [b.min.x, midY, 0], ground_nose: [0, 0, b.max.z], ground_tail: [0, 0, b.min.z],
    ground_l: [b.max.x, 0, 0], ground_r: [b.min.x, 0, 0], tail_top: [0, b.max.y, b.min.z * 0.85] };
  if (!pts || pts.length < 50) return A;
  const sx = b.max.x - b.min.x, sz = b.max.z - b.min.z;
  const mean = arr => arr.reduce((m, p) => [m[0] + p[0] / arr.length, m[1] + p[1] / arr.length, m[2] + p[2] / arr.length], [0, 0, 0]);
  const ext = (f, k) => { const s = pts.map(f); const lim = k > 0 ? Math.max(...s) : Math.min(...s); return mean(pts.filter((p, i) => Math.abs(s[i] - lim) < 0.03 * Math.max(sx, sz))); };
  const xs = pts.map(p => p[0]); const maxX = Math.max(...xs), minX = Math.min(...xs);
  A.wingtip_l = ext(p => p[0], 1); A.wingtip_r = ext(p => p[0], -1);
  const core = pts.filter(p => Math.abs(p[0]) < sx * 0.06);                       // the fuselage and fin
  if (core.length > 20) {
    const ys = core.map(p => p[1]); const topY = Math.max(...ys); const tp = core.filter((p, i) => ys[i] > topY - 0.03 * sz); A.top = mean(tp); A.tail_top = A.top;
    const mid = core.filter(p => Math.abs(p[2]) < sz * 0.08); if (mid.length) { const my = mid.map(p => p[1]); A.belly = [0, Math.min(...my), 0]; A.center = [0, (Math.min(...my) + Math.max(...my)) / 2, 0]; }
    const nz = core.map(p => p[2]); const zmax = Math.max(...nz), zmin = Math.min(...nz);
    A.nose = mean(core.filter((p, i) => nz[i] > zmax - 0.02 * sz)); A.tail = mean(core.filter((p, i) => nz[i] < zmin + 0.02 * sz));
    const cock = core.filter(p => p[2] > zmin + sz * 0.3 && p[2] < zmax - sz * 0.15); if (cock.length) { const cy = cock.map(p => p[1]); const cmax = Math.max(...cy); A.canopy = mean(cock.filter((p, i) => cy[i] > cmax - 0.02 * sz)); }
    A.ground_nose = [0, 0, A.nose[2]]; A.ground_tail = [0, 0, A.tail[2]];
  }
  A.ground_l = [A.wingtip_l[0], 0, A.wingtip_l[2]]; A.ground_r = [A.wingtip_r[0], 0, A.wingtip_r[2]];
  return A;
}

/* one instance per shot: shares geometry, owns its materials only when a shot changes them */
export function instance(S, opt = {}) {
  const obj = S.root.clone(true);
  const inst = { S, obj, nodes: {}, gear: [], spin: [], discs: [] };
  obj.traverse(o => { if (o.name) inst.nodes[o.name] = o; });
  inst.gear = S.gearNodes.map(g => inst.nodes[g.name]).filter(Boolean);
  inst.spin = S.spin.map(s => ({ ...s, objs: s.objs.map(o => inst.nodes[o.name]).filter(Boolean) }));
  const gearDown = opt.gear !== undefined ? opt.gear !== 'up' : !opt.flying;
  inst.gear.forEach(g => g.visible = gearDown);
  if (opt.rim ?? (S.dark || (R.tl.look_opts || {}).rim)) rimLight(inst, opt.rimStrength ?? (S.dark ? 0.55 : 0.25));
  /* a soft disc that sells fast spin at 30 fps */
  if (opt.flying || opt.spin) for (const s of inst.spin) for (const o of s.objs) {
    const bb = new THREE.Box3().setFromObject(o); const sz = bb.getSize(new THREE.Vector3());
    const axis = s.axis || 'z'; const dia = axis === 'z' ? Math.max(sz.x, sz.y) : axis === 'x' ? Math.max(sz.y, sz.z) : Math.max(sz.x, sz.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(dia / 2 / (S.root.children[0].scale.x || 1), 48), discMat());
    const local = new THREE.Box3().setFromObject(o); void local;
    disc.position.copy(o.position); disc.renderOrder = 5;
    if (axis === 'x') disc.rotation.y = Math.PI / 2; if (axis === 'y') disc.rotation.x = Math.PI / 2;
    o.parent.add(disc); inst.discs.push(disc);
  }
  return inst;
}
let _disc; function discMat() {
  if (_disc) return _disc;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  const g = c.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, 'rgba(60,60,60,0.0)'); g.addColorStop(0.55, 'rgba(70,70,70,0.10)'); g.addColorStop(0.9, 'rgba(90,90,90,0.16)'); g.addColorStop(1, 'rgba(90,90,90,0)');
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.userData.shared = true;
  _disc = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }); _disc.userData.shared = true; return _disc;
}

/* spinning parts turn at a fixed on-screen rate that reads as fast at 30 fps without strobing */
export function animate(inst, t, opt = {}) {
  for (const s of inst.spin) {
    const on = opt.spin ?? opt.flying;
    const rate = on ? (s.visualRps || 2.9) : 0; const a = t * rate * Math.PI * 2;
    for (const o of s.objs) { if (o.userData.r0 === undefined) o.userData.r0 = o.rotation[s.axis || 'z']; o.rotation[s.axis || 'z'] = o.userData.r0 + a * (s.dir || 1); }
  }
}

export function ownMaterials(inst) {
  if (inst.own) return; inst.own = true;
  inst.obj.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone(); });
}
/* fresnel rim: lights the silhouette of dark aircraft so the shape reads on any set */
export function rimLight(inst, strength = 0.5, color) {
  ownMaterials(inst);
  const col = new THREE.Color(color || R.theme.rimColor);
  inst.obj.traverse(o => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (!m.isMeshStandardMaterial) return;
      m.onBeforeCompile = sh => {
        sh.uniforms.uRim = { value: col.clone().multiplyScalar(strength) };
        sh.fragmentShader = 'uniform vec3 uRim;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n float mhF = 1.0 - abs(dot(normalize(normal), normalize(vViewPosition)));\n totalEmissiveRadiance += uRim * pow(mhF, 3.0);');
      };
      m.customProgramCacheKey = () => 'rim' + strength.toFixed(2) + col.getHexString();
      m.needsUpdate = true;
    });
  });
}
/* x-ray: everything turns to a cool glass shell except the named parts */
const ghostMat = () => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color(R.theme.accent2) }, uA: { value: 0.55 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.2); gl_FragColor = vec4(uCol*(0.05+f), (0.04+f*0.9)*uA); }'
});
export function xray(inst, keep = [], amount = 1) {
  const keepObjs = keep.flatMap(k => findNodes(inst.nodes, k));
  const keepSet = new Set(); keepObjs.forEach(o => o.traverse(x => keepSet.add(x)));
  const g = ghostMat(); g.uniforms.uA.value = 0.55 * amount;
  inst.obj.traverse(o => { if (o.isMesh && !keepSet.has(o)) { o.userData.solid = o.userData.solid || o.material; o.material = g; o.castShadow = false; } });
  inst.ghost = g; return keepObjs;
}
export function parts(inst, names = []) { return names.flatMap(k => findNodes(inst.nodes, k)); }
/* highlight: an emissive pulse on the named parts; the core adds an outline in the glow colour */
export function highlight(objs, amount, color) {
  const col = new THREE.Color(color || R.theme.glow);
  for (const o of objs) o.traverse(x => {
    if (!x.isMesh) return;
    if (!x.userData.hiMat) { x.userData.hiMat = (Array.isArray(x.material) ? x.material[0] : x.material).clone(); x.material = x.userData.hiMat; }
    if (x.material.emissive) { x.material.emissive.copy(col); x.material.emissiveIntensity = amount * 0.9; }
  });
}
/* a world point for an anchor name, a part name, or [x, y, z] metres */
export function point(inst, a) {
  if (Array.isArray(a)) return new THREE.Vector3(...a).applyMatrix4(inst.obj.matrixWorld);
  const an = inst.S.anchors[a];
  if (an) return new THREE.Vector3(...an).applyMatrix4(inst.obj.matrixWorld);
  const objs = findNodes(inst.nodes, a);
  if (objs.length) { const b = new THREE.Box3(); objs.forEach(o => b.expandByObject(o)); return b.getCenter(new THREE.Vector3()); }
  warn(`${inst.S.id}: no anchor or part "${a}" (anchors: ${Object.keys(inst.S.anchors).join(', ')})`);
  return new THREE.Vector3().setFromMatrixPosition(inst.obj.matrixWorld);
}
export function boxOf(inst, names) {
  const b = new THREE.Box3(); const objs = parts(inst, names);
  if (!objs.length) { names.forEach(n => b.expandByPoint(point(inst, n))); b.expandByScalar(Math.max(1, (inst.S?.radius || 6) * 0.3)); }  // an anchor is a point: give it a sensible area round it, a third of the aircraft else objs.forEach(o => b.expandByObject(o));
  return b;
}

/* a simple, neutral scale figure 1.8 m tall */
export function person(h = 1.8, color = '#c9cfd3') {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const k = h / 1.8;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19 * k, 0.55 * k, 6, 12), m); body.position.y = 1.12 * k;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12 * k, 16, 12), m); head.position.y = 1.66 * k;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.075 * k, 0.72 * k, 4, 8), m); legL.position.set(0.1 * k, 0.43 * k, 0);
  const legR = legL.clone(); legR.position.x = -0.1 * k;
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.055 * k, 0.55 * k, 4, 8), m); armL.position.set(0.26 * k, 1.1 * k, 0); armL.rotation.z = 0.08;
  const armR = armL.clone(); armR.position.x = -0.26 * k; armR.rotation.z = -0.08;
  [body, head, legL, legR, armL, armR].forEach(x => { x.castShadow = true; g.add(x); });
  return g;
}
