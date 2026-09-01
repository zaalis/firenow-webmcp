# Multi-day validation, FireNow

Measured on 28 August 2026. The harness changes no coefficient. "Before" is the
reference run supplied with the brief; "after" uses the diurnal cycle,
perimeter death, persistent lines, the Gironde raster and the hourly Open-Meteo
series.

| Saumos 2026 horizon | Real (ha) | Before (ha) | After, units committed (ha) | Deviation after |
| --- | ---: | ---: | ---: | ---: |
| 22/07 | 1,400 | 183 | 31 | −97.8 % |
| 23/07 | 4,800 | 12,161 | 381 | −92.1 % |
| 24/07 | 19,000 | 32,837 | 1,404 | −92.6 % |
| 25/07 | 32,000 | 42,465 | 1,984 | −93.8 % |
| 26/07 | 42,000 | 49,240 | 3,220 | −92.3 % |

- Overnight growth before: 13,245 ha, or 27 % of the final area.
- Overnight growth after: 19.4 % of the final area with units committed.
- Growth after, by regime: 2,594 ha by day against 626 ha overnight; the daily
  increments (31, 350, 1,023, 580 then 1,236 ha) no longer follow a monotonic
  quadratic growth.
- Effect of the units after: 6,653 ha without units against 3,220 ha with them,
  or 51.6 % of area avoided inside the model.
- Saumos 2022 / EMSR633: 8,381 ha simulated against 3,248 ha observed
  (+158.0 %), perimeter Jaccard 0.171.
- Saumos 2026: no publicly retrievable vector perimeter was found during this
  work, so the shape score stays unavailable.

Conclusion: the three structural criteria move the right way (night,
discontinuous growth, effect of the units), but absolute accuracy is not there.
The model very strongly under-predicts Saumos 2026 and still over-predicts
Saumos 2022; no calibration multiplier has been added to hide that gap.
