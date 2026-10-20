# Real-recording session tests

These tests check how the tuner feels to a player, not just whether the pitch detector is accurate on clean tones. They use real instrument recordings and script the things people actually do while tuning. Results: [RESULTS.md](RESULTS.md).

```bash
uxtest/run.sh            # build sessions, replay through the engine, score (a few minutes)
uxtest/run.sh --browser  # also play them through the built app in Chromium, in real time, CPU throttled 4x
```

The first run downloads the recordings (about 40 MB) from [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) (MIT). These are University of Iowa acoustic guitar, Karoryfer electric bass and VSCO2 violin samples. Set `UXTEST_SAMPLES=/path/to/samples` to use an existing copy. The browser run needs Playwright: `pip install playwright && playwright install chromium`.

## How it works

| Step | File | What it does |
|---|---|---|
| Ground truth | `truth.py` | Measures each recording's fundamental over time with 1 s FFT windows, independently of the app's detector. |
| Sessions | `sessions.py` | Builds scripted tune-ups: pluck a detuned string, look, turn the peg while it rings and overshoot, re-pluck, settle, mute, next string. Turning the peg is modelled by reading the recording at a varying rate, so the true pitch is known at every moment. Environments add room noise, echo, the previous string left ringing, table bumps and background speech. |
| Offline replay | `replay.ts` | Streams a session through `TunerEngine` (the same code the app runs) and logs every reading. `--trace from to` prints a decision-by-decision trace. `TUNING='{"focus":false}'` overrides engine constants for experiments. |
| Browser replay | `play.py` | Plays a session into the built app at real-time speed and logs what the screen shows every frame (note, needle position, "In tune", tuned marks). `--video` also records the screen. |
| Scoring | `score.py`, `summary.py` | Compares what was shown with the truth. It only judges moments when the string is audible, at least 6 dB above the background. |
| Per-string detail | `intune_detail.py` | Reading bias and "In tune" accuracy for each string. |

## What is scored

| Measure | Meaning |
|---|---|
| Pluck → correct reading | Time from a pluck until the right string is on screen with the needle within 10 cents of the truth |
| Needle wobble | Frame-to-frame jitter while the pitch is steady |
| Needle error | Needle against the true pitch while steady |
| Lag while turning | How far the needle trails the pitch as the peg turns |
| Wrong note shown | Share of audible ringing time showing a different string or note, and how many such episodes last over 0.15 s |
| "In tune" shown | Share of truly-in-tune time (within ±2 cents) showing "In tune", plus on/off flicker and false "In tune" (shown while more than 5 cents off) |
| Ghost readings | Live readings during pauses, silence and bumps |
| Strings marked tuned | Tuned marks at the end of the session |
