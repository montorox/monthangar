#!/usr/bin/env node
/* Model doctor. Orients, scales, grounds and splits a model, grades it, then renders a check sheet.
     doctor.mjs <model.glb|scene.gltf> --out DIR --id ID --length METRES [--rotate x,y,z] [--no-split] [--gear-y M] [--no-props] [--no-gear]
   Writes DIR/model.glb (clean, nose +Z, wheels on y=0, gear_N and prop_N nodes), DIR/doctor.json and DIR/check/sheet.jpg:
   front, side, top, three-quarter on its wheels, and the flight pose with the gear hidden and the props spinning.
   Look at the sheet: the nose must point the way the labels say, and no wheel may show in the flight views. */
import { createRequire } from 'node:module'; import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { createHash } from 'node:crypto';
import { studioDir } from './common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), SKILL = path.resolve(HERE, '..', '..');
const STUDIO = studioDir(); const require = createRequire(path.join(STUDIO, 'package.json')); const { chromium } = require('playwright');
const argv = process.argv.slice(2); const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const src = path.resolve(argv[0] || ''); if (!fs.existsSync(src)) { console.error('usage: doctor.mjs <model> --out DIR --id ID --length M'); process.exit(2); }
const OUT = path.resolve(arg('out', '.')); const ID = arg('id', 'aircraft'); fs.mkdirSync(OUT, { recursive: true });
const opt = { id: ID, length_m: arg('length') ? +arg('length') : null, rotate: arg('rotate') ? String(arg('rotate')).split(',').map(Number) : null,
  split: !arg('no-split', false), props: !arg('no-props', false), gear: !arg('no-gear', false), gearY: arg('gear-y') ? +arg('gear-y') : undefined, debug: !!arg('debug', false) };
const T = { '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]); let f = null;
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(`<!doctype html><script type=importmap>{"imports":{"three":"/nm/three/build/three.module.js","three/addons/":"/nm/three/examples/jsm/"}}</script><script type=module>import * as D from '/engine/mh-doctor.js'; window.D = D; window.READY = true;</script>`); }
  if (u.startsWith('/engine/')) f = path.join(SKILL, 'core', 'engine', u.slice(8));
  else if (u.startsWith('/nm/')) f = path.join(STUDIO, 'node_modules', u.slice(4));
  else if (u.startsWith('/src/')) f = path.join(path.dirname(src), u.slice(5));
  if (!f || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': T[path.extname(f).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
let browser;
try { browser = await chromium.launch({ args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [] }); }
catch (e) { console.error('MH doctor FAILED: ' + String(e.message).split('\n').find(l => /denied|error|fail/i.test(l))); console.error('The browser could not start. If you are an agent in a sandbox (Codex workspace-write, a managed shell), Chromium needs to run outside it: ask the user to approve running this command without the sandbox. Otherwise run: npx playwright install chromium (in the studio folder).'); srv.close(); process.exit(3); }
let code = 0;
try {
  const page = await browser.newPage(); page.on('console', m => { if (/MH doctor/.test(m.text())) console.log(m.text()); else if (m.type() === 'error') console.error(m.text()); });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${srv.address().port}/`); await page.waitForFunction(() => window.READY, null, { timeout: 60000 });
  const res = await page.evaluate(([u, o]) => window.D.run(u, o), ['/src/' + encodeURIComponent(path.basename(src)), opt]);
  const glb = Buffer.from(res.glb, 'base64'); fs.writeFileSync(path.join(OUT, 'model.glb'), glb);
  delete res.glb; res.source = src; res.sha256 = createHash('sha256').update(glb).digest('hex'); res.date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, 'doctor.json'), JSON.stringify(res, null, 1));
  console.log(`MH doctor: wrote ${path.join(OUT, 'model.glb')} (${(glb.length / 1e6).toFixed(1)} MB)`);
} catch (e) { console.error(e.stack || e); code = 1; }
await browser.close(); srv.close();
if (code) process.exit(code);

/* check sheet: rendered by the real engine, so what passes here is what the film will show */
const rep = JSON.parse(fs.readFileSync(path.join(OUT, 'doctor.json'), 'utf8'));
const meta = { name: ID, length_m: rep.dims.length_m, gear: rep.made.gear.map(g => g.node), spin: rep.made.prop.map(p => ({ node: p.node, axis: 'z' })) };
const proj = path.join(OUT, 'check'); fs.mkdirSync(path.join(proj, 'build'), { recursive: true });
const note = (t, sub) => [{ type: 'note', text: t + (sub ? '\n' + sub : ''), x: 0.04, y: 0.06, size: 46, t: 0 }];
const views = [
  { type: 'studio', cam: { az: 0, el: 3, dist: 1.0 }, add: note('FRONT', 'nose toward you') },
  { type: 'studio', cam: { az: -90, el: 2, dist: 1.0 }, add: note('RIGHT SIDE', 'nose to the right') },
  { type: 'studio', cam: { az: 180.01, el: 88, dist: 2.0, target: 'center' }, add: note('TOP', 'nose up the screen') },
  { type: 'hangar', cam: { az: 35, el: 12, dist: 1.05 }, add: note('ON ITS WHEELS', `gear sets: ${meta.gear.length}`) },
  { type: 'flight', sky: 'day', below: 'ocean', cam: { az: 150, el: -12, dist: 1.2 }, add: note('FLIGHT FROM BELOW', 'no wheels may show') },
  { type: 'flight', sky: 'day', below: 'ocean', cam: { az: 35, el: 6, dist: 1.1 }, add: note('FLIGHT FRONT QUARTER', `props: ${meta.spin.length}`) }
].map((v, i) => ({ ...v, id: 'v' + (i + 1), subject: ID, t0: i * 2, t1: i * 2 + 2, in: 'cut', move: 'still', reflect: v.type !== 'flight' }));
const tl = { size: [1280, 720], fps: 30, look: 'graphite', units: 'imperial', packs: ['aviation'], library: OUT, subjects: { [ID]: { url: '/lib/model.glb', meta } }, shots: views };
fs.writeFileSync(path.join(proj, 'build', 'timeline.json'), JSON.stringify(tl, null, 1));
const r = spawnSync('node', [path.join(HERE, 'render.mjs'), '--project', proj, '--stills', views.map(v => v.t0 + 1).join(','), '--dir', path.join(proj, 'frames')], { stdio: 'inherit' });
if (r.status === 0) {
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-pattern_type', 'glob', '-i', path.join(proj, 'frames', 'f*.jpg'), '-vf', 'scale=640:-1,tile=3x2:padding=6:color=black', '-frames:v', '1', path.join(proj, 'sheet.jpg')]);
  fs.rmSync(path.join(proj, 'frames'), { recursive: true, force: true });
  console.log(`MH doctor: check sheet ${path.join(proj, 'sheet.jpg')}`);
}
console.log(JSON.stringify({ heading: rep.heading, dims: rep.dims, gear: rep.made.gear.length, props: rep.made.prop.length, grade: rep.grade.grade }, null, 0));
