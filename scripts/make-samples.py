"""Build the reference-tone samples (public/samples/) from real recordings.

    python3 scripts/make-samples.py        (needs numpy, scipy, ffmpeg)

Sources (downloaded by uxtest/run.sh, or set UXTEST_SAMPLES):
  guitar  University of Iowa Electronic Music Studios, acoustic guitar:
          "may be downloaded and used for any projects, without restrictions"
  violin  VSCO 2 Community Edition (Versilian Studios): CC0 / public domain

For a tuner, the reference must be exactly on pitch, so every recording is
pitch-flattened: its fundamental is tracked every few milliseconds and the
recording is resampled with the inverse of that curve, so it sits exactly on
its equal-tempered note (A4 = 440 Hz) for its whole length. That also removes
the violin's vibrato. The app then shifts each sample by at most a couple of
semitones (playbackRate) to reach any string, and to follow the A4 setting.

This script writes candidate versions of each note (different pitch-tracking
methods) as WAV files to .sample-build/. scripts/pick-samples.ts then measures
each candidate with the tuner's own engine, keeps the steadiest, encodes it to
public/samples/<instrument>/<note>.mp3 and writes src/audio/samples.json.

    python3 scripts/make-samples.py && npx tsx scripts/pick-samples.ts
"""
import json, os, re, subprocess, sys, tempfile, wave
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.environ.get('UXTEST_SAMPLES', os.path.join(ROOT, 'uxtest', 'samples', 'samples'))
OUT = os.path.join(ROOT, 'public', 'samples')
BUILD = os.path.join(ROOT, '.sample-build')
SR = 44100

NAMES = {'C': 0, 'Cs': 1, 'D': 2, 'Ds': 3, 'E': 4, 'F': 5, 'Fs': 6, 'G': 7, 'Gs': 8, 'A': 9, 'As': 10, 'B': 11}
def midi_of(n):
    m = re.match(r'([A-G]s?)(\d)$', n)
    return (int(m.group(2)) + 1) * 12 + NAMES[m.group(1)]
def et(midi): return 440.0 * 2 ** ((midi - 69) / 12)

INSTRUMENTS = {
    'guitar': {
        'dir': 'guitar-acoustic',
        # every 2 semitones from D2 to D5: no note is shifted by more than one semitone
        # (G3 instead of G#3: that recording's pitch wavers by ±10 cents)
        'notes': ['D2', 'E2', 'Fs2', 'Gs2', 'As2', 'C3', 'D3', 'E3', 'Fs3', 'G3', 'As3', 'C4', 'D4', 'E4', 'Fs4', 'Gs4', 'As4', 'C5', 'D5'],
        # plucked strings have no vibrato but drift a few cents as they ring
        'methods': ['constant', 'drift_fft', 'drift_td'], 'seconds': 3.2, 'max_down': 3, 'max_up': 2, 'credit': 'University of Iowa Electronic Music Studios',
    },
    'violin': {
        'dir': 'violin',
        'notes': ['G3', 'A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6'],
        # bowed with vibrato: follow the pitch curve and flatten it
        'methods': ['vib_fft1', 'vib_fft3', 'vib_td2'], 'seconds': 3.0, 'max_down': 7, 'max_up': 2, 'credit': 'VSCO 2 Community Edition (CC0)',
    },
}

def load(path):
    w = wave.open(path)
    sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
    x = np.frombuffer(w.readframes(n), dtype={2: np.int16, 4: np.int32}[sw]).astype(np.float64) / 2 ** (8 * sw - 1)
    if ch > 1: x = x.reshape(-1, ch).mean(1)
    assert sr == SR, (path, sr)
    return x

def peak(spec, freqs, f, tol):
    lo, hi = np.searchsorted(freqs, [f * (1 - tol), f * (1 + tol)])
    if hi - lo < 3: return None, 0.0
    i = lo + int(np.argmax(spec[lo:hi]))
    if i <= 0 or i >= len(spec) - 1: return None, 0.0
    a, b, c = np.log(spec[i - 1:i + 2] + 1e-20)
    d = a - 2 * b + c
    p = 0.5 * (a - c) / d if d != 0 else 0.0
    return freqs[i] + p * (freqs[1] - freqs[0]), spec[i]

def track(x, f0, hop_s=0.004):
    """Fundamental every `hop_s`, from a Hann-windowed FFT with interpolated peaks.
    Uses partial 2 / 2 when the fundamental is buried (low guitar strings)."""
    win = int(max(0.03, 5 / f0) * SR)
    hop = int(hop_s * SR)
    nfft = 1 << int(np.ceil(np.log2(win * 8)))
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    h = np.hanning(win)
    ts, fs = [], []
    est = f0
    for s in range(0, len(x) - win, hop):
        seg = x[s:s + win]
        if np.sqrt(np.mean(seg ** 2)) < 1e-4: break
        sp = np.abs(np.fft.rfft(seg * h, nfft))
        f1, a1 = peak(sp, freqs, est, 0.03)
        f2, a2 = peak(sp, freqs, 2 * est, 0.03)
        top = sp[np.searchsorted(freqs, 0.8 * est):np.searchsorted(freqs, 6 * est)].max()
        if f1 is not None and a1 > top * 10 ** (-30 / 20): e = f1
        elif f2 is not None: e = f2 / 2
        else: continue
        ts.append((s + win / 2) / SR); fs.append(e)
        est = 0.7 * est + 0.3 * e
    return np.array(ts), np.array(fs)

def steady_pitch(x, f0, start=0.25, end=1.5):
    """Fundamental of a steady stretch, from one long FFT (accurate to ~0.1 cent)."""
    seg = x[int(start * SR):int(end * SR)]
    sp = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 1 << 21))
    freqs = np.fft.rfftfreq(1 << 21, 1 / SR)
    f1, a1 = peak(sp, freqs, f0, 0.03)
    f2, _ = peak(sp, freqs, 2 * f0, 0.03)
    top = sp[np.searchsorted(freqs, 0.8 * f0):np.searchsorted(freqs, 6 * f0)].max()
    return f1 if (f1 is not None and a1 > top * 10 ** (-30 / 20)) else f2 / 2

def track_td(x, f0, hop_s=0.002, periods=3, search=0.08):
    """Time-domain period tracker (YIN-style difference function, only around the
    expected period, parabolic interpolation). Sharp in time: follows vibrato."""
    tau0 = SR / f0
    W = int(max(periods * tau0, 0.006 * SR))
    hop = int(hop_s * SR)
    lo, hi = int(tau0 * (1 - search)) - 1, int(tau0 * (1 + search)) + 2
    taus = np.arange(lo, hi + 1)
    ts, fs = [], []
    for s in range(0, len(x) - W - hi - 1, hop):
        a = x[s:s + W]
        if np.sqrt(np.mean(a ** 2)) < 1e-4: break
        d = np.array([np.sum((a - x[s + t:s + t + W]) ** 2) for t in taus])
        i = int(np.argmin(d[1:-1])) + 1
        y0, y1, y2 = d[i - 1], d[i], d[i + 1]
        den = y0 - 2 * y1 + y2
        sh = 0.5 * (y0 - y2) / den if den > 0 else 0.0
        ts.append((s + W / 2) / SR)
        fs.append(SR / (taus[i] + sh))
    return np.array(ts), np.array(fs)

def smooth(v, n):
    if n <= 1 or len(v) < n: return v
    pad = n // 2
    vp = np.pad(v, pad, mode='edge')
    med = np.array([np.median(vp[i:i + n]) for i in range(len(v))])
    k = np.ones(n) / n
    return np.convolve(np.pad(med, pad, mode='edge'), k, 'valid')[:len(v)]

def flatten(x, ts, fs, target):
    """Resample x so its tracked pitch fs(ts) becomes exactly `target` throughout."""
    t_src = np.arange(len(x)) / SR
    ratio = target / np.interp(t_src, ts, fs)          # >1: read faster (raise pitch)
    out_pos = np.concatenate([[0.0], np.cumsum(1.0 / ratio)])[:-1]   # output time of each source sample
    n_out = int(out_pos[-1])
    src_pos = np.interp(np.arange(n_out), out_pos, np.arange(len(x)))   # source position per output sample
    i = np.floor(src_pos).astype(int)
    f = src_pos - i
    i = np.clip(i, 1, len(x) - 3)
    p0, p1, p2, p3 = x[i - 1], x[i], x[i + 1], x[i + 2]                 # Catmull-Rom interpolation
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)

def residual(y, target):
    ts, fs = track(y, target)
    c = 1200 * np.log2(fs / target)
    steady = c[(ts > 0.15) & (ts < min(2.0, ts[-1] if len(ts) else 0))]
    return float(np.median(steady)), float(np.percentile(np.abs(steady - np.median(steady)), 95))

def track_long(x, f0, win_s=0.3, hop_s=0.02):
    """Slow pitch drift of the fundamental: long FFT windows, so precise but slow."""
    win, hop = int(win_s * SR), int(hop_s * SR)
    nfft = 1 << int(np.ceil(np.log2(win * 8)))
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    h = np.hanning(win)
    ts, fs = [], []
    for s in range(0, len(x) - win, hop):
        seg = x[s:s + win]
        if np.sqrt(np.mean(seg ** 2)) < 1e-4: break
        sp = np.abs(np.fft.rfft(seg * h, nfft))
        f1, a1 = peak(sp, freqs, f0, 0.03)
        f2, _ = peak(sp, freqs, 2 * f0, 0.03)
        top = sp[np.searchsorted(freqs, 0.8 * f0):np.searchsorted(freqs, 6 * f0)].max()
        e = f1 if (f1 is not None and a1 > top * 10 ** (-30 / 20)) else (f2 / 2 if f2 is not None else None)
        if e is None: continue
        ts.append((s + win / 2) / SR); fs.append(e)
    return np.array(ts), np.array(fs)

def candidate(x, target, method):
    if method == 'constant':
        f = steady_pitch(x, target)
        return flatten(x, np.array([0.0, 1.0]), np.array([f, f]), target)
    if method == 'drift_fft':
        ts, fs = track_long(x, target)
        return flatten(x, ts, smooth(fs, 5), target)
    if method == 'drift_td':
        ts, fs = track_td(x, target, hop_s=0.005)
        return flatten(x, ts, smooth(fs, 51), target)
    passes = int(method[-1])
    y = x
    for _ in range(passes):
        ts, fs = track_td(y, target) if method.startswith('vib_td') else track(y, target)
        y = flatten(y, ts, smooth(fs, 3), target)
    return y

def write_wav(path, y):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes()); w.close()

def process(inst, cfg, note):
    x = load(os.path.join(SRC, cfg['dir'], f'{note}.wav'))
    midi = midi_of(note)
    target = et(midi)
    env = np.convolve(np.abs(x), np.ones(441) / 441, 'same')
    onset = max(0, int(np.argmax(env > 0.1 * env.max())) - int(0.006 * SR))
    x = x[onset:onset + int((cfg['seconds'] + 0.6) * SR)]
    out = []
    for method in cfg['methods']:
        y = candidate(x, target, method)[: int(cfg['seconds'] * SR)].copy()
        # level: first second at -18 dBFS RMS, peaks no higher than -1 dBFS
        rms = np.sqrt(np.mean(y[:SR] ** 2))
        y *= 10 ** (-18 / 20) / max(rms, 1e-9)
        y *= min(1.0, 10 ** (-1 / 20) / np.max(np.abs(y)))
        n_in, n_out = int(0.003 * SR), int(0.5 * SR)
        y[:n_in] *= np.linspace(0, 1, n_in)
        y[-n_out:] *= np.linspace(1, 0, n_out) ** 2
        path = os.path.join(BUILD, inst, f'{note}.{method}.wav')
        write_wav(path, y)
        out.append(method)
    print(f'{inst:7s} {note:4s} candidates: {", ".join(out)}')
    return {'note': note.replace('s', '#'), 'midi': midi, 'candidates': out}

def main():
    if not os.path.isdir(SRC):
        sys.exit(f'Recordings not found at {SRC}. Run uxtest/run.sh once (it downloads them) or set UXTEST_SAMPLES.')
    plan = {}
    for inst, cfg in INSTRUMENTS.items():
        os.makedirs(os.path.join(BUILD, inst), exist_ok=True)
        notes = [process(inst, cfg, n) for n in cfg['notes']]
        plan[inst] = {'maxDown': cfg['max_down'], 'maxUp': cfg['max_up'], 'credit': cfg['credit'], 'notes': notes}
    with open(os.path.join(BUILD, 'plan.json'), 'w') as f:
        json.dump(plan, f, indent=1)
    print(f'candidates in {BUILD}; next: npx tsx scripts/pick-samples.ts')

main()
