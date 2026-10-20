"""Ground-truth pitch tracks for real instrument recordings.

Independent of the app's YIN detector: zero-padded FFT on long Hann windows,
parabolic interpolation of the harmonic peaks near the nominal frequency, and
a weighted combination of partials 1-3 (f_k / k). Output: JSON with, per
sample, onset time, nominal note, a pitch track (t, Hz) and its median offset
from equal temperament.
"""
import json, os, sys, wave
import numpy as np

SAMPLES = os.environ.get('UXTEST_SAMPLES', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'samples', 'samples'))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'truth.json')

NAMES = {'C': 0, 'Cs': 1, 'D': 2, 'Ds': 3, 'E': 4, 'F': 5, 'Fs': 6, 'G': 7, 'Gs': 8, 'A': 9, 'As': 10, 'B': 11}

def nominal(name):
    import re
    m = re.match(r'([A-G]s?)(\d)', name)
    midi = (int(m.group(2)) + 1) * 12 + NAMES[m.group(1)]
    return midi, 440 * 2 ** ((midi - 69) / 12)

def load(path):
    w = wave.open(path)
    sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels(); sw = w.getsampwidth()
    raw = w.readframes(n)
    dt = {2: np.int16, 4: np.int32}[sw]
    x = np.frombuffer(raw, dtype=dt).astype(np.float64) / (2 ** (8 * sw - 1))
    if ch > 1: x = x.reshape(-1, ch).mean(axis=1)
    return x, sr

def peak_near(spec, freqs, f, tol):
    lo, hi = np.searchsorted(freqs, [f * (1 - tol), f * (1 + tol)])
    if hi - lo < 3: return None, 0
    seg = spec[lo:hi]
    i = int(np.argmax(seg)) + lo
    if i <= 0 or i >= len(spec) - 1: return None, 0
    a, b, c = np.log(spec[i - 1] + 1e-20), np.log(spec[i] + 1e-20), np.log(spec[i + 1] + 1e-20)
    p = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0
    df = freqs[1] - freqs[0]
    return freqs[i] + p * df, spec[i]

def track(x, sr, f0):
    """Fundamental (partial 1) tracked with 1 s windows; falls back to partial 2 / 2
    only when the fundamental is buried more than 35 dB under the strongest partial."""
    nwin = int(1.0 * sr)
    hop = int(0.025 * sr)
    nfft = 1 << int(np.ceil(np.log2(nwin * 8)))
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    h = np.hanning(nwin)
    env = np.convolve(np.abs(x), np.ones(int(0.01 * sr)) / int(0.01 * sr), 'same')
    onset = int(np.argmax(env > 0.1 * env.max()))
    # whole-note estimate first, to centre the search
    seg = x[onset + int(0.2 * sr): onset + int(1.7 * sr)]
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 1 << 21)); ff = np.fft.rfftfreq(1 << 21, 1 / sr)
    est, _ = peak_near(spec, ff, f0, 0.04)
    out = []
    for start in range(max(0, onset - nwin // 2), len(x) - nwin, hop):
        seg = x[start:start + nwin]
        rms = np.sqrt(np.mean(seg ** 2))
        if rms < 3e-4: break
        spec = np.abs(np.fft.rfft(seg * h, nfft))
        f1, a1 = peak_near(spec, freqs, est, 0.012)
        f2, a2 = peak_near(spec, freqs, 2 * est, 0.012)
        top = spec[np.searchsorted(freqs, 0.8 * est):np.searchsorted(freqs, 8 * est)].max()
        if f1 is not None and a1 > top * 10 ** (-35 / 20): e = f1
        elif f2 is not None: e = f2 / 2
        else: continue
        out.append(((start + nwin / 2) / sr, e, 20 * np.log10(rms)))
        est = e
    return onset / sr, out

result = {}
for inst in ['guitar-acoustic', 'bass-electric', 'violin']:
    import os
    for f in sorted(os.listdir(f'{SAMPLES}/{inst}')):
        if not f.endswith('.wav'): continue
        name = f[:-4]
        midi, fnom = nominal(name)
        x, sr = load(f'{SAMPLES}/{inst}/{f}')
        onset, tr = track(x, sr, fnom)
        if len(tr) < 5: continue
        hz = np.array([t[1] for t in tr])
        steady = hz[min(len(hz) - 1, 20):min(len(hz), 70)]  # skip the attack, use the next ~1.3 s
        off = 1200 * np.log2(np.median(steady) / fnom)
        result[f'{inst}/{name}'] = {'midi': midi, 'nominal': fnom, 'sr': sr, 'onset': onset, 'offset_cents': off,
                                    'track': [[round(t, 4), round(h, 5), round(l, 1)] for t, h, l in tr]}
        attack = 1200 * np.log2(hz[0] / np.median(steady))
        print(f'{inst:16s} {name:4s} offset {off:+6.1f}c  attack {attack:+5.1f}c  frames {len(tr)}  len {len(x)/sr:.1f}s')
json.dump(result, open(OUT, 'w'))
