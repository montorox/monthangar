"""Shared paths and helpers for the MontHangar tools."""
import json, os, re, subprocess, sys, shutil, hashlib
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
SKILL = TOOLS.parent.parent
PACKS = SKILL / 'packs'

def studio():
    env = os.environ.get('MONTHANGAR_HOME')
    if env: return Path(env)
    return Path.home() / 'MontHangarStudio'

def library(): return studio() / 'library'

def cache(key):
    """Temp folder in the system caches (never in a synced project folder)."""
    if sys.platform == 'darwin': base = Path.home() / 'Library' / 'Caches'
    else: base = Path(os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_CACHE_HOME') or Path.home() / '.cache')
    d = base / 'MontHangar' / key; d.mkdir(parents=True, exist_ok=True); return d

def load(p, default=None):
    p = Path(p)
    if not p.exists(): return default
    return json.loads(p.read_text(encoding='utf-8'))

def save(p, data):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding='utf-8')

def project(p):
    p = Path(p).resolve()
    cfg = load(p / 'config.json')
    if cfg is None: sys.exit(f'no config.json in {p}. Make a project with: mh new <slug> --title "..."')
    return p, cfg

def pack(name='aviation'): return load(PACKS / name / 'pack.json', {})

def run(cmd, **kw):
    r = subprocess.run([str(c) for c in cmd], **kw)
    if r.returncode != 0: sys.exit(f'failed: {" ".join(map(str, cmd))}')
    return r

def ffprobe_dur(f):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return 0.0

def sha256(f):
    h = hashlib.sha256()
    with open(f, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

norm = lambda x: re.sub(r"[^a-z0-9']", '', x.lower().replace('’', "'"))

def stamp(s):
    s = int(s); return f'{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}' if s >= 3600 else f'{s // 60}:{s % 60:02d}'

def node(): return shutil.which('node') or 'node'
