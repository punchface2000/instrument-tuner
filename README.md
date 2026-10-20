# Instrument Tuner

A web tuner for guitar, ukulele, bass and violin, plus a chromatic mode. It is a rewrite of an earlier MATLAB App Designer tuner (kept in [`matlab/`](matlab/) for reference).

> **Status:** the pitch-detection engine and its benchmark are done. The web UI is next.

## How it works

Microphone audio passes through a low-pass pre-filter and then into a YIN pitch detector, which gives the frequency and a confidence value. The app compares that frequency to the nearest string or note and shows the deviation in cents.

| Piece | File |
|---|---|
| YIN pitch detector | [`src/pitch/yin.ts`](src/pitch/yin.ts) |
| Streaming low-pass pre-filter | [`src/pitch/filter.ts`](src/pitch/filter.ts) |
| Detector settings per frequency range | [`src/pitch/config.ts`](src/pitch/config.ts) |
| Note math (equal temperament, adjustable A4) | [`src/tuning.ts`](src/tuning.ts) |
| Instruments and tunings (data only) | [`src/instruments.ts`](src/instruments.ts) |
| Original MATLAB algorithm, ported as-is for comparison | [`src/pitch/legacy.ts`](src/pitch/legacy.ts) |

### Adding an instrument or tuning

Add an entry to `INSTRUMENTS` in `src/instruments.ts`, listing the strings in physical order:

```ts
{
  id: 'guitar',
  name: 'Guitar',
  tunings: [
    { id: 'standard', name: 'Standard (EADGBE)', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    { id: 'drop-d', name: 'Drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  ],
},
```

Nothing else needs to change. The detection range and filter settings are derived from the notes.

## Benchmark

`npm run bench` runs the original MATLAB algorithm and the new one on synthetic tones and writes [`bench/results.md`](bench/results.md). The tones are pure sines, plucked strings, a weak fundamental, a noisy signal and a signal with DC offset, played on every string at several detunings.

| Share of readings within ±3 cents | Original | New |
|---|---|---|
| Guitar, plucked | 24% | 100% |
| Ukulele, plucked | 0% | 100% |
| Bass, plucked | 86% | 100% |
| Violin, plucked | 0% | 100% |
| Any instrument, 15 dB noise | 0–83% | 100% |

The new detector also rejects white noise, which the original reported as a pitch. It is about 10× faster per frame, and its frames are shorter: 46 ms for guitar instead of 200 ms.

## Development

```bash
npm install
npm test          # unit tests
npm run bench     # algorithm benchmark → bench/results.md
```
