#!/usr/bin/env node
/* MontHangar renderer. Serves the engine, the packs, the shared aircraft library and one project over
   local http, drives Chromium on the GPU and writes stills, contact sheets or a film.
     render.mjs --project P --stills 1.5,20,61 --dir OUT          single frames
     render.mjs --project P --contact 4 --dir OUT                 a frame every 4 s plus 5x5 sheets
     render.mjs --project P --out film.mp4 [--from a --to b] [--workers 3] [--audio mix.wav] [--preview]
   --timeline F  render another timeline file (default P/build/timeline.json; the Short stage passes its own)
   --preview     half size, quicker, same pictures (archival included)
   Temp chunks live in the system caches folder (never in the project), survive a crash (rerun the
   same command to resume, --fresh to restart) and are deleted after the join. */
import { createRequire } from 'node:module'; import { createHash } from 'node:crypto';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { studioDir } from './common.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE = path.join(SKILL, 'core', 'engine'), PACKS = path.join(SKILL, 'packs');
const STUDIO = studioDir();
const require = createRequire(path.join(STUDIO, 'package.json'));
const { chromium } = require('playwright');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const P = path.resolve(arg('project', '.'));
const TL = path.resolve(arg('timeline', path.join(P, 'build', 'timeline.json')));
if (!fs.existsSync(TL)) { console.error(`no timeline at ${TL}. Run: mh.py plan --project ${P}`); process.exit(2); }
const timeline = JSON.parse(fs.readFileSync(TL, 'utf8'));
const PREVIEW = !!arg('preview', false);
const [W0, H0] = timeline.size || [1920, 1080];
const W = PREVIEW ? Math.round(W0 / 2 / 2) * 2 : W0, H = PREVIEW ? Math.round(H0 / 2 / 2) * 2 : H0;
const FPS = timeline.fps || 30;
const LIB = timeline.library || path.join(STUDIO, 'library');
const cacheRoot = key => {
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches') : (process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  const d = path.join(base, 'MontHangar', key);
  try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { const f = path.join(P, '.render-tmp', key); fs.mkdirSync(f, { recursive: true }); return f; }
};
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.svg': 'image/svg+xml' };
const packs = timeline.packs || ['aviation'];
const INDEX = `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:Barlow;font-weight:500;src:url(/nm/@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2)}
@font-face{font-family:Barlow;font-weight:700;src:url(/nm/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2)}
@font-face{font-family:Barlow;font-weight:800;src:url(/nm/@fontsource/barlow-condensed/files/barlow-condensed-latin-800-normal.woff2)}
@font-face{font-family:Inter;font-weight:500;src:url(/nm/@fontsource/inter/files/inter-latin-500-normal.woff2)}
@font-face{font-family:Inter;font-weight:700;src:url(/nm/@fontsource/inter/files/inter-latin-700-normal.woff2)}
html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<script type=importmap>{"imports":{"three":"/nm/three/build/three.module.js","three/addons/":"/nm/three/examples/jsm/"}}</script>
<script type=module>
import * as MH from '/engine/mh-main.js';
${packs.map((p, i) => `import * as pack${i} from '/packs/${p}/pack.js';`).join('\n')}
window.MH = MH;
(async () => { try {
  const tl = await (await fetch('/timeline.json')).json();
  ${packs.map((_, i) => `await pack${i}.install(MH);`).join(' ')}
  await MH.boot(tl, { width: ${W}, height: ${H}, preview: ${PREVIEW} });
  window.READY = true;
} catch (e) { window.BOOTERR = String(e && e.stack || e); } })();
</script>`;

function serve(file, r) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(r);
}
const inside = (root, rel) => { const f = path.resolve(root, rel); return f.startsWith(path.resolve(root)) ? f : null; };
const server = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(INDEX); }
  if (u === '/timeline.json') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(timeline)); }
  if (u.startsWith('/engine/')) return serve(inside(ENGINE, u.slice(8)), r);
  if (u.startsWith('/packs/')) return serve(inside(PACKS, u.slice(7)), r);
  if (u.startsWith('/nm/')) return serve(inside(path.join(STUDIO, 'node_modules'), u.slice(4)), r);
  if (u.startsWith('/lib/')) return serve(inside(LIB, u.slice(5)), r);
  if (u.startsWith('/p/')) { /* a Short lives in <project>/short and shares the project's media */
    let f = inside(P, u.slice(3)); if ((!f || !fs.existsSync(f)) && path.basename(P) === 'short') f = inside(path.dirname(P), u.slice(3));
    return serve(f, r); }
  if (u.startsWith('/abs/')) return serve(u.slice(4), r); /* absolute paths listed in the timeline (brand logo, user media) */
  r.writeHead(404); r.end();
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
/* GPU: Metal through ANGLE on macOS, the default GPU path elsewhere. --software forces SwiftShader. */
const gpuArgs = arg('software', false) ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] :
  (process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl']);
let browser;
try { browser = await chromium.launch({ headless: true, args: [...gpuArgs, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] }); }
catch (e) { console.error('MH render FAILED: ' + String(e.message).split('\n').find(l => /denied|error|fail/i.test(l)) ); console.error('The browser could not start. If you are an agent in a sandbox (Codex workspace-write, a managed shell), Chromium needs to run outside it: ask the user to approve running this command without the sandbox. Otherwise run: npx playwright install chromium (in the studio folder).'); server.close(); process.exit(3); }
async function openPage() {
  const page = await browser.newPage({ viewport: { width: Math.min(W, 1920), height: Math.min(H, 1920) } });
  page.on('pageerror', e => console.error('page error:', e.message));
  page.on('console', m => { const t = m.type(); if (t === 'error' || t === 'warning' && /MH/.test(m.text())) console.error('console:', m.text()); else if (t === 'log' && /^MH /.test(m.text())) console.log(m.text()); });
  await page.goto(URL_);
  await page.waitForFunction(() => window.READY || window.BOOTERR, null, { timeout: 300000 });
  const err = await page.evaluate(() => window.BOOTERR); if (err) throw new Error(err);
  return page;
}
const b64 = u => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64');
const stamp = t => `f${t.toFixed(2).padStart(8, '0')}.jpg`;
let code = 0;
try {
  const page = await openPage();
  const info = await page.evaluate(() => MH.info());
  console.log(`MH gpu: ${info.gpu}`);
  console.log(`MH ${info.shots} shots, ${info.end.toFixed(2)} s, ${W}x${H} @ ${FPS}`);
  (info.warnings || []).forEach(w => console.log('CHECK ' + w));
  const dir = arg('dir');
  const stills = arg('stills'), contact = arg('contact');
  if (stills || contact) {
    fs.mkdirSync(dir, { recursive: true });
    const times = stills ? String(stills).split(',').map(Number) : Array.from({ length: Math.floor(info.end / +contact) + 1 }, (_, i) => i * +contact);
    for (const t of times) fs.writeFileSync(path.join(dir, stamp(t)), b64(await page.evaluate(t => MH.frame(t, 0.93), t)));
    if (contact) {
      const list = path.join(dir, 'list.txt');
      fs.writeFileSync(list, times.map(t => `file '${path.join(path.resolve(dir), stamp(t))}'`).join('\n'));
      const vert = H > W;
      spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-r', '1', '-i', list, '-vf', vert ? 'scale=216:-1,tile=8x3' : 'scale=384:-1,tile=5x5', '-fps_mode', 'passthrough', '-q:v', '3', path.join(dir, 'sheet-%02d.jpg')]);
      fs.rmSync(list); console.log(`sheets: ${dir}/sheet-*.jpg, ${contact} s apart, left to right`);
    }
    console.log(`${times.length} frames written to ${dir}`);
  }
  const out = arg('out');
  if (out) {
    const from = +arg('from', 0), to = Math.min(+arg('to', info.end), info.end);
    const n = Math.ceil((to - from) * FPS), WK = +arg('workers', 3), CH = 300;
    const sum = createHash('sha1');
    const feed = d => { if (fs.existsSync(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory() && !['data'].includes(e.name)) feed(f); else if (/\.(js|json)$/.test(e.name)) sum.update(fs.readFileSync(f)); } };
    feed(ENGINE); feed(PACKS); sum.update(JSON.stringify(timeline) + from + to + W + H);
    const base = path.basename(P) + '-' + path.basename(out, '.mp4'), key = base + '-' + sum.digest('hex').slice(0, 10), tmp = cacheRoot(key);
    try { const up = path.dirname(tmp); for (const e of fs.readdirSync(up)) if (e.startsWith(base + '-') && e !== key) fs.rmSync(path.join(up, e), { recursive: true, force: true }); } catch {}
    if (arg('fresh', false)) { fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true }); }
    const count = Math.ceil(n / CH), names = Array.from({ length: count }, (_, i) => path.join(tmp, `c${String(i).padStart(4, '0')}.mp4`));
    const todo = names.map((f, i) => i).filter(i => !fs.existsSync(names[i]));
    console.log(`MH ${n} frames in ${count} chunks, ${count - todo.length} already done, ${WK} workers, temp ${tmp}`);
    const t0 = Date.now(); let done = 0;
    const pages = [page]; for (let i = 1; i < Math.min(WK, todo.length); i++) pages.push(await openPage());
    const encArgs = arg('x264', false) ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16'] : ['-c:v', 'h264_videotoolbox', '-q:v', '72', '-allow_sw', '1'];
    async function chunk(pg, i) {
      const a = i * CH, b = Math.min(n, a + CH), part = names[i] + '.part.mp4';
      const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', ...(process.platform === 'darwin' ? encArgs : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16']), '-pix_fmt', 'yuv420p', '-r', String(FPS), part], { stdio: ['pipe', 'inherit', 'inherit'] });
      const closed = new Promise((ok, no) => ff.on('close', c => c === 0 ? ok() : no(new Error('ffmpeg ' + c))));
      for (let f = a; f < b; f++) {
        const buf = b64(await pg.evaluate(t => MH.frame(t, 0.92), from + f / FPS));
        if (!ff.stdin.write(buf)) await new Promise(ok => ff.stdin.once('drain', ok));
        done++;
        if (done % 150 === 0) { const s = (Date.now() - t0) / 1000; console.log(`MH ${done}/${n - (count - todo.length) * CH} frames, ${(done / s).toFixed(1)} fps, about ${Math.round((n - done) / (done / s) / 60)} min left`); }
      }
      ff.stdin.end(); await closed; fs.renameSync(part, names[i]);
    }
    const queue = todo.slice();
    await Promise.all(pages.map(async pg => { while (queue.length) await chunk(pg, queue.shift()); }));
    const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, names.map(f => `file '${f}'`).join('\n'));
    const audio = arg('audio');
    const joinArgs = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list];
    if (audio) joinArgs.push('-ss', String(from), '-t', String(to - from), '-i', path.resolve(audio), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '256k', '-shortest');
    joinArgs.push('-c:v', 'copy', '-movflags', '+faststart', path.resolve(out));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const j = spawnSync('ffmpeg', joinArgs, { stdio: 'inherit' });
    if (j.status !== 0) throw new Error('join failed');
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`MH wrote ${out} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
  }
} catch (e) { console.error(e.stack || e); code = 1; }
await browser.close(); server.close(); process.exit(code);
