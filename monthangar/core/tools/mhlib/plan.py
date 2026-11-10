"""plan/shots.json (shots placed on spoken phrases) -> build/timeline.json (shots on seconds), with checks.
A shot starts at the first word of its "at" phrase and runs until the next shot starts."""
import hashlib, json, math, re, subprocess
from pathlib import Path
from .common import load, save, library, sha256, pack as get_pack, ffprobe_dur, stamp
from .words import find

THREE_D = {'hangar', 'studio', 'flight', 'compare'}

def subjects_for(cfg, ids, issues):
    out = {}; lib = library(); pk = cfg.get('pack', 'aviation')
    for i in ids:
        d = lib / pk / i; meta = load(d / 'subject.json')
        if meta is None: issues.append(f'ERROR subject "{i}" is not in the library ({d}). Add it: mh library add <model> --id {i} ...'); continue
        if not meta.get('verified'): issues.append(f'ERROR subject "{i}" is in the library but not verified; look at {d}/check/sheet.jpg then run: mh library verify {i}')
        if meta.get('sha256') and (d / 'model.glb').exists() and sha256(d / 'model.glb') != meta['sha256']: issues.append(f'ERROR subject "{i}": model.glb changed since it was verified; run the doctor again')
        lic = (meta.get('licence') or {}).get('ok')
        if lic is False: issues.append(f'ERROR subject "{i}": licence not usable on a monetised channel ({(meta.get("licence") or {}).get("name")})')
        out[i] = {'url': f'/lib/{pk}/{i}/model.glb', 'meta': meta}
    return out

_PLACES = None
def place_known(name):
    global _PLACES
    if _PLACES is None:
        import json as _j
        f = Path(__file__).resolve().parents[2] / 'engine' / 'data' / 'geo.json'
        try: _PLACES = [((c[0] or '').lower(), (c[3] or '').lower(), c[4] or 0, c[3] or '') for c in _j.loads(f.read_text())['cities']]
        except Exception: _PLACES = []
    if not _PLACES: return True
    return bool(place_hits(name))

def place_hits(name):
    """every place a map name could mean, biggest first (the engine picks the first)"""
    nm, _, cc = (x.strip() for x in name.lower().partition(','))
    return sorted([p for p in (_PLACES or []) if p[0] == nm and (not cc or cc in p[1])], key=lambda p: -p[2])

def frames_for(P, shot, fps, size, issues):
    """footage shots: cut the frames the shot needs into build/frames/<hash>/ (shown in previews too)"""
    src = Path(shot['media']); src = src if src.is_absolute() else P / src
    if not src.exists() and P.name == 'short' and not Path(shot['media']).is_absolute(): src = P.parent / shot['media']   # a Short shares the project's media
    if not src.exists(): issues.append(f'ERROR shot {shot["id"]}: footage {shot["media"]} not found'); return None
    start = float(shot.get('from', 0)); speed = float(shot.get('speed', 1)); dur = (shot['t1'] - shot['t0']) * speed + 0.5
    total = ffprobe_dur(src)
    if total and start + dur > total + 0.5: issues.append(f'WARN shot {shot["id"]}: needs {dur:.1f} s of footage from {start:.1f} s but the clip is {total:.1f} s; it will hold its last frame')
    crop = shot.get('crop_px')   # [x, y, w, h] in source pixels, e.g. to cut a burned-in timecode
    h = hashlib.sha1(f'{src}{src.stat().st_mtime}{start}{dur:.2f}{fps}{crop}{size}'.encode()).hexdigest()[:12]
    d = P / 'build' / 'frames' / h; rel = f'build/frames/{h}'
    if not (d / '00001.jpg').exists():
        d.mkdir(parents=True, exist_ok=True)
        vf = (f'crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]},' if crop else '') + f"fps={fps},scale='min({size},iw)':-2"
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(start), '-t', f'{dur:.2f}', '-i', str(src), '-vf', vf, '-q:v', '3', str(d / '%05d.jpg')], check=True)
    n = len(list(d.glob('*.jpg')))
    return {'dir': rel, 'n': n, 'fps': fps}

def resolve(P, cfg, plan, words_data, vertical=False, tail=1.2):
    issues = []; words = words_data['words']; end = words_data.get('duration') or (words[-1]['e'] + tail)
    shots = plan['shots'] if isinstance(plan, dict) else plan
    pk = get_pack(cfg.get('pack', 'aviation')); types = set(pk.get('shot_types', [])) | {'card'}
    cur = 0; out = []
    for n, s in enumerate(shots):
        s = dict(s); s['id'] = s.get('id') or f's{n + 1:03d}'
        if 'start' in s: t0 = float(s['start'])
        elif n == 0: t0 = 0.0
        else:
            k = find(words, s.get('at', ''), cur)
            if k is None:
                k2 = find(words, s.get('at', ''), 0)
                issues.append(f'ERROR shot {s["id"]}: the words "{s.get("at")}" are not in the voice-over' + (' after the shot before it (they come earlier)' if k2 is not None else ''))
                continue
            t0 = words[k]['s'] + float(s.get('lead', -0.08)); cur = k + 1
        s['t0'] = round(max(0, t0), 3); out.append(s)
        if s.get('type') not in types: issues.append(f'ERROR shot {s["id"]}: type "{s.get("type")}" is not one of {sorted(types)}')
    out.sort(key=lambda x: x['t0'])
    for a, b in zip(out, out[1:]): a['t1'] = b['t0']
    if out: out[-1]['t1'] = round(max(out[-1]['t0'] + 2, end + tail), 3); out[-1].setdefault('out', 'fade')
    # overlay times (and board event times) can be phrases too
    for s in out:
        for o in (s.get('add', []) or []) + list(((s.get('board') or {}).get('events')) or []):
            if isinstance(o.get('t'), str):
                k = find(words, o['t'], 0)
                while k is not None and words[k]['s'] < s['t0'] - 0.05: k = find(words, o['t'], k + 1)
                if k is None or words[k]['s'] > s['t1']: issues.append(f'WARN shot {s["id"]}: overlay time "{o["t"]}" is not spoken during the shot'); o['t'] = 0.3
                else: o['t'] = round(words[k]['s'] - s['t0'], 3)
    return out, issues

def check(out, cfg, vertical, issues):
    pk = get_pack(cfg.get('pack', 'aviation')); sec = pk.get('shot_seconds', {}); mx = sec.get('max', {})
    need = set(pk.get('needs_subject', [])); V = pk.get('vertical', {})
    subs = cfg.get('_subjects', {})
    for i, s in enumerate(out):
        d = s['t1'] - s['t0']; t = s.get('type')
        if d < sec.get('min', 1.4) and i < len(out) - 1: issues.append(f'WARN shot {s["id"]} at {stamp(s["t0"])} lasts {d:.1f} s; under {sec.get("min", 1.4)} s reads as a flash')
        lim = mx.get(t, mx.get('default', 9))
        if d > lim: issues.append(f'WARN shot {s["id"]} at {stamp(s["t0"])} lasts {d:.1f} s (limit {lim} s for {t}); split it or add a camera move')
        if t in need and not s.get('subject') and len(subs) != 1: issues.append(f'ERROR shot {s["id"]}: {t} needs "subject"')
        sid = s.get('subject') or (list(subs)[0] if subs else None)
        meta = (subs.get(sid) or {}).get('meta', {}) if sid else {}
        if t == 'flight' and not meta.get('gear') and not meta.get('add_gear') and meta.get('has_wheels', True): issues.append(f'WARN shot {s["id"]}: {sid} has no gear nodes, so wheels will show in flight; run the doctor (it splits the gear)')
        if t == 'flight' and s.get('gear') == 'down': issues.append(f'NOTE shot {s["id"]}: gear shown down in flight on purpose')
        for o in s.get('add', []) or []:
            if o.get('type') in ('arrow', 'arrow3d'): issues.append(f'ERROR shot {s["id"]}: no 3D arrows; use a label')
            if vertical and o.get('type') == 'stat' and not str(o.get('pos', 'upper')).startswith('upper'): issues.append(f'ERROR shot {s["id"]}: in a Short, stats sit in the upper area (pos "upper"); lower ones collide with captions')
        if vertical and t in THREE_D and t != 'compare':
            cam = s.get('cam', {}); az = abs(((cam.get('az', 30 if t != 'flight' else 150) + 180) % 360) - 180); dist = cam.get('dist', 1.1)
            long_ = (meta.get('length_m') or 0) >= V.get('long_subject_m', 12)
            lo, hi = V.get('side_az', [55, 125])
            if long_ and lo <= az <= hi and (s.get('to') or {}).get('az') is None: issues.append(f'ERROR shot {s["id"]}: side view of a long aircraft in a vertical frame crops it; use head-on or a quarter view (az 0-40 or 140-180)')
            if dist < V.get('min_dist', 1.25) and not s.get('closeup'): issues.append(f'WARN shot {s["id"]}: dist {dist} is tight for vertical; use 1.25+ or mark "closeup": true')
    NEED = {'card': ('card', 'style'), 'map': ('map', None), 'board': ('board', 'events')}
    STYLES = {'chapter', 'fact', 'spec', 'list', 'quote', 'doc', 'title'}
    for i, s in enumerate(out):
        t = s.get('type'); d = s['t1'] - s['t0']
        if d < 0.3: issues.append(f'ERROR shot {s["id"]} at {stamp(s["t0"])} lasts {d:.2f} s: its words come right after the shot before (or the word times are broken)')
        if t in NEED:
            k, sub = NEED[t]
            if not isinstance(s.get(k), dict): issues.append(f'ERROR shot {s["id"]}: a {t} shot needs "{k}": {{...}} (see references/shots.md)')
            elif sub and sub not in s[k]: issues.append(f'ERROR shot {s["id"]}: "{k}" needs "{sub}"')
            elif t == 'card' and s[k].get('style') not in STYLES: issues.append(f'ERROR shot {s["id"]}: card style "{s[k].get("style")}" is not one of {sorted(STYLES)}')
        if t == 'archival' and not s.get('media'): issues.append(f'ERROR shot {s["id"]}: archival needs "media"')
        if t == 'map' and isinstance(s.get('map'), dict):   # every named place must exist in the map data, or the engine drops it (and its routes)
            m = s['map']; names = [c for c in m.get('cities') or []] + [x for r in m.get('routes') or [] for x in [r.get('from'), r.get('to'), *(r.get('via') or [])]] + [r.get('at') for r in m.get('rings') or []]
            for n in names:
                if isinstance(n, str) and not place_known(n): issues.append(f'ERROR shot {s["id"]}: map place "{n}" is not in the built-in map data; give it as {{"name": "{n}", "lon": ..., "lat": ...}}')
                elif isinstance(n, str) and ',' not in n:
                    hits = place_hits(n); lands = {h[3].split(' · ')[0] for h in hits}
                    if len(lands) > 1: issues.append(f'WARN shot {s["id"]}: "{n}" could be {len(hits)} places; using {hits[0][3]}. Write "{n}, <state or country>" to be sure')
        if t == 'compare' and len(s.get('subjects') or []) < 2: issues.append(f'ERROR shot {s["id"]}: compare needs "subjects": [a, b]')
    run_t, prev, run = None, None, 0
    for s in out:
        run = run + 1 if s.get('type') == prev else 1; prev = s.get('type')
        if run == 5: issues.append(f'WARN five {prev} shots in a row from {stamp(s["t0"])}; mix in a map, board or archival beat')
    for a, b in zip(out, out[1:]):
        if a.get('type') == b.get('type') in THREE_D and a.get('cam') == b.get('cam') and a.get('subject') == b.get('subject'): issues.append(f'WARN shots {a["id"]} and {b["id"]} use the same camera; change angle or distance')
    total = out[-1]['t1'] if out else 1
    share = {}
    for s in out: share[s.get('type')] = share.get(s.get('type'), 0) + (s['t1'] - s['t0']) / total
    if not vertical and total > 300:
        for t, want in pk.get('rhythm', {}).items():
            got = share.get(t, 0)
            if want >= 0.1 and got < want * 0.35: issues.append(f'NOTE {t} shots fill {got:.0%} of the film (house rhythm about {want:.0%})')
            if got > want * 2.2 and got > 0.2: issues.append(f'NOTE {t} shots fill {got:.0%} of the film (house rhythm about {want:.0%}); the film may feel samey')
    avg = total / max(1, len(out))
    return share, avg

def build(P, cfg, plan_file, words_file, out_file, size=None, vertical=False, captions=None, preview=False):
    plan = load(plan_file); words_data = load(words_file)
    if plan is None: raise SystemExit(f'no plan at {plan_file}')
    if words_data is None: raise SystemExit(f'no words at {words_file}; run: mh words {P}')
    shots, issues = resolve(P, cfg, plan, words_data, vertical)
    ids = sorted({s['subject'] for s in shots if s.get('subject')} | {x for s in shots for x in (s.get('subjects') or [])} | set(cfg.get('subjects', [])))
    subs = subjects_for(cfg, ids, issues); cfg['_subjects'] = subs
    size = size or cfg.get('size', [2560, 1440]); fps = cfg.get('fps', 30)
    for s in shots:
        if s.get('type') == 'archival' and s.get('media') and re.search(r'\.(mp4|mov|mkv|webm|m4v|avi|mpg)$', s['media'], re.I):
            f = frames_for(P, s, fps, max(size), issues)
            if f: s['frames'] = f
        elif s.get('type') == 'archival' and s.get('media') and not re.match(r'^(https?:|data:)', s['media']):
            m = Path(s['media']); cands = [m] if m.is_absolute() else [P / m] + ([P.parent / m] if P.name == 'short' else [])
            if not any(c.exists() for c in cands): issues.append(f'ERROR shot {s["id"]}: photo {s["media"]} not found (it would render black)')
        if s.get('type') == 'archival' and s.get('media') and not s.get('credit'):
            cr = credit_for(P, s['media'])
            if cr: s['credit'] = cr
            else: issues.append(f'WARN shot {s["id"]}: {s["media"]} has no credit in media/credits.json')
    share, avg = check(shots, cfg, vertical, issues)
    tl = {'size': size, 'fps': fps, 'look': cfg.get('look', 'graphite'), 'units': cfg.get('units', get_pack(cfg.get('pack', 'aviation')).get('units', 'imperial')),
          'brand': cfg.get('brand', {}), 'packs': [cfg.get('pack', 'aviation')], 'library': str(library()), 'subjects': subs, 'shots': shots}
    if captions: tl['captions'] = captions; tl['captionY'] = cfg.get('captionY', 0.735)
    save(out_file, tl)
    print(f'{len(shots)} shots, {shots[-1]["t1"] if shots else 0:.1f} s, average {avg:.1f} s a shot -> {out_file}')
    print('time on screen: ' + ', '.join(f'{k} {v:.0%}' for k, v in sorted(share.items(), key=lambda x: -x[1])))
    for m in issues: print(m)
    return tl, issues

def credit_for(P, media):
    cr = load(P / 'media' / 'credits.json', []) or (load(P.parent / 'media' / 'credits.json', []) if P.name == 'short' else [])
    name = Path(media).name
    for c in cr:
        if Path(c.get('file', '')).name == name: return c.get('short') or c.get('author')
    return None
