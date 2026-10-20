# Instrument Tuner

A web tuner for guitar, ukulele, bass and violin, plus a chromatic mode. It is a rewrite of an earlier MATLAB App Designer tuner (kept in [`matlab/`](matlab/) for reference).

**Try it:** https://punchface2000.github.io/instrument-tuner/ (once GitHub Pages is switched on; see [Deploying](#deploying)).

## Using it

1. Open the page and tap **Start tuning**. The browser asks for the microphone once.
2. Pick your instrument and play one string at a time. The tuner finds the nearest string.
3. Left of centre is flat (tighten), right is sharp (loosen). The note turns green when it is in tune, and the string gets a green dot.
4. Tap a string to tune only that one, then tap **Play** to hear its pitch.
5. **Chromatic** names any note. Settings has the reference pitch (A4), the in-tune range, the microphone and the theme.

The microphone only works on `https://` pages or `localhost`.

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
| Live tuner logic: samples in, readings out (no DOM) | [`src/engine.ts`](src/engine.ts) |
| Microphone capture (AudioWorklet) | [`src/audio/mic.ts`](src/audio/mic.ts) |
| Reference tone | [`src/audio/reference-tone.ts`](src/audio/reference-tone.ts) |
| UI wiring | [`src/main.ts`](src/main.ts), [`index.html`](index.html), [`src/styles.css`](src/styles.css) |
| All user-facing text (for translations) | [`src/i18n.ts`](src/i18n.ts) |

### Adding an instrument

Add an entry to `INSTRUMENTS` in `src/instruments.ts`, listing the strings in physical order:

```ts
{
  id: 'cello',
  name: 'Cello',
  tunings: [{ id: 'standard', name: 'Standard (CGDA)', strings: ['C2', 'G2', 'D3', 'A3'] }],
},
```

It appears as a new tab. The detection range and filter settings are derived from the notes. An instrument can already list several tunings, but the app uses the first one until a tuning picker is added.

## Benchmark

`npm run bench` runs the original MATLAB algorithm and the new one on synthetic tones and writes [`bench/results.md`](bench/results.md). The tones are pure sines, plucked strings, a weak fundamental, a noisy signal and a signal with DC offset, played on every string at several detunings.

| Share of readings within ±3 cents | Original | New |
|---|---|---|
| Guitar, plucked | 24% | 100% |
| Ukulele, plucked | 0% | 100% |
| Bass, plucked | 86% | 100% |
| Violin, plucked | 0% | 100% |
| Any instrument, 15 dB noise | 0–83% | 100% |

The new detector also rejects white noise, which the original reported as a pitch. It is also over 20× faster per frame (FFT-based), and its frames are shorter: 46 ms for guitar instead of 200 ms.

## Development

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run dev       # live-reloading app at http://localhost:5173
npm test          # unit tests
npm run bench     # algorithm benchmark → bench/results.md
npm run build     # one self-contained file: dist/index.html
```

## Deploying

`.github/workflows/deploy.yml` builds and tests the app and publishes it to GitHub Pages on every push to `main`. Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.
