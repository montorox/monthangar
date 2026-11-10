/* The 3D map: the same cartography as the flat map, laid on raised land and filmed with a tilted, drifting camera.
   Cities are beams of light with pulsing rings, routes are glowing arcs that lift off the ground and land again.
   map: { ..., style: "flat" } keeps the 2D chart; tilt (degrees above the ground, 52), az (0 = looking north), drift (true). */
import { R, THREE, register, clamp, lerp, ease, rad, warn } from './mh-core.js';
import { MAP_FLAT, mapData, mapBase, city, gc, merc, planeIcon, brackets } from './mh-2d.js';
import { F, FB, pill } from './mh-overlay.js';

const vnoise = (() => { /* small 2D value noise for the relief */
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const n = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h(ix, iy), h(ix + 1, iy), sx), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), sx), sy); };
  return (x, y) => n(x, y) * 0.55 + n(x * 2.1, y * 2.1) * 0.28 + n(x * 4.3, y * 4.3) * 0.17;
})();

function glowMat(hex, k = 2.4, opacity = 1) { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), transparent: true, opacity, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }); return m; }

async function setup3d(shot) {
  await mapData(); const m = shot.map || {}; const th = R.theme;
  const A = { c: m.center || [0, 30], km: m.km || 6000 }, B = { c: (m.to && m.to.center) || A.c, km: (m.to && m.to.km) || A.km * 0.9 };
  const kW = 100 / rad(A.km / (111.32 * Math.cos(rad(A.c[1]))));           /* world units per radian of Mercator x; 100 units = the opening view */
  const X = lon => (rad(lon) - rad(A.c[0])) * kW, Z = lat => -(merc(lat) - merc(A.c[1])) * kW;
  const mid = [(A.c[0] + B.c[0]) / 2, (A.c[1] + B.c[1]) / 2];
  const ext = 170 * Math.max(1, B.km / A.km) + Math.hypot(X(B.c[0]), Z(B.c[1])) * 1.2;   /* the textured ground, square, around the move */
  const px0 = X(mid[0]), pz0 = Z(mid[1]);
  /* where a lon/lat lands on the ground plane */
  const latOfZ = z => { const y = merc(A.c[1]) - z / kW; return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; };
  const cLat = latOfZ(pz0), cLon = A.c[0] + (px0 / kW) * 180 / Math.PI;
  const kmTex = (ext / kW) * 180 / Math.PI * 111.32 * Math.cos(rad(cLat));

  /* texture: the flat map's cartography, drawn big. Country names lie on the ground like engraving. */
  const T = R.preview ? 2048 : 4096; const cv = document.createElement('canvas'); cv.width = cv.height = T; const c = cv.getContext('2d');
  const sTex = R.scale * (T * 100 / ext) / R.W; const keep = R.scale, keepMap = th.map; R.scale = sTex; th.map = { ...th.map, ...(th.map3d || {}) };   /* the lit relief wants a slightly brighter sea */
  try { mapBase(c, T, T, cLon, cLat, kmTex, { ...m, countryLabels: m.countryLabels }, 99, sTex); } finally { R.scale = keep; th.map = keepMap; }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = R.renderer.capabilities.getMaxAnisotropy(); tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;

  /* height: the land mask, blurred into a soft coastal bevel, plus relief inside the land */
  const HM = 1024, hc = document.createElement('canvas'); hc.width = hc.height = HM; const hx = hc.getContext('2d');
  const G = await mapData(); const widthRad = ext / kW; const k = HM / widthRad, tx = HM / 2 - rad(cLon) * k, ty = HM / 2 + merc(cLat) * k;
  hx.fillStyle = '#000'; hx.fillRect(0, 0, HM, HM); hx.save(); hx.setTransform(k, 0, 0, k, tx, ty); hx.fillStyle = '#fff'; hx.fill(G.land); hx.fillStyle = '#000'; hx.fill(G.lakes); hx.restore();
  const bc = document.createElement('canvas'); bc.width = bc.height = HM; const bx = bc.getContext('2d'); bx.filter = `blur(${Math.max(2, HM / 150)}px)`; bx.drawImage(hc, 0, 0);
  const hd = bx.getImageData(0, 0, HM, HM).data;
  const landH = 1.5, relief = 1.7, nf = 0.032;
  const px = (ix, iy) => hd[(Math.min(HM - 1, Math.max(0, iy)) * HM + Math.min(HM - 1, Math.max(0, ix))) * 4] / 255;
  const maskAt = (x, z) => { const u = ((x - px0) / ext + 0.5) * HM - 0.5, v = ((z - pz0) / ext + 0.5) * HM - 0.5; const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;   /* bilinear: no stair-steps on the coast */
    const m0 = lerp(lerp(px(ix, iy), px(ix + 1, iy), fx), lerp(px(ix, iy + 1), px(ix + 1, iy + 1), fx), fy); return m0 * m0 * (3 - 2 * m0); };
  const hAt = (x, z) => { const mk = maskAt(x, z); const inland = clamp((mk - 0.6) / 0.4); return mk * landH + inland * inland * vnoise(x * nf, z * nf) * relief; };

  const SEG = R.preview ? 256 : 448; const geo = new THREE.PlaneGeometry(ext, ext, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, hAt(px0 + pos.getX(i), pz0 + pos.getZ(i)));
  geo.computeVertexNormals();
  const rough = document.createElement('canvas'); rough.width = rough.height = 512; const rx = rough.getContext('2d'); rx.fillStyle = '#6a6a6a'; rx.fillRect(0, 0, 512, 512); rx.drawImage(hc, 0, 0, 512, 512); /* water a little glossy, land matte */
  const rTex = new THREE.CanvasTexture(rough);
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, roughnessMap: rTex, metalness: 0 }));
  ground.position.set(px0, 0, pz0); ground.receiveShadow = true;

  const scene = new THREE.Scene(); const bg = new THREE.Color(th.map.ocean); scene.background = bg; scene.fog = new THREE.Fog(bg, 100, 300); scene.add(ground);
  const key = new THREE.DirectionalLight(th.keyColor || '#ffe2b8', 2.6); key.position.set(-75, 32, 30); scene.add(key);
  const rim = new THREE.DirectionalLight(th.accent2, 0.5); rim.position.set(70, 25, -80); scene.add(rim);
  scene.add(new THREE.HemisphereLight('#b8d4e6', '#20262c', 0.75));
  const camera = new THREE.PerspectiveCamera(32, R.W / R.H, 0.3, 4000);

  /* cities: a beam, a bright head and a pulsing ground ring */
  const cities = (m.cities || []).map(city).filter(Boolean).map((ce, i) => {
    const x = X(ce.lon), z = Z(ce.lat), y = hAt(x, z); const g = new THREE.Group(); g.position.set(x, y, z);
    const beamH = 7; const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, beamH, 12, 1, true), glowMat(th.map.city, 2.2, 0.85)); beam.position.y = beamH / 2; g.add(beam);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 12), glowMat(th.map.city, 3.2)); head.position.y = beamH; g.add(head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 48), glowMat(th.map.city, 2.0, 0.8)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.45; ring.material.depthTest = false; ring.renderOrder = 2; g.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), glowMat(th.map.city, 2.6)); dot.rotation.x = -Math.PI / 2; dot.position.y = 0.45; dot.material.depthTest = false; dot.renderOrder = 2; g.add(dot);
    scene.add(g); return { ...ce, g, beam, head, ring, beamH, i, top: new THREE.Vector3(x, y + beamH, z) };
  });
  /* routes: an arc that climbs off the ground and lands, with its shadow on the land */
  const routes = (m.routes || []).map(r => {
    const a = city(r.from), b = city(r.to); if (!a || !b) return null; const via = (r.via || []).map(city).filter(Boolean); const stops = [a, ...via, b];
    let ll = []; for (let i = 0; i < stops.length - 1; i++) ll = ll.concat(gc(stops[i], stops[i + 1], 64));
    const flat = ll.map(p => new THREE.Vector3(X(p.lon), 0, Z(p.lat))); let len = 0; for (let i = 1; i < flat.length; i++) len += flat[i].distanceTo(flat[i - 1]);
    const arcH = r.height ?? clamp(len * 0.16, 2.5, 26); let acc = 0;
    const pts = flat.map((p, i) => { if (i) acc += p.distanceTo(flat[i - 1]); const t = len ? acc / len : 0; return new THREE.Vector3(p.x, hAt(p.x, p.z) + 0.25 + Math.sin(Math.PI * t) * arcH, p.z); });
    const shadow = flat.map(p => new THREE.Vector3(p.x, hAt(p.x, p.z) + 0.08, p.z));
    const N = 240, RS = 8; const col = r.color || th.map.route;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N, 0.2, RS), glowMat(col, 2.4));
    const sh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shadow), N, 0.09, 6), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.45, depthWrite: false }));
    scene.add(sh); scene.add(tube); const curve = new THREE.CatmullRomCurve3(pts);
    return { ...r, tube, sh, N, RS, curve };
  }).filter(Boolean);
  /* rings: a ground circle of a given radius */
  const rings = (m.rings || []).map(rg => { const ce = city(rg.at); if (!ce) return null; const rr = rg.km / A.km * 100; const x = X(ce.lon), z = Z(ce.lat);
    const line = new THREE.Mesh(new THREE.RingGeometry(rr * 0.985, rr, 128), glowMat(th.accent2, 2.0, 0.9)); line.rotation.x = -Math.PI / 2; line.position.set(x, landH + relief * 0.6 + 0.3, z);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(rr, 96), glowMat(th.accent2, 1.0, 0.10)); fill.rotation.x = -Math.PI / 2; fill.position.copy(line.position); scene.add(fill); scene.add(line); return { ...rg, line, fill, ce, x, z, rr }; }).filter(Boolean);

  return { kind: '3d', scene, camera, m, A, B, X, Z, hAt, cities, routes, rings, exposure: 1.65, bloom: 0.55, bloomThreshold: 0.92, clampMax: 24 };
}

function draw3d(st, lt, u, cx) {
  const m = st.m, e = ease.inOut(u); const cam = st.camera;
  const cxW = lerp(st.X(st.A.c[0]), st.X(st.B.c[0]), e), czW = lerp(st.Z(st.A.c[1]), st.Z(st.B.c[1]), e);
  const view = 100 * Math.exp(lerp(Math.log(st.A.km), Math.log(st.B.km), e)) / st.A.km;
  const el = rad(m.tilt ?? 46), az = rad((m.az ?? 0) + (m.drift === false ? 0 : lerp(-5, 5, ease.sine(u))));
  const hf = Math.atan(Math.tan(rad(cam.fov / 2)) * cam.aspect); const d = (view / 2) / Math.tan(hf) * 1.05;
  const target = new THREE.Vector3(cxW, st.hAt(cxW, czW) * 0.5, czW);
  cam.position.set(target.x + Math.sin(az) * Math.cos(el) * d, target.y + Math.sin(el) * d, target.z + Math.cos(az) * Math.cos(el) * d); cam.lookAt(target); cam.updateMatrixWorld();
  st.scene.fog.near = d * 0.95; st.scene.fog.far = d * 2.3;
  const sc = view / 100;   /* pins keep their size on screen through a zoom */
  for (const ce of st.cities) {
    const g0 = ease.out(clamp((lt - 0.2 - ce.i * 0.25) / 0.6)); ce.g.visible = g0 > 0; ce.g.scale.setScalar(sc);
    ce.beam.scale.y = Math.max(0.001, g0); ce.beam.position.y = ce.beamH * g0 / 2; ce.head.position.y = ce.beamH * g0; ce.head.visible = g0 > 0.05;
    const p = (lt * 0.6 + ce.i * 0.3) % 1; ce.ring.scale.setScalar(1 + p * 2.6); ce.ring.material.opacity = 0.8 * (1 - p) * g0;
    ce.top.set(ce.g.position.x, ce.g.position.y + ce.beamH * sc * g0, ce.g.position.z);
  }
  const dur = cx.shot.t1 - cx.shot.t0;
  for (const r of st.routes) {
    const t0 = r.t ?? 0.3, rd = r.dur ?? Math.max(1.2, dur * 0.6); r.g = ease.inOut(clamp((lt - t0) / rd));
    const n = Math.floor(r.g * r.N); r.tube.geometry.setDrawRange(0, n * r.RS * 6); r.sh.geometry.setDrawRange(0, n * 6 * 6); r.tube.visible = r.sh.visible = n > 0;
    r.tube.scale.set(1, 1, 1);
  }
  for (const rg of st.rings) { const k = ease.out(clamp((lt - (rg.t ?? 0.3)) / 1)); rg.line.scale.setScalar(Math.max(0.001, k)); rg.fill.scale.setScalar(Math.max(0.001, k)); }
}

function post3d(st, lt, u, cx) {
  const c = cx.c, s = R.scale, th = R.theme, m = st.m;
  const proj = v => { const p = v.clone().project(st.camera); return [(p.x * 0.5 + 0.5) * R.W, (-p.y * 0.5 + 0.5) * R.H, p.z < 1]; };
  /* route heads: the little aircraft riding the arc */
  for (const r of st.routes) {
    if (!(r.g > 0) || (r.g >= 1 && r.icon === false)) continue; const a = proj(r.curve.getPoint(Math.max(0, r.g - 0.01))), b = proj(r.curve.getPoint(r.g)); if (!b[2]) continue;
    planeIcon(c, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), 30 * s, th.ink);
    if (r.label && r.g > 0.3) { const mp = proj(r.curve.getPoint(0.5)); c.save(); c.font = F(700, 30); c.textAlign = 'center'; c.fillStyle = r.color || th.map.route; c.globalAlpha = clamp((r.g - 0.3) / 0.3); c.fillText(r.label.toUpperCase(), mp[0], mp[1] - 26 * s); c.restore(); }
  }
  /* city names beside the beam heads */
  for (const ce of st.cities) {
    const a = ease.out(clamp((lt - 0.45 - ce.i * 0.25) / 0.4)); if (a <= 0) continue; const [x, y, ok] = proj(ce.top); if (!ok) continue;
    const nm = (ce.label || ce.name || '').toUpperCase(); c.save(); c.globalAlpha = a; c.font = F(700, R.vertical ? 40 : 36); const tw = c.measureText(nm).width; const right = x < R.W * 0.75;
    const lx = right ? x + 22 * s : x - 22 * s - tw; pill(c, lx - 10 * s, y - 25 * s, tw + 20 * s, 48 * s, 6 * s, th.panel); c.fillStyle = th.map.city; c.fillRect(right ? lx - 10 * s : lx + tw + 6 * s, y - 25 * s, 4 * s, 48 * s);
    c.fillStyle = th.ink; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(nm, lx, y); c.restore();
  }
  for (const rg of st.rings) if (rg.label) { const [x, y, ok] = proj(new THREE.Vector3(rg.x, rg.line.position.y, rg.z - rg.rr)); if (!ok) continue; c.save(); c.globalAlpha = ease.out(clamp((lt - 0.8) / 0.5)); c.font = F(700, 28); c.fillStyle = th.accent2; c.textAlign = 'center'; c.fillText(rg.label.toUpperCase(), x, y - 14 * s); c.restore(); }
  for (const lb of m.labels || []) { const x0 = st.X(lb.at[0]), z0 = st.Z(lb.at[1]); const [x, y, ok] = proj(new THREE.Vector3(x0, st.hAt(x0, z0) + 0.5, z0)); if (!ok) continue; c.save(); c.globalAlpha = ease.out(clamp((lt - (lb.t || 0.4)) / 0.5)); c.font = F(600, lb.size || 30); c.fillStyle = lb.color || th.map.label; c.textAlign = 'center'; c.fillText(String(lb.text).toUpperCase(), x, y); c.restore(); }
  if (m.hud !== false) {
    const mg = (R.vertical ? 50 : 64) * s; c.save(); c.globalAlpha = 0.8; brackets(c, mg, mg, R.W - 2 * mg, R.H - 2 * mg, 46 * s, th.accent, 3 * s); c.restore();
    const e = ease.inOut(u), lon0 = lerp(st.A.c[0], st.B.c[0], e), lat0 = lerp(st.A.c[1], st.B.c[1], e);
    c.save(); c.font = FB(600, 20); c.fillStyle = th.map.label; c.globalAlpha = 0.75; c.textAlign = 'left'; c.fillText(`${Math.abs(lat0).toFixed(2)}° ${lat0 >= 0 ? 'N' : 'S'}   ${Math.abs(lon0).toFixed(2)}° ${lon0 >= 0 ? 'E' : 'W'}`, mg + 24 * s, R.H - mg - 22 * s); c.restore();
  }
  if (m.title) { c.save(); c.font = F(800, 40); const tw = c.measureText(m.title.toUpperCase()).width; const y = R.vertical ? R.H * 0.1 : 60 * s + 30 * s; pill(c, 90 * s, y, tw + 40 * s, 60 * s, 8 * s, th.panel); c.fillStyle = th.accent; c.fillRect(90 * s, y, 5 * s, 60 * s); c.fillStyle = th.ink; c.textBaseline = 'middle'; c.fillText(m.title.toUpperCase(), 112 * s, y + 31 * s); c.restore(); }
}

register('map', {
  kind: '3d',
  async setup(shot) { const m = shot.map || {}; if (m.style === 'flat') { const st = await MAP_FLAT.setup(shot); st.kind = '2d'; st.flat = true; return st; } return setup3d(shot); },
  draw(st, lt, u, cx) { if (st.flat) return MAP_FLAT.draw(st, lt, u, cx); draw3d(st, lt, u, cx); },
  post(st, lt, u, cx) { if (!st.flat) post3d(st, lt, u, cx); }
});
void warn;
