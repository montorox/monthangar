"""Licence-safe media: Wikimedia Commons (originals fetched slowly, resized here) and the Internet Archive.
Every file is logged in media/credits.json with author, licence and source."""
import html, json, random, re, sys, time, urllib.parse
from pathlib import Path
import requests
from .common import load, save, cache

UA = {'User-Agent': 'MontHangar/1.0 (documentary media fetcher; contact via project page)'}
GAP = cache('net') / 'wikimedia-last'

def _wait(min_s=20, max_s=60):
    """Wikimedia throttles bulk downloads: keep 20-60 s between originals, across commands"""
    if GAP.exists():
        last = float(GAP.read_text() or 0); need = random.uniform(min_s, max_s) - (time.time() - last)
        if need > 0: print(f'waiting {need:.0f} s (Wikimedia rate limit)'); time.sleep(need)
    GAP.write_text(str(time.time()))

def _clean(s): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()

def lic_ok(name):
    low = (name or '').lower()
    if re.search(r'\bnc\b|non-?commercial|\bnd\b|no-?deriv|fair use|all rights reserved', low): return False
    return bool(re.search(r'public domain|\bpd\b|cc0|cc[ -]?by|no restrictions|no known copyright|us gov|usaf|us navy|nasa', low))

def credit(P, entry):
    f = Path(P) / 'media' / 'credits.json'; cr = load(f, [])
    cr = [c for c in cr if c.get('file') != entry['file']] + [entry]; save(f, cr)

def wikimedia(P, title, as_name=None, max_px=2600, kind='photo'):
    if title.startswith('http'): title = urllib.parse.unquote(title.split('/wiki/')[-1])
    if not title.startswith('File:'): title = 'File:' + title
    q = requests.get('https://commons.wikimedia.org/w/api.php', params={'action': 'query', 'titles': title, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata|size|mime', 'format': 'json'}, headers=UA, timeout=30).json()
    page = next(iter(q['query']['pages'].values()))
    if 'imageinfo' not in page: sys.exit(f'not found on Commons: {title}')
    ii = page['imageinfo'][0]; md = ii.get('extmetadata', {}); g = lambda k: _clean(md.get(k, {}).get('value', ''))
    lic = g('LicenseShortName') or g('UsageTerms'); author = g('Artist') or g('Credit')
    if not lic_ok(lic): print(f'REFUSED: licence "{lic}" is not safe for a monetised film'); return None
    ext = Path(urllib.parse.urlparse(ii['url']).path).suffix.lower()
    sub = 'footage' if ii.get('mime', '').startswith('video') else 'photos'
    out = Path(P) / 'media' / sub / ((as_name or re.sub(r'[^A-Za-z0-9_-]+', '_', title[5:].rsplit('.', 1)[0])[:60]) + ext)
    out.parent.mkdir(parents=True, exist_ok=True)
    _wait()
    for attempt in range(4):
        r = requests.get(ii['url'], headers=UA, timeout=180, stream=True)
        if r.status_code == 429: w = 60 * (attempt + 1); print(f'429 from Wikimedia, waiting {w} s'); time.sleep(w); continue
        r.raise_for_status(); out.write_bytes(r.content); break
    else: sys.exit('Wikimedia kept refusing; try again later')
    if sub == 'photos' and ext in ('.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'):
        from PIL import Image
        im = Image.open(out); im.load()
        if max(im.size) > max_px: im.thumbnail((max_px, max_px), Image.LANCZOS)
        if out.suffix.lower() in ('.tif', '.tiff', '.png') and im.mode not in ('RGB', 'L'): im = im.convert('RGB')
        if out.suffix.lower() in ('.tif', '.tiff'): out.unlink(); out = out.with_suffix('.jpg')
        im.convert('RGB').save(out, quality=92) if out.suffix.lower() in ('.jpg', '.jpeg') else im.save(out)
    short = _short_author(author)
    credit(P, {'kind': kind if sub == 'photos' else 'footage', 'title': title, 'author': author, 'short': short, 'license': lic, 'source': 'https://commons.wikimedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_')), 'file': str(out)})
    print(f'{out}  ({lic}, {short})'); return out

def _short_author(a):
    a = re.sub(r'\b(official photographer|photographer|unknown author|unknown)\b', '', a or '', flags=re.I).strip(' ,;:')
    for org in ['U.S. Navy', 'US Navy', 'U.S. Air Force', 'USAF', 'NASA', 'Royal Navy', 'Imperial War Museums', 'San Diego Air and Space Museum', 'Library of Congress', 'National Archives']:
        if org.lower() in (a or '').lower(): return org
    return (a or 'Wikimedia Commons')[:60]

def search_wikimedia(query, limit=20):
    q = requests.get('https://commons.wikimedia.org/w/api.php', params={'action': 'query', 'generator': 'search', 'gsrsearch': query, 'gsrnamespace': 6, 'gsrlimit': limit, 'prop': 'imageinfo', 'iiprop': 'extmetadata|size|mime', 'format': 'json'}, headers=UA, timeout=30).json()
    rows = []
    for p in (q.get('query', {}).get('pages', {}) or {}).values():
        ii = (p.get('imageinfo') or [{}])[0]; md = ii.get('extmetadata', {}); lic = _clean(md.get('LicenseShortName', {}).get('value', ''))
        rows.append((p['title'], lic, ii.get('width'), ii.get('height'), ii.get('mime', ''), lic_ok(lic)))
    for t, lic, w, h, mime, ok in sorted(rows, key=lambda r: (not r[5], -(r[2] or 0))):
        print(f'{"OK " if ok else "NO "} {w}x{h} {mime:<11} {lic:<22} {t}')
    return rows

def archive(P, ident, file=None, as_name=None):
    md = requests.get(f'https://archive.org/metadata/{ident}', headers=UA, timeout=30).json()
    if not md.get('files'): sys.exit(f'no Internet Archive item "{ident}"')
    meta = md.get('metadata', {}); lic = meta.get('licenseurl') or meta.get('rights') or ''
    files = [f for f in md['files'] if f['name'].lower().endswith(('.mp4', '.mpeg4', '.ogv', '.mov'))]
    if file: files = [f for f in md['files'] if f['name'] == file]
    else: files.sort(key=lambda f: (('h.264' not in f.get('format', '').lower() and '512kb' not in f['name']), -int(f.get('size', 0) or 0)))
    if not files: sys.exit('no video file in that item; pass --file with a name from https://archive.org/details/' + ident)
    f = files[0]; out = Path(P) / 'media' / 'footage' / ((as_name or re.sub(r'[^A-Za-z0-9_-]+', '_', ident)[:60]) + Path(f['name']).suffix.lower())
    out.parent.mkdir(parents=True, exist_ok=True)
    url = f'https://archive.org/download/{ident}/{urllib.parse.quote(f["name"])}'
    print(f'downloading {f["name"]} ({int(f.get("size", 0) or 0) / 1e6:.0f} MB)')
    with requests.get(url, headers=UA, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(out, 'wb') as fh:
            for b in r.iter_content(1 << 20): fh.write(b)
    pd = bool(re.search(r'publicdomain|/zero/|cc0', lic, re.I)) or 'prelinger' in (meta.get('collection') and str(meta.get('collection')).lower() or '')
    note = lic or ('Prelinger Archives (public domain)' if pd else 'no licence stated: check the item page before using it')
    if not pd and not re.search(r'creativecommons\.org/licenses/by(/|-sa/)', lic): print(f'CHECK licence: {note}')
    credit(P, {'kind': 'footage', 'title': meta.get('title', ident), 'author': meta.get('creator', '') if isinstance(meta.get('creator', ''), str) else ', '.join(meta.get('creator')), 'short': 'Internet Archive' + (' / ' + str(meta.get('creator'))[:40] if meta.get('creator') else ''),
               'license': note, 'source': f'https://archive.org/details/{ident}', 'file': str(out)})
    print(out); return out

def add_own(P, file, author, lic, source=''):
    credit(P, {'kind': 'photo' if Path(file).suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp') else 'footage', 'title': Path(file).name, 'author': author, 'short': author, 'license': lic, 'source': source, 'file': str(Path(file).resolve())})
    print(f'logged {file}')
