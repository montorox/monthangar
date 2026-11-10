"""Script files: script.md (with chapter headings) -> the clean text the user reads, plus a lint.
script.md format:
  # Title of the film            (one line, optional)
  ## Chapter name                (starts a chapter; the name becomes a YouTube chapter)
  Spoken text in paragraphs.
  [a note for the edit]          (square brackets are never read aloud)
  <!-- a comment -->             (ignored)
"""
import re
from pathlib import Path

def parse(text):
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    title, sections, cur = None, [], None
    for line in text.splitlines():
        s = line.strip()
        if not s: continue
        if s.startswith('## '): cur = {'name': s[3:].strip(), 'text': []}; sections.append(cur); continue
        if s.startswith('# '): title = s[2:].strip(); continue
        if s.startswith('#'): continue
        s = re.sub(r'\[[^\]]*\]', '', s).strip()
        if not s: continue
        if cur is None: cur = {'name': 'Intro', 'text': []}; sections.append(cur)
        cur['text'].append(s)
    for x in sections: x['text'] = ' '.join(x['text']).strip()
    return {'title': title, 'sections': [x for x in sections if x['text']]}

def spoken(text): return '\n\n'.join(s['text'] for s in parse(text)['sections'])

STALE = ['delve', 'tapestry', 'testament to', 'in the realm of', "it's worth noting", 'game-changer', 'game changer', 'navigate the', 'unleash', 'embark',
         'a symphony of', 'stands as a', 'in conclusion', 'little did they know', 'buckle up', 'let that sink in', 'here\'s the thing', 'the rest is history',
         'nestled', 'pivotal', 'seamlessly', 'ever-evolving', 'in today\'s world', 'at the end of the day', 'it is important to note', 'fast forward to', 'but here\'s the kicker']

def lint(text, wpm=150, min_minutes=8.0, short=False, test=False):
    p = parse(text); body = ' '.join(s['text'] for s in p['sections']); words = body.split(); n = len(words)
    out = [f'{n} words, about {n / wpm:.1f} min at {wpm} words a minute, {len(p["sections"])} chapters']
    mins = n / wpm
    if short and not (55 <= mins * 60 <= 75): out.append(f'FIX a Short should read in 60 to 70 s; this is about {mins * 60:.0f} s')
    if test: out.append('TEST script: length and chapter rules are off; label everything made from it as a test')
    if not short and not test and mins < min_minutes: out.append(f'FIX a long film should run {min_minutes:.0f}+ minutes; this is about {mins:.1f}')
    if not short and not test and len(p['sections']) < 4: out.append('FIX use at least 4 chapters (## headings) so YouTube shows chapters')
    for s in re.split(r'(?<=[.!?])\s+', body):
        w = len(s.split())
        if w > 34: out.append(f'LONG sentence ({w} words), hard to read aloud: "{s[:80]}..."')
    low = body.lower()
    for ph in STALE:
        if ph in low: out.append(f'STALE phrase "{ph}": say it plainly')
    for m in re.finditer(r'\b\d[\d,.]*\s?(mph|km/h|knots|ft|feet|m|km|miles|hp|lb|kg|kn)\b', body):
        pass
    dashes = body.count('—') + body.count(' - ')
    if dashes > n / 120: out.append(f'{dashes} dashes: speech reads better with full stops')
    return out

def export(script_md, out_txt):
    t = Path(script_md).read_text(encoding='utf-8'); Path(out_txt).write_text(spoken(t) + '\n', encoding='utf-8')
    return out_txt
