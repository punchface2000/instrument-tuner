"""Score a played session the way a person would experience it.

Reads logs/<session>.json (what the screen showed each frame) and
www/sessions/<session>.json (what was really being played) and reports:
  time to note    pluck → correct string on screen, needle within 10 cents of the truth
  needle jitter   frame-to-frame wobble of the needle while the pitch is steady
  needle error    needle vs true pitch while steady
  turning lag     how far the needle trails the pitch while the peg is turned
  wrong string    share of sounding time showing a different string or note
  in-tune         share of truly-in-tune time showing "In tune", and on/off flicker
  false in-tune   "In tune" shown while really more than tolerance + 2 cents off
  ghosts          live readings during silence, knocks and between strings
  dropouts        reading vanishing while the string is sounding
  frame drops     frames slower than 34 ms (visible stutter)
"""
import json, re, sys
import numpy as np

import os
BASE = os.path.dirname(os.path.abspath(__file__))
TOL = 3
N = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11, '♯': 0}
def et(name):
    m = re.match(r'([A-G])(#|♯)?(\d)', name)
    midi = (int(m.group(3)) + 1) * 12 + N[m.group(1)] + (1 if m.group(2) else 0)
    return 440 * 2 ** ((midi - 69) / 12)

SOUNDING = {'pluck-and-look', 'turning-peg', 'ringing', 'in-tune-confirm'}
QUIET = {'silence-before', 'silence-after', 'between-strings'}

def score(name, verbose=False):
    meta = json.load(open(f'{BASE}/www/sessions/{name}.json'))
    import os
    log = json.load(open(f"{BASE}/logs/{os.environ.get('LOGP', '')}{name}.json"))
    fr = log['frames']
    tl = meta['timeline']
    def truth_at(t):
        j = int(round(t / 0.01))
        if j < 0 or j >= len(tl): return None, None, None
        kind = tl[j][3]
        # a string drowned by the background (< 6 dB above it) cannot be judged
        if kind in SOUNDING and len(tl[j]) > 4 and tl[j][4] < 6: kind = 'inaudible'
        return tl[j][1], tl[j][2], kind
    rows = []
    for f in fr:
        ta, tw, state, held, tune, note, direction, ctext, needle, target, tuned = f
        ftrue, string, kind = truth_at(ta)
        true_c = 1200 * np.log2(ftrue / et(string)) if (ftrue and string) else None
        live = state == 'active' and not held
        rows.append(dict(ta=ta, tw=tw, live=live, held=held, active=state == 'active', tune=tune, note=note,
                         needle=needle, string=string, kind=kind, true_c=true_c, tuned=tuned))

    # pluck times: start of pluck-and-look and end of gap-replucking
    plucks = [(e[0], e[2]) for e in meta['events'] if e[3] == 'pluck-and-look']
    replucks = [(e[1], e[2]) for e in meta['events'] if e[3] == 'gap-replucking']
    lat = []
    for (tp, s) in plucks:
        hit = next((r for r in rows if r['ta'] >= tp and r['live'] and r['note'] == s and r['true_c'] is not None
                    and abs(r['needle'] - max(-50, min(50, r['true_c']))) < 10), None)
        lat.append((hit['ta'] - tp) * 1000 if hit else float('inf'))

    # steadiness during the steady parts (skip the first 0.4 s after a pluck: attack)
    jit, err = [], []
    for e in meta['events']:
        if e[3] not in ('pluck-and-look', 'in-tune-confirm'): continue
        a = e[0] + 0.4 if e[3] == 'pluck-and-look' else e[0] + 0.3
        seg = [r for r in rows if a <= r['ta'] < e[1] and r['live'] and r['note'] == e[2] and r['true_c'] is not None
               and abs(r['true_c']) < 50]
        if len(seg) < 10: continue
        nd = np.array([r['needle'] for r in seg]); tc = np.array([r['true_c'] for r in seg])
        jit.append(np.std(np.diff(nd)) / np.sqrt(2))  # frame-to-frame wobble
        err.extend(list(np.abs(nd - tc)))

    # turning lag: best time shift between needle and truth while turning
    lags, lag_rms = [], []
    for e in meta['events']:
        if e[3] != 'turning-peg': continue
        seg = [r for r in rows if e[0] + 0.1 <= r['ta'] < e[1] and r['live'] and r['note'] == e[2] and r['true_c'] is not None]
        if len(seg) < 20: continue
        ts = np.array([r['ta'] for r in seg]); nd = np.array([r['needle'] for r in seg])
        best = None
        for L in np.arange(0, 0.31, 0.01):
            tc = np.array([truth_at(t - L)[0] for t in ts], dtype=float)
            tc = 1200 * np.log2(tc / et(e[2]))
            tc = np.clip(tc, -50, 50)
            rms = np.sqrt(np.mean((nd - tc) ** 2))
            if best is None or rms < best[1]: best = (L, rms)
        lags.append(best[0] * 1000); lag_rms.append(best[1])

    sounding = [r for r in rows if r['kind'] in SOUNDING]
    wrong = [r for r in sounding if r['active'] and r['note'] and r['note'] != r['string']]
    # wrong-string episodes
    episodes, cur = [], None
    for r in sounding:
        bad = r['active'] and r['note'] and r['note'] != r['string']
        if bad and cur is None: cur = [r['ta'], r['ta'], r['note'], r['string'], r['kind']]
        elif bad: cur[1] = r['ta']
        elif cur is not None: episodes.append(cur); cur = None
    if cur: episodes.append(cur)

    truly_in = [r for r in sounding if r['true_c'] is not None and abs(r['true_c']) <= TOL - 1 and r['kind'] == 'in-tune-confirm']
    in_shown = sum(1 for r in truly_in if r['tune']) / max(1, len(truly_in))
    flips = sum(1 for a, b in zip(truly_in, truly_in[1:]) if a['tune'] != b['tune'] and b['ta'] - a['ta'] < 0.05)
    false_in = [r for r in sounding if r['tune'] and r['true_c'] is not None and abs(r['true_c']) > TOL + 2]
    ghosts = [r for r in rows if r['kind'] in QUIET and r['live']]
    # a ghost only counts after the previous note has had 0.3 s to stop
    mutes = [e[0] for e in meta['events'] if e[3] in QUIET]
    ghosts = [r for r in ghosts if not any(0 <= r['ta'] - m < 0.3 for m in mutes)]
    drop = sum(1 for a, b in zip(sounding, sounding[1:]) if a['live'] and not b['active'] and b['ta'] - a['ta'] < 0.05)
    dts = np.diff([f[1] for f in fr])
    slow = float(np.mean(dts > 0.034))
    final_tuned = rows[-1]['tuned']

    res = dict(session=name, label=meta['label'],
               time_to_note_ms=[round(x) if np.isfinite(x) else None for x in lat],
               jitter_c=round(float(np.median(jit)), 2) if jit else None,
               needle_err_c=round(float(np.median(err)), 2) if err else None,
               needle_err95_c=round(float(np.percentile(err, 95)), 2) if err else None,
               turning_lag_ms=round(float(np.median(lags))) if lags else None,
               turning_rms_c=round(float(np.median(lag_rms)), 2) if lag_rms else None,
               wrong_string_pct=round(100 * len(wrong) / max(1, len(sounding)), 1),
               wrong_episodes=[(round(a, 2), round(b - a, 2), n, s, k) for a, b, n, s, k in episodes],
               in_tune_shown_pct=round(100 * in_shown, 1), in_tune_flicker=flips,
               false_in_tune_frames=len(false_in),
               ghost_frames=len(ghosts), ghost_notes=sorted(set(r['note'] for r in ghosts)),
               dropouts=drop, slow_frames_pct=round(100 * slow, 1),
               tuned_at_end=final_tuned, strings=meta['strings'])
    return res

if __name__ == '__main__':
    names = sys.argv[1:]
    allres = [score(n) for n in names]
    for r in allres:
        print(f"\n== {r['session']}: {r['label']}")
        for k, v in r.items():
            if k in ('session', 'label'): continue
            if k == 'wrong_episodes':
                print(f'  {k}: {len(v)}')
                for ep in v[:8]: print(f'      at {ep[0]}s for {ep[1]}s showed {ep[2]} while playing {ep[3]} ({ep[4]})')
            else: print(f'  {k}: {v}')
    json.dump(allres, open(f'{BASE}/score_latest.json', 'w'), indent=1)
