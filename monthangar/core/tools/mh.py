#!/usr/bin/env python3
"""MontHangar command line.  mh <command> ...   (projects live in <studio>/projects/<slug>)

  Setup      mh check                                   is everything installed? renders one frame on the GPU
  Project    mh new <slug> --title "..." [--subject corsair] [--units imperial|metric] [--look graphite]
  Script     mh lint <p>  |  mh vo-script <p>            lint script.md, write "vo-script (read this).txt"
  Voice      mh words <p> [--audio file]                word times from the user's recording, aligned to the script
             mh voicestudio <p> voices|sample|speak --voice "My voice"     (Pro) read the script with VoiceStudio
  Shots      mh build <p>                               plan/shots.json -> build/timeline.json with checks
             mh stills <p> --at 3,40,95 | mh contact <p> [--every 4]   look before rendering
             mh render <p> [--preview] [--from a --to b]
  Finish     mh sound <p>  |  mh finish <p> [--preview]  score, SFX, mix to -14 LUFS, final film in out/
  Short      mh short <p> [--preview]                   (Pro) short/script.md + short/audio/voice.* -> 1080x1920 Short, cover, caption
  Thumbs     mh thumbs <p> [--feature part] [--rival id] (Pro) A hero, B feature, C face-off/flight + phone check
             mh codex-thumb <p> --ref thumbs/A_hero.jpg --prompt "..." [--out thumbs/codex_1.jpg]
             mh thumbcheck <p> --image thumbs/codex_1.jpg [--az 0 --el 5 --dist 0.92]
  Library    mh library add <model> --id ID --name "..." --length M [--span M --height M --engine piston --engines 1
                 --author A --source URL --licence "CC BY 4.0" --rotate x,y,z]
             mh library verify ID [--note "..."]  |  mh library list
             mh doctor <model> --out DIR --id ID --length M     the doctor on its own
  Media      mh media search "query"  |  mh media wikimedia <p> "File:Name.jpg" [--as name]
             mh media archive <p> <identifier> [--file name]  |  mh media add <p> <file> --author A --licence L
  Upload     mh upload <p> [--out DIR]                  (Pro) the folder to publish from
"""
import argparse, json, os, re, shutil, subprocess, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent; sys.path.insert(0, str(HERE))
from mhlib.common import studio, load, save, project, node, run, ffprobe_dur, cache, library, pack as get_pack

PRO = HERE / 'mhlib' / 'short.py'   # the free edition ships without the Pro modules (short, thumbs, upload, voicestudio)

def need_pro(mod):
    if not (HERE / 'mhlib' / f'{mod}.py').exists():
        sys.exit(f'"{mod}" is part of MontHangar Pro (the Short stage, thumbnails with the accuracy check, the gear and propeller splitter, the upload packager and VoiceStudio). See the README.')

def P_(a):
    p = Path(a.project); p = p if p.exists() else studio() / 'projects' / a.project
    return project(p)

def render(P, extra):
    run([node(), HERE / 'render.mjs', '--project', P] + extra)

def cmd_new(a):
    P = studio() / 'projects' / a.slug
    if (P / 'config.json').exists(): sys.exit(f'{P} already exists')
    for d in ('audio', 'plan', 'media', 'research', 'build', 'out', 'thumbs', 'short/audio', 'short/plan'): (P / d).mkdir(parents=True, exist_ok=True)
    pk = get_pack(a.pack)
    cfg = {'title': a.title, 'pack': a.pack, 'look': a.look, 'units': a.units or pk.get('units', 'imperial'), 'subjects': [a.subject] if a.subject else [],
           'size': [2560, 1440], 'fps': 30, 'key': 'D', 'hook': '', 'tags': [], 'sources': [], 'thumb_feature': None, 'brand': {'name': a.brand or ''}}
    save(P / 'config.json', cfg)
    if not (P / 'script.md').exists(): (P / 'script.md').write_text(f'# {a.title}\n\n## Cold open\n\n[Write the script here. ## headings become YouTube chapters. Square brackets are notes, never read.]\n', encoding='utf-8')
    if not (P / 'plan' / 'shots.json').exists(): (P / 'plan' / 'shots.json').write_text('{"shots": []}\n')
    print(f'project -> {P}')

def cmd_lint(a):
    P, cfg = P_(a); from mhlib import script as S
    f = P / 'short' / 'script.md' if a.short else P / 'script.md'
    for l in S.lint(f.read_text(encoding='utf-8'), short=a.short, test=a.test): print(l)

def cmd_vo(a):
    P, cfg = P_(a); from mhlib import script as S
    base = P / 'short' if a.short else P
    out = base / 'vo-script (read this).txt'; S.export(base / 'script.md', out); print(f'-> {out}')

def cmd_words(a):
    P, cfg = P_(a); from mhlib import words as W
    au = Path(a.audio) if a.audio else next(iter(sorted((P / 'audio').glob('voice.*'))), None)
    if not au or not au.exists(): sys.exit(f'put the recording in {P / "audio"}/voice.wav (or pass --audio)')
    W.align(au, P / 'script.md', P / 'audio' / 'words.json')

def cmd_build(a):
    P, cfg = P_(a); from mhlib import plan as Pl
    wd = load(P / 'audio' / 'words.json')
    tl, issues = Pl.build(P, cfg, P / 'plan' / 'shots.json', P / 'audio' / 'words.json', P / 'build' / 'timeline.json')
    if any(m.startswith('ERROR') for m in issues): sys.exit('fix the ERRORs above in plan/shots.json')

def cmd_stills(a):
    P, cfg = P_(a); render(P, ['--stills', a.at, '--dir', P / 'build' / 'stills'])

def cmd_contact(a):
    P, cfg = P_(a); render(P, ['--contact', str(a.every), '--dir', P / 'build' / 'contact'])

def out_name(cfg, P, suffix):
    return P / 'out' / (re.sub(r'[^\w -]', '', cfg.get('title') or P.name).strip().replace(' ', '_') + suffix)

def cmd_render(a):
    P, cfg = P_(a)
    ex = ['--out', a.out or out_name(cfg, P, '_preview.mp4' if a.preview else '_silent.mp4')] + (['--preview'] if a.preview else [])
    if a.frm is not None: ex += ['--from', str(a.frm)]
    if a.to is not None: ex += ['--to', str(a.to)]
    render(P, ex)

def sound(P, cfg):
    from mhlib import sound as Snd
    tl = load(P / 'build' / 'timeline.json'); wd = load(P / 'audio' / 'words.json', {})
    if not tl: sys.exit('no timeline; run mh build first')
    dur = tl['shots'][-1]['t1']; secs = [{'name': s['name'], 's': s['s']} for s in wd.get('sections', [])]
    cards = [s['t0'] for s in tl['shots'] if s.get('type') == 'card']
    mus = Snd.score(dur, secs, key=cfg.get('key', 'D'), moods=cfg.get('moods'), bpm=cfg.get('bpm', 78), seed=cfg.get('seed', 7), cards=cards)
    fx = Snd.sfx(tl, wd.get('words'))
    voice = Path(wd.get('audio') or '')
    if not voice.exists(): voice = next(iter(sorted((P / 'audio').glob('voice.*'))), None)
    if not voice or not voice.exists() or ffprobe_dur(voice) < 1: sys.exit('no voice-over to mix (audio/voice.* missing or empty); record it, then run mh words and mh finish')
    out = P / 'build' / 'mix.wav'; I, TP = Snd.mix(voice, mus, fx, out, music_db=cfg.get('music_db', -17))
    print(f'mix -> {out}: {I:.1f} LUFS, {TP:.1f} dBTP'); return out

def cmd_sound(a):
    P, cfg = P_(a); sound(P, cfg)

def cmd_finish(a):
    P, cfg = P_(a); mixf = sound(P, cfg)
    out = out_name(cfg, P, '_preview.mp4' if a.preview else '_final.mp4')
    render(P, ['--out', out, '--audio', mixf] + (['--preview'] if a.preview else []))
    print(f'film -> {out} ({ffprobe_dur(out) / 60:.1f} min)')

def cmd_short(a):
    need_pro('short'); P, cfg = P_(a); from mhlib import short as Sh; Sh.run(P, cfg, preview=a.preview, redo_words=a.redo_words)

def cmd_thumbs(a):
    need_pro('thumbs'); P, cfg = P_(a); from mhlib import thumbs as T; T.make(P, cfg, feature=a.feature, rival=a.rival, subject=a.subject)

def cmd_codex(a):
    need_pro('thumbs'); P, cfg = P_(a); from mhlib import thumbs as T
    n = len(list((P / 'thumbs').glob('codex_*.jpg'))) + 1
    T.codex(P, P / a.ref if not Path(a.ref).is_absolute() else a.ref, a.prompt, a.out and (P / a.out) or P / 'thumbs' / f'codex_{n}.jpg')

def cmd_thumbcheck(a):
    need_pro('thumbs'); P, cfg = P_(a); from mhlib import thumbs as T
    T.check(P, cfg, P / a.image if not Path(a.image).is_absolute() else a.image, view={'az': a.az, 'el': a.el, 'dist': a.dist}, subject=a.subject)

def cmd_library(a):
    from mhlib import library as L
    if a.op == 'list': return L.listing()
    if a.op == 'verify': return L.verify(a.arg, note=a.note or '')
    if a.op == 'add':
        rot = [float(x) for x in a.rotate.split(',')] if a.rotate else None
        extra = [x for k, v in (('--gear-y', a.gear_y),) if v for x in (k, str(v))] + (['--no-props'] if a.no_props else []) + (['--no-gear'] if a.no_gear else [])
        return L.add(a.arg, a.id, name=a.name, length=a.length, span=a.span, height=a.height, engine=a.engine, engines=a.engines, author=a.author, source=a.source, lic=a.licence, rotate=rot, extra=extra)

def cmd_doctor(a):
    run([node(), HERE / 'doctor.mjs'] + a.rest)

def cmd_media(a):
    from mhlib import media as M
    if a.op == 'search': return [print(f'{r["title"]}  |  {r.get("licence", "")}  |  {r.get("author", "")}') for r in M.search_wikimedia(a.args[0])]
    P, cfg = project(Path(a.args[0]) if Path(a.args[0]).exists() else studio() / 'projects' / a.args[0])
    if a.op == 'wikimedia': return M.wikimedia(P, a.args[1], as_name=a.as_name)
    if a.op == 'archive': return M.archive(P, a.args[1], file=a.file, as_name=a.as_name)
    if a.op == 'add': return M.add_own(P, a.args[1], a.author, a.licence, a.source or '')

def cmd_upload(a):
    need_pro('upload'); P, cfg = P_(a); from mhlib import upload as U; U.run(P, cfg, a.out)

def cmd_voicestudio(a):
    if not (HERE / 'voicestudio.py').exists(): need_pro('voicestudio')
    P, cfg = P_(a); from mhlib import script as S
    S.export(P / 'script.md', P / 'script.txt')
    args = [sys.executable, HERE / 'voicestudio.py', a.op, '--project', P] + (['--voice', a.voice] if a.voice else []) + (['--gallery', a.gallery] if a.gallery else []) + ['--speed', str(a.speed)]
    run(args if a.op != 'voices' else [sys.executable, HERE / 'voicestudio.py', 'voices'])

def cmd_check(a):
    ok = True
    for b in ('node', 'ffmpeg', 'ffprobe'):
        w = shutil.which(b); print(f'{b:<8} {"ok " + w if w else "MISSING"}'); ok &= bool(w)
    st = studio(); print(f'studio   {st} {"ok" if (st / "node_modules" / "three").exists() else "MISSING node packages: run setup.sh"}')
    try:
        import numpy, scipy, PIL, faster_whisper; print('python   ok (numpy, scipy, pillow, faster-whisper)')
    except ImportError as e: print(f'python   MISSING {e.name}: run setup.sh'); ok = False
    print(f'library  {library()} ({len(list(library().glob("*/*/subject.json")))} aircraft)')
    print('edition  ' + ('Pro' if PRO.exists() else 'free'))
    if ok:
        P = cache('selftest'); (P / 'build').mkdir(exist_ok=True)
        save(P / 'build' / 'timeline.json', {'size': [1280, 720], 'fps': 30, 'look': 'graphite', 'packs': ['aviation'], 'subjects': {},
             'shots': [{'id': 'm', 'type': 'map', 't0': 0, 't1': 2, 'view': {'center': [-40, 35], 'zoom': 2.2}, 'title': 'SELF TEST'}]})
        r = subprocess.run([node(), str(HERE / 'render.mjs'), '--project', str(P), '--stills', '1', '--dir', str(P / 'f')])
        print('render   ' + ('ok' if r.returncode == 0 else 'FAILED (see above)')); shutil.rmtree(P, ignore_errors=True); ok &= r.returncode == 0
    if not ok: sys.exit(1)

def main():
    ap = argparse.ArgumentParser(prog='mh', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); sp = ap.add_subparsers(dest='cmd')
    def sub(name, fn, proj=True, **kw):
        p = sp.add_parser(name, **kw); p.set_defaults(fn=fn)
        if proj: p.add_argument('project')
        return p
    sub('check', cmd_check, False)
    p = sub('new', cmd_new, False); p.add_argument('slug'); p.add_argument('--title', required=True); p.add_argument('--subject'); p.add_argument('--pack', default='aviation')
    p.add_argument('--units'); p.add_argument('--look', default='graphite'); p.add_argument('--brand')
    p = sub('lint', cmd_lint); p.add_argument('--short', action='store_true'); p.add_argument('--test', action='store_true'); p = sub('vo-script', cmd_vo); p.add_argument('--short', action='store_true')
    p = sub('words', cmd_words); p.add_argument('--audio')
    sub('build', cmd_build)
    p = sub('stills', cmd_stills); p.add_argument('--at', required=True)
    p = sub('contact', cmd_contact); p.add_argument('--every', type=float, default=4)
    p = sub('render', cmd_render); p.add_argument('--preview', action='store_true'); p.add_argument('--from', dest='frm', type=float); p.add_argument('--to', type=float); p.add_argument('--out')
    sub('sound', cmd_sound)
    p = sub('finish', cmd_finish); p.add_argument('--preview', action='store_true')
    p = sub('short', cmd_short); p.add_argument('--preview', action='store_true'); p.add_argument('--redo-words', action='store_true')
    p = sub('thumbs', cmd_thumbs); p.add_argument('--feature'); p.add_argument('--rival'); p.add_argument('--subject')
    p = sub('codex-thumb', cmd_codex); p.add_argument('--ref', required=True); p.add_argument('--prompt', required=True); p.add_argument('--out')
    p = sub('thumbcheck', cmd_thumbcheck); p.add_argument('--image', required=True); p.add_argument('--az', type=float, default=0); p.add_argument('--el', type=float, default=5); p.add_argument('--dist', type=float, default=0.92); p.add_argument('--subject')
    p = sub('library', cmd_library, False); p.add_argument('op', choices=['add', 'verify', 'list']); p.add_argument('arg', nargs='?')
    for k in ('id', 'name', 'engine', 'author', 'source', 'licence', 'rotate', 'note'): p.add_argument('--' + k)
    for k in ('length', 'span', 'height', 'gear-y'): p.add_argument('--' + k, type=float)
    p.add_argument('--engines', type=int); p.add_argument('--no-props', action='store_true'); p.add_argument('--no-gear', action='store_true')
    p = sub('doctor', cmd_doctor, False); p.add_argument('rest', nargs=argparse.REMAINDER)
    p = sub('media', cmd_media, False); p.add_argument('op', choices=['search', 'wikimedia', 'archive', 'add']); p.add_argument('args', nargs='+')
    for k in ('as', 'file', 'author', 'licence', 'source'): p.add_argument('--' + k, dest=k.replace('as', 'as_name') if k == 'as' else k)
    p = sub('upload', cmd_upload); p.add_argument('--out')
    p = sub('voicestudio', cmd_voicestudio); p.add_argument('op', choices=['voices', 'sample', 'speak']); p.add_argument('--voice'); p.add_argument('--gallery'); p.add_argument('--speed', type=float, default=1.0)
    a = ap.parse_args()
    if not getattr(a, 'fn', None): print(__doc__); return
    a.fn(a)

if __name__ == '__main__': main()
