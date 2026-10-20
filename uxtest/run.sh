#!/usr/bin/env bash
# Real-recording tuning sessions: build them, replay them through the engine,
# and score how the tuner would feel to a player.
#
#   uxtest/run.sh            offline replay (fast, engine only)
#   uxtest/run.sh --browser  also play them through the built app in Chromium
#                            at real time with the CPU throttled 4x (needs
#                            Playwright: pip install playwright && playwright install chromium)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
SESSIONS="guitar_close guitar_table guitar_talk guitar_noisy bass_close bass_table violin_close ukulele_close"

# 1. instrument recordings (University of Iowa / VSCO2 / Karoryfer via tonejs-instruments, MIT)
if [ -z "${UXTEST_SAMPLES:-}" ] && [ ! -d "$HERE/samples/samples/guitar-acoustic" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/nbrosowsky/tonejs-instruments "$HERE/samples"
  git -C "$HERE/samples" sparse-checkout set samples/guitar-acoustic samples/bass-electric samples/violin
fi

# 2. ground truth and sessions
[ -f "$HERE/truth.json" ] || python3 "$HERE/truth.py"
[ -f "$HERE/www/sessions/guitar_close.wav" ] || python3 "$HERE/sessions.py"

# 3. offline replay through the engine + score
for s in $SESSIONS; do (cd "$ROOT" && npx tsx uxtest/replay.ts "$s"); done
LOGP=off_ python3 "$HERE/score.py" $SESSIONS > "$HERE/score_offline.txt"
python3 "$HERE/summary.py" "$HERE/score_latest.json"

# 4. optional: real-time browser run of the built app
if [ "${1:-}" = "--browser" ]; then
  (cd "$ROOT" && npm run build >/dev/null)
  cp "$ROOT/dist/index.html" "$HERE/www/index.html"
  (cd "$HERE/www" && python3 -m http.server 8766 >/dev/null 2>&1 & echo $! > "$HERE/.server.pid")
  sleep 1
  python3 "$HERE/play.py" $SESSIONS
  kill "$(cat "$HERE/.server.pid")" && rm "$HERE/.server.pid"
  python3 "$HERE/score.py" $SESSIONS > "$HERE/score_browser.txt"
  python3 "$HERE/summary.py" "$HERE/score_latest.json"
fi
