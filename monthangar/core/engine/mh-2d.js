/* 2D shot types: chart maps (with lakes and rivers), the ops board timeline, the archival window and cards. */
import { R, register, clamp, lerp, ease, rad, rng, warn, image, mediaUrl, geo, hashStr, noise1 } from './mh-core.js';
import { F, FB, pill, units } from './mh-overlay.js';

/* ---------- shared backgrounds ---------- */
function gridBg(c, lt, opt = {}) {
  const th = R.theme, s = R.scale;
  const g = c.createLinearGradient(0, 0, 0, R.H); g.addColorStop(0, opt.top || th.bg); g.addColorStop(1, opt.bottom || shade(th.bg, -0.25)); c.fillStyle = g; c.fillRect(0, 0, R.W, R.H);
  c.save(); c.strokeStyle = th.name === 'graphite' ? 'rgba(120,170,190,0.07)' : 'rgba(40,70,90,0.07)'; c.lineWidth = 1 * s;
  const step = 60 * s, off = (lt * 6 * s) % step;
  for (let x = -step + off; x < R.W + step; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, R.H); c.stroke(); }
  for (let y = -step + off * 0.5; y < R.H + step; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(R.W, y); c.stroke(); }
  c.restore();
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = n >> 8 & 255, b = n & 255; const f = x => Math.round(clamp(k < 0 ? x * (1 + k) : x + (255 - x) * k, 0, 255)); return `rgb(${f(r)},${f(g)},${f(b)})`; }
function wrapText(c, text, max) { const out = []; for (const para of String(text).split('\n')) { let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; } out.push(line); } return out; }

/* ---------- maps ---------- */
const merc = lat => Math.log(Math.tan(Math.PI / 4 + rad(clamp(lat, -84, 84)) / 2));
let G = null;
async function mapData() {
  if (G) return G; const g = await geo();
  const P = rings => { const p = new Path2D(); for (const poly of rings) for (const ring of poly) { ring.forEach(([lo, la], i) => { const x = rad(lo), y = -merc(la); i ? p.lineTo(x, y) : p.moveTo(x, y); }); p.closePath(); } return p; };
  const L = lines => { const p = new Path2D(); for (const l of lines) l.forEach(([lo, la], i) => { const x = rad(lo), y = -merc(la); i ? p.lineTo(x, y) : p.moveTo(x, y); }); return p; };
  G = { land: P(g.land), lakes: P(g.lakes.map(l => l.polys).flat()), states: L(g.states), rivers: L(g.rivers), countries: g.countries.map(c => ({ ...c, path: P(c.polys) })), cities: g.cities, credit: g.credit };
  return G;
}
export function city(name) {
  if (Array.isArray(name)) return { name: '', lon: name[0], lat: name[1] };
  if (typeof name === 'object') return name;
  const n = String(name).toLowerCase(); const [nm, cc] = n.split(',').map(x => x.trim());
  const hits = G.cities.filter(c => c[0] && c[0].toLowerCase() === nm && (!cc || (c[3] || '').toLowerCase().includes(cc)));
  if (!hits.length) { warn(`map: city "${name}" not found; give {name, lat, lon}`); return null; }
  hits.sort((a, b) => b[4] - a[4]); const h = hits[0]; return { name: h[0], lat: h[1], lon: h[2] };
}
function gc(a, b, n = 64) { /* great-circle points between two {lat, lon} */
  const toV = p => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lon)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lon)), Math.sin(rad(p.lat))];
  const A = toV(a), B = toV(b); const d = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)); const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const s1 = d ? Math.sin((1 - t) * d) / Math.sin(d) : 1 - t, s2 = d ? Math.sin(t * d) / Math.sin(d) : t; const v = [A[0] * s1 + B[0] * s2, A[1] * s1 + B[1] * s2, A[2] * s1 + B[2] * s2]; out.push({ lat: Math.atan2(v[2], Math.hypot(v[0], v[1])) * 180 / Math.PI, lon: Math.atan2(v[1], v[0]) * 180 / Math.PI }); }
  return out;
}
function planeIcon(c, x, y, ang, sz, col) {
  c.save(); c.translate(x, y); c.rotate(ang); c.scale(sz / 20, sz / 20); c.fillStyle = col; c.beginPath();
  c.moveTo(12, 0); c.lineTo(4, -1.6); c.lineTo(-1, -10); c.lineTo(-4, -10); c.lineTo(-1, -1.6); c.lineTo(-8, -1.4); c.lineTo(-11, -5); c.lineTo(-13, -5); c.lineTo(-11.5, 0); c.lineTo(-13, 5); c.lineTo(-11, 5); c.lineTo(-8, 1.4); c.lineTo(-1, 1.6); c.lineTo(-4, 10); c.lineTo(-1, 10); c.lineTo(4, 1.6); c.closePath(); c.fill(); c.restore();
}
register('map', {
  kind: '2d',
  async setup(shot) { await mapData(); const m = shot.map || {}; return { m, cities: (m.cities || []).map(city).filter(Boolean), routes: (m.routes || []).map(r => ({ ...r, pts: (() => { const a = city(r.from), b = city(r.to); if (!a || !b) return []; const via = (r.via || []).map(city).filter(Boolean); const stops = [a, ...via, b]; let pts = []; for (let i = 0; i < stops.length - 1; i++) pts = pts.concat(gc(stops[i], stops[i + 1], 48)); return pts; })() })) }; },
  draw(st, lt, u, cx) {
    const c = cx.c, th = R.theme.map, s = R.scale, m = st.m; const e = ease.inOut(u);
    const A = { center: m.center || [0, 30], km: m.km || 6000 }, B = { center: (m.to && m.to.center) || A.center, km: (m.to && m.to.km) || A.km * 0.92 };
    const lon0 = lerp(A.center[0], B.center[0], e), lat0 = lerp(A.center[1], B.center[1], e);
    const km = Math.exp(lerp(Math.log(A.km), Math.log(B.km), e));
    const widthRad = rad(km / (111.32 * Math.cos(rad(lat0))));
    const k = R.W / widthRad; const tx = R.W / 2 - rad(lon0) * k, ty = R.H / 2 + merc(lat0) * k;
    const P = (lon, lat) => [rad(lon) * k + tx, -merc(lat) * k + ty];
    const og = c.createRadialGradient(R.W / 2, R.H / 2, 0, R.W / 2, R.H / 2, R.W * 0.75); og.addColorStop(0, th.ocean2); og.addColorStop(1, th.ocean); c.fillStyle = og; c.fillRect(0, 0, R.W, R.H);
    c.save(); c.setTransform(k, 0, 0, k, tx, ty);
    /* graticule */
    c.strokeStyle = th.grid; c.lineWidth = 1 * s / k; const stepDeg = km > 8000 ? 15 : km > 3000 ? 10 : km > 1200 ? 5 : 2;
    for (let lo = -180; lo <= 180; lo += stepDeg) { c.beginPath(); c.moveTo(rad(lo), -merc(84)); c.lineTo(rad(lo), -merc(-84)); c.stroke(); }
    for (let la = -80; la <= 80; la += stepDeg) { c.beginPath(); c.moveTo(rad(-180), -merc(la)); c.lineTo(rad(180), -merc(la)); c.stroke(); }
    /* land with a soft drop shadow, then coast */
    c.save(); c.translate(3 * s / k, 5 * s / k); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill(G.land); c.restore();
    const lg = c.createLinearGradient(0, -merc(lat0) - widthRad / 2, 0, -merc(lat0) + widthRad / 2); lg.addColorStop(0, th.land2); lg.addColorStop(1, th.land); c.fillStyle = lg; c.fill(G.land);
    for (const hi of [].concat(m.highlight || [])) { const cc = G.countries.find(x => x.iso === hi || (x.name || '').toLowerCase() === String(hi).toLowerCase()); if (!cc) { warn(`map: country "${hi}" not found`); continue; } c.fillStyle = th.hi; c.globalAlpha = clamp(lt / 0.6); c.fill(cc.path); c.strokeStyle = R.theme.accent; c.lineWidth = 2 * s / k; c.stroke(cc.path); c.globalAlpha = 1; }
    c.strokeStyle = th.border; c.lineWidth = 1 * s / k; for (const cc of G.countries) c.stroke(cc.path);
    if (m.states || km < 3500) { c.strokeStyle = th.border; c.globalAlpha = 0.45; c.setLineDash([3 * s / k, 3 * s / k]); c.stroke(G.states); c.setLineDash([]); c.globalAlpha = 1; }
    if (km < 5000) { c.strokeStyle = th.river; c.lineWidth = 1.2 * s / k; c.stroke(G.rivers); }
    c.fillStyle = th.lake; c.fill(G.lakes); c.strokeStyle = th.coast; c.lineWidth = 0.8 * s / k; c.stroke(G.lakes);
    c.strokeStyle = th.coast; c.lineWidth = 1.1 * s / k; c.stroke(G.land);
    c.restore();
    /* country labels: big ones only, in view */
    if (m.countryLabels !== false) {
      c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = FB(600, km > 6000 ? 15 : 18); c.fillStyle = th.label; c.globalAlpha = 0.55;
      const maxRank = km > 9000 ? 2 : km > 5000 ? 3 : km > 2500 ? 4 : 6;
      for (const cc of G.countries) { if ((cc.rank || 9) > maxRank) continue; const [x, y] = P(cc.label[0], cc.label[1]); if (x < 40 || x > R.W - 40 || y < 40 || y > R.H - 40) continue; c.fillText((cc.name || '').toUpperCase().split('').join(' '), x, y); }
      c.restore();
    }
    for (const ring of m.rings || []) { const ce = city(ring.at); if (!ce) continue; const pts = []; for (let a = 0; a <= 64; a++) { const b = a / 64 * Math.PI * 2; const d = ring.km / 6371; const la1 = rad(ce.lat), lo1 = rad(ce.lon); const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b)); const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2)); pts.push(P(lo2 * 180 / Math.PI, la2 * 180 / Math.PI)); }
      const g2 = ease.out(clamp((lt - (ring.t || 0.3)) / 1)); c.save(); c.strokeStyle = R.theme.accent2; c.fillStyle = R.theme.accent2; c.globalAlpha = 0.12 * g2; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p)); c.fill(); c.globalAlpha = 0.9 * g2; c.lineWidth = 2.5 * s; c.setLineDash([10 * s, 8 * s]); c.stroke(); c.setLineDash([]);
      if (ring.label) { c.font = F(700, 28); c.fillStyle = R.theme.accent2; c.textAlign = 'center'; c.fillText(ring.label.toUpperCase(), pts[0][0], pts[0][1] - 14 * s); } c.restore(); }
    /* routes */
    for (const r of st.routes) {
      if (!r.pts.length) continue; const t0 = r.t ?? 0.3, d = r.dur ?? Math.max(1.2, (cx.shot.t1 - cx.shot.t0) * 0.6);
      const g = ease.inOut(clamp((lt - t0) / d)); if (g <= 0) continue;
      const pts = r.pts.map(p => P(p.lon, p.lat)); const n = Math.max(1, Math.floor(g * (pts.length - 1)));
      c.save(); c.lineCap = 'round'; c.strokeStyle = r.color || th.route; c.globalAlpha = 0.35; c.lineWidth = 9 * s; c.beginPath(); for (let i = 0; i <= n; i++) i ? c.lineTo(...pts[i]) : c.moveTo(...pts[i]); c.stroke();
      c.globalAlpha = 1; c.lineWidth = 3.5 * s; c.setLineDash(r.dashed === false ? [] : [16 * s, 10 * s]); c.lineDashOffset = -lt * 40 * s; c.stroke(); c.setLineDash([]);
      const a = pts[Math.max(0, n - 1)], b = pts[n]; if (g < 1 || r.icon !== false) planeIcon(c, b[0], b[1], Math.atan2(b[1] - a[1], b[0] - a[0]), 30 * s, R.theme.ink);
      if (r.label && g > 0.3) { const mid = pts[Math.floor(pts.length / 2)]; c.font = F(700, 30); c.textAlign = 'center'; c.fillStyle = r.color || th.route; c.globalAlpha = clamp((g - 0.3) / 0.3); c.fillText(r.label.toUpperCase(), mid[0], mid[1] - 22 * s); }
      c.restore();
    }
    /* cities */
    st.cities.forEach((ce, i) => {
      const [x, y] = P(ce.lon, ce.lat); const a = ease.out(clamp((lt - 0.2 - i * 0.25) / 0.4)); if (a <= 0) return;
      c.save(); c.globalAlpha = a; c.fillStyle = th.city; c.beginPath(); c.arc(x, y, 7 * s, 0, 7); c.fill(); c.strokeStyle = R.theme.ink; c.lineWidth = 2.5 * s; c.stroke();
      c.strokeStyle = th.city; c.globalAlpha = a * 0.5 * (1 - (lt * 0.7 % 1)); c.beginPath(); c.arc(x, y, (10 + 22 * (lt * 0.7 % 1)) * s, 0, 7); c.stroke(); c.globalAlpha = a;
      const nm = (ce.label || ce.name || '').toUpperCase(); c.font = F(700, 32); const tw = c.measureText(nm).width; const right = x < R.W * 0.75;
      const lx = right ? x + 18 * s : x - 18 * s - tw; pill(c, lx - 8 * s, y - 22 * s, tw + 16 * s, 40 * s, 5 * s, R.theme.panel); c.fillStyle = R.theme.ink; c.textBaseline = 'middle'; c.fillText(nm, lx, y);
      c.restore();
    });
    for (const lb of m.labels || []) { const [x, y] = P(lb.at[0], lb.at[1]); c.save(); c.globalAlpha = ease.out(clamp((lt - (lb.t || 0.4)) / 0.5)); c.font = F(600, lb.size || 30); c.fillStyle = lb.color || R.theme.map.label; c.textAlign = 'center'; c.fillText(String(lb.text).toUpperCase(), x, y); c.restore(); }
    if (m.title) { c.save(); c.font = F(800, 40); const tw = c.measureText(m.title.toUpperCase()).width; const y = R.vertical ? R.H * 0.1 : 60 * s; pill(c, 60 * s, y, tw + 40 * s, 60 * s, 8 * s, R.theme.panel); c.fillStyle = R.theme.accent; c.fillRect(60 * s, y, 5 * s, 60 * s); c.fillStyle = R.theme.ink; c.textBaseline = 'middle'; c.fillText(m.title.toUpperCase(), 82 * s, y + 31 * s); c.restore(); }
  }
});

/* ---------- the ops board: a dark wall with an amber rail, photo prints clipped on, dates on the rail ---------- */
register('board', {
  kind: '2d',
  async setup(shot) {
    const b = shot.board || {}; const ev = b.events || [];
    const imgs = await Promise.all(ev.map(e => e.img ? image(mediaUrl(e.img)).catch(() => { warn(`board: image ${e.img} missing`); return null; }) : null));
    return { b, ev, imgs, r: rng(hashStr(shot.id || 'b')) };
  },
  draw(st, lt, u, cx) {
    const c = cx.c, th = R.theme.board, s = R.scale, n = st.ev.length, dur = cx.shot.t1 - cx.shot.t0;
    const bg = c.createLinearGradient(0, 0, 0, R.H); bg.addColorStop(0, th.bg2); bg.addColorStop(1, th.bg); c.fillStyle = bg; c.fillRect(0, 0, R.W, R.H);
    c.save(); c.globalAlpha = 0.05; c.strokeStyle = th.ink; for (let x = 0; x < R.W; x += 40 * s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, R.H); c.stroke(); } c.restore();
    const spacing = (R.vertical ? 0.62 : 0.34) * R.W; const total = Math.max(0, (n - 1) * spacing);
    const appear = i => (st.ev[i].t ?? (0.25 + i * Math.max(0.6, (dur - 1.2) / Math.max(1, n)))); /* seconds into the shot */
    let active = 0; for (let i = 0; i < n; i++) if (lt >= appear(i)) active = i;
    const focusX = n > 1 ? lerp(active > 0 ? (active - 1) * spacing : 0, active * spacing, ease.inOut(clamp((lt - appear(active)) / 0.8))) : 0;
    const view = Math.min(total, focusX) - (R.vertical ? 0 : Math.min(total, spacing * 0.6)) * (n > 2 ? 0.5 : 0);
    const ox = (n === 1 ? R.W / 2 : (R.vertical ? R.W / 2 : R.W * 0.5 - Math.max(0, total / 2 - Math.max(0, total / 2 - view) * 0)) - (n > 1 && total > R.W * 0.7 ? view - total / 2 + total / 2 - (R.vertical ? 0 : R.W * 0.0) : total / 2)) - (n > 1 && total > R.W * 0.7 ? 0 : 0);
    const railY = R.H * (R.vertical ? 0.62 : 0.68);
    const x0 = n > 1 && total > R.W * 0.7 ? R.W / 2 - focusX : R.W / 2 - total / 2;
    void ox; void view;
    c.save(); c.strokeStyle = th.rail; c.lineWidth = 5 * s; c.beginPath(); c.moveTo(-10, railY); c.lineTo(R.W + 10, railY); c.stroke(); c.restore();
    if (st.b.title) { c.save(); c.font = F(800, R.vertical ? 64 : 58); c.fillStyle = th.ink; c.textAlign = 'left'; c.fillText(st.b.title.toUpperCase(), 80 * s, R.vertical ? R.H * 0.14 : 110 * s); c.fillStyle = th.rail; c.fillRect(80 * s, (R.vertical ? R.H * 0.14 : 110 * s) + 18 * s, 120 * s, 5 * s); c.restore(); }
    st.ev.forEach((e, i) => {
      const a = ease.out(clamp((lt - appear(i)) / 0.5)); if (a <= 0) return;
      const x = x0 + i * spacing; if (x < -spacing || x > R.W + spacing) return;
      c.save(); c.globalAlpha = a;
      c.fillStyle = th.rail; c.beginPath(); c.arc(x, railY, 12 * s, 0, 7); c.fill(); c.fillStyle = th.bg; c.beginPath(); c.arc(x, railY, 5 * s, 0, 7); c.fill();
      c.font = F(800, 46); c.fillStyle = th.rail; c.textAlign = 'center'; c.fillText(String(e.year || e.date || ''), x, railY + 64 * s);
      c.font = F(600, 30); c.fillStyle = th.ink; wrapText(c, String(e.text || '').toUpperCase(), spacing * 0.82).slice(0, 3).forEach((l, k) => c.fillText(l, x, railY + 106 * s + k * 34 * s));
      const im = st.imgs[i]; const pw = (R.vertical ? 0.5 : 0.24) * R.W, ph = pw * 0.75; const rot = (st.r() - 0.5) * 0.06 + (i % 2 ? 0.02 : -0.02);
      const drop = (1 - a) * -40 * s; const py = railY - ph - 70 * s + drop;
      c.translate(x, py + ph / 2); c.rotate(rot);
      c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 24 * s; c.shadowOffsetY = 10 * s; c.fillStyle = th.paper; c.fillRect(-pw / 2 - 12 * s, -ph / 2 - 12 * s, pw + 24 * s, ph + 24 * s); c.shadowColor = 'transparent';
      if (im) { const r2 = Math.max(pw / im.width, ph / im.height); const sw = pw / r2, sh = ph / r2; c.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, -pw / 2, -ph / 2, pw, ph); }
      else { c.fillStyle = '#2b3238'; c.fillRect(-pw / 2, -ph / 2, pw, ph); c.font = F(800, 70); c.fillStyle = th.rail; c.fillText(String(e.year || ''), 0, 20 * s); }
      c.fillStyle = th.clip; c.fillRect(-26 * s, -ph / 2 - 26 * s, 52 * s, 30 * s); c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(-26 * s, -ph / 2 - 26 * s, 52 * s, 6 * s);
      c.restore();
    });
  }
});

/* ---------- archival: footage or photos in a framed window over a soft blurred copy ---------- */
const small = document.createElement('canvas'); small.width = 64; small.height = 36;
async function frameImage(st, lt) {
  if (st.frames) { const i = clamp(Math.floor((lt * (st.speed || 1) + (st.offset || 0)) * st.frames.fps), 0, st.frames.n - 1); const url = `/p/${st.frames.dir}/${String(i + 1).padStart(5, '0')}.jpg`;
    if (st.cur && st.cur.url === url) return st.cur.im; const im = await new Promise((ok) => { const x = new Image(); x.onload = () => ok(x); x.onerror = () => ok(null); x.src = url; }); st.cur = { url, im }; return im; }
  return st.img;
}
register('archival', {
  kind: '2d',
  async setup(shot) {
    const st = { frames: shot.frames, kb: shot.kenburns, speed: shot.speed, offset: 0 };
    if (!shot.frames) st.img = await image(mediaUrl(shot.media)).catch(() => { warn(`archival: ${shot.media} missing`); return null; });
    if (shot.frames) { const first = await frameImage(st, 0); st.first = first; if (!first) warn(`archival shot ${shot.id}: frames missing in ${shot.frames.dir}; run mh.py plan again`); }
    return st;
  },
  prepare: (st, lt) => prepareArchival(st, lt),
  draw(st, lt, u, cx) { /* sync wrapper: frames are fetched ahead in prepare() */ drawArchival(cx.c, st, st.curIm || st.img || st.first, lt, u, cx.shot); }
});
/* the core awaits prepare() before draw for shots that need per-frame loading */
export async function prepareArchival(st, lt) { st.curIm = await frameImage(st, lt); }
function drawArchival(c, st, im, lt, u, shot) {
  const s = R.scale, th = R.theme;
  c.fillStyle = '#07080a'; c.fillRect(0, 0, R.W, R.H);
  if (!im) return;
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; const crop = shot.crop || [0, 0, 1, 1];
  const sx0 = crop[0] * iw, sy0 = crop[1] * ih, sw0 = (crop[2] - crop[0]) * iw, sh0 = (crop[3] - crop[1]) * ih;
  /* soft background: the same picture, tiny then scaled up, darkened */
  const sc = small.getContext('2d'); sc.drawImage(im, sx0, sy0, sw0, sh0, 0, 0, 64, 36);
  c.save(); c.imageSmoothingQuality = 'high'; c.filter = `blur(${Math.round(30 * R.scale)}px)`; c.globalAlpha = 0.6; c.drawImage(small, -R.W * 0.1, -R.H * 0.1, R.W * 1.2, R.H * 1.2); c.restore();
  c.fillStyle = 'rgba(5,6,8,0.55)'; c.fillRect(0, 0, R.W, R.H);
  /* window: contain-fit, never cropped into a sliver */
  const maxW = R.W * (R.vertical ? 0.94 : 0.8), maxH = R.H * (R.vertical ? 0.4 : 0.8);
  const ar = sw0 / sh0; let w = maxW, h = w / ar; if (h > maxH) { h = maxH; w = h * ar; }
  const x = (R.W - w) / 2, y = R.vertical ? R.H * 0.44 - h / 2 : (R.H - h) / 2 - 10 * s;
  /* Ken Burns for stills: kenburns: { from: [cx, cy, zoom], to: [...] } in picture fractions */
  let kx = 0.5, ky = 0.5, kz = 1;
  if (!st.frames) { const kb = st.kb || { from: [0.5, 0.5, 1.0], to: [0.5, 0.48, 1.08] }; const e = ease.sine(u); kx = lerp(kb.from[0], kb.to[0], e); ky = lerp(kb.from[1], kb.to[1], e); kz = lerp(kb.from[2], kb.to[2], e); }
  const vw = sw0 / kz, vh = sh0 / kz; const vx = clamp(sx0 + kx * sw0 - vw / 2, sx0, sx0 + sw0 - vw), vy = clamp(sy0 + ky * sh0 - vh / 2, sy0, sy0 + sh0 - vh);
  c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 40 * s; c.fillStyle = '#000'; c.fillRect(x, y, w, h); c.restore();
  c.save(); if (shot.mono) c.filter = 'grayscale(1) contrast(1.05)'; c.drawImage(im, vx, vy, vw, vh, x, y, w, h); c.restore();
  /* frame: thin border and amber corner brackets */
  c.save(); c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 1.5 * s; c.strokeRect(x, y, w, h);
  c.strokeStyle = th.accent; c.lineWidth = 4 * s; const L = 34 * s, o = 10 * s;
  for (const [cx2, cy2, dx, dy] of [[x - o, y - o, 1, 1], [x + w + o, y - o, -1, 1], [x - o, y + h + o, 1, -1], [x + w + o, y + h + o, -1, -1]]) { c.beginPath(); c.moveTo(cx2 + dx * L, cy2); c.lineTo(cx2, cy2); c.lineTo(cx2, cy2 + dy * L); c.stroke(); }
  c.restore();
  if (shot.caption || shot.credit) {
    const txt = [shot.caption, shot.credit].filter(Boolean).join('  ·  '); c.save(); c.font = FB(600, 20); const tw = c.measureText(txt).width;
    const tx = R.vertical ? (R.W - tw) / 2 : x, ty = y + h + 30 * s; c.globalAlpha = clamp(lt / 0.6); c.fillStyle = th.dim; c.textBaseline = 'top'; c.fillText(txt, tx, ty); c.restore();
  }
}

/* ---------- cards ---------- */
register('card', {
  kind: '2d',
  async setup(shot) { const st = { ...shot.card }; if (st.img) st.im = await image(mediaUrl(st.img)).catch(() => null); return st; },
  draw(st, lt, u, cx) {
    const c = cx.c, th = R.theme, s = R.scale; gridBg(c, lt);
    const style = st.style || 'chapter'; const a = ease.out(clamp(lt / 0.6));
    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
    if (style === 'chapter') {
      c.globalAlpha = a; c.font = F(800, R.vertical ? 170 : 190); c.fillStyle = th.accent; c.fillText(String(st.number || '').padStart(2, '0'), R.W / 2, R.H * 0.33);
      c.font = F(800, R.vertical ? 92 : 104); c.fillStyle = th.ink; wrapText(c, String(st.title || '').toUpperCase(), R.W * 0.8).forEach((l, i) => c.fillText(l, R.W / 2, R.H * 0.53 + i * 100 * s));
      const nl = wrapText(c, String(st.title || '').toUpperCase(), R.W * 0.8).length;
      const lw = ease.out(clamp((lt - 0.3) / 0.7)) * 260 * s; c.fillStyle = th.accent; c.fillRect(R.W / 2 - lw / 2, R.H * 0.53 + (nl - 1) * 100 * s + 70 * s, lw, 5 * s);
    } else if (style === 'quote') {
      c.globalAlpha = a; c.font = F(800, 220); c.fillStyle = th.accent; c.fillText('“', R.W / 2, R.H * 0.26);
      c.font = F(600, R.vertical ? 62 : 66); c.fillStyle = th.ink; const lines = wrapText(c, st.text || '', R.W * (R.vertical ? 0.84 : 0.7)); const lh = 78 * s; const y0 = R.H * 0.5 - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => { c.globalAlpha = ease.out(clamp((lt - 0.2 - i * 0.18) / 0.5)); c.fillText(l, R.W / 2, y0 + i * lh); });
      c.globalAlpha = ease.out(clamp((lt - 0.8) / 0.5)); c.font = FB(700, 24); c.fillStyle = th.accent; c.fillText(('— ' + (st.by || '')).toUpperCase(), R.W / 2, y0 + lines.length * lh + 30 * s);
    } else if (style === 'list') {
      c.textAlign = 'left'; c.globalAlpha = a; c.font = F(800, 64); c.fillStyle = th.ink; const x0 = R.W * (R.vertical ? 0.1 : 0.2); c.fillText(String(st.title || '').toUpperCase(), x0, R.H * 0.2);
      c.fillStyle = th.accent; c.fillRect(x0, R.H * 0.2 + 40 * s, 140 * s, 5 * s);
      (st.items || []).forEach((it, i) => { const t0 = (st.times && st.times[i]) ?? (0.5 + i * 0.7); const k = ease.out(clamp((lt - t0) / 0.45)); if (k <= 0) return; const y = R.H * 0.34 + i * 100 * s; c.globalAlpha = k; c.save(); c.translate((1 - k) * 40 * s, 0);
        pill(c, x0, y - 38 * s, 76 * s, 76 * s, 8 * s, th.accent); c.fillStyle = th.bg; c.font = F(800, 50); c.textAlign = 'center'; c.fillText(String(i + 1), x0 + 38 * s, y + 2 * s); c.textAlign = 'left';
        c.fillStyle = th.ink; c.font = F(700, 52); c.fillText(String(it).toUpperCase(), x0 + 104 * s, y + 2 * s); c.restore(); });
    } else if (style === 'spec') {
      const rows = st.rows || []; const cols = st.cols || []; const x0 = R.W * 0.16, x1 = R.W * 0.84; const cw = (x1 - x0) / (cols.length + 1);
      c.globalAlpha = a; c.font = F(800, 58); c.fillStyle = th.ink; c.fillText(String(st.title || '').toUpperCase(), R.W / 2, R.H * 0.16);
      c.font = F(800, 40); cols.forEach((h, j) => { c.fillStyle = j === (st.mark ?? -1) ? th.accent : th.ink; c.fillText(String(h).toUpperCase(), x0 + cw * (j + 1.5), R.H * 0.28); });
      rows.forEach((r, i) => { const k = ease.out(clamp((lt - 0.4 - i * 0.35) / 0.4)); if (k <= 0) return; const y = R.H * 0.38 + i * 84 * s; c.globalAlpha = k; c.fillStyle = 'rgba(255,255,255,0.04)'; if (i % 2 === 0) c.fillRect(x0, y - 38 * s, x1 - x0, 76 * s);
        c.textAlign = 'left'; c.font = FB(700, cols.length ? 24 : 32); c.fillStyle = th.dim; c.fillText(String(r[0]).toUpperCase(), x0 + 20 * s, y); c.textAlign = 'center'; c.font = F(700, cols.length ? 44 : 52);
        if (!cols.length) { c.textAlign = 'right'; c.fillStyle = th.ink; c.fillText(String(r[1] ?? ''), x1 - 24 * s, y); c.textAlign = 'center'; }
        else r.slice(1).forEach((v, j) => { c.fillStyle = j === (st.mark ?? -1) ? th.accent : th.ink; c.fillText(String(v), x0 + cw * (j + 1.5), y); }); });
    } else if (style === 'fact') {
      c.globalAlpha = a; const k = ease.out(clamp(lt / 1.2)); const v = typeof st.value === 'number' ? st.value * k : st.value;
      const [p, q] = typeof st.value === 'number' ? units(v, st.unit, st) : [String(v), ''];
      c.font = F(800, R.vertical ? 170 : 210); c.fillStyle = th.accent; c.fillText(p, R.W / 2, R.H * 0.45);
      if (q) { c.font = F(600, 54); c.fillStyle = th.dim; c.fillText(units(st.value, st.unit, st)[1], R.W / 2, R.H * 0.45 + 140 * s); }
      c.font = F(700, 52); c.fillStyle = th.ink; wrapText(c, String(st.caption || '').toUpperCase(), R.W * 0.8).forEach((l, i) => c.fillText(l, R.W / 2, R.H * (R.vertical ? 0.62 : 0.68) + i * 60 * s));
    } else if (style === 'doc' && st.im) {
      const im = st.im; const maxW = R.W * 0.6, maxH = R.H * 0.84; let w = maxW, h = w * im.height / im.width; if (h > maxH) { h = maxH; w = h * im.width / im.height; }
      const z = lerp(1, 1.08, ease.sine(u)); c.save(); c.translate(R.W / 2, R.H / 2); c.rotate(-0.012); c.scale(z, z); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 40 * s; c.drawImage(im, -w / 2, -h / 2, w, h); c.shadowColor = 'transparent';
      if (st.mark) { const [mx, my, mw, mh] = st.mark; c.globalCompositeOperation = 'multiply'; c.fillStyle = th.accent; c.globalAlpha = 0.55 * ease.out(clamp((lt - 0.6) / 0.6)); c.fillRect(-w / 2 + mx * w, -h / 2 + my * h, mw * w * ease.out(clamp((lt - 0.6) / 0.6)), mh * h); }
      c.restore();
    } else if (style === 'title') {
      c.globalAlpha = a; c.font = FB(700, 26); c.fillStyle = th.accent; if (st.kicker) c.fillText(st.kicker.toUpperCase().split('').join(' '), R.W / 2, R.H * 0.36);
      c.font = F(800, R.vertical ? 104 : 120); c.fillStyle = th.ink; wrapText(c, String(st.text || '').toUpperCase(), R.W * 0.82).forEach((l, i) => c.fillText(l, R.W / 2, R.H * 0.47 + i * 116 * s));
    }
    c.restore();
  }
});
