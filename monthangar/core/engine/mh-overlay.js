/* The overlay layer: labels with leader lines, dimension lines, counting stats, source tags, titles
   and burned-in captions. Drawn in 2D over any shot so text stays crisp at any size. */
import { R, clamp, ease, warn } from './mh-core.js';

/* ---------- units: give a value in its own unit; the other system follows in brackets ---------- */
const CONV = {
  m: ['ft', 3.28084], ft: ['m', 0.3048], km: ['mi', 0.621371], mi: ['km', 1.609344], nmi: ['km', 1.852],
  'km/h': ['mph', 0.621371], mph: ['km/h', 1.609344], kn: ['km/h', 1.852], kg: ['lb', 2.20462], lb: ['kg', 0.453592],
  t: ['lb', 2204.62], hp: ['kW', 0.7457], kW: ['hp', 1.34102], kN: ['lbf', 224.809], lbf: ['kN', 0.00444822],
  L: ['US gal', 0.264172], 'US gal': ['L', 3.78541], 'm²': ['sq ft', 10.7639], 'sq ft': ['m²', 0.092903], 'm/s': ['ft/min', 196.85], 'ft/min': ['m/s', 0.00508]
};
const IMPERIAL = new Set(['ft', 'mi', 'nmi', 'mph', 'kn', 'lb', 'hp', 'lbf', 'US gal', 'sq ft', 'ft/min']);
export function fmt(v, dec) {
  if (typeof v !== 'number') return String(v);
  const d = dec ?? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2);
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
/* returns [first, second] strings in the channel's unit order; never puts metric first for an imperial channel */
export function units(v, unit, opt = {}) {
  const c = CONV[unit];
  if (!c || opt.convert === false) return [`${fmt(v, opt.dec)} ${unit || ''}`.trim(), ''];
  const other = v * c[1]; const ou = c[0];
  const round = x => Math.abs(x) >= 1000 ? Math.round(x / 10) * 10 : x;
  const a = `${fmt(v, opt.dec)} ${unit}`, b = `${fmt(round(other), opt.dec2 ?? opt.dec)} ${ou}`;
  const srcImperial = IMPERIAL.has(unit) || unit === 'kn';
  const wantImperial = (R.units || 'imperial') === 'imperial';
  return srcImperial === wantImperial ? [a, b] : [b, a];
}

/* ---------- drawing helpers ---------- */
export const F = (w, px) => `${w} ${Math.round(px * R.scale)}px Barlow`;
export const FB = (w, px) => `${w} ${Math.round(px * R.scale)}px Inter`;
export function pill(c, x, y, w, h, r, fill, stroke) {
  c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5 * R.scale; c.stroke(); }
}
function shadowText(c, txt, x, y, col, sh = 'rgba(0,0,0,0.55)') { c.save(); c.shadowColor = sh; c.shadowBlur = 12 * R.scale; c.fillStyle = col; c.fillText(txt, x, y); c.restore(); }
const win = (o, lt, shotDur) => { const t0 = o.t ?? o.at_t ?? 0.25, d = o.dur ?? (shotDur - t0 - 0.1); return { a: clamp((lt - t0) / 0.45), out: clamp((t0 + d - lt) / 0.3), t0 }; };

/* ---------- overlays per shot ---------- */
export function drawOverlays(c, s, st, lt, u, cx) {
  const dur = s.t1 - s.t0; let statSlot = 0;
  for (const o of s.add) {
    const w = win(o, lt, dur); const k = Math.min(w.a, w.out); if (k <= 0) continue;
    const proj = st && st.project;
    try {
      if (o.type === 'label') label(c, o, proj, k, lt - w.t0);
      else if (o.type === 'dim') dim(c, o, proj, k, lt - w.t0);
      else if (o.type === 'stat') stat(c, o, k, lt - w.t0, statSlot++);
      else if (o.type === 'tag') tag(c, o, k);
      else if (o.type === 'title') title(c, o, k, lt - w.t0);
      else if (o.type === 'note') note(c, o, k);
      else warn(`shot ${s.id}: unknown overlay "${o.type}"`);
    } catch (e) { warn(`shot ${s.id}: overlay ${o.type} failed: ${e.message}`); }
  }
}

function label(c, o, proj, k, lt) {
  if (!proj) return; const [x, y, vis] = proj(o.at); if (!vis) return;
  const s = R.scale, th = R.theme; const side = o.side || (x > R.W * 0.55 ? 'left' : 'right');
  const up = o.up ?? (y > R.H * 0.35 ? -1 : 1);
  const lx = x + (side === 'right' ? 1 : -1) * (o.dx ?? 90) * s, ly = y + up * (o.dy ?? 70) * s;
  const draw = ease.out(k);
  c.save(); c.globalAlpha = clamp(k * 1.5);
  /* anchor: dot and a soft pulse ring */
  c.fillStyle = th.accent; c.beginPath(); c.arc(x, y, 5 * s, 0, 7); c.fill();
  c.strokeStyle = th.accent; c.lineWidth = 2 * s; c.globalAlpha *= 0.6 * (1 - (lt * 0.8 % 1)); c.beginPath(); c.arc(x, y, (8 + 16 * (lt * 0.8 % 1)) * s, 0, 7); c.stroke(); c.globalAlpha = clamp(k * 1.5);
  /* leader: diagonal, then a short level run under the text */
  c.font = F(700, o.size || 34); const txt = String(o.text).toUpperCase(); const tw = c.measureText(txt).width;
  const run = tw + 28 * s; const ex = lx + (side === 'right' ? run : -run);
  c.strokeStyle = th.accent; c.lineWidth = 2.2 * s; c.beginPath(); c.moveTo(x, y);
  const m1 = clamp(draw * 2), m2 = clamp(draw * 2 - 1);
  c.lineTo(x + (lx - x) * m1, y + (ly - y) * m1); if (m2 > 0) c.lineTo(lx + (ex - lx) * m2, ly); c.stroke();
  if (m2 > 0.2) {
    const tx = side === 'right' ? lx + 14 * s : lx - 14 * s - tw; const ty = ly - 12 * s;
    c.globalAlpha = clamp((m2 - 0.2) / 0.5) * clamp(k * 1.5);
    pill(c, tx - 10 * s, ty - 34 * s, tw + 20 * s, 44 * s, 6 * s, th.panel);
    c.fillStyle = th.ink; c.textBaseline = 'alphabetic'; c.fillText(txt, tx, ty);
    if (o.sub) { c.font = FB(500, 20); c.fillStyle = th.dim; c.fillText(o.sub, tx, ly + 22 * s); }
  }
  c.restore();
}

function dim(c, o, proj, k, lt) {
  if (!proj) return; let [x1, y1, v1] = proj(o.from), [x2, y2, v2] = proj(o.to); if (!v1 && !v2) return;
  const s = R.scale, th = R.theme; const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1; const nx = -dy / L, ny = dx / L;
  const off = (o.offset ?? 46) * s * (o.flip ? -1 : 1); const sgn = (ny < 0 ? 1 : -1);
  const ox = nx * off * sgn, oy = ny * off * sgn;
  const a1 = [x1 + ox, y1 + oy], a2 = [x2 + ox, y2 + oy];
  const g = ease.out(clamp(k * 1.3)); const mx = (a1[0] + a2[0]) / 2, my = (a1[1] + a2[1]) / 2;
  const p1 = [mx + (a1[0] - mx) * g, my + (a1[1] - my) * g], p2 = [mx + (a2[0] - mx) * g, my + (a2[1] - my) * g];
  c.save(); c.globalAlpha = clamp(k * 1.6); c.strokeStyle = th.accent; c.lineWidth = 2.2 * s;
  c.setLineDash([4 * s, 5 * s]); c.globalAlpha *= 0.7; c.beginPath(); c.moveTo(x1, y1); c.lineTo(a1[0] + ox * 0.15, a1[1] + oy * 0.15); c.moveTo(x2, y2); c.lineTo(a2[0] + ox * 0.15, a2[1] + oy * 0.15); c.stroke(); c.setLineDash([]); c.globalAlpha = clamp(k * 1.6);
  c.beginPath(); c.moveTo(...p1); c.lineTo(...p2); c.stroke();
  const tick = (p, d) => { const ux = dx / L * d, uy = dy / L * d; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + ux * 14 * s + nx * 7 * s, p[1] + uy * 14 * s + ny * 7 * s); c.moveTo(p[0], p[1]); c.lineTo(p[0] + ux * 14 * s - nx * 7 * s, p[1] + uy * 14 * s - ny * 7 * s); c.stroke(); };
  if (g > 0.95) { tick(p1, 1); tick(p2, -1); }
  if (g > 0.6) {
    const val = o.text || units(o.value, o.unit || 'm', o).filter(Boolean).join('  ·  ');
    c.font = F(700, o.size || 36); const tw = c.measureText(val).width;
    const tx = mx + ox * 0.9, ty = my + oy * 0.9;
    c.globalAlpha = clamp((g - 0.6) / 0.3) * clamp(k * 1.6);
    pill(c, tx - tw / 2 - 14 * s, ty - 26 * s, tw + 28 * s, 50 * s, 8 * s, th.panel, th.panelEdge);
    c.fillStyle = th.ink; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(val, tx, ty + 1 * s);
    if (o.label) { c.font = FB(500, 18); c.fillStyle = th.dim; c.fillText(o.label.toUpperCase(), tx, ty + 40 * s); }
  }
  c.restore();
}

/* counting stat card. pos: lower-left (default), lower-right, upper-left, upper-right, upper (centre, used in Shorts), center */
function stat(c, o, k, lt, slot) {
  const s = R.scale, th = R.theme;
  const pos = o.pos || (R.vertical ? 'upper' : 'lower-left');
  const count = typeof o.value === 'number' && o.count !== false ? ease.out(clamp(lt / (o.countDur ?? 1.1))) : 1;
  const v = typeof o.value === 'number' ? o.value * count : o.value;
  const [a, b] = typeof o.value === 'number' ? units(v, o.unit, o) : [String(o.value), ''];
  const [, bFinal] = typeof o.value === 'number' ? units(o.value, o.unit, o) : ['', ''];
  const big = R.vertical ? 92 : 86;
  c.save(); c.font = F(800, big); const wA = c.measureText(units(o.value, o.unit, o)[0] || a).width;
  c.font = F(600, 34); const wB = b ? c.measureText(bFinal).width : 0;
  c.font = FB(700, 20); const wL = o.label ? c.measureText(o.label.toUpperCase()).width : 0;
  const w = Math.max(wA, wB, wL) + 70 * s, h = (big + (o.label ? 34 : 0) + (b ? 44 : 0) + 36) * s;
  const m = 70 * s; let x = m, y = R.H - m - h - slot * (h + 18 * s);
  if (pos === 'lower-right') x = R.W - m - w;
  if (pos.startsWith('upper')) y = (R.vertical ? R.H * 0.075 : m) + slot * (h + 18 * s);
  if (pos === 'upper-right') x = R.W - m - w;
  if (pos === 'upper' || pos === 'center') x = (R.W - w) / 2;
  if (pos === 'center') y = (R.H - h) / 2;
  const slide = (1 - ease.out(clamp(k * 1.2))) * 40 * s;
  c.globalAlpha = clamp(k * 1.5); c.translate(-slide, 0);
  pill(c, x, y, w, h, 10 * s, th.panel);
  c.fillStyle = th.accent; c.fillRect(x, y + 12 * s, 6 * s, h - 24 * s);
  let yy = y + 24 * s; c.textBaseline = 'top'; c.textAlign = 'left';
  if (o.label) { c.font = FB(700, 20); c.fillStyle = th.accent; c.fillText(o.label.toUpperCase(), x + 32 * s, yy); yy += 34 * s; }
  c.font = F(800, big); c.fillStyle = th.ink; c.fillText(a, x + 30 * s, yy - 6 * s); yy += big * s;
  if (b) { c.font = F(600, 34); c.fillStyle = th.dim; c.fillText(bFinal, x + 32 * s, yy + 2 * s); }
  c.restore();
}

function tag(c, o, k) {
  const s = R.scale, th = R.theme; c.save(); c.globalAlpha = clamp(k * 1.5);
  c.font = FB(600, 21); const txt = String(o.text); const tw = c.measureText(txt).width;
  const x = R.vertical ? (R.W - tw) / 2 - 18 * s : 70 * s, y = R.vertical ? R.H * 0.64 : R.H - 92 * s;
  pill(c, x, y, tw + 36 * s, 42 * s, 6 * s, th.panel); c.fillStyle = th.accent; c.fillRect(x, y, 4 * s, 42 * s);
  c.fillStyle = th.ink; c.textBaseline = 'middle'; c.fillText(txt, x + 20 * s, y + 21 * s); c.restore();
}

function note(c, o, k) {
  const s = R.scale, th = R.theme; c.save(); c.globalAlpha = clamp(k * 1.5);
  c.font = F(700, o.size || 44); const lines = String(o.text).split('\n');
  const tw = Math.max(...lines.map(l => c.measureText(l.toUpperCase()).width)); const lh = (o.size || 44) * 1.15 * s;
  const x = o.x != null ? o.x * R.W : (R.W - tw) / 2, y = o.y != null ? o.y * R.H : R.H * 0.12;
  pill(c, x - 24 * s, y - 16 * s, tw + 48 * s, lines.length * lh + 26 * s, 10 * s, th.panel);
  c.fillStyle = th.ink; c.textBaseline = 'top'; lines.forEach((l, i) => c.fillText(l.toUpperCase(), x, y + i * lh));
  c.restore();
}

function title(c, o, k, lt) {
  const s = R.scale, th = R.theme; c.save();
  const y = o.y != null ? o.y * R.H : R.H * (R.vertical ? 0.2 : 0.5);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.globalAlpha = clamp(k * 1.4);
  if (o.kicker) { c.font = FB(700, 24); c.fillStyle = th.accent; c.fillText(o.kicker.toUpperCase().split('').join(' '), R.W / 2, y - 80 * s); }
  c.font = F(800, o.size || (R.vertical ? 96 : 110)); const lines = String(o.text).toUpperCase().split('\n');
  lines.forEach((l, i) => shadowText(c, l, R.W / 2, y + i * (o.size || 110) * 1.02 * s, th.ink, 'rgba(0,0,0,0.7)'));
  const lw = ease.out(clamp((lt - 0.2) / 0.6)) * 220 * s; c.fillStyle = th.accent; c.fillRect(R.W / 2 - lw / 2, y + (lines.length - 0.35) * (o.size || 110) * s + 22 * s, lw, 5 * s);
  if (o.sub) { c.font = FB(500, 28); c.fillStyle = th.dim; c.fillText(o.sub, R.W / 2, y + (lines.length - 0.35) * (o.size || 110) * s + 66 * s); }
  c.restore();
}

/* ---------- burned-in captions for Shorts: two short lines, the spoken word lights up ---------- */
export function drawCaptions(c, t) {
  const caps = R.tl.captions; let cue = null;
  for (const q of caps) if (t >= q.t0 && t < q.t1) { cue = q; break; }
  if (!cue) return;
  const s = R.scale, th = R.theme; const y0 = R.H * (R.tl.captionY || 0.735);
  c.save(); c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = F(800, 70);
  const words = cue.words || cue.text.split(' ').map(w => ({ w }));
  const lines = []; let cur = [], cw = 0; const max = R.W * 0.84, sp = c.measureText(' ').width;
  for (const w of words) { const ww = c.measureText(w.w.toUpperCase()).width; if (cur.length && cw + sp + ww > max) { lines.push(cur); cur = []; cw = 0; } cur.push({ ...w, ww }); cw += (cur.length > 1 ? sp : 0) + ww; }
  if (cur.length) lines.push(cur);
  const lh = 84 * s; const pop = ease.out(clamp((t - cue.t0) / 0.12));
  lines.forEach((ln, li) => {
    const tw = ln.reduce((a, w) => a + w.ww, 0) + sp * (ln.length - 1); let x = (R.W - tw) / 2; const y = y0 + (li - (lines.length - 1) / 2) * lh;
    for (const w of ln) {
      const on = w.t0 != null && t >= w.t0;
      c.lineJoin = 'round'; c.lineWidth = 12 * s; c.strokeStyle = 'rgba(0,0,0,0.9)';
      c.save(); c.translate(x + w.ww / 2, y); const sc = (0.9 + 0.1 * pop) * (on && t < w.t1 ? 1.06 : 1); c.scale(sc, sc);
      c.strokeText(w.w.toUpperCase(), -w.ww / 2, 0); c.fillStyle = on && t < (w.t1 ?? 1e9) + 0.05 ? th.accent : '#ffffff'; c.fillText(w.w.toUpperCase(), -w.ww / 2, 0); c.restore();
      x += w.ww + sp;
    }
  });
  c.restore();
}
