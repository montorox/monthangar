/* Sets: the Bay (MontHangar's own hangar), the Stage (dark void with coloured glow, also the thumbnail set)
   and the camera rig every model shot uses. */
import * as THREE from 'three';
import { R, register, clamp, lerp, ease, rad, noise1, rng, warn, mediaUrl } from './mh-core.js';
import { loadSubject, instance, animate, xray, parts, highlight, point, boxOf, person } from './mh-subject.js';

/* ---------- textures drawn in code ---------- */
function canvasTex(w, h, draw, opt = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = opt.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8; if (opt.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opt.repeat); }
  return t;
}
function concrete(c, w, h, base, seed) {
  c.fillStyle = base; c.fillRect(0, 0, w, h); const r = rng(seed);
  for (let i = 0; i < 2600; i++) { const x = r() * w, y = r() * h, s = 8 + r() * 90; const a = r() * 0.05; c.fillStyle = r() < .5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`; c.beginPath(); c.ellipse(x, y, s, s * (0.4 + r()), r() * 3, 0, 7); c.fill(); }
  for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${r() < .5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`; c.fillRect(r() * w, r() * h, 1.5, 1.5); }
}
function corrugated(c, w, h, base) {
  c.fillStyle = base; c.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 16) { const g = c.createLinearGradient(x, 0, x + 16, 0); g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0.05)'); c.fillStyle = g; c.fillRect(x, 0, 16, h); }
  for (let y = 0; y < h; y += 256) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y, w, 3); }
}
/* environment for reflections: warm lamp strips, a dusk door and dark walls */
function envMap(theme) {
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.wall).multiplyScalar(0.6), side: THREE.BackSide })));
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.lampColor).multiplyScalar(6 * theme.lampPower) });
  for (let i = -2; i <= 2; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(40, 0.6, 1.2), lamp); m.position.set(0, 14, i * 9); sc.add(m); }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(36, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.skyMid).multiplyScalar(2.2) })); door.position.set(0, 4, -29.5); sc.add(door);
  const low = new THREE.Mesh(new THREE.PlaneGeometry(36, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.skyLow).multiplyScalar(2.5) })); low.position.set(0, -1, -29.4); sc.add(low);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.floor).multiplyScalar(0.8) })); floor.rotation.x = -Math.PI / 2; floor.position.y = -14.9; sc.add(floor);
  const pm = new THREE.PMREMGenerator(R.renderer); const rt = pm.fromScene(sc, 0.03); pm.dispose();
  return rt.texture;
}
const envCache = {};
export const env = theme => envCache[theme.name] || (envCache[theme.name] = envMap(theme));

/* ---------- the Bay ---------- */
const bayCache = new Map();
function bayKey(L, theme) { return theme.name + ':' + Math.round(L / 4) * 4; }
export function buildBay(L, theme) {
  const key = bayKey(L, theme);
  if (bayCache.has(key)) return bayCache.get(key).clone();
  L = Math.max(14, Math.round(L / 4) * 4);
  const g = new THREE.Group(); g.name = 'bay';
  const Wd = L * 2.6, D = L * 2.8, H = Math.max(12, L * 0.62);
  const brand = (R.tl.brand && R.tl.brand.name) || '';
  /* floor */
  const fl = canvasTex(4096, 4096, (c, w, h) => {
    concrete(c, w, h, theme.floor, 3);
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 3; const step = w / 12;
    for (let i = 1; i < 12; i++) { c.beginPath(); c.moveTo(i * step, 0); c.lineTo(i * step, h); c.stroke(); c.beginPath(); c.moveTo(0, i * step); c.lineTo(w, i * step); c.stroke(); }
    /* painted bay: outline, lead-in line, hatched no-go strips */
    const px = m => m / (Wd * 1.6) * w; const cx = w / 2, cy = h / 2;
    c.strokeStyle = theme.paint; c.globalAlpha = 0.8; c.lineWidth = px(0.22);
    const bw = px(L * 1.5), bd = px(L * 1.55); c.strokeRect(cx - bw / 2, cy - bd / 2, bw, bd);
    c.setLineDash([px(1.6), px(1.0)]); c.lineWidth = px(0.16); c.beginPath(); c.moveTo(cx, cy + bd / 2); c.lineTo(cx, h); c.stroke(); c.setLineDash([]);
    c.lineWidth = px(0.18);
    for (const side of [-1, 1]) { const x0 = cx + side * (bw / 2 + px(1.2)); c.save(); c.beginPath(); c.rect(x0 - px(0.8), cy - bd / 2, px(1.6), bd); c.clip(); for (let y = cy - bd / 2 - px(3); y < cy + bd / 2; y += px(0.9)) { c.beginPath(); c.moveTo(x0 - px(1), y); c.lineTo(x0 + px(1), y + px(1.4)); c.stroke(); } c.restore(); }
    c.globalAlpha = 0.55; c.fillStyle = theme.paint; c.textAlign = 'center'; c.font = `800 ${px(2.6)}px Barlow`;
    c.save(); c.translate(cx, cy + bd / 2 + px(3.2)); c.fillText('BAY 03', 0, 0); c.restore();
    if (brand) { c.save(); c.globalAlpha = 0.35; c.translate(cx, cy - bd / 2 - px(1.5)); c.font = `800 ${px(2.0)}px Barlow`; c.fillText(brand.toUpperCase(), 0, 0); c.restore(); }
    c.globalAlpha = 1;
  });
  const floorMat = new THREE.MeshStandardMaterial({ map: fl, roughness: 0.8, metalness: 0.0, transparent: true, opacity: theme.name === 'graphite' ? 0.86 : 0.93, envMapIntensity: 0.22 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(Wd * 1.6, Wd * 1.6), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; floor.renderOrder = 1; g.add(floor);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(Wd * 1.6, Wd * 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.floor).multiplyScalar(0.25) })); under.rotation.x = -Math.PI / 2; under.position.y = -L * 0.6; g.add(under);
  /* walls */
  const corr = canvasTex(1024, 1024, (c, w, h) => corrugated(c, w, h, theme.wall), { repeat: [Wd / 8, H / 8] });
  const wallMat = new THREE.MeshStandardMaterial({ map: corr, roughness: 0.75, metalness: 0.3, envMapIntensity: 0.4 });
  const steel = new THREE.MeshStandardMaterial({ color: theme.steel, roughness: 0.5, metalness: 0.6 });
  const doorW = Wd * 0.62, doorH = H * 0.74;
  const back = new THREE.Group(); back.position.z = -D / 2;
  const seg = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat); m.position.set(x, y, 0); m.receiveShadow = true; back.add(m); };
  seg((Wd - doorW) / 2, H, -(doorW / 2 + (Wd - doorW) / 4), H / 2); seg((Wd - doorW) / 2, H, doorW / 2 + (Wd - doorW) / 4, H / 2); seg(doorW, H - doorH, 0, doorH + (H - doorH) / 2);
  for (const x of [-doorW / 2, doorW / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, doorH, 0.8), steel); p.position.set(x, doorH / 2, 0.2); back.add(p); }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.6, 0.9, 0.9), steel); lintel.position.set(0, doorH, 0.2); back.add(lintel);
  /* the open door: sky, horizon glow, apron and runway lights */
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(doorW * 4, doorH * 3), new THREE.ShaderMaterial({
    uniforms: { a: { value: new THREE.Color(theme.skyTop) }, b: { value: new THREE.Color(theme.skyMid) }, c: { value: new THREE.Color(theme.skyLow) } },
    vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 a,b,c; varying vec2 vU; void main(){ float y=vU.y; vec3 col = y<0.38? mix(c,b,smoothstep(0.30,0.38,y)) : mix(b,a,smoothstep(0.38,0.9,y)); col*= (y<0.3? 0.0:1.0); gl_FragColor=vec4(col*1.35,1.0); }'
  })); sky.position.set(0, doorH * 0.9, -60); back.add(sky);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(doorW * 6, 120), new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.floor).multiplyScalar(0.7), roughness: 0.6 })); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.01, -60); back.add(apron);
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.paint).multiplyScalar(theme.name === 'graphite' ? 8 : 1.5) }), 120);
  const mtx = new THREE.Matrix4(); let k = 0;
  for (let row = 0; row < 2; row++) for (let i = 0; i < 60; i++) { mtx.makeTranslation((row ? 1 : -1) * (6 + i * 0.05), 0.15, -12 - i * 2.2); lights.setMatrixAt(k++, mtx); }
  back.add(lights);
  g.add(back);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(Wd, H), wallMat); front.position.set(0, H / 2, D / 2); front.rotation.y = Math.PI; g.add(front);
  if (brand) {
    const bt = canvasTex(2048, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = theme.paint; c.globalAlpha = 0.85; c.font = '800 200px Barlow'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(brand.toUpperCase().split('').join(' '), w / 2, h / 2 + 8); });
    for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.95 * 8, H * 0.95), new THREE.MeshBasicMaterial({ map: bt, transparent: true, depthWrite: false })); b.scale.setScalar(Math.min(0.55, doorW * 0.7 / (H * 0.95 * 8))); b.position.set(0, doorH + (H - doorH) / 2, z); if (z > 0) b.rotation.y = Math.PI; g.add(b); }
  }
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat); w.position.set(s * Wd / 2, H / 2, 0); w.rotation.y = -s * Math.PI / 2; g.add(w);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.9, H * 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.skyMid).multiplyScalar(theme.name === 'graphite' ? 0.9 : 1.6) }));
    win.position.set(s * (Wd / 2 - 0.05), H * 0.82, 0); win.rotation.y = -s * Math.PI / 2; g.add(win);
  }
  /* roof trusses and lamps */
  const beam = (len, x, y, z, ry = 0, rz = 0, t = 0.28) => { const m = new THREE.Mesh(new THREE.BoxGeometry(len, t, t), steel); m.position.set(x, y, z); m.rotation.set(0, ry, rz); g.add(m); };
  const nT = Math.max(4, Math.round(D / 7));
  for (let i = 0; i < nT; i++) {
    const z = -D / 2 + (i + 0.5) * D / nT, top = H, bot = H - 2.2;
    beam(Wd, 0, top, z, 0, 0, 0.4); beam(Wd, 0, bot, z, 0, 0, 0.3);
    const nd = Math.round(Wd / 2.4); for (let j = 0; j < nd; j++) { const x0 = -Wd / 2 + j * Wd / nd, x1 = x0 + Wd / nd; const len = Math.hypot(x1 - x0, 2.2); beam(len, (x0 + x1) / 2, (top + bot) / 2, z, 0, (j % 2 ? 1 : -1) * Math.atan2(2.2, x1 - x0), 0.16); }
  }
  for (const x of [-Wd / 3, 0, Wd / 3]) beam(D, x, H - 0.2, 0, Math.PI / 2, 0, 0.3);
  const housing = new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.5, metalness: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.lampColor).multiplyScalar(10 * theme.lampPower) });
  const coneMat = new THREE.ShaderMaterial({ uniforms: { col: { value: new THREE.Color(theme.lampColor) }, k: { value: theme.name === 'graphite' ? 0.045 : 0.018 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY=uv.y; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 col; uniform float k; varying float vY; varying vec3 vN; varying vec3 vV; void main(){ float f=abs(dot(normalize(vN),normalize(vV))); gl_FragColor=vec4(col, k*pow(vY,2.2)*f*f); }' });
  const cols = Math.max(3, Math.round(Wd / 11)), rows = Math.max(3, Math.round(D / 11));
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = -Wd / 2 + (i + 0.5) * Wd / cols, z = -D / 2 + (j + 0.5) * D / rows, y = H - 3.2;
    const hsg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.75, 0.6, 20, 1, true), housing); hsg.position.set(x, y, z); g.add(hsg);
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), glow); d.rotation.x = Math.PI / 2; d.position.set(x, y - 0.28, z); g.add(d);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 4.2, y - 0.3, 24, 1, true), coneMat); cone.position.set(x, (y - 0.3) / 2, z); g.add(cone);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 4), housing); cable.position.set(x, H - 1.6, z); g.add(cable);
  }
  /* a few props that make it a working hangar */
  const prop = (w, h, d, col, x, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.2 })); m.position.set(x, h / 2, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); };
  prop(1.6, 1.1, 0.7, '#a8321e', Wd / 2 - 3, -D / 4, 0.1); prop(1.6, 1.1, 0.7, '#a8321e', Wd / 2 - 3, -D / 4 + 1.2, -0.05);
  prop(2.6, 0.9, 1.4, '#3b4248', -Wd / 2 + 3.5, D / 5, 0.3); prop(0.6, 2.4, 0.6, '#5b646a', -Wd / 2 + 2, -D / 3, 0);
  for (const [x, z] of [[Wd * 0.3, D * 0.3], [Wd * 0.32, D * 0.27], [-Wd * 0.3, -D * 0.2]]) { const cn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 16), new THREE.MeshStandardMaterial({ color: theme.paint, roughness: 0.6 })); cn.position.set(x, 0.35, z); cn.castShadow = true; g.add(cn); }
  g.userData = { Wd, D, H, L };
  g.traverse(o => { if (o.geometry) o.geometry.userData.shared = true; if (o.material) o.material.userData.shared = true; });
  [fl, corr].forEach(t => t.userData.shared = true);
  bayCache.set(key, g);
  return g.clone();
}
function bayLights(scene, L, theme, S) {
  const hemi = new THREE.HemisphereLight(new THREE.Color(theme.skyMid), new THREE.Color(theme.floor), theme.fill); scene.add(hemi);
  const key = new THREE.DirectionalLight(new THREE.Color(theme.keyColor), theme.name === 'graphite' ? 2.4 : 2.6);
  key.position.set(L * 0.5, L * 1.6, L * 0.9); key.castShadow = true;
  const sc = key.shadow.camera; const e = Math.max(L, 20) * 0.9; sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e; sc.near = 1; sc.far = L * 5; key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(theme.rimColor), theme.name === 'graphite' ? 0.9 : 0.5); rim.position.set(-L * 0.4, L * 0.6, -L * 1.5); scene.add(rim);
  /* two ceiling spots make pools of warm light on the floor around the aircraft */
  for (const [x, z] of [[L * 0.35, L * 0.45], [-L * 0.45, -L * 0.35]]) { const sp = new THREE.SpotLight(new THREE.Color(theme.lampColor), (theme.name === 'graphite' ? 1700 : 600) * (L / 20) ** 2 * theme.lampPower, L * 3, rad(38), 0.85, 1.6); sp.position.set(x, Math.max(12, L * 0.62) - 3, z); sp.target.position.set(x * 0.6, 0, z * 0.6); scene.add(sp); scene.add(sp.target); }
  scene.environment = env(theme); scene.environmentIntensity = theme.name === 'graphite' ? 0.38 : 0.7;
}

/* ---------- the Stage: a dark void with two coloured glows (feature shots and thumbnails) ---------- */
export function buildStage(L, theme, opt = {}) {
  const g = new THREE.Group(); const st = theme.stage;
  const A = new THREE.Color(opt.glowA || st.glowA), B = new THREE.Color(opt.glowB || st.glowB);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(L * 40, L * 16), new THREE.ShaderMaterial({
    uniforms: { a: { value: A }, b: { value: B }, top: { value: new THREE.Color(st.top) }, k: { value: opt.glow ?? 1 } },
    vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 a,b,top; uniform float k; varying vec2 vU; void main(){ vec2 q=vec2(0.5+(vU.x-0.5)*3.3333, 0.5+(vU.y-0.5)*2.6667); vec2 p=q-vec2(0.5,0.40); p.x*=2.0; float ga=exp(-pow(length(p-vec2(-0.13,0.02))*4.2,2.0)); float gb=exp(-pow(length(p-vec2(0.13,0.02))*4.2,2.0)); vec3 col=top*0.12 + (a*ga + b*gb)*0.42*k; gl_FragColor=vec4(col,1.0); }'
  })); back.position.set(0, L * 1.0, -L * 3.0); g.add(back); g.userData.back = back; g.userData.L = L;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L * 12, L * 12), new THREE.MeshStandardMaterial({ color: st.floor, roughness: 0.58, metalness: 0.0, transparent: true, opacity: 0.88 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.name = 'floor'; floor.renderOrder = 1; g.add(floor);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(L * 12, L * 12), new THREE.MeshBasicMaterial({ color: '#000' })); under.rotation.x = -Math.PI / 2; under.position.y = -L; g.add(under);
  return g;
}
function stageLights(scene, L, theme, opt = {}) {
  const st = theme.stage;
  scene.add(new THREE.HemisphereLight('#9fb3c8', '#050607', 0.25));
  const key = new THREE.SpotLight('#fff3e2', 1200 * (L / 20) ** 2, L * 6, rad(34), 0.6, 1.4); key.position.set(L * 0.2, L * 1.6, L * 1.9); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; scene.add(key); scene.add(key.target);
  const a = new THREE.DirectionalLight(new THREE.Color(opt.glowA || st.glowA), 2.4); a.position.set(L * 1.4, L * 0.5, -L * 1.2); scene.add(a);
  const b = new THREE.DirectionalLight(new THREE.Color(opt.glowB || st.glowB), 2.4); b.position.set(-L * 1.4, L * 0.5, -L * 1.2); scene.add(b);
  const top = new THREE.DirectionalLight('#ffffff', 0.8); top.position.set(0, L * 2, 0); scene.add(top);
  scene.environment = env(theme); scene.environmentIntensity = 0.45;
}

/* ---------- camera rig ----------
   cam = { az, el, dist, target, fov, lift } : az 0 = head-on, 90 = left side (nose to screen left), -90 = right side,
   180 = from behind; el in degrees; dist 1 = the aircraft fills about 3/4 of the frame width side-on.
   to = the same keys for the end of the shot. Every shot drifts a little unless move: 'still'. */
export function camDist(S, d, fov, aspect) {
  const hf = Math.atan(Math.tan(rad(fov / 2)) * aspect);
  return d * S.radius / Math.tan(hf) * 0.78 + S.radius * 0.6 * Math.min(1, d * d);
}
export function rig(shot, S, inst, cam, u, lt) {
  inst.obj.parent && inst.obj.parent.updateMatrixWorld(true); inst.obj.updateMatrixWorld(true);
  const A = { az: 30, el: 10, dist: 1.1, fov: 34, target: 'center', ...(shot.cam || {}) };
  const B = { ...A, ...(shot.to || {}) };
  if (!shot.to && shot.move !== 'still') { B.az = A.az + (shot.drift ?? 7) * (hashSign(shot)); B.dist = A.dist * 0.96; }
  const e = (shot.ease === 'linear' ? ease.linear : ease.sine)(u);
  const az = lerp(A.az, B.az, e), el = lerp(A.el, B.el, e), d = lerp(A.dist, B.dist, e), fov = lerp(A.fov, B.fov, e);
  const aspect = R.W / R.H;
  /* fit: frame a named part (or anchor) so it really fills the picture; dist then scales that framing */
  const fitD = (P, dd) => { const bx = boxOf(inst, [].concat(P)); const r = bx.getSize(new THREE.Vector3()).length() / 2; const hf = Math.atan(Math.tan(rad(fov / 2)) * Math.min(1, aspect)); return { c: bx.getCenter(new THREE.Vector3()), D: dd * r / Math.tan(hf) * 1.1 }; };
  const fa = A.fit ? fitD(A.fit, A.dist) : null, fb = B.fit ? fitD(B.fit, B.dist) : null;
  const ta = fa ? fa.c : point(inst, A.target), tb = fb ? fb.c : point(inst, B.target);
  const tgt = ta.lerp(tb, e); tgt.y += lerp(A.lift || 0, B.lift || 0, e);
  const D = (fa || fb) ? lerp(fa ? fa.D : camDist(S, A.dist, fov, aspect), fb ? fb.D : camDist(S, B.dist, fov, aspect), e) : camDist(S, d, fov, aspect);
  const n = shot.move === 'still' ? 0 : 1; const hand = shot.handheld ? 0.25 : 0.06;
  cam.fov = fov; cam.aspect = aspect;
  cam.position.set(tgt.x + D * Math.cos(rad(el)) * Math.sin(rad(az)), Math.max(shot.minY ?? 0.25, tgt.y + D * Math.sin(rad(el))), tgt.z + D * Math.cos(rad(el)) * Math.cos(rad(az)));
  cam.position.x += noise1(lt * 0.35 + 3) * hand * n; cam.position.y += noise1(lt * 0.3 + 9) * hand * n * 0.6;
  cam.near = Math.max(0.05, D * 0.02); cam.far = D * 40 + 400; cam.updateProjectionMatrix(); cam.lookAt(tgt); cam.updateMatrixWorld();
}
const hashSign = s => ((s.i ?? 0) % 2 ? -1 : 1);

/* a projector for the overlay layer: anchor name, part name or [x,y,z] -> screen pixels */
export function projector(inst, camera) {
  return a => { camera.updateMatrixWorld(); const p = point(inst, a).project(camera); return [(p.x + 1) / 2 * R.W, (1 - p.y) / 2 * R.H, p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2]; };
}

/* mirrored copy under the glossy floor */
function reflection(inst, theme) {
  const m = inst.obj.clone(true); m.scale.y = -1; m.traverse(o => { o.castShadow = false; });
  m.userData.reflect = true; return m;
}

/* the Stage backdrop turns with the camera so the two glows always sit behind the subject */
function faceStage(stage, camera) {
  if (!stage) return; const b = stage.userData.back, L = stage.userData.L; const a = Math.atan2(camera.position.x, camera.position.z);
  b.position.set(-Math.sin(a) * L * 3, L, -Math.cos(a) * L * 3); b.rotation.set(0, a, 0);
}
/* ---------- 3D shot types ---------- */
async function modelScene(shot, set) {
  const S = await loadSubject(shot.subject || Object.keys(R.tl.subjects || {})[0]);
  if (!S) return { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), project: () => [0, 0, false] };
  const theme = R.theme; const L = Math.max(S.dims.length, S.dims.span);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(34, R.W / R.H, 0.1, 5000);
  const inst = instance(S, { gear: shot.gear, spin: shot.spin, rim: shot.rim });
  if (shot.silhouette) { scene.background = new THREE.Color('#000'); const white = new THREE.MeshBasicMaterial({ color: '#fff' }); inst.obj.traverse(o => { if (o.isMesh) o.material = white; }); scene.add(inst.obj); const st0 = { scene, camera, S, inst, outline: [], extras: [], bloom: 0, silhouette: true }; st0.project = projector(inst, camera); return st0; }
  let stage = null; if (set === 'stage') { stage = buildStage(L, theme, shot); scene.add(stage); stageLights(scene, L, theme, shot); scene.background = new THREE.Color('#000'); }
  else { scene.add(buildBay(L, theme)); bayLights(scene, L, theme, S); scene.background = new THREE.Color(theme.bg); scene.fog = new THREE.Fog(theme.bg, L * 4, L * 9); }
  scene.add(inst.obj);
  if (shot.reflect !== false) scene.add(reflection(inst, theme));
  const st = { scene, camera, S, inst, outline: [], extras: [], stage };
  /* x-ray keeps the named parts solid and glowing */
  if (shot.xray) { const keep = xray(inst, [].concat(shot.xray)); st.xrayKeep = keep; st.outline = keep; }
  if (shot.highlight) { st.hi = parts(inst, [].concat(shot.highlight)); if (!st.hi.length) warn(`shot ${shot.id}: highlight part ${JSON.stringify(shot.highlight)} not found`); st.outline = st.hi; }
  if (shot.edges || (S.dark && shot.edges !== false && set !== 'stage')) { st.outline = st.outline.length ? st.outline : [inst.obj]; st.edgeAll = !st.hi && !st.xrayKeep; }
  if (shot.people) { const n = shot.people === true ? 1 : shot.people; for (let k = 0; k < n; k++) { const p = person(); const nose = S.anchors.ground_nose; p.position.set((S.dims.span * 0.12 + k * 0.9), 0, nose[2] + 2.2 + k * 0.4); p.rotation.y = rad(200); scene.add(p); st.extras.push(p); } }
  st.project = projector(inst, camera);
  return st;
}
function drawModel(st, lt, u, shot) {
  if (!st.inst) return;
  animate(st.inst, lt, { spin: shot.spin });
  rig(shot, st.S, st.inst, st.camera, u, lt);
  faceStage(st.stage, st.camera);
  if (st.hi) highlight(st.hi, 0.6 + 0.4 * Math.sin(lt * 3), shot.color);
  if (st.edgeAll) { st.outlineColor = R.theme.rimColor; st.outlineStrength = 2.2; }
  else if (st.outline.length) { st.outlineColor = shot.color || R.theme.glow; st.outlineStrength = 4; }
  st.exposure = R.theme.exposure; st.bloomThreshold = 2.4;
}
register('hangar', { kind: '3d', setup: s => modelScene(s, 'bay'), draw: (st, lt, u, cx) => drawModel(st, lt, u, cx.shot) });
register('studio', { kind: '3d', setup: s => modelScene(s, 'stage'), draw: (st, lt, u, cx) => { drawModel(st, lt, u, cx.shot); st.bloom = st.silhouette ? 0 : 0.25; if (st.silhouette) { st.exposure = 1; st.outline = []; } } });

/* compare: two subjects side by side (or one behind the other) in the Bay or on the Stage */
register('compare', {
  kind: '3d',
  async setup(shot) {
    const ids = shot.subjects || []; const SS = await Promise.all(ids.map(loadSubject));
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(34, R.W / R.H, 0.1, 5000);
    const L = Math.max(...SS.map(S => Math.max(S.dims.length, S.dims.span))) * 1.9;
    let stage = null; if (shot.set === 'stage') { stage = buildStage(L, R.theme, shot); scene.add(stage); stageLights(scene, L, R.theme, shot); scene.background = new THREE.Color('#000'); }
    else { scene.add(buildBay(L, R.theme)); bayLights(scene, L, R.theme); scene.background = new THREE.Color(R.theme.bg); }
    const insts = SS.map((S, k) => { const inst = instance(S, {}); const off = (k - (SS.length - 1) / 2) * (Math.max(...SS.map(x => x.dims.span)) * 1.08); inst.obj.position.x = off; scene.add(inst.obj); scene.add(reflection(inst)); return inst; });
    return { scene, camera, insts, SS, L, stage, project: a => { camera.updateMatrixWorld(); const [k, name] = String(a).includes(':') ? String(a).split(':') : [0, a]; const p = point(insts[+k] || insts[0], name).project(camera); return [(p.x + 1) / 2 * R.W, (1 - p.y) / 2 * R.H, p.z < 1]; } };
  },
  draw(st, lt, u, cx) {
    const shot = cx.shot; const A = { az: 20, el: 14, dist: 1.0, fov: 34, ...(shot.cam || {}) }, B = { ...A, ...(shot.to || { az: A.az + 6 }) };
    const e = ease.sine(u); const az = lerp(A.az, B.az, e), el = lerp(A.el, B.el, e), d = lerp(A.dist, B.dist, e);
    const D = d * st.L / Math.tan(Math.atan(Math.tan(rad(17)) * R.W / R.H)) * 0.55;
    st.camera.aspect = R.W / R.H; st.camera.fov = A.fov; st.camera.position.set(D * Math.cos(rad(el)) * Math.sin(rad(az)), 1 + D * Math.sin(rad(el)), D * Math.cos(rad(el)) * Math.cos(rad(az)));
    st.camera.near = 0.2; st.camera.far = D * 30; st.camera.updateProjectionMatrix(); st.camera.lookAt(0, Math.max(...st.SS.map(S => S.dims.height)) * 0.4, 0);
    st.insts.forEach(i => animate(i, lt, {})); faceStage(st.stage, st.camera);
  }
});
export { modelScene, drawModel };
