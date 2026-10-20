# Live responsiveness benchmark

The live engine is fed simulated microphone audio in small blocks. **Latency** = time from the pluck until the first reading within 5 cents (median / worst, per pluck). **Coverage** = share of the ringing time with a live reading on screen. **Dropouts** = times the reading disappeared while the string was still ringing. **Error** = median / 95th-percentile cents error of live readings.

| Scenario | Instrument | Latency (ms) | Coverage | Dropouts | Error (¢) | Wrong note |
|---|---|---|---|---|---|---|
| Pluck and let ring (loud, −20 dBFS peak) | Guitar | 41 / 41 | 99% | 0 | 0.1 / 1.0 | 0 |
| Pluck and let ring (loud, −20 dBFS peak) | Bass | 89 / 89 | 98% | 0 | 0.1 / 0.6 | 0 |
| Pluck and let ring (loud, −20 dBFS peak) | Ukulele | 20 / 20 | 100% | 0 | 0.1 / 0.8 | 0 |
| Pluck and let ring (loud, −20 dBFS peak) | Violin | 20 / 31 | 100% | 0 | 0.1 / 1.1 | 0 |
| Quiet phone mic at arm’s length (−38 dBFS peak) | Guitar | 41 / 52 | 99% | 0 | 1.4 / 17.9 | 0 |
| Quiet phone mic at arm’s length (−38 dBFS peak) | Bass | 73 / 89 | 98% | 0 | 0.7 / 9.4 | 0 |
| Quiet phone mic at arm’s length (−38 dBFS peak) | Ukulele | 20 / 31 | 100% | 0 | 0.9 / 13.7 | 0 |
| Quiet phone mic at arm’s length (−38 dBFS peak) | Violin | 20 / 31 | 99% | 0 | 1.2 / 10.6 | 0 |
| Turning the peg: −40 → +5 cents over 5 s, re-plucking every 1.7 s | Guitar | 1 / 52 | 100% | 0 | 0.2 / 0.6 | 0 |
| Turning the peg: −40 → +5 cents over 5 s, re-plucking every 1.7 s | Bass | 7 / 100 | 99% | 0 | 0.5 / 0.8 | 0 |
| Turning the peg: −40 → +5 cents over 5 s, re-plucking every 1.7 s | Ukulele | 1 / 31 | 100% | 0 | 0.1 / 0.5 | 0 |
| Turning the peg: −40 → +5 cents over 5 s, re-plucking every 1.7 s | Violin | 1 / 20 | 100% | 0 | 0.1 / 0.6 | 0 |
| Noisy room with 50 Hz mains hum (−52 dBFS) | Guitar | 41 / 41 | 99% | 0 | 4.0 / 28.0 | 0 |
| Noisy room with 50 Hz mains hum (−52 dBFS) | Bass | 116 / 116 | 100% | 0 | 4.4 / 39.6 | 1004 |
| Noisy room with 50 Hz mains hum (−52 dBFS) | Ukulele | 20 / 31 | 99% | 0 | 3.3 / 33.3 | 0 |
| Noisy room with 50 Hz mains hum (−52 dBFS) | Violin | 20 / 20 | 99% | 0 | 2.5 / 38.6 | 0 |
