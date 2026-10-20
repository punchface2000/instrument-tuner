# Pitch detector benchmark

Sample rate 44100 Hz. Each cell covers every string × detune {-30, -10, -3, 0, 3, 10, 30} cents × 3 random phases.
**In tune** = share of detections within ±3 cents of the true pitch. **Mean/Max** = absolute cents error over non-gross detections. **Wrong** = gross errors (> 50 cents, i.e. wrong note or octave) plus failed detections.

Legacy = original MATLAB DetectPitch ported as-is (0.2 s frame, threshold 0.1). New = fixed YIN with a streaming low-pass pre-filter (6 × highest string), window = 2 × longest period, threshold 0.12.

## Pure sine

| Instrument | Legacy in tune | Legacy mean | Legacy max | Legacy wrong | New in tune | New mean | New max | New wrong |
|---|---|---|---|---|---|---|---|---|
| Guitar | 35% | 4.68 | 14.4 | 0 | 100% | 0.01 | 0.1 | 0 |
| Ukulele | 6% | 8.74 | 13.6 | 0 | 100% | 0.04 | 0.1 | 0 |
| Bass | 6% | 13.27 | 38.2 | 0 | 100% | 0.00 | 0.0 | 0 |
| Violin | 17% | 10.59 | 23.1 | 0 | 100% | 0.07 | 0.2 | 0 |

## Plucked string (12 harmonics, decaying)

| Instrument | Legacy in tune | Legacy mean | Legacy max | Legacy wrong | New in tune | New mean | New max | New wrong |
|---|---|---|---|---|---|---|---|---|
| Guitar | 24% | 6.16 | 12.2 | 0 | 100% | 0.02 | 0.1 | 0 |
| Ukulele | 0% | 12.96 | 16.7 | 0 | 100% | 0.04 | 0.1 | 0 |
| Bass | 86% | 1.68 | 5.6 | 0 | 100% | 0.01 | 0.1 | 0 |
| Violin | 0% | 14.49 | 25.5 | 0 | 100% | 0.06 | 0.2 | 0 |

## Weak fundamental (−20 dB), like a phone mic on bass

| Instrument | Legacy in tune | Legacy mean | Legacy max | Legacy wrong | New in tune | New mean | New max | New wrong |
|---|---|---|---|---|---|---|---|---|
| Guitar | 12% | 6.85 | 12.9 | 0 | 100% | 0.01 | 0.1 | 0 |
| Ukulele | 0% | 13.66 | 17.6 | 0 | 100% | 0.04 | 0.1 | 0 |
| Bass | 68% | 2.19 | 3.9 | 0 | 100% | 0.01 | 0.0 | 0 |
| Violin | 0% | 15.23 | 26.0 | 0 | 100% | 0.06 | 0.2 | 0 |

## Plucked + white noise at 15 dB SNR

| Instrument | Legacy in tune | Legacy mean | Legacy max | Legacy wrong | New in tune | New mean | New max | New wrong |
|---|---|---|---|---|---|---|---|---|
| Guitar | 23% | 6.21 | 13.3 | 0 | 100% | 0.27 | 1.3 | 0 |
| Ukulele | 0% | 12.92 | 16.7 | 0 | 100% | 0.31 | 1.1 | 0 |
| Bass | 83% | 1.60 | 5.3 | 2 | 100% | 0.17 | 0.6 | 0 |
| Violin | 0% | 14.50 | 26.2 | 0 | 100% | 0.28 | 1.1 | 0 |

## Plucked + DC offset (0.1)

| Instrument | Legacy in tune | Legacy mean | Legacy max | Legacy wrong | New in tune | New mean | New max | New wrong |
|---|---|---|---|---|---|---|---|---|
| Guitar | 25% | 6.06 | 13.1 | 0 | 100% | 0.02 | 0.1 | 0 |
| Ukulele | 0% | 12.88 | 17.3 | 0 | 100% | 0.04 | 0.1 | 0 |
| Bass | 90% | 1.45 | 4.5 | 0 | 100% | 0.01 | 0.1 | 0 |
| Violin | 0% | 14.54 | 26.9 | 0 | 100% | 0.06 | 0.2 | 0 |

## New YIN in chromatic mode (one detector, range B0–C8)

Window 2946 samples, frame 4421 samples (100 ms).
The pre-filter follows the detected note: a first pass finds the note, then the cutoff is set from it (as the app does once a note is sounding).

| Scenario | In tune | Mean | Max | Wrong |
|---|---|---|---|---|
| Pure sine | 100% | 0.03 | 0.2 | 0 |
| Plucked string (12 harmonics, decaying) | 100% | 0.03 | 0.2 | 0 |
| Weak fundamental (−20 dB), like a phone mic on bass | 100% | 0.03 | 0.3 | 0 |
| Plucked + white noise at 15 dB SNR | 100% | 0.15 | 0.7 | 0 |
| Plucked + DC offset (0.1) | 100% | 0.03 | 0.2 | 0 |

## Rejection of non-pitched input

| Input | Legacy result | New result |
|---|---|---|
| Silence | no pitch | no pitch (conf 0.00) |
| Very quiet noise (−54 dBFS peak) | no pitch | no pitch (conf 0.00) |
| Loud white noise (seed 11) | reports 32.5 Hz | no pitch (conf 0.07) |
| Loud white noise (seed 12) | reports 82.3 Hz | no pitch (conf 0.07) |
| Loud white noise (seed 13) | reports 75.6 Hz | no pitch (conf 0.07) |

## Speed (this machine, Node)

- Legacy: 18.72 ms per frame, one result every 200 ms (0.2 s frames)
- New: 0.29 ms per frame; frames can overlap, so 20–40 results per second are practical
