"""Word times from the user's recorded voice-over, aligned to the approved script.
Spelling comes from the script, timing from the audio. Every place the reading differs is printed."""
import difflib, json, re, subprocess
from pathlib import Path
from .common import norm, save
from . import script as S

def transcribe(audio, model='small.en'):
    from faster_whisper import WhisperModel
    import numpy as np
    pcm = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', str(audio), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout, np.float32)
    segs, _ = WhisperModel(model, compute_type='int8').transcribe(pcm, word_timestamps=True, vad_filter=False, beam_size=5)
    return [{'w': w.word.strip(), 's': round(w.start, 3), 'e': round(w.end, 3)} for s in segs for w in s.words], len(pcm) / 16000

def align(audio, script_md=None, out=None, model='small.en'):
    heard, dur = transcribe(audio, model)
    if dur < 1.0 or len(heard) < 3:
        raise SystemExit(f'ERROR {audio}: {dur:.1f} s of audio and {len(heard)} words heard. The file is empty or silent; check it plays, then run again.')
    sections = []
    if script_md and Path(script_md).exists():
        p = S.parse(Path(script_md).read_text(encoding='utf-8'))
        toks, sec_of = [], []
        for k, s in enumerate(p['sections']):
            for w in s['text'].split(): toks.append(w); sec_of.append(k)
        A = [norm(w) for w in toks]; B = [norm(w['w']) for w in heard]; words = [None] * len(toks); diffs = []
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, A, B, autojunk=False).get_opcodes():
            if op == 'equal':
                for k in range(i2 - i1): words[i1 + k] = {'w': toks[i1 + k], 's': heard[j1 + k]['s'], 'e': heard[j1 + k]['e']}
            else:
                diffs.append((' '.join(toks[i1:i2]), ' '.join(w['w'] for w in heard[j1:j2])))
                if j2 > j1 and i2 > i1:
                    s0, e0 = heard[j1]['s'], heard[j2 - 1]['e']
                    for k in range(i2 - i1): words[i1 + k] = {'w': toks[i1 + k], 's': round(s0 + (e0 - s0) * k / (i2 - i1), 3), 'e': round(s0 + (e0 - s0) * (k + 1) / (i2 - i1), 3)}
        for i in range(len(words)):
            if words[i] is None:
                prev = words[i - 1]['e'] if i and words[i - 1] else 0
                words[i] = {'w': toks[i], 's': prev, 'e': prev, 'missing': True}
        for d in diffs: print(f'DIFF script: "{d[0]}"  heard: "{d[1]}"')
        miss = sum(1 for w in words if w.get('missing'))
        if miss > 0.25 * len(words): raise SystemExit(f'ERROR {miss} of {len(words)} script words were not heard: this recording does not match script.md (wrong file, or the script changed after recording)')
        print(f'{len(toks)} script words, {len(diffs)} places where the reading differs')
        for k, s in enumerate(p['sections']):
            i0 = sec_of.index(k); sections.append({'name': s['name'], 'i': i0, 's': words[i0]['s']})
        title = p['title']
    else:
        words = heard; title = None
    data = {'title': title, 'audio': str(audio), 'duration': round(dur, 3), 'words': words, 'sections': sections}
    if out: save(out, data); print(f'{len(words)} words, voice ends {words[-1]["e"]:.2f} s of {dur:.2f} s -> {out}')
    return data

def find(words, phrase, start=0):
    """index of the first word of phrase at or after start, or None"""
    q = [norm(x) for x in str(phrase).split() if norm(x)]
    W = [norm(x['w']) for x in words]
    for i in range(start, len(W) - len(q) + 1):
        if W[i:i + len(q)] == q: return i
    return None

def srt(words, out, max_chars=42, max_dur=5.5):
    """captions in two-line cues that break at punctuation"""
    cues, cur = [], []
    def flush():
        if cur: cues.append((cur[0]['s'], cur[-1]['e'], ' '.join(w['w'] for w in cur)))
    for w in words:
        if w.get('missing'): continue
        txt = ' '.join(x['w'] for x in cur + [w])
        if cur and (len(txt) > max_chars * 2 or w['e'] - cur[0]['s'] > max_dur): flush(); cur = []
        cur.append(w)
        if re.search(r'[.!?]$', w['w']) and len(' '.join(x['w'] for x in cur)) > 20: flush(); cur = []
    flush()
    def ts(t): h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60; return f'{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}'
    def two(t):
        if len(t) <= max_chars: return t
        ws = t.split(); best = min(range(1, len(ws)), key=lambda k: abs(len(' '.join(ws[:k])) - len(t) / 2)); return ' '.join(ws[:best]) + '\n' + ' '.join(ws[best:])
    lines = []
    for i, (a, b, t) in enumerate(cues, 1): lines += [str(i), f'{ts(a)} --> {ts(max(b, a + 0.8))}', two(t), '']
    Path(out).write_text('\n'.join(lines), encoding='utf-8'); return len(cues)
