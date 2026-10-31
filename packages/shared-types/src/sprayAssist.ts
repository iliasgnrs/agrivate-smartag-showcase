/**
 * Spray Assist — day/hour spray-window assessment types and thresholds.
 *
 * This is the "which hour of this day can I spray?" layer. It is deliberately
 * separate from `./spray.ts`:
 *
 *  - `spray.ts` answers "is this single point right now OK?" (verdict
 *    good/moderate/bad) and is already consumed by the hourly carousel, the
 *    6-hour notice and the chatbot.
 *  - Spray Assist evaluates a WHOLE application (duration + rainfast window)
 *    across the before/during/after phases, so it needs its own levels
 *    (`past` included), per-phase factor verdicts and a confidence signal.
 *
 * Keeping them apart means new thresholds cannot silently change the verdicts
 * that existing screens already show.
 *
 * All messageKeys below are resolved by the web app through i18next
 * (`sprayAssist.*` in el.json/en.json). The API only ever returns keys, never
 * localised text.
 */

// ---------------------------------------------------------------------------
// Levels, factors, phases
// ---------------------------------------------------------------------------

/**
 * Hour suitability.
 * - `good` — spray freely;   `ok` — spray with caution
 * - `bad`  — do not spray;   `past` — hour already elapsed (no recommendation)
 * - `noData` — no forecast or station data for this hour. Never a fake verdict:
 *   the dial renders it as an empty slot instead of a misleading colour.
 */
export type SprayLevel = 'good' | 'ok' | 'bad' | 'past' | 'noData';

/** One icon per factor in the hour-detail modal: temp | wind | rain | plant. */
export type SprayFactor = 'temp' | 'wind' | 'rain' | 'plant';

/** Application phases: checks before, during and after the application. */
export type SprayPhase = 'before' | 'during' | 'after';

/** Severity ranking used to pick the worst factor/phase. Higher = worse. */
export const SPRAY_LEVEL_RANK: Record<SprayLevel, number> = {
  past: -1,
  noData: -1,
  good: 0,
  ok: 1,
  bad: 2,
};

// ---------------------------------------------------------------------------
// Per-hour result
// ---------------------------------------------------------------------------

/** Why a phase/factor is not `good`. */
export interface SprayFactorVerdict {
  level: SprayLevel;
  /** i18n key (`sprayAssist.messages.*`). Never user-facing text. */
  messageKey: string;
  /** Interpolation params for the message (e.g. `{ wind: 4.2, gust: 7.1 }`). */
  params?: Record<string, string | number>;
}

/** Blended conditions for the hour, after microclimate correction. */
export interface SprayHourMetrics {
  tempC: number;
  /** Rain accumulated in the hour, mm. */
  rainMm: number;
  /** Probability of precipitation for the hour, %. */
  rainProb: number;
  /** Sustained wind, m/s. */
  windMs: number;
  /** Gust, m/s. */
  gustMs: number;
  /** Wind FROM direction, degrees (meteorological). */
  windDirDeg: number;
  /** Relative humidity, %. */
  humidity: number;
  /** Wet-bulb depression, °C (see computeDeltaT). */
  deltaT: number;
}

/** Which sources contributed to an hour's metrics. */
export interface SprayHourSources {
  openMeteo: boolean;
  google: boolean;
  station: boolean;
}

export interface SprayHourSlot {
  /** 0–23 in Europe/Athens wall-clock time. */
  hour: number;
  level: SprayLevel;
  metrics: SprayHourMetrics;
  phases: Record<SprayPhase, Partial<Record<SprayFactor, SprayFactorVerdict>>>;
  confidence: 'high' | 'low';
  /**
   * Phase that produced the slot level. `null` for `past` slots and for
   * wholly `good` hours. Drives the modal's "worst factor" sentence.
   */
  worstPhase: SprayPhase | null;
  sources: SprayHourSources;
}

/** Response payload of GET /api/farms/:id/spray-assist. */
export interface SprayAssistDay {
  /** Requested day, YYYY-MM-DD (Europe/Athens). */
  date: string;
  /** Always 24 entries, hour 0 … 23. */
  slots: SprayHourSlot[];
  /** ISO timestamp of the underlying forecast/observation data. */
  updatedAt: string;
  /** Echo of the parameters the assessment was computed with. */
  durationH: number;
  rainfastH: number;
  /** Station the assessment belongs to. */
  stationId: string;
  /** True when at least one hour was corrected with station observations. */
  microclimateApplied: boolean;
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Two-band limit: `good` up to `good`, `ok` up to `ok`, `bad` beyond.
 * A `null` upper bound means "no upper limit" (e.g. minimum temperature bands
 * use the mirrored `{ good, ok }` reading where lower is better).
 */
export interface SprayBandLimit {
  /** Inclusive bound for `good`. */
  good: number;
  /** Inclusive bound for `ok`; beyond it the phase is `bad`. */
  ok: number;
}

export interface SprayThresholds {
  /** Sustained wind, m/s — higher is worse. */
  windMs: SprayBandLimit;
  /** Gusts, m/s — higher is worse. Separate (lower) bands than sustained. */
  gustMs: SprayBandLimit;
  /** Temperature, °C — outside [goodMin..goodMax] is `ok`, outside [okMin..okMax] is `bad`. */
  tempC: { goodMin: number; goodMax: number; okMin: number; okMax: number };
  /** Wet-bulb depression ΔT, °C — ideal band, `ok` band, else `bad`. */
  deltaT: { goodMin: number; goodMax: number; okMin: number; okMax: number };
  /** Rain that disqualifies the DURING phase: hourly `mm` and `prob` %. */
  rainDuring: { mm: SprayBandLimit; prob: SprayBandLimit };
  /** Rain that disqualifies the AFTER (rainfast) phase. */
  rainAfter: { mm: SprayBandLimit; prob: SprayBandLimit };
  /** Rain in the BEFORE look-back window that leaves foliage wet. */
  rainBefore: { mm: SprayBandLimit; prob: SprayBandLimit };
  /** How many hours before the slot to look back for wet foliage. */
  beforeLookbackH: number;
  /** Frost risk: temperatures at/below these values block the BEFORE phase. */
  frostC: { good: number; ok: number };
  /** Station/forecast disagreement (any metric, normalised) that forces `low` confidence. */
  disagreement: {
    /** Forecast-vs-forecast: m/s. */
    windMs: number;
    /** Forecast-vs-forecast: °C. */
    tempC: number;
    /** Forecast-vs-forecast: mm. */
    rainMm: number;
    /** Microclimate correction decays to zero over this many hours (3–6 typical). */
    decayHours: number;
  };
}

/**
 * Defaults derived from Greek label guidance and the spray-viability literature
 * already used in `spray.ts` (ΔT 2–8 °C, gusts as the drift driver).
 *
 * Override per product or crop by passing a partial object to
 * `mergeSprayThresholds()` — e.g. a translaminar fungicide tolerates more wind
 * than a herbicide, and some products have a 24 h rainfast interval.
 */
export const DEFAULT_SPRAY_THRESHOLDS: SprayThresholds = {
  windMs: { good: 3, ok: 5 },
  gustMs: { good: 5, ok: 7 },
  tempC: { goodMin: 10, goodMax: 28, okMin: 5, okMax: 32 },
  deltaT: { goodMin: 2, goodMax: 8, okMin: 1, okMax: 10 },
  rainDuring: { mm: { good: 0, ok: 0.2 }, prob: { good: 10, ok: 30 } },
  rainAfter: { mm: { good: 0, ok: 1 }, prob: { good: 20, ok: 40 } },
  rainBefore: { mm: { good: 0, ok: 0.5 }, prob: { good: 20, ok: 40 } },
  beforeLookbackH: 3,
  frostC: { good: 1, ok: 3 },
  disagreement: { windMs: 3, tempC: 3, rainMm: 1, decayHours: 6 },
};

export type SprayThresholdOverrides = {
  [K in keyof SprayThresholds]?: SprayThresholds[K] extends object
    ? Partial<SprayThresholds[K]>
    : never;
};

/** Shallow-merge per section so a caller can override one band and keep the rest. */
export function mergeSprayThresholds(
  base: SprayThresholds = DEFAULT_SPRAY_THRESHOLDS,
  overrides?: SprayThresholdOverrides,
): SprayThresholds {
  if (!overrides) return base;

  const merged: SprayThresholds = { ...base };
  for (const key of Object.keys(overrides) as (keyof SprayThresholds)[]) {
    const section = overrides[key];
    if (section === undefined) continue;
    // Each threshold section is a flat object of numbers/bands; merging one
    // level deep is enough and keeps callers from restating the whole section.
    Object.assign(merged[key] as object, section);
  }
  return merged;
}
