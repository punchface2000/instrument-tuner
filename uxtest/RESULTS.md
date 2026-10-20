# Real-recording session results

Each session is a scripted tune-up built from **real instrument recordings** (University of Iowa acoustic guitar, Karoryfer electric bass, VSCO2 violin). The player plucks a detuned string, looks, turns the peg while it rings (overshooting), re-plucks, settles, mutes and moves on. Environments add room noise, echo, the previous string left ringing, bumps and people talking. The true pitch is known at every moment. See [README.md](README.md) for how the sessions are made and scored.

Only moments when the string is actually audible (at least 6 dB above the room noise and voices) are judged.

## Before and after

The version deployed before this round of testing, against the current engine, on identical sessions (offline replay, the same code the app runs).

| Session | Wrong note shown | Wrong for > 0.15 s | "In tune" shown when in tune | Needle error (median, cents) | Ghost readings in pauses (frames) | Strings marked tuned |
|---|---|---|---|---|---|---|
| Guitar, phone held close, quiet room | 7.7% → **1.1%** | 2 → **0** | 72.1% → **91.1%** | 1.68 → **0.57** | 0 → **0** | 6 → **6** of 6 |
| Guitar, phone on a table 1 m away, room echo, previous string left ringing, knocks | 15.4% → **1.7%** | 2 → **0** | 63.9% → **88.9%** | 1.78 → **1.76** | 17 → **0** | 3 → **6** of 6 |
| Guitar, people talking across the room | 16.1% → **3.1%** | 6 → **0** | 56.2% → **77.7%** | 2.22 → **2.18** | 194 → **42** | 1 → **6** of 6 |
| Guitar, someone talking right next to the phone (stress test) | 18.5% → **7.5%** | 7 → **0** | 34.9% → **73.0%** | 3.23 → **2.69** | 215 → **61** | 0 → **5** of 6 |
| Bass, phone held close | 0.8% → **1.2%** | 0 → **0** | 22.5% → **100.0%** | 5.74 → **0.8** | 0 → **0** | 2 → **4** of 4 |
| Bass, phone on a table, room echo | 1.5% → **2.0%** | 0 → **0** | 34.3% → **55.1%** | 6.23 → **6.18** | 0 → **0** | 2 → **3** of 4 |
| Violin (bowed), phone close | 0.4% → **0.7%** | 0 → **0** | 92.9% → **98.3%** | 0.72 → **1.01** | 0 → **0** | 4 → **4** of 4 |
| Ukulele (high G), phone close | 1.0% → **1.2%** | 0 → **0** | 87.9% → **100.0%** | 1.3 → **0.49** | 0 → **0** | 4 → **4** of 4 |

## In the real app, at phone CPU speed

The built app in Chromium with the CPU throttled 4×, fed in real time, everything on screen logged every frame (60 fps throughout).

| Session | Pluck → correct reading (median ms) | Needle wobble (cents, frame to frame) | Needle lag while turning (ms) | "In tune" shown when in tune | Slow frames |
|---|---|---|---|---|---|
| Guitar, phone held close, quiet room | 114 | 0.12 | 90 | 91.3% | 0.0% |
| Guitar, phone on a table 1 m away, room echo, previous string left ringing, knocks | 146 | 0.23 | 90 | 88.6% | 0.0% |
| Guitar, people talking across the room | 123 | 0.55 | 65 | 78.1% | 0.0% |
| Guitar, someone talking right next to the phone (stress test) | 105 | 0.48 | 55 | 75.3% | 0.0% |
| Bass, phone held close | 144 | 0.11 | 85 | 100.0% | 0.0% |
| Bass, phone on a table, room echo | 155 | 0.09 | 115 | 54.8% | 0.0% |
| Violin (bowed), phone close | 88 | 0.36 | 70 | 98.7% | 0.0% |
| Ukulele (high G), phone close | 112 | 0.18 | 95 | 100.0% | 0.0% |

## What the testing found and fixed

1. **Low E shown as "D3" for up to 2 s.** On a low string with a strong second harmonic, the detector sometimes locked on the octave above, and the nearest string to that was D3. The tracker now checks whether the note it was following still fits the waveform before believing a jump, unless the new pitch is itself a string.
2. **A jump to a different string needs a real pluck.** While a note rings, only a sudden rise in level about as loud as recent plucks can switch notes, so a syllable of speech or a knock can't.
3. **Overtones pulling the reading sharp.** Several recordings (guitar A2, all bass strings) have strong overtones a few cents sharp of the fundamental, which made the reading 5–15 cents sharp and the "In tune" state unreachable. Once a note is identified, it is now measured on a copy filtered tightly around its fundamental. Biases fell to 0–3 cents.
4. **"In tune" flickering at the edge.** It now turns on within the tolerance and only turns off 1.5 cents beyond it.
5. **Guitar body boom.** A plucked high string excites the guitar body's air resonance near 110 Hz (A2) for about 0.3 s. Snapping back to a tracked note is now only allowed when the new pitch is not itself a string, so high E is no longer shown as A2.

## Known limits

- **Bass across the room.** With the phone about 1 m from a bass, the low E fundamental is lost in room noise. Like any tuner, the app then reads the overtones, which on an inharmonic bass string sit 6–14 cents sharp. Hold the phone close to the bass or its amp.
- **Someone talking right next to the phone** (as loud as the decaying string) still causes the odd wrong reading and about 1 s of stray readings per minute. Talking across the room is handled.
- **A voice in an otherwise silent room** can show notes before anything has been played. Most tuners do this. Once a string has been plucked, quieter voices are ignored.
- **High strings fade fast at a distance.** With the phone across a table, B3 and E4 drop under the room noise about 2 s after the pluck, so re-pluck more often.
- **Ground truth** is itself uncertain by about 1–3 cents (recording drift and inharmonicity), so differences below that are not meaningful.
