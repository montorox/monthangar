/* MontHangar engine core: timeline, shot registry, renderer, post, transitions, finish.
   Every shot is a pure function of time, so any frame can be rendered alone and in any order. */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { THEMES } from './mh-theme.js';
import { drawOverlays, drawCaptions } from './mh-overlay.js';
export { THREE };

export const R = {};          /* runtime: renderer, canvases, sizes, theme, timeline */
const REG = {};               /* shot type -> implementation */
const states = new Map();     /* shot index -> built state */
export const WARN = [];
export const warn = m => { if (!WARN.includes(m)) WARN.push(m); };

/* ---------- small maths ---------- */
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, u) => a + (b - a) * u;
export const smooth = u => { u = clamp(u); return u * u * (3 - 2 * u); };
export const ease = { linear: u => clamp(u), inOut: u => { u = clamp(u); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }, out: u => 1 - Math.pow(1 - clamp(u), 3), in: u => Math.pow(clamp(u), 3), sine: u => -(Math.cos(Math.PI * clamp(u)) - 1) / 2 };
export const rad = d => d * Math.PI / 180;
export function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash1 = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
export const noise1 = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash1(i), hash1(i + 1), u) * 2 - 1; };
export const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* ---------- registry ---------- */
/* impl = { kind: '3d' | '2d', setup: async (shot, ctx) => state, draw: (state, lt, u, ctx) => void, dispose?: state => void }
   A 3d state carries { scene, camera } plus optional project(anchor) -> [x, y, visible] and outline: [objects]. */
export function register(type, impl) { REG[type] = impl; }
export const types = () => Object.keys(REG);

/* ---------- assets ---------- */
const imgCache = new Map();
export function image(url) {
  if (!imgCache.has(url)) imgCache.set(url, new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('image failed: ' + url)); im.src = url; }));
  return imgCache.get(url);
}
export const mediaUrl = p => !p ? p : /^(https?:|\/p\/|\/lib\/|\/abs\/|\/engine\/|data:)/.test(p) ? p : p.startsWith('/') ? '/abs' + p : '/p/' + p;
let geoP = null; export const geo = () => geoP || (geoP = fetch('/engine/data/geo.json').then(r => r.json()));

/* ---------- boot ---------- */
export async function boot(tl, opt) {
  R.tl = tl; R.W = opt.width; R.H = opt.height; R.preview = opt.preview; R.scale = R.H > R.W ? R.W / 1080 : R.H / 1080;
  R.vertical = R.H > R.W;
  R.theme = THEMES[tl.look] || THEMES.graphite;
  R.units = tl.units || 'imperial';
  R.fps = tl.fps || 30;
  const gl = document.createElement('canvas'); gl.width = R.W; gl.height = R.H;
  R.renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  R.renderer.setPixelRatio(1); R.renderer.setSize(R.W, R.H, false);
  R.renderer.shadowMap.enabled = true; R.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  R.renderer.toneMapping = THREE.ACESFilmicToneMapping; R.renderer.outputColorSpace = THREE.SRGBColorSpace;
  const dbg = R.renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  R.gpu = dbg ? R.renderer.getContext().getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  const rt = new THREE.WebGLRenderTarget(R.W, R.H, { type: THREE.HalfFloatType, samples: 4 });
  R.composer = new EffectComposer(R.renderer, rt);
  R.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  R.outline = new OutlinePass(new THREE.Vector2(R.W, R.H), R.renderPass.scene, R.renderPass.camera);
  R.outline.edgeStrength = 4; R.outline.edgeGlow = 0.6; R.outline.edgeThickness = 1.5; R.outline.pulsePeriod = 0;
  R.bloom = new UnrealBloomPass(new THREE.Vector2(R.W, R.H), 0.35, 0.5, 0.85);
  /* one bad pixel (NaN or a huge value) would smear across the whole frame through the bloom blur; clean it first */
  R.sanitize = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uMax: { value: 48 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); if(any(isnan(c)) || any(isinf(c))) c=vec4(0.0,0.0,0.0,1.0); gl_FragColor=vec4(min(c.rgb,vec3(uMax)),c.a); }' });
  /* the grade: a colourist's last touch in display space (contrast round mid-grey, saturation, a little lift); per shot */
  R.grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uC: { value: 1 }, uS: { value: 1 }, uL: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float uC,uS,uL; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); vec3 x=c.rgb; float l=dot(x,vec3(0.2126,0.7152,0.0722)); x=mix(vec3(l),x,uS); x=(x-0.5)*uC+0.5; x=x+uL*(1.0-x); gl_FragColor=vec4(clamp(x,0.0,1.0),c.a); }' });
  R.composer.addPass(R.renderPass); R.composer.addPass(R.sanitize); R.composer.addPass(R.outline); R.composer.addPass(R.bloom); R.composer.addPass(new OutputPass()); R.composer.addPass(R.grade);
  R.gl = gl;
  R.out = document.createElement('canvas'); R.out.width = R.W; R.out.height = R.H; document.body.appendChild(R.out);
  R.ctx = R.out.getContext('2d');
  R.aux = document.createElement('canvas'); R.aux.width = R.W; R.aux.height = R.H; R.actx = R.aux.getContext('2d');
  await Promise.all(['500 40px Barlow', '700 40px Barlow', '800 40px Barlow', '500 20px Inter', '700 20px Inter'].map(f => document.fonts.load(f)));
  makeFinish();
  R.shots = (tl.shots || []).map((s, i) => ({ ...s, i }));
  for (const s of R.shots) if (!REG[s.type]) warn(`shot ${s.id || s.i} has unknown type "${s.type}"`);
  R.end = R.shots.length ? R.shots[R.shots.length - 1].t1 : 0;
  console.log('MH boot ' + R.W + 'x' + R.H + ' gpu ' + R.gpu);
}
export const info = () => ({ gpu: R.gpu, shots: R.shots.length, end: R.end, warnings: WARN.slice(), types: types() });

/* ---------- film finish: vignette and still grain ---------- */
function makeFinish() {
  const v = document.createElement('canvas'); v.width = R.W; v.height = R.H; const c = v.getContext('2d');
  const g = c.createRadialGradient(R.W / 2, R.H / 2, Math.min(R.W, R.H) * 0.35, R.W / 2, R.H / 2, Math.hypot(R.W, R.H) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${R.theme.vignette})`); c.fillStyle = g; c.fillRect(0, 0, R.W, R.H);
  R.vignette = v;
  R.grain = [];
  for (let k = 0; k < 4; k++) {
    const n = document.createElement('canvas'); n.width = n.height = 256; const x = n.getContext('2d'); const d = x.createImageData(256, 256); const rr = rng(77 + k);
    for (let i = 0; i < d.data.length; i += 4) { const q = 128 + (rr() - .5) * 90; d.data[i] = d.data[i + 1] = d.data[i + 2] = q; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); R.grain.push(R.ctx.createPattern(n, 'repeat'));
  }
}
function finish(t) {
  const c = R.ctx; c.save(); c.globalCompositeOperation = 'source-over'; c.drawImage(R.vignette, 0, 0);
  if (R.theme.grain > 0) { c.globalCompositeOperation = 'overlay'; c.globalAlpha = R.theme.grain; c.fillStyle = R.grain[Math.floor(t * 12) % 4]; c.fillRect(0, 0, R.W, R.H); }
  c.restore();
}

/* ---------- shot lookup and state cache ---------- */
function shotAt(t) {
  const S = R.shots; let lo = 0, hi = S.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].t0 <= t) lo = m; else hi = m - 1; }
  return lo;
}
async function stateFor(i) {
  if (states.has(i)) return states.get(i);
  const s = R.shots[i], impl = REG[s.type];
  const p = (async () => impl ? await impl.setup(s, ctxFor(s)) : null)();
  states.set(i, p);
  return p;
}
function ctxFor(s) { return { R, THREE, shot: s, theme: R.theme, W: R.W, H: R.H, s: R.scale }; }
function gc(keep) {
  for (const [i, p] of states) if (!keep.includes(i)) { states.delete(i); p.then(st => { const impl = REG[R.shots[i].type]; try { impl && impl.dispose ? impl.dispose(st) : disposeState(st); } catch (e) { } }); }
}
export function disposeState(st) {
  if (!st || !st.scene) return;
  st.scene.traverse(o => { if (o.userData.shared) return; if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach(mm => { if (!mm.userData.shared) { for (const k in mm) if (mm[k] && mm[k].isTexture && !mm[k].userData.shared) mm[k].dispose(); mm.dispose(); } }); });
}

/* ---------- drawing one shot into the output canvas ---------- */
async function drawShot(i, t, c) {
  const s = R.shots[i]; const impl = REG[s.type];
  c.save(); c.fillStyle = R.theme.bg; c.fillRect(0, 0, R.W, R.H); c.restore();
  if (!impl) return;
  const st = await stateFor(i);
  if (impl.prepare) await impl.prepare(st, t - s.t0);
  const lt = t - s.t0, dur = Math.max(0.001, s.t1 - s.t0), u = clamp(lt / dur);
  const cx = ctxFor(s);
  if ((st && st.kind) === '3d' || (impl.kind === '3d' && !(st && st.kind === '2d'))) {   /* a shot type can pick 2D or 3D per shot (the map) */
    impl.draw(st, lt, u, cx);
    R.renderPass.scene = st.scene; R.renderPass.camera = st.camera;
    R.outline.renderScene = st.scene; R.outline.renderCamera = st.camera;
    const sel = st.outline || [];
    R.outline.enabled = sel.length > 0; R.outline.selectedObjects = sel;
    if (sel.length) { const col = new THREE.Color(st.outlineColor || R.theme.glow); R.outline.visibleEdgeColor.copy(col); R.outline.hiddenEdgeColor.copy(col).multiplyScalar(0.35); R.outline.edgeStrength = st.outlineStrength || 4; }
    R.bloom.strength = st.bloom ?? R.theme.bloom; R.bloom.enabled = R.bloom.strength > 0; R.bloom.threshold = st.bloomThreshold ?? 1.0; R.sanitize.uniforms.uMax.value = st.clampMax ?? 48;
    R.renderer.toneMappingExposure = st.exposure ?? 1;
    const gr = st.grade || R.theme.grade || {}; R.grade.uniforms.uC.value = gr.contrast ?? 1; R.grade.uniforms.uS.value = gr.sat ?? 1; R.grade.uniforms.uL.value = gr.lift ?? 0; R.grade.enabled = (gr.contrast ?? 1) !== 1 || (gr.sat ?? 1) !== 1 || (gr.lift ?? 0) !== 0;
    R.composer.render();
    c.drawImage(R.gl, 0, 0);
    if (impl.post) impl.post(st, lt, u, { ...cx, c });   /* crisp 2D labels over the 3D frame */
  } else {
    impl.draw(st, lt, u, { ...cx, c });
  }
  if (s.add && s.add.length) drawOverlays(c, s, st, lt, u, cx);
}

/* ---------- public: one frame as a JPEG data URL ---------- */
export async function frame(t, q = 0.92) {
  const c = R.ctx;
  if (!R.shots.length) { c.fillStyle = '#000'; c.fillRect(0, 0, R.W, R.H); return R.out.toDataURL('image/jpeg', q); }
  t = clamp(t, 0, Math.max(0, R.end - 1e-4));
  const i = shotAt(t), s = R.shots[i];
  gc([i - 1, i, i + 1]);
  const tr = s.in || (i === 0 ? 'fade' : 'cut'); const td = s.inDur ?? (tr === 'flash' ? 0.35 : tr === 'fade' ? 0.6 : 0.5);
  const lt = t - s.t0;
  if ((tr === 'dissolve' || tr === 'wipe') && lt < td && i > 0) {
    await drawShot(i - 1, t, R.actx); await drawShot(i, t, c);
    const u = ease.inOut(lt / td);
    if (tr === 'dissolve') { c.save(); c.globalAlpha = 1 - u; c.drawImage(R.aux, 0, 0); c.restore(); }
    else { const x = R.W * u; c.save(); c.beginPath(); c.rect(x, 0, R.W - x, R.H); c.clip(); c.drawImage(R.aux, 0, 0); c.restore(); c.save(); c.fillStyle = R.theme.accent; c.globalAlpha = .9; c.fillRect(x - 3 * R.scale, 0, 6 * R.scale, R.H); c.restore(); }
  } else {
    await drawShot(i, t, c);
  }
  if (tr === 'fade' && lt < td) { c.save(); c.fillStyle = '#000'; c.globalAlpha = 1 - ease.out(lt / td); c.fillRect(0, 0, R.W, R.H); c.restore(); }
  if (tr === 'flash' && lt < td) { c.save(); c.fillStyle = '#fff'; c.globalAlpha = (1 - lt / td) * 0.7; c.fillRect(0, 0, R.W, R.H); c.restore(); }
  const ot = s.out; const od = s.outDur ?? 0.6; const left = s.t1 - t;
  if (ot === 'fade' && left < od) { c.save(); c.fillStyle = '#000'; c.globalAlpha = 1 - left / od; c.fillRect(0, 0, R.W, R.H); c.restore(); }
  if (R.tl.captions && R.tl.captions.length) drawCaptions(c, t);
  if (!s.clean) finish(t);
  /* prefetch the next shot's setup while this frame encodes */
  if (i + 1 < R.shots.length && t > s.t1 - 1.5) stateFor(i + 1);
  return R.out.toDataURL('image/jpeg', q);
}
