/**
 * Wind unit conversions — Beaufort is the canonical storage/display unit.
 *
 * `weather_measurements.wind_speed` / `wind_gust` hold Beaufort (Bft) values.
 * Station APIs report m/s (wind_speed_unitid=10) or km/h, so ingestion must
 * convert with {@link windToBft}. Code that needs a physical speed — the
 * FAO-56 ETo formula, the Windy upload — converts back with {@link bftToMs}.
 */

/** Upper bounds (m/s) of Beaufort force 0–11; force 12 is open-ended. */
const BEAUFORT_UPPER_MS = [
  0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7,
];

/**
 * Convert wind speed in m/s to the Beaufort scale (0–12).
 * Uses the standard WMO Beaufort wind-speed thresholds.
 */
export function msToBft(ms: number): number {
  for (let force = 0; force < BEAUFORT_UPPER_MS.length; force++) {
    if (ms < BEAUFORT_UPPER_MS[force]) return force;
  }
  return 12;
}

/**
 * Convert a Beaufort force back to a representative wind speed in m/s.
 *
 * Returns the midpoint of the force's m/s band, which is the least biased
 * single estimate when averaging. Force 12 returns the lower bound (32.7).
 */
export function bftToMs(bft: number): number {
  if (!Number.isFinite(bft)) return 0;
  const force = Math.min(Math.max(Math.round(bft), 0), 12);

  const lower = force === 0 ? 0 : BEAUFORT_UPPER_MS[force - 1];
  const upper = BEAUFORT_UPPER_MS[force];
  if (upper === undefined) return lower; // force 12

  return (lower + upper) / 2;
}

/**
 * Convert a wind speed to Bft given its source unit.
 * Handles m/s, km/h, mph, knots and values already in Bft/Beaufort.
 *
 * Beaufort input is passed through untouched rather than rounded: Ecowitt
 * already returns Beaufort for `wind_speed_unitid=10` and may preserve a
 * decimal, so rounding would silently drop a force.
 */
export function windToBft(value: number, unit: string): number {
  const rawUnit = (unit || '').toLowerCase();

  if (rawUnit.includes('bft') || rawUnit.includes('beaufort') || rawUnit === 'b') {
    return value; // already Beaufort
  }
  if (rawUnit.includes('km')) {
    return msToBft(value / 3.6);
  }
  if (rawUnit.includes('mph')) {
    return msToBft(value * 0.44704);
  }
  if (rawUnit.includes('knot') || rawUnit === 'kt') {
    return msToBft(value * 0.514444);
  }
  // m/s (and unknown) — assume m/s
  return msToBft(value);
}
