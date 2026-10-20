import json, sys
rows = json.load(open(sys.argv[1]))
print(f"{'session':14s} {'to-note ms (per string)':28s} {'jit':>5s} {'err':>5s} {'err95':>6s} {'lag':>5s} {'wrong%':>6s} {'eps':>4s} {'inTune%':>7s} {'flick':>5s} {'falseIn':>7s} {'ghost':>5s} {'tuned':>6s}")
for r in rows:
    t = r['time_to_note_ms']
    ts = ','.join('∞' if x is None else str(x) for x in t)
    eps = [e for e in r['wrong_episodes'] if e[1] >= 0.15]
    print(f"{r['session']:14s} {ts:28s} {r['jitter_c']!s:>5s} {r['needle_err_c']!s:>5s} {r['needle_err95_c']!s:>6s} {r['turning_lag_ms']!s:>5s} {r['wrong_string_pct']!s:>6s} {len(eps):>4d} {r['in_tune_shown_pct']!s:>7s} {r['in_tune_flicker']!s:>5s} {r['false_in_tune_frames']!s:>7s} {r['ghost_frames']!s:>5s} {len(r['tuned_at_end'].split(',')) if r['tuned_at_end'] else 0}/{len(r['strings'])}")
    for e in eps[:4]: print(f"      ↳ {e[0]}s for {e[1]}s showed {e[2]} while playing {e[3]} ({e[4]})")
