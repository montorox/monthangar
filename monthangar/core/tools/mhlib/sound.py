"""Sound: an original score written for each film, synthesised sound effects, the mix and the master.
Everything is generated here from the timeline and the voice, so there is nothing to license.
  score  - chords per chapter, chosen by mood; pads, bass, a sparse piano motif, pulses in tense parts, risers and a hit at chapter cards
  sfx    - engine beds under flight shots (piston, turboprop, jet; doppler on fly-bys), soft whooshes on big scene changes only
           (about one every 15 s at most), ticks under counting stats, pings on map cities, clips on board prints, a quiet hangar room tone
  mix    - music ducks under the voice, effects duck less; master to -14 LUFS integrated, -1.5 dBTP"""
import json, math, re, subprocess
from pathlib import Path
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from .common import load, save

SR = 48000
NOTE = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
hz = lambda midi: 440.0 * 2 ** ((midi - 69) / 12)
# moods: scale degrees of each chord (semitones from the key root) and texture
MOODS = {
    'mystery': {'minor': True, 'prog': [[0, 3, 7, 10], [8, 12, 15, 19], [3, 7, 10, 14], [10, 14, 17, 21]], 'bars': 2, 'pulse': 0, 'piano': 0.5, 'bright': 0.7},
    'drive': {'minor': True, 'prog': [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]], 'bars': 1, 'pulse': 1.0, 'piano': 0.8, 'bright': 1.0},
    'wonder': {'minor': False, 'prog': [[0, 4, 7, 11], [7, 11, 14, 17], [9, 12, 16, 19], [5, 9, 12, 16]], 'bars': 2, 'pulse': 0.3, 'piano': 1.0, 'bright': 1.2},
    'tension': {'minor': True, 'prog': [[0, 3, 7], [8, 12, 15], [5, 8, 12], [7, 11, 14]], 'bars': 1, 'pulse': 1.0, 'piano': 0.4, 'bright': 0.8},
    'resolve': {'minor': False, 'prog': [[5, 9, 12, 16], [7, 11, 14, 17], [0, 4, 7, 12], [0, 4, 7, 11]], 'bars': 2, 'pulse': 0.4, 'piano': 1.0, 'bright': 1.3},
    'reflect': {'minor': False, 'prog': [[0, 4, 7, 14], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], 'bars': 2, 'pulse': 0, 'piano': 0.7, 'bright': 0.9}
}
DEFAULT_ARC = ['mystery', 'drive', 'wonder', 'tension', 'drive', 'resolve', 'reflect']

def _saw_table(n=2048, harm=24):
    x = np.arange(n) / n; t = np.zeros(n)
    for k in range(1, harm + 1): t += np.sin(2 * np.pi * k * x) / k * (1 - k / (harm + 1))
    return (t / np.abs(t).max()).astype(np.float32)
SAW = _saw_table()
def osc(freq, n, table=SAW, phase=0.0):
    ph = (phase + np.cumsum(np.full(n, freq / SR, np.float64))) % 1.0
    return table[(ph * len(table)).astype(np.int32)]
def lp(x, fc, order=2): return sosfilt(butter(order, min(fc, SR * 0.45) / (SR / 2), 'low', output='sos'), x)
def hp(x, fc, order=2): return sosfilt(butter(order, fc / (SR / 2), 'high', output='sos'), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], 'band', output='sos'), x)
def env_adsr(n, a, r):
    e = np.ones(n, np.float32); ai = min(n, int(a * SR)); ri = min(n - ai, int(r * SR))
    if ai: e[:ai] = np.linspace(0, 1, ai) ** 1.5
    if ri: e[n - ri:] *= np.linspace(1, 0, ri) ** 1.2
    return e
def add(buf, x, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= buf.shape[1] or i + len(x) <= 0: return
    j0 = max(0, -i); x = x[j0:]; i = max(0, i); n = min(len(x), buf.shape[1] - i)
    l, r = math.cos((pan + 1) * math.pi / 4), math.sin((pan + 1) * math.pi / 4)
    buf[0, i:i + n] += x[:n] * gain * l * 1.414; buf[1, i:i + n] += x[:n] * gain * r * 1.414
def reverb_ir(sec=2.6, seed=3):
    rng = np.random.default_rng(seed); n = int(sec * SR); t = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n) * np.exp(-t * 6.9 / sec), rng.standard_normal(n) * np.exp(-t * 6.9 / sec)]).astype(np.float32)
    ir[:, :int(0.012 * SR)] = 0; return ir / np.abs(ir).sum(axis=1, keepdims=True) * 6

def score(dur, sections, key='D', moods=None, bpm=78, seed=7, cards=()):
    """sections: [{'name', 's'}]; moods: {section name or index: mood}; cards: chapter-card times for hits"""
    rng = np.random.default_rng(seed); n = int((dur + 4) * SR); out = np.zeros((2, n), np.float32)
    root = 50 + NOTE.get(key.replace('m', ''), 2)   # D3
    if not sections: sections = [{'name': 'all', 's': 0}]
    beat = 60 / bpm; bar = beat * 4
    bounds = [s['s'] for s in sections] + [dur + 3]
    pad = np.zeros((2, n), np.float32); keys = np.zeros((2, n), np.float32); low = np.zeros((2, n), np.float32); perc = np.zeros((2, n), np.float32)
    for k, s in enumerate(sections):
        m = (moods or {}).get(s['name']) or (moods or {}).get(str(k)) or DEFAULT_ARC[min(k, len(DEFAULT_ARC) - 1) if k < len(sections) - 1 else -1]
        M = MOODS.get(m, MOODS['mystery']); t0, t1 = bounds[k], bounds[k + 1]
        shift = 0 if M['minor'] else 3   # major moods use the relative major
        t = t0; ci = 0
        while t < t1:
            chord = M['prog'][ci % len(M['prog'])]; L = min(M['bars'] * bar, t1 - t + 1.5); seg = int((L + 2.5) * SR)
            e = env_adsr(seg, 1.2, 2.4)
            for v, deg in enumerate(chord):
                f = hz(root + shift + deg + (12 if v > 1 else 0)); x = np.zeros(seg, np.float32)
                for det in (-0.07, 0.0, 0.06): x += osc(f * 2 ** (det / 12), seg, phase=rng.random())
                x = lp(x, 900 * M['bright'] + 300 * math.sin(ci), 2).astype(np.float32) * e
                add(pad, x, t, 0.035, pan=(v - 1.5) * 0.35)
            b = np.sin(2 * np.pi * np.cumsum(np.full(seg, hz(root + shift + chord[0] - 12) / SR))).astype(np.float32)
            b += 0.25 * np.sin(4 * np.pi * np.cumsum(np.full(seg, hz(root + shift + chord[0] - 12) / SR))).astype(np.float32)
            add(low, b * env_adsr(seg, 0.4, 2.0), t, 0.09)
            # piano motif: arpeggio notes on beats, sparse in calm moods
            step = beat * (1 if M['pulse'] > 0.7 else 2)
            tt = t
            while tt < t + L - 0.1:
                if rng.random() < M['piano'] * 0.75:
                    deg = chord[int(rng.integers(len(chord)))] + 12 * int(rng.integers(1, 3)); f = hz(root + shift + deg)
                    nn = int(2.8 * SR); tau = np.arange(nn) / SR; x = np.zeros(nn, np.float32)
                    for h, a in ((1, 1), (2, 0.42), (3, 0.18), (4, 0.09), (5, 0.05)): x += (a * np.sin(2 * np.pi * f * h * tau) * np.exp(-tau * (1.6 + h * 0.9))).astype(np.float32)
                    x[:200] *= np.linspace(0, 1, 200)
                    add(keys, x, tt + rng.normal(0, 0.008), 0.05 * (0.7 + 0.3 * rng.random()), pan=rng.uniform(-0.4, 0.4))
                tt += step
            if M['pulse'] > 0:
                tt = t
                while tt < t + L - 0.05:
                    nn = int(0.09 * SR); x = (rng.standard_normal(nn) * np.exp(-np.arange(nn) / SR * 60)).astype(np.float32)
                    add(perc, hp(x, 5000).astype(np.float32), tt, 0.018 * M['pulse'], pan=0.3)
                    if int(round((tt - t) / beat)) % 4 == 0:
                        nk = int(0.35 * SR); tk = np.arange(nk) / SR; kick = np.sin(2 * np.pi * (48 + 40 * np.exp(-tk * 25)) * tk) * np.exp(-tk * 9)
                        add(perc, kick.astype(np.float32), tt, 0.10 * M['pulse'])
                    tt += beat / 2
            t += M['bars'] * bar; ci += 1
        # riser into each new chapter, a soft hit on it
        if k > 0:
            nr = int(2.2 * SR); tr = np.arange(nr) / SR; noise = rng.standard_normal(nr).astype(np.float32)
            riser = np.zeros(nr, np.float32)
            for j in range(8):
                a, b2 = j * nr // 8, (j + 1) * nr // 8; fc = 400 * 2 ** (j * 0.5)
                riser[a:b2] = bp(noise, fc, fc * 2.2)[a:b2]
            riser *= (tr / tr[-1]) ** 2.5
            add(perc, riser, t0 - 2.2, 0.06)
    for c in cards:
        nb = int(2.5 * SR); tb = np.arange(nb) / SR; boom = (np.sin(2 * np.pi * (55 * np.exp(-tb * 1.5) + 30) * tb) * np.exp(-tb * 2.2)).astype(np.float32)
        add(perc, boom, c, 0.22)
    mus = pad + keys + low + perc
    wet = np.stack([fftconvolve(mus[0], (ir := reverb_ir())[0])[:n], fftconvolve(mus[1], ir[1])[:n]]).astype(np.float32)
    out = mus * 0.75 + wet * 0.55
    fade = int(3 * SR); out[:, -fade:] *= np.linspace(1, 0, fade); out[:, :int(0.5 * SR)] *= np.linspace(0, 1, int(0.5 * SR))
    return out[:, :int(dur * SR)]

# ---------- effects ----------
def engine_sound(kind, sec, rng, flyby=False, size=1.0):
    n = int(sec * SR); t = np.arange(n) / SR; noise = rng.standard_normal(n).astype(np.float32)
    if kind in ('piston', 'radial'):
        f0 = 38 + rng.uniform(-3, 3); jitter = 1 + 0.01 * np.sin(2 * np.pi * 0.7 * t)
        ph = np.cumsum(f0 * jitter / SR) * 2 * np.pi
        x = sum((0.6 / h) * np.sin(h * ph + rng.random() * 6) for h in range(1, 9)).astype(np.float32)
        x = x * (0.7 + 0.3 * np.sign(np.sin(ph * 0.5))) + lp(noise, 600) * 0.6
        x = lp(x, 1800)
    elif kind == 'turboprop':
        f0 = 62; ph = np.cumsum(np.full(n, f0 / SR)) * 2 * np.pi
        x = sum((0.5 / h) * np.sin(h * ph) for h in range(1, 6)).astype(np.float32) + lp(noise, 1200) * 0.5 + 0.05 * np.sin(2 * np.pi * 3200 * t)
    elif kind == 'rotor':
        ph = np.cumsum(np.full(n, 5.5 / SR)) * 2 * np.pi; x = lp(noise, 500) * (0.4 + 0.6 * np.clip(np.sin(ph), 0, 1) ** 4)
    else:  # jet
        x = lp(noise, 700) * 1.0 + bp(noise, 1500, 4000) * 0.25 + 0.03 * np.sin(2 * np.pi * (2800 + 40 * np.sin(2 * np.pi * 0.3 * t)) * t)
    x = x.astype(np.float32) / (np.abs(x).max() + 1e-6)
    if flyby:   # doppler: pitch falls through the pass, level peaks in the middle
        u = t / sec - 0.5; speed = np.cumsum(1.0 + 0.12 * -np.tanh(u * 6)) / SR
        idx = np.clip((speed / speed[-1] * (n - 1)).astype(np.int64), 0, n - 1); x = x[idx] * (0.25 + 0.75 * np.exp(-(u * 4) ** 2))
    return x * env_adsr(n, 0.5, 0.8)

def whoosh(rng, sec=1.1):
    n = int(sec * SR); t = np.arange(n) / SR; noise = rng.standard_normal(n).astype(np.float32); out = np.zeros(n, np.float32)
    for j in range(10):
        a, b = j * n // 10, (j + 1) * n // 10; fc = 300 * 2 ** (math.sin(j / 9 * math.pi) * 3)
        out[a:b] = bp(noise, fc, fc * 2.5)[a:b]
    return out * np.sin(np.pi * t / sec) ** 2

def sfx(tl, words=None, seed=11, whoosh_gap=14.0):
    rng = np.random.default_rng(seed); dur = tl['shots'][-1]['t1'] if tl['shots'] else 1; n = int((dur + 2) * SR); out = np.zeros((2, n), np.float32)
    subs = tl.get('subjects', {}); last_whoosh = -99; cat = lambda t: 'model' if t in ('hangar', 'studio', 'compare') else t
    prev = None; tick = None
    for s in tl['shots']:
        t0, t1, typ = s['t0'], s['t1'], s.get('type')
        meta = (subs.get(s.get('subject')) or (next(iter(subs.values())) if subs else {}) or {}).get('meta', {}) if subs else {}
        if typ == 'flight' and s.get('engine_sound', True):
            kind = s.get('engine') or meta.get('engine') or 'piston'
            x = engine_sound(kind, t1 - t0 + 0.6, rng, flyby=s.get('mode') == 'flyby')
            add(out, x, t0 - 0.2, 0.16 if s.get('mode') != 'flyby' else 0.24, pan=0.0)
        if typ in ('hangar', 'compare'):
            nn = int((t1 - t0 + 0.4) * SR); room = lp(rng.standard_normal(nn).astype(np.float32), 180) * env_adsr(nn, 0.3, 0.4)
            add(out, room.astype(np.float32), t0, 0.05)
        if prev is not None and cat(typ) != cat(prev.get('type')) and t0 - last_whoosh >= whoosh_gap and s.get('sfx') is not False or s.get('sfx') == 'whoosh':
            add(out, whoosh(rng), t0 - 0.55, 0.11, pan=rng.uniform(-0.5, 0.5)); last_whoosh = t0
        if typ == 'card' and (s.get('card') or {}).get('style') == 'chapter': pass  # the score places the hit
        for o in s.get('add', []) or []:
            ot = t0 + float(o.get('t', 0.25) or 0)
            if o.get('type') == 'stat' and isinstance(o.get('value'), (int, float)):
                cd = o.get('countDur', 1.1); k = 0; tt = 0.0
                while tt < cd:
                    nn = int(0.012 * SR); clk = hp(rng.standard_normal(nn).astype(np.float32), 3500) * np.exp(-np.arange(nn) / SR * 400)
                    add(out, clk.astype(np.float32), ot + tt, 0.05); k += 1; tt += 0.035 + 0.11 * (tt / cd) ** 2
            if o.get('type') in ('label', 'dim'):
                nn = int(0.08 * SR); tau = np.arange(nn) / SR; blip = np.sin(2 * np.pi * 1900 * tau) * np.exp(-tau * 60)
                add(out, blip.astype(np.float32), ot, 0.025, pan=0.2)
        if typ == 'map':
            for i, c in enumerate((s.get('map') or {}).get('cities', [])):
                nn = int(0.5 * SR); tau = np.arange(nn) / SR; ping = (np.sin(2 * np.pi * 1320 * tau) + 0.4 * np.sin(2 * np.pi * 1980 * tau)) * np.exp(-tau * 9)
                add(out, ping.astype(np.float32), t0 + 0.2 + i * 0.25, 0.03, pan=rng.uniform(-0.4, 0.4))
        if typ == 'board':
            evs = (s.get('board') or {}).get('events', []); d = t1 - t0
            for i, e in enumerate(evs):
                at = e.get('t', 0.25 + i * max(0.6, (d - 1.2) / max(1, len(evs)))) if not isinstance(e.get('t'), str) else 0.25
                nn = int(0.06 * SR); clip = bp(rng.standard_normal(nn).astype(np.float32), 1500, 6000) * np.exp(-np.arange(nn) / SR * 90)
                add(out, clip.astype(np.float32), t0 + float(at), 0.06)
        prev = s
    return out[:, :int(dur * SR)]

# ---------- mix and master ----------
def read_audio(f, sr=SR):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(f), '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).T.copy()
def write_wav(f, x, sr=SR):
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', '2', '-i', '-', '-c:a', 'pcm_s24le', str(f)], input=np.ascontiguousarray(x.T).astype(np.float32).tobytes())
    if p.returncode: raise SystemExit('could not write ' + str(f))
def envelope(v, win=0.05, att=0.08, rel=0.45):
    m = np.abs(v).mean(axis=0); w = int(win * SR); k = np.convolve(m, np.ones(w) / w, mode='same')
    thr = np.percentile(k[k > 1e-5], 30) if np.any(k > 1e-5) else 1e-3; g = (k > thr * 1.2).astype(np.float32)
    out = np.zeros_like(g); a = math.exp(-1 / (att * SR / 64)); r = math.exp(-1 / (rel * SR / 64)); cur = 0.0
    for i in range(0, len(g), 64):
        tgt = g[i]; cur = (a if tgt > cur else r) * cur + (1 - (a if tgt > cur else r)) * tgt; out[i:i + 64] = cur
    return out
def master(inp, out, lufs=-14.0, tp=-1.5, _depth=0):
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(inp), '-af', f'loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1])
    af = f"loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(inp), '-af', af + ',aresample=48000', '-c:a', 'pcm_s24le', str(out)], check=True)
    r2 = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(out), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
    m2 = json.loads(r2.stderr[r2.stderr.rindex('{'):r2.stderr.rindex('}') + 1]); I, TP = float(m2['input_i']), float(m2['input_tp'])
    if TP > tp and _depth < 2:   # loudnorm can overshoot the ceiling by a tenth; master again with a little more headroom
        tmp = Path(out).with_suffix(f'.tp{_depth}.wav'); Path(out).rename(tmp)
        try: I, TP = master(tmp, out, lufs, tp - (TP - tp) - 0.2, _depth + 1)
        finally: tmp.unlink(missing_ok=True)
    if TP > tp and _depth == 0:  # still over after the re-passes (short, punchy mixes): pull the whole file down by the overshoot
        tmp = Path(out).with_suffix('.trim.wav'); Path(out).rename(tmp)
        try:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(tmp), '-af', f'volume={tp - TP - 0.1:.2f}dB', '-c:a', 'pcm_s24le', str(out)], check=True)
        finally: tmp.unlink(missing_ok=True)
        r3 = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(out), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
        m3 = json.loads(r3.stderr[r3.stderr.rindex('{'):r3.stderr.rindex('}') + 1]); I, TP = float(m3['input_i']), float(m3['input_tp'])
    return I, TP

def mix(voice_file, music, fx, out, music_db=-17.0, gap_db=-8.0, fx_db=-3.0, lufs=-14.0):
    v = read_audio(voice_file); n = max(v.shape[1], music.shape[1], fx.shape[1])
    pad = lambda x: np.pad(x, ((0, 0), (0, n - x.shape[1])))
    v, music, fx = pad(v), pad(music), pad(fx)
    v = hp(v, 70).astype(np.float32)
    peak = np.percentile(np.abs(v), 99.9) + 1e-6; v = v / peak * 0.5
    e = envelope(v)[:n]; db = lambda d: 10 ** (d / 20)
    mg = (db(gap_db) + (db(music_db) - db(gap_db)) * e).astype(np.float32)
    fg = (db(fx_db) * (1 - 0.45 * e)).astype(np.float32)
    mpk = np.percentile(np.abs(music), 99.9) + 1e-6; fpk = np.percentile(np.abs(fx), 99.9) + 1e-6
    x = v + music / mpk * 0.5 * mg + fx / fpk * 0.5 * fg
    tmp = Path(out).with_suffix('.premaster.wav'); write_wav(tmp, x)
    I, TP = master(tmp, out, lufs); tmp.unlink()
    return I, TP
