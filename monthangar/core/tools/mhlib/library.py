"""The shared aircraft library: every model is doctored and verified once, then every project uses it in place.
library/<pack>/<id>/  source/ (the original download), model.glb (doctored), subject.json, doctor.json, check/sheet.jpg"""
import json, shutil, subprocess, sys, re
from datetime import date
from pathlib import Path
from .common import library, load, save, sha256, TOOLS, node

OK_LIC = [(r'\bcc0\b|public domain|\bpd\b|no known copyright|nasa|smithsonian open access', 'public domain', False),
          (r'cc[- ]?by[- ]?sa', 'CC BY-SA', True), (r'cc[- ]?by(?![- ]?(nc|nd))', 'CC BY', True),
          (r'free standard|sketchfab standard|^standard$|royalty[- ]free|editorial', None, None), (r'own|mine|made by me|self', 'your own work', False)]

def licence(name):
    """returns {'name','ok','credit','note'}. NC and ND are refused for a monetised channel; Editorial too."""
    n = (name or '').strip(); low = n.lower()
    if not n: return {'name': '', 'ok': False, 'credit': False, 'note': 'no licence given: find it on the model page before using the model'}
    if re.search(r'\bnc\b|non[- ]?commercial', low): return {'name': n, 'ok': False, 'credit': True, 'note': 'NonCommercial: not allowed on a monetised channel'}
    if re.search(r'\bnd\b|no[- ]?deriv', low): return {'name': n, 'ok': False, 'credit': True, 'note': 'NoDerivatives: the doctor changes the model, so do not use it'}
    if 'editorial' in low: return {'name': n, 'ok': False, 'credit': True, 'note': 'Editorial licence: not for monetised video'}
    if re.search(r'free standard|sketchfab standard|^standard$|royalty[- ]free', low): return {'name': n, 'ok': True, 'credit': True, 'note': 'Sketchfab Standard: commercial use allowed; credit the author'}
    for pat, nice, credit in OK_LIC:
        if nice and re.search(pat, low): return {'name': n, 'ok': True, 'credit': bool(credit), 'note': nice + (': credit required' if credit else ': credit optional')}
    return {'name': n, 'ok': False, 'credit': True, 'note': 'unknown licence: check it by hand, then add it again with a recognised name'}

def add(src, id, pack='aviation', name=None, length=None, span=None, height=None, engine=None, engines=None, author=None, source=None, lic=None, rotate=None, extra=None):
    src = Path(src).resolve(); d = library() / pack / id; d.mkdir(parents=True, exist_ok=True)
    if not src.exists(): sys.exit(f'no model at {src}')
    L = licence(lic)
    if not L['ok']: print(f'LICENCE PROBLEM: {L["note"]} ({lic})')
    s = d / 'source'
    if s.exists(): shutil.rmtree(s)
    if src.suffix.lower() == '.gltf': shutil.copytree(src.parent, s)
    else: s.mkdir(); shutil.copy2(src, s / src.name)
    model = s / src.name
    if not (TOOLS / 'mhlib' / 'short.py').exists() and '--no-split' not in (extra or []):
        print('free edition: the model is oriented, scaled and checked; splitting the gear and propellers is in MontHangar Pro (wheels stay down in flight, props stay still)')
        extra = (extra or []) + ['--no-split']
    cmd = [node(), TOOLS / 'doctor.mjs', model, '--out', d, '--id', id] + (['--length', str(length)] if length else []) + (['--rotate', ','.join(map(str, rotate))] if rotate else []) + (extra or [])
    r = subprocess.run([str(c) for c in cmd])
    if r.returncode: sys.exit('doctor failed')
    rep = load(d / 'doctor.json')
    meta = load(d / 'subject.json', {})
    meta.update({'id': id, 'name': name or id, 'kind': 'aircraft', 'length_m': rep['dims']['length_m'], 'span_m': span or rep['dims']['span_m'], 'height_m': height or rep['dims']['height_m'],
                 'measured': rep['dims'], 'engine': engine, 'engines': engines, 'gear': [g['node'] for g in rep['made']['gear']],
                 'spin': [{'node': p['node'], 'axis': 'z'} for p in rep['made']['prop']], 'grade': rep['grade']['grade'], 'grade_note': rep['grade']['note'],
                 'licence': L, 'author': author, 'source': source, 'sha256': rep['sha256'], 'doctored': rep['date'], 'verified': False})
    meta['credit'] = f'3D model: "{name or id}" by {author or "unknown"} ({L["name"]}){", " + source if source else ""}'
    save(d / 'subject.json', meta)
    warn = []
    if span and abs(rep['dims']['span_m'] - span) / span > 0.06: warn.append(f'measured span {rep["dims"]["span_m"]} m vs real {span} m: the model is out of proportion or the heading is wrong')
    if height and abs(rep['dims']['height_m'] - height) / height > 0.12: warn.append(f'measured height {rep["dims"]["height_m"]} m vs real {height} m (props or an antenna can explain a little)')
    if engine in ('piston', 'turboprop') and not meta['spin']: warn.append('a propeller aircraft with no props found: pass --gear-y / check the sheet; props will not spin')
    if not meta['gear']: warn.append('no landing gear found: if the model has wheels they will show in flight')
    print(f'\n{id}: grade {meta["grade"]} ({meta["grade_note"]}); licence: {L["note"]}')
    for w in warn: print('CHECK ' + w)
    print(f'Now LOOK at {d / "check" / "sheet.jpg"}: nose direction in every view, no wheels in the two flight views, props spinning.')
    print(f'If right: mh library verify {id}   If the heading is wrong: add again with --rotate x,y,z')
    return meta

def verify(id, pack='aviation', by='agent', note=''):
    d = library() / pack / id; meta = load(d / 'subject.json')
    if not meta: sys.exit(f'{id} is not in the library')
    if not meta.get('licence', {}).get('ok'): sys.exit(f'cannot verify {id}: {meta.get("licence", {}).get("note")}')
    meta['verified'] = True; meta['verified_on'] = date.today().isoformat(); meta['verified_by'] = by; meta['sha256'] = sha256(d / 'model.glb')
    if note: meta['verify_note'] = note
    save(d / 'subject.json', meta); print(f'{id} verified; every project can now use it as "{id}"')

def listing(pack=None):
    root = library(); rows = []
    for p in sorted(root.glob('*/*/subject.json')):
        m = load(p); rows.append(m)
        print(f'{p.parent.parent.name}/{m["id"]:<16} {"verified" if m.get("verified") else "NOT VERIFIED":<13} grade {m.get("grade", "?")}  {m.get("length_m")} m  {m.get("licence", {}).get("name", "")}  {m.get("name", "")}')
    if not rows: print(f'library is empty ({root})')
    return rows
