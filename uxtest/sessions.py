"""Build realistic tuning sessions from real instrument recordings.

Each session is a WAV (48 kHz mono) plus a JSON timeline with the true
pitch, the string the player is working on, and what they are doing, every
10 ms. Sessions model what a person really does: pluck a detuned string,
look, turn the peg while it rings (often overshooting), re-pluck, settle,
pause, move to the next string. Environments add room noise, reverb,
sympathetic ringing of the other open strings, handling knocks, and
background voices.
"""
import json, re, sys, wave
import numpy as np

import os
BASE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = os.environ.get('UXTEST_SAMPLES', f'{BASE}/samples/samples')
OUT = f'{BASE}/www/sessions'
TRUTH = json.load(open(f'{BASE}/truth.json'))
SR = 48000
rng = np.random.default_rng(2026)

NAMES = {'C': 0, 'Cs': 1, 'D': 2, 'Ds': 3, 'E': 4, 'F': 5, 'Fs': 6, 'G': 7, 'Gs': 8, 'A': 9, 'As': 10, 'B': 11}
def midi_of(n):
    m = re.match(r'([A-G]s?)(\d)', n)
    return (int(m.group(2)) + 1) * 12 + NAMES[m.group(1)]
def et(midi): return 440 * 2 ** ((midi - 69) / 12)

_cache = {}
def load(key):
    if key not in _cache:
        w = wave.open(f'{SAMPLES}/{key}.wav')
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        if w.getnchannels() > 1: x = x.reshape(-1, w.getnchannels()).mean(1)
        _cache[key] = (x, w.getframerate())
    return _cache[key]

_smooth = {}
def intrinsic(key, t_src):
    """True pitch of the recording at source time t (s): the ground-truth track,
    median-smoothed over 1.5 s to remove estimator glitches but keep the real drift."""
    if key not in _smooth:
        tr = TRUTH[key]['track']
        ts = np.array([a[0] for a in tr]); hz = np.array([a[1] for a in tr])
        w = 30  # ±0.75 s: real drift is slow; estimator glitches are short
        sm = np.array([np.median(hz[max(0, i - w):i + w + 1]) for i in range(len(hz))])
        _smooth[key] = (ts, sm)
    ts, sm = _smooth[key]
    return np.interp(t_src, ts, sm)

class Voice:
    """One plucked note: a recording read at a time-varying rate (= the player turning the peg)."""
    def __init__(self, key, target_midi, start, cents_fn, gain=1.0):
        self.key, self.start, self.cents_fn, self.gain = key, start, cents_fn, gain
        x, sr = load(key)
        self.x, self.sr = x, sr
        self.onset = TRUTH[key]['onset']
        # base shift so the recording sits exactly on the target note before detuning
        self.base_ratio = et(target_midi) / np.median([a[1] for a in TRUTH[key]['track'][20:70]])
        self.stop = None  # time when muted

    def render(self, out, truth, label_fn):
        n_out = len(out)
        i0 = int(self.start * SR)
        pos = max(0.0, self.onset - 0.01) * self.sr  # start just before the recorded attack
        step0 = self.sr / SR
        i = i0
        while i < n_out and pos < len(self.x) - 2:
            t = i / SR
            if self.stop is not None and t >= self.stop: break
            c = self.cents_fn(t)
            ratio = self.base_ratio * 2 ** (c / 1200)
            k = int(pos); fr = pos - k
            v = self.x[k] * (1 - fr) + self.x[k + 1] * fr
            out[i] += self.gain * v
            if truth is not None and i % 480 == 0:
                truth[i // 480] = intrinsic(self.key, pos / self.sr) * ratio
            pos += step0 * ratio
            i += 1
        # 30 ms fade at a mute
        if self.stop is not None:
            j = int(self.stop * SR)
            f = int(0.03 * SR)
            if j < n_out: out[j:j + f] *= np.linspace(1, 0, min(f, n_out - j))

def pink(n, level_db):
    w = rng.standard_normal(n)
    f = np.fft.rfft(w); k = np.arange(len(f)); k[0] = 1
    p = np.fft.irfft(f / np.sqrt(k), n)
    return p / np.sqrt(np.mean(p ** 2)) * 10 ** (level_db / 20)

def reverb(x, rt60=0.6, wet_db=-8):
    n = int(rt60 * SR)
    ir = rng.standard_normal(n) * np.exp(-6.9 * np.arange(n) / n)
    ir[:int(0.012 * SR)] = 0  # pre-delay
    ir /= np.sqrt(np.sum(ir ** 2))
    from scipy.signal import fftconvolve
    wet = fftconvolve(x, ir)[:len(x)]
    return x + wet * 10 ** (wet_db / 20)

def knock(out, t, level_db=-20):
    """Handling noise: a short thump (hand on body, phone bumped)."""
    i = int(t * SR); n = int(0.04 * SR)
    if i + n >= len(out): return
    env = np.exp(-np.arange(n) / (0.006 * SR))
    thump = np.sin(2 * np.pi * 90 * np.arange(n) / SR) * env + 0.5 * rng.standard_normal(n) * env
    out[i:i + n] += thump * 10 ** (level_db / 20)

def babble(n, level_db):
    """Background voices: syllable-modulated noise plus a gliding voiced buzz (speech pitch)."""
    t = np.arange(n) / SR
    from scipy.signal import butter, lfilter
    b, a = butter(2, [300 / (SR / 2), 3000 / (SR / 2)], 'band')
    noise = lfilter(b, a, rng.standard_normal(n))
    syll = 0.5 + 0.5 * np.sin(2 * np.pi * 4.3 * t + 2 * np.sin(2 * np.pi * 0.7 * t))
    f0 = 140 + 35 * np.sin(2 * np.pi * 0.9 * t) + 20 * np.sin(2 * np.pi * 2.3 * t)
    ph = 2 * np.pi * np.cumsum(f0) / SR
    buzz = sum(np.sin(k * ph) / k for k in range(1, 12))
    voiced = (np.sin(2 * np.pi * 1.1 * t) > -0.2).astype(float)
    v = (0.6 * noise / noise.std() + buzz / buzz.std() * voiced) * syll ** 2
    return v / np.sqrt(np.mean(v ** 2)) * 10 ** (level_db / 20)

def ramp(points):
    """Piecewise-linear cents(t) from [(t, cents), ...]."""
    ts = [p[0] for p in points]; cs = [p[1] for p in points]
    return lambda t: float(np.interp(t, ts, cs))

def tune_string(plan, voices, events, t, key, midi, string_name, c0, c_over, other_strings=(), symp_db=None):
    """One string tuned the way people do it. Returns the time after the string is done."""
    # 1. pluck, look at the tuner
    t1 = t + 1.3
    # 2. turn the peg while it rings, overshooting
    t2 = t1 + 1.6
    t3 = t2 + 0.9
    v1 = Voice(key, midi, t, ramp([(t, c0), (t1, c0), (t2, c_over)]))
    v1.stop = t3
    voices.append(v1)
    events += [(t, t1, string_name, 'pluck-and-look'), (t1, t2, string_name, 'turning-peg'), (t2, t3, string_name, 'ringing')]
    # 3. re-pluck at the overshoot, turn back to pitch, let it ring to confirm
    t4 = t3 + 0.35
    t5 = t4 + 0.9
    t6 = t5 + 1.8
    v2 = Voice(key, midi, t4, ramp([(t4, c_over), (t4 + 0.25, c_over), (t5, 0.0)]))
    v2.stop = t6
    voices.append(v2)
    events += [(t3, t4, string_name, 'gap-replucking'), (t4, t5, string_name, 'turning-peg'), (t5, t6, string_name, 'in-tune-confirm')]
    # the string tuned before this one is left ringing (not muted) under the first pluck
    if symp_db is not None and other_strings:
        okey, omidi = other_strings[0]
        sv = Voice(okey, omidi, t - 0.6, lambda _t: 0.0, gain=10 ** (symp_db / 20))
        sv.stop = t3
        voices.append(sv)
    return t6 + 0.9  # mute, then move to the next string

def build(name, instrument, strings, env, label):
    """strings: list of (sample key, note name, start cents, overshoot cents)."""
    voices, events = [], []
    t = 1.5  # the tuner is opened, the player gets ready
    events.append((0, t, None, 'silence-before'))
    resolved = [(k, midi_of(n), n) for (k, n, _, _) in strings]
    for (key, note, c0, c_over) in strings:
        midi = midi_of(note)
        idx = [nn for (_, _, nn) in resolved].index(note)
        others = [(resolved[idx - 1][0], resolved[idx - 1][1])] if idx > 0 else []
        t_end = tune_string(None, voices, events, t, key, midi, note, c0, c_over, others, env.get('symp_db'))
        events.append((t_end - 0.9, t_end, None, 'between-strings'))
        if env.get('knocks'): knock_at = t_end - 0.5
        else: knock_at = None
        t = t_end
        if knock_at: events.append((knock_at, knock_at + 0.05, None, 'knock'))
    dur = t + 1.0
    events.append((t, dur, None, 'silence-after'))
    n = int(dur * SR)
    out = np.zeros(n)
    truth = np.full(n // 480 + 1, np.nan)
    # the main voice of each segment writes the truth (sympathetic voices do not)
    main = np.zeros(n)
    for v in voices:
        is_main = v.gain == 1.0
        v.render(main if is_main else out, truth if is_main else None, None)
    out += main
    # level for the environment
    peak = np.max(np.abs(out))
    out *= 10 ** (env['peak_db'] / 20) / peak
    if env.get('reverb'): out = reverb(out, *env['reverb'])
    for (a, b, s, kind) in events:
        if kind == 'knock': knock(out, a, env['peak_db'] - 2)
    bg = pink(n, env['noise_db'])
    if env.get('babble_db') is not None: bg = bg + babble(n, env['babble_db'])
    out += bg
    # string-to-background ratio per 10 ms (50 ms windows), to know when the string is audible
    g_main = 10 ** (env['peak_db'] / 20) / peak
    def rms10(sig):
        w = int(0.05 * SR); h = 480
        c = np.cumsum(np.concatenate([[0], sig ** 2]))
        idx = np.arange(0, n // h + 1) * h
        a0 = np.clip(idx - w // 2, 0, n); a1 = np.clip(idx + w // 2, 0, n)
        return np.sqrt((c[a1] - c[a0]) / np.maximum(1, a1 - a0))
    snr = 20 * np.log10((rms10(main * g_main) + 1e-12) / (rms10(bg) + 1e-12))
    out = np.clip(out, -1, 1)
    # write
    w = wave.open(f'{OUT}/{name}.wav', 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype('<i2').tobytes()); w.close()
    # timeline every 10 ms
    tl = []
    for j in range(len(truth)):
        tt = j * 0.01
        seg = next((e for e in events if e[0] <= tt < e[1] and e[3] not in ('knock',)), None)
        tl.append([round(tt, 2), None if np.isnan(truth[j]) else round(float(truth[j]), 4),
                   seg[2] if seg else None, seg[3] if seg else None, round(float(snr[min(j, len(snr) - 1)]), 1)])
    meta = {'name': name, 'label': label, 'instrument': instrument, 'env': env, 'duration': dur,
            'strings': [s[1] for s in strings], 'events': events, 'timeline': tl}
    json.dump(meta, open(f'{OUT}/{name}.json', 'w'))
    print(f'{name}: {dur:.1f}s, peak {env["peak_db"]} dBFS, noise {env["noise_db"]} dBFS')

import os
os.makedirs(OUT, exist_ok=True)
GA = 'guitar-acoustic'
GUITAR = [(f'{GA}/E2', 'E2', -38, 7), (f'{GA}/A2', 'A2', 24, -6), (f'{GA}/D3', 'D3', -16, 5),
          (f'{GA}/G3', 'G3', -48, 8), (f'{GA}/B3', 'B3', 11, -4), (f'{GA}/E4', 'E4', -7, 3)]
BASS = [('bass-electric/E1', 'E1', -30, 6), ('bass-electric/As1', 'A1', 20, -5),
        ('bass-electric/Cs2', 'D2', -14, 4), ('bass-electric/G2', 'G2', 9, -4)]
# every violin recording has vibrato; G3 is the steadiest (±7 c), so it is used for all four strings
VIOLIN = [('violin/G3', 'G3', -22, 5), ('violin/G3', 'D4', 15, -4), ('violin/G3', 'A4', -9, 3), ('violin/G3', 'E5', 18, -3)]
UKE = [(f'{GA}/G4', 'G4', -25, 5), (f'{GA}/C4', 'C4', 18, -4), (f'{GA}/E4', 'E4', -12, 4), (f'{GA}/A4', 'A4', 30, -5)]

QUIET_CLOSE = {'peak_db': -16, 'noise_db': -72}
TABLE_ROOM = {'peak_db': -34, 'noise_db': -60, 'reverb': (0.6, -8), 'symp_db': -14, 'knocks': True}
NOISY = {'peak_db': -26, 'noise_db': -58, 'babble_db': -40, 'symp_db': -14, 'knocks': True}
TALK_ROOM = {'peak_db': -26, 'noise_db': -60, 'babble_db': -50, 'symp_db': -14, 'knocks': True}

build('guitar_close', 'guitar', GUITAR, QUIET_CLOSE, 'Guitar, phone held close, quiet room')
build('guitar_table', 'guitar', GUITAR, TABLE_ROOM, 'Guitar, phone on a table 1 m away, room echo, previous string left ringing, knocks')
build('guitar_talk', 'guitar', GUITAR, TALK_ROOM, 'Guitar, people talking across the room')
build('guitar_noisy', 'guitar', GUITAR, NOISY, 'Guitar, someone talking right next to the phone (stress test)')
build('bass_close', 'bass', BASS, QUIET_CLOSE, 'Bass, phone held close')
build('bass_table', 'bass', BASS, TABLE_ROOM, 'Bass, phone on a table, room echo')
build('violin_close', 'violin', VIOLIN, QUIET_CLOSE, 'Violin (bowed), phone close')
build('ukulele_close', 'ukulele', UKE, QUIET_CLOSE, 'Ukulele (high G), phone close')
