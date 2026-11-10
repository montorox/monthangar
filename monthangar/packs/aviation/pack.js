/* Aviation pack: the flight world (sky, ocean, cloud deck, farmland, desert, snow) and the flight shot.
   A pack only adds shot types and data; the core never needs to change. */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

let MH, C, Sub, Sets;
export async function install(mh) {
  MH = mh; C = mh; Sub = mh.subject; Sets = mh.sets;
  mh.register('flight', { kind: '3d', setup: setupFlight, draw: drawFlight });
}

/* ---------- shared GLSL noise ---------- */
const NOISE = `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<6;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }`;

/* sky presets: sun elevation and azimuth in degrees, turbidity, haze colour */
const SKIES = {
  day: { el: 38, az: 140, turb: 1.6, ray: 2.1, mie: 0.0018, mieG: 0.7, zenith: '#174c93', horizon: '#aecbe6', haze: '#9ab8d6', sun: '#fff1de', sunI: 4.2, hemi: 0.9, env: 1.6, expo: 0.62, puffA: 0.6, grade: { contrast: 1.12, sat: 1.14 } },
  golden: { el: 9, az: 230, turb: 5, ray: 2.2, haze: '#e8b98a', sun: '#ffc98a', sunI: 3.2, hemi: 0.6, expo: 0.62, puffA: 0.45, puffL: 0.72 },
  dusk: { el: 2.2, az: 250, turb: 7, ray: 3.0, haze: '#c27a5c', sun: '#ff9a62', sunI: 2.4, hemi: 0.45, expo: 0.8, puffA: 0.4, puffL: 0.6 },
  high: { el: 55, az: 120, turb: 1.2, ray: 0.8, zenith: '#163f86', horizon: '#a9c6e6', haze: '#8fb2d6', sun: '#ffffff', sunI: 3.2, hemi: 0.9, env: 1.6, expo: 0.6, puffA: 0.6, grade: { contrast: 1.1, sat: 1.1 } },
  overcast: { el: 35, az: 160, turb: 12, ray: 0.5, haze: '#a9b2b9', sun: '#e9eef2', sunI: 1.2, hemi: 1.5, expo: 0.6 }
};
const envBySky = {};
function skyEnv(renderer, sky, preset) {
  if (envBySky[preset]) return envBySky[preset];
  const sc = new THREE.Scene(); const s2 = sky.clone(); sc.add(s2);
  const pm = new THREE.PMREMGenerator(renderer); const t = pm.fromScene(sc).texture; pm.dispose(); envBySky[preset] = t; return t;
}

function oceanMat(sunDir, haze, deep) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uSun: { value: sunDir }, uHaze: { value: new THREE.Color(haze) }, uDeep: { value: new THREE.Color(deep) }, uOff: { value: 0 }, uFar: { value: 9000 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: NOISE + `
      uniform float uT, uOff, uFar; uniform vec3 uSun, uHaze, uDeep; varying vec3 vW;
      void main(){ vec2 p = vW.xz + vec2(0.0, uOff);
        float e=1.5; vec2 q=p*0.045; float t=uT*0.35;
        float h0=fbm(q+vec2(t,t*0.6)) + 0.5*fbm(q*3.1-vec2(t*1.3,0.0));
        float hx=fbm(q+vec2(e*0.02,0)+vec2(t,t*0.6)) + 0.5*fbm((q+vec2(e*0.02,0))*3.1-vec2(t*1.3,0.0));
        float hz=fbm(q+vec2(0,e*0.02)+vec2(t,t*0.6)) + 0.5*fbm((q+vec2(0,e*0.02))*3.1-vec2(t*1.3,0.0));
        vec3 n = normalize(vec3((h0-hx)*14.0, 1.0, (h0-hz)*14.0));
        vec3 v = normalize(cameraPosition - vW); float fr = 0.02 + 0.98*pow(1.0-max(dot(n,v),0.0),5.0);
        vec3 r = reflect(-v,n); vec3 sky = mix(uHaze, uHaze*vec3(0.55,0.7,0.95), clamp(r.y*1.6,0.0,1.0));
        vec3 col = mix(uDeep, sky, fr) + pow(max(dot(r,uSun),0.0), 420.0)*vec3(6.0,5.4,4.6);
        float d = length(vW.xz - cameraPosition.xz); col = mix(col, uHaze, smoothstep(uFar*0.32, uFar*1.25, d));   /* haze only far out: the sea stays deep */
        gl_FragColor = vec4(col,1.0); 
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}
function cloudDeckMat(sunDir, haze, shadow) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 }, uOff: { value: 0 }, uSun: { value: sunDir }, uHaze: { value: new THREE.Color(haze) }, uShadow: { value: new THREE.Color(shadow) }, uFar: { value: 9000 }, uCover: { value: 0.5 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: NOISE + `
      uniform float uT, uOff, uFar, uCover; uniform vec3 uSun, uHaze, uShadow; varying vec3 vW;
      void main(){ vec2 p=(vW.xz+vec2(0.0,uOff))*0.0016 + vec2(uT*0.004,0.0);
        float d = fbm(p) + 0.35*fbm(p*4.0);
        float a = smoothstep(uCover, uCover+0.28, d);
        float lit = clamp(0.55 + (fbm(p*2.0+vec2(0.3*uSun.x,0.3*uSun.z)) - fbm(p*2.0))*3.0 + d*0.4, 0.0, 1.0);
        vec3 col = mix(uShadow, vec3(1.0,0.98,0.95)*1.15, lit);
        float dist = length(vW.xz - cameraPosition.xz); col = mix(col, uHaze, smoothstep(uFar*0.2, uFar, dist));
        gl_FragColor = vec4(col, a*(1.0-smoothstep(uFar*0.6,uFar,dist))); 
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}
function groundMat(kind, sunDir, haze) {
  const pal = { land: ['#5b6e3a', '#7a8a45', '#9a8f55', '#4a5e34', '#8c7a4a', '#6f8040'], desert: ['#c9a874', '#b8935e', '#d8bc8a', '#a98250', '#c4a06c', '#e0c898'], snow: ['#e8edf2', '#d9e1e8', '#f4f6f8', '#c9d3dc', '#e1e7ee', '#b9c4ce'] }[kind] || ['#5b6e3a'];
  return new THREE.ShaderMaterial({
    uniforms: { uOff: { value: 0 }, uSun: { value: sunDir }, uHaze: { value: new THREE.Color(haze) }, uFar: { value: 12000 }, uPal: { value: pal.map(c => new THREE.Color(c)) }, uKind: { value: kind === 'land' ? 0 : kind === 'desert' ? 1 : 2 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
    fragmentShader: NOISE + `
      uniform float uOff, uFar; uniform int uKind; uniform vec3 uSun, uHaze; uniform vec3 uPal[6]; varying vec3 vW;
      void main(){ vec2 p = vW.xz + vec2(0.0,uOff);
        vec2 w = p + 140.0*vec2(fbm(p*0.002), fbm(p*0.002+7.0));
        vec2 cell = floor(w/vec2(260.0,190.0)); float k = h21(cell);
        vec3 col = uPal[int(floor(k*5.99))];
        if(uKind==0){ float edge = min(fract(w.x/260.0), fract(w.y/190.0)); col *= mix(0.82,1.0,smoothstep(0.0,0.03,edge)); float forest = smoothstep(0.58,0.64,fbm(p*0.0012)); col = mix(col, vec3(0.16,0.24,0.14), forest); }
        else { float dune = fbm(p*0.004); col = mix(uPal[0], uPal[2], dune) * (0.85 + 0.3*fbm(p*0.02)); }
        col *= 0.8 + 0.25*fbm(p*0.01);
        float d = length(vW.xz - cameraPosition.xz); col = mix(col, uHaze, smoothstep(uFar*0.05, uFar, d));
        gl_FragColor = vec4(col,1.0); 
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  });
}
function puffTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d'); const r = C.rng(5);
  for (let i = 0; i < 26; i++) { const x = 70 + r() * 116, y = 90 + r() * 70, s = 30 + r() * 55; const g = c.createRadialGradient(x, y, 0, x, y, s); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let PUFF;

/* ---------- the flight shot ----------
   shot = { subject, sky: day|golden|dusk|high|overcast, below: ocean|clouds|land|desert|snow, alt: metres above the surface,
            cam: { az, el, dist, fov }, to: {...}, mode: 'rig' | 'flyby', bank, pitch, speed (m/s for the world), gear: 'down' to show it } */
async function setupFlight(shot) {
  const S = await Sub.loadSubject(shot.subject || Object.keys(C.R.tl.subjects || {})[0]);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(32, C.R.W / C.R.H, 0.5, 60000);
  const pre = SKIES[shot.sky || 'day'] || SKIES.day;
  let sky;
  if (pre.zenith) {   /* graded sky: deep blue overhead easing to a light horizon, a soft sun glow (the physical model goes white at flight angles) */
    sky = new THREE.Mesh(new THREE.SphereGeometry(45000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunPosition: { value: new THREE.Vector3() }, zen: { value: new THREE.Color(pre.zenith) }, hor: { value: new THREE.Color(pre.horizon) }, sunC: { value: new THREE.Color(pre.sun) } },
      vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww; }',
      fragmentShader: 'uniform vec3 sunPosition, zen, hor, sunC; varying vec3 vD; void main(){ float y=max(vD.y,0.0); vec3 c=mix(hor, zen, pow(y,0.42)); float sd=max(dot(vD,normalize(sunPosition)),0.0); c+=sunC*(pow(sd,900.0)*6.0+pow(sd,40.0)*0.35+pow(sd,6.0)*0.10); c=mix(hor*0.92, c, smoothstep(-0.02,0.02,vD.y)); gl_FragColor=vec4(c,1.0);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }' }));
    sky.material.uniforms.turbidity = { value: 0 }; sky.material.uniforms.rayleigh = { value: 0 }; sky.material.uniforms.mieCoefficient = { value: 0 }; sky.material.uniforms.mieDirectionalG = { value: 0 };
  } else { sky = new Sky(); sky.scale.setScalar(45000); }
  const sun = new THREE.Vector3().setFromSphericalCoords(1, C.rad(90 - pre.el), C.rad(pre.az));
  Object.assign(sky.material.uniforms, {}); sky.material.uniforms.turbidity.value = pre.turb; sky.material.uniforms.rayleigh.value = pre.ray; sky.material.uniforms.mieCoefficient.value = pre.mie ?? 0.004; sky.material.uniforms.mieDirectionalG.value = pre.mieG ?? 0.85; sky.material.uniforms.sunPosition.value.copy(sun);
  scene.add(sky);
  scene.environment = skyEnv(C.R.renderer, sky, shot.sky || 'day'); scene.environmentIntensity = pre.env ?? 0.7;
  const light = new THREE.DirectionalLight(pre.sun, pre.sunI); light.position.copy(sun).multiplyScalar(200); scene.add(light); scene.add(light.target);
  light.castShadow = true; const e = S ? Math.max(S.dims.length, S.dims.span) * 0.7 : 30; Object.assign(light.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 600 }); light.shadow.mapSize.set(2048, 2048); light.shadow.bias = -0.0005;
  scene.add(new THREE.HemisphereLight('#bcd3ea', '#5b5a52', pre.hemi * 0.6));
  const below = shot.below || 'ocean'; const alt = shot.alt ?? (below === 'clouds' ? 220 : below === 'ocean' ? 420 : 900);
  const plane = new THREE.PlaneGeometry(60000, 60000, 1, 1); plane.rotateX(-Math.PI / 2);
  let surf;
  if (below === 'ocean') surf = new THREE.Mesh(plane, oceanMat(sun, pre.haze, '#0b2a3a'));
  else if (below === 'clouds') { surf = new THREE.Mesh(plane, oceanMat(sun, pre.haze, '#0d2c3c')); surf.position.y = -1400; const deck = new THREE.Mesh(plane, cloudDeckMat(sun, pre.haze, '#8d9fb3')); deck.material.uniforms.uCover.value = shot.cover ?? 0.42; scene.add(deck); scene.userData.deck = deck; }
  else surf = new THREE.Mesh(plane, groundMat(below, sun, pre.haze));
  surf.position.y += -alt; scene.add(surf);
  if (scene.userData.deck) scene.userData.deck.position.y = -alt;
  /* puffs: cumulus sprites around the path, drifting past */
  PUFF = PUFF || puffTex(); const puffs = []; const r = C.rng(C.hashStr(shot.id || 'f'));
  const nP = shot.puffs ?? (below === 'clouds' ? 60 : 36);
  for (let i = 0; i < nP; i++) { const m = new THREE.SpriteMaterial({ map: PUFF, color: pre.puffL ? new THREE.Color(pre.haze).lerp(new THREE.Color(pre.sun), 0.35).multiplyScalar(pre.puffL) : new THREE.Color(pre.sun).lerp(new THREE.Color('#ffffff'), 0.6), transparent: true, depthWrite: false, opacity: pre.puffA ?? 0.85, fog: false }); const sp = new THREE.Sprite(m); const s = 160 + r() * 420; sp.scale.set(s * 1.6, s, 1); sp.userData = { x: (r() - 0.5) * 5000, y: below === 'clouds' ? -alt * (0.15 + r() * 0.5) : -alt * (0.2 + r() * 0.6) + (r() < 0.3 ? alt * (0.4 + r()) : 0), z: r() * 8000 }; scene.add(sp); puffs.push(sp); }
  scene.fog = null;
  const inst = S ? Sub.instance(S, { flying: true, gear: shot.gear || 'up' }) : null;
  const holder = new THREE.Group(); if (inst) { holder.add(inst.obj); inst.obj.position.y = -(S.box.max.y + S.box.min.y) / 2; }
  scene.add(holder);
  return { scene, camera, S, inst, holder, puffs, surf, alt, pre, exposure: pre.expo, bloom: shot.bloom ?? 0, bloomThreshold: 6, clampMax: shot.clampMax ?? 12, project: inst ? Sets.projector(inst, camera) : () => [0, 0, false], outline: [] };
}

function drawFlight(st, lt, u, cx) {
  const shot = cx.shot; if (!st.inst) return;
  const v = shot.speed ?? 140; const travel = (shot.t0 + lt) * v;
  const bankA = shot.bank ?? 0; const bank = C.rad(bankA + C.noise1(lt * 0.4 + 2) * 2.2); const pitch = C.rad((shot.pitch ?? 1.5) + C.noise1(lt * 0.3 + 5) * 0.8);
  st.holder.rotation.set(-pitch, 0, -bank, 'YXZ');
  st.holder.position.y = C.noise1(lt * 0.25 + 11) * 0.8;
  Sub.animate(st.inst, lt, { flying: true });
  [st.surf, st.scene.userData.deck].forEach(m => { if (m && m.material.uniforms) { m.material.uniforms.uOff && (m.material.uniforms.uOff.value = travel); m.material.uniforms.uT && (m.material.uniforms.uT.value = shot.t0 + lt); } });
  st.scene.updateMatrixWorld(true);
  if (shot.mode === 'flyby') {
    const S = st.S; const D = Math.max(S.dims.length, S.dims.span); const side = shot.side ?? 1;
    const cam = new THREE.Vector3(side * D * (shot.dist ?? 1.6), D * (shot.height ?? 0.25), 0);
    const zz = C.lerp(-D * 5, D * 5, u); st.holder.position.z = zz;
    st.camera.fov = shot.cam?.fov ?? 30; st.camera.aspect = C.R.W / C.R.H; st.camera.position.copy(cam); st.camera.updateProjectionMatrix();
    st.camera.lookAt(new THREE.Vector3(0, 0, zz * 0.85));
  } else {
    st.holder.position.z = 0;
    Sets.rig({ ...shot, cam: { az: 150, el: 8, dist: 1.25, fov: 32, ...(shot.cam || {}) }, to: shot.to, drift: shot.drift ?? 5, minY: -1e9 }, st.S, st.inst, st.camera, u, lt);
    st.camera.far = 60000; st.camera.updateProjectionMatrix();
  }
  for (const p of st.puffs) { const z = ((p.userData.z - travel * 0.9) % 8000 + 8000) % 8000 - 3000; p.position.set(p.userData.x, p.userData.y, z); const dc = st.camera.position.distanceTo(p.position) - p.scale.x * 0.5; p.material.opacity = (st.pre.puffA ?? 0.85) * C.clamp(1 - Math.abs(z) / 3200) * C.clamp((dc - 400) / 1400);   /* never a white blob right by the aircraft */ }
  st.exposure = st.pre.expo; st.grade = shot.grade || st.pre.grade || { contrast: 1.08, sat: 1.08 };
}
