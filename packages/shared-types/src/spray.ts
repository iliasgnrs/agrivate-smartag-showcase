/**
 * Spraying suitability — agronomic decision helper.
 *
 * Centralizes the "can I spray right now?" judgement so every surface
 * (hourly carousel, 6-hour notice, chatbot) uses identical rules.
 *
 * WHY THIS EXISTS (bug fixed 2026-09-26)
 * --------------------------------------
 * The original frontend check was wind-only one-sided:
 *
 *   good  → windBft <= 3 AND 40 <= humidity <= 80 AND 10 <= temp <= 30
 *   bad   → windBft > 4  OR humidity < 30 OR humidity > 85 OR temp < 5 OR temp > 35
 *
 * A hot, dry, still afternoon (e.g. 35 °C, 25 % RH, 1 Bft — a very common
 * Greek summer afternoon) satisfied NONE of the `bad` tests (35 is not > 35,
 * 25 is not < 30) so it fell through to whatever the first branch decided.
 * Depending on ordering this surfaced as "favorable", which is agronomically
 * wrong: at 35 °C the droplet evaporates before it reaches the target and
 * phytotoxicity risk is high, and at < 30 % RH you get drift + poor uptake.
 *
 * The fix is to make heat and dryness FIRST-CLASS disqualifiers rather than
 * boundary tests that a value can slip between, and to score the whole
 * window instead of a single point.
 */

// Beaufort conversion lives in ./wind.ts so there is a single WMO table.
import { msToBft } from './wind.js';

export { msToBft } from './wind.js';

export type SprayVerdict = 'good' | 'moderate' | 'bad';

/** A single identified reason why a condition degraded spray suitability. */
export interface SprayLimiter {
  factor: 'wind' | 'humidity_low' | 'humidity_high' | 'temp_low' | 'temp_high' | 'delta_t' | 'rain';
  /** i18n key under `spray.` namespace, or null for purely informational limits. */
  messageKey: string;
  params?: Record<string, string | number>;
}

export interface SprayAssessment {
  verdict: SprayVerdict;
  /** Ordered worst-first reasons. Empty when verdict === 'good'. */
  limiters: SprayLimiter[];
  /** Delta-T in °C, or null when temperature/humidity were unavailable. */
  deltaT: number | null;
  /** Beaufort number used for the wind decision. */
  windBft: number;
}

export interface SprayInput {
  /** Sustained wind speed in m/s. */
  windSpeedMs: number;
  /** Relative humidity in %. */
  humidity: number;
  /** Air temperature in °C. */
  temp: number;
  /** Optional rain rate/accumulation in mm/h — spraying in rain is pointless. */
  precipitation?: number;
  /**
   * Use gusts instead of sustained wind when deciding (recommended for
   * planning a window; gusts are what actually cause drift).
   */
  windGustMs?: number;
}

// ---------------------------------------------------------------------------
// Thresholds — single source of truth
// ---------------------------------------------------------------------------

/**
 * Delta-T (wet-bulb depression) is the standard spray-viability index in
 * plant protection. Below 2 °C the air is near saturation and droplets barely
 * evaporate (runoff, poor coverage, elevated disease risk). Above 8 °C the
 * droplets evaporate too fast for reliable deposition and phytotoxicity risk
 * climbs. The 2–8 °C band is the internationally recommended spraying window.
 */
export const DELTA_T_MIN = 2;
export const DELTA_T_MAX = 8;

/** Hard limits: exceeding ANY of these is an immediate 'bad'. */
const HARD = {
  windBft: 4,        // > 4 Bft sustained → drift, off-target loss
  humidityLow: 30,   // < 30 % → poor uptake, droplet evaporation
  humidityHigh: 90,  // > 90 % → runoff + disease pressure
  tempLow: 5,        // < 5 °C → poor translocation, frost risk
  tempHigh: 32,      // >= 32 °C → evaporation + phytotoxicity
  deltaTHigh: 10,    // > 10 °C → severe evaporation
} as const;

/** Soft limits: exceeding ANY of these caps the verdict at 'moderate'. */
const SOFT = {
  windBft: 3,
  humidityLow: 45,
  humidityHigh: 85,
  tempLow: 10,
  tempHigh: 28,
  deltaTLow: DELTA_T_MIN,
  deltaTHigh: DELTA_T_MAX,
} as const;

// ---------------------------------------------------------------------------
// Delta-T
// ---------------------------------------------------------------------------

/**
 * Wet-bulb depression (ΔT) in °C from dry-bulb temperature and relative
 * humidity, using the WMO/Stull approximation for wet-bulb temperature.
 *
 * Returns null when inputs are unusable.
 */
export function computeDeltaT(tempC: number, humidity: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(humidity)) return null;
  if (humidity <= 0 || humidity > 100) return null;

  const rh = humidity;
  // Stull (2011) empirical wet-bulb temperature — accurate to ~0.3 °C for
  // the -20…+50 °C / 5…99 % RH range that matters for spraying decisions.
  const tw =
    tempC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tempC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035;

  return Math.round((tempC - tw) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * Assess spray suitability for a single forecast point.
 *
 * The verdict is the WORST of all individual factor verdicts — a single
 * disqualifying factor is enough to fail the window, which is how an
 * agronomist actually reasons about it.
 */
export function assessSprayConditions(input: SprayInput): SprayAssessment {
  const { humidity, temp } = input;
  // Gusts are the physically meaningful driver of drift; fall back to
  // sustained wind only when gusts are unavailable.
  const decisionWindMs =
    input.windGustMs !== undefined && Number.isFinite(input.windGustMs)
      ? input.windGustMs
      : input.windSpeedMs;
  const windBft = msToBft(decisionWindMs || 0);
  const deltaT = computeDeltaT(temp, humidity);

  const limiters: SprayLimiter[] = [];
  let verdict: SprayVerdict = 'good';
  const fail = (v: SprayVerdict) => {
    if (v === 'bad') verdict = 'bad';
    else if (v === 'moderate' && verdict === 'good') verdict = 'moderate';
  };

  // ── Rain: never spray into rain ───────────────────────────────────────
  if (input.precipitation !== undefined && input.precipitation >= 0.5) {
    limiters.push({ factor: 'rain', messageKey: 'spray.limiter.rain', params: { mm: input.precipitation.toFixed(1) } });
    fail('bad');
  }

  // ── Wind ──────────────────────────────────────────────────────────────
  if (windBft > HARD.windBft) {
    limiters.push({ factor: 'wind', messageKey: 'spray.limiter.windBad', params: { bft: windBft } });
    fail('bad');
  } else if (windBft > SOFT.windBft) {
    limiters.push({ factor: 'wind', messageKey: 'spray.limiter.windModerate', params: { bft: windBft } });
    fail('moderate');
  }

  // ── Temperature (evaluated on BOTH ends, hot first for this climate) ──
  if (temp >= HARD.tempHigh) {
    limiters.push({ factor: 'temp_high', messageKey: 'spray.limiter.tempHighBad', params: { temp: Math.round(temp) } });
    fail('bad');
  } else if (temp > SOFT.tempHigh) {
    limiters.push({ factor: 'temp_high', messageKey: 'spray.limiter.tempHighModerate', params: { temp: Math.round(temp) } });
    fail('moderate');
  }
  if (temp <= HARD.tempLow) {
    limiters.push({ factor: 'temp_low', messageKey: 'spray.limiter.tempLowBad', params: { temp: Math.round(temp) } });
    fail('bad');
  } else if (temp < SOFT.tempLow) {
    limiters.push({ factor: 'temp_low', messageKey: 'spray.limiter.tempLowModerate', params: { temp: Math.round(temp) } });
    fail('moderate');
  }

  // ── Humidity ──────────────────────────────────────────────────────────
  if (humidity < HARD.humidityLow) {
    limiters.push({ factor: 'humidity_low', messageKey: 'spray.limiter.dryBad', params: { rh: Math.round(humidity) } });
    fail('bad');
  } else if (humidity < SOFT.humidityLow) {
    limiters.push({ factor: 'humidity_low', messageKey: 'spray.limiter.dryModerate', params: { rh: Math.round(humidity) } });
    fail('moderate');
  }
  if (humidity > HARD.humidityHigh) {
    limiters.push({ factor: 'humidity_high', messageKey: 'spray.limiter.humidBad', params: { rh: Math.round(humidity) } });
    fail('bad');
  } else if (humidity > SOFT.humidityHigh) {
    limiters.push({ factor: 'humidity_high', messageKey: 'spray.limiter.humidModerate', params: { rh: Math.round(humidity) } });
    fail('moderate');
  }

  // ── Delta-T ───────────────────────────────────────────────────────────
  if (deltaT !== null) {
    if (deltaT > HARD.deltaTHigh) {
      limiters.push({ factor: 'delta_t', messageKey: 'spray.limiter.deltaTHighBad', params: { deltaT: deltaT.toFixed(1) } });
      fail('bad');
    } else if (deltaT > SOFT.deltaTHigh) {
      limiters.push({ factor: 'delta_t', messageKey: 'spray.limiter.deltaTHighModerate', params: { deltaT: deltaT.toFixed(1) } });
      fail('moderate');
    }
    // Below the lower bound the air is too close to saturation.
    if (deltaT < SOFT.deltaTLow) {
      const isBad = deltaT < 1;
      limiters.push({
        factor: 'delta_t',
        messageKey: isBad ? 'spray.limiter.deltaTLowBad' : 'spray.limiter.deltaTLowModerate',
        params: { deltaT: deltaT.toFixed(1) },
      });
      fail(isBad ? 'bad' : 'moderate');
    }
  }

  // Deduplicate by messageKey, worst-first ordering driven by severity.
  const seen = new Set<string>();
  const deduped = limiters.filter((l) => {
    if (seen.has(l.messageKey)) return false;
    seen.add(l.messageKey);
    return true;
  });

  return { verdict, limiters: deduped, deltaT, windBft };
}

/** Tailwind background class for a verdict dot. */
export function sprayVerdictColor(verdict: SprayVerdict): string {
  if (verdict === 'bad') return 'bg-red-500';
  if (verdict === 'moderate') return 'bg-orange-500';
  return 'bg-green-500';
}

/**
 * Summarize a list of hourly assessments into the best contiguous window.
 * Returns the index range of the longest run of 'good' hours, or null.
 */
export function bestSprayWindow(
  points: SprayInput[],
): { startIndex: number; endIndex: number; length: number } | null {
  let best: { startIndex: number; endIndex: number; length: number } | null = null;
  let runStart = -1;

  for (let i = 0; i < points.length; i++) {
    const { verdict } = assessSprayConditions(points[i]);
    if (verdict === 'good') {
      if (runStart === -1) runStart = i;
      const length = i - runStart + 1;
      if (!best || length > best.length) {
        best = { startIndex: runStart, endIndex: i, length };
      }
    } else {
      runStart = -1;
    }
  }

  return best;
}
