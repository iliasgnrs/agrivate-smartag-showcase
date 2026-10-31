/**
 * Spray Assist — pure rules engine.
 *
 * No I/O, no i18n runtime, no clock reads: everything the decision depends on
 * is passed in. That makes the whole day's assessment unit-testable and lets
 * the API service stay a thin orchestration layer over cached forecast data.
 *
 * Pipeline (see buildSprayAssist):
 *   1. mergeSources          — Open-Meteo vs Google, conservative pick
 *   2. blendMicroclimate     — station offset, decaying over N hours
 *   3. evaluatePhases        — before / during / after, worst factor wins
 */

import type { ForecastPoint, WeatherMeasurement } from './index.js';
import { computeDeltaT } from './spray.js';
import {
  DEFAULT_SPRAY_THRESHOLDS,
  SPRAY_LEVEL_RANK,
  type SprayAssistDay,
  type SprayBandLimit,
  type SprayFactor,
  type SprayFactorVerdict,
  type SprayHourMetrics,
  type SprayHourSlot,
  type SprayLevel,
  type SprayPhase,
  type SprayThresholds,
} from './sprayAssist.js';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SpraySourceForecast {
  /** Provider tag, e.g. 'open-meteo' / 'google'. Only used for diagnostics. */
  name: string;
  /** One point per hour, Athens wall-clock, for the requested day. */
  points: ForecastPoint[];
}

export interface BuildSprayAssistInput {
  /** Requested day, YYYY-MM-DD. */
  date: string;
  /** 'now' as an Athens wall-clock reference — an ISO string or a Date. */
  now: string | Date;
  /** Two independent forecast series (Open-Meteo + Google). One is enough. */
  sources: SpraySourceForecast[];
  /** Station observations covering the past hours of `date` (may be empty). */
  observations?: WeatherMeasurement[];
  /** Provider forecast for the CURRENT hour, used to derive the station offset. */
  currentForecast?: SprayHourMetrics | null;
  /** Station observation for the CURRENT hour, used to derive the offset. */
  currentObservation?: SprayHourMetrics | null;
  durationH?: number;
  rainfastH?: number;
  thresholds?: SprayThresholds;
  stationId?: string;
  updatedAt?: string;
}

const MERGE_TOLERANCE_PERCENT = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Athens wall-clock hour (0–23) of a timestamp. */
export function athensHourOf(value: string | Date): number {
  if (typeof value === 'string' && /T\d{2}:/.test(value) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) {
    // Open-Meteo returns a suffix-less Athens wall-clock string.
    return parseInt(value.slice(value.indexOf('T') + 1, value.indexOf('T') + 3), 10) % 24;
  }
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).format(new Date(value));
  return parseInt(h, 10) % 24;
}

/** YYYY-MM-DD in Athens terms. */
export function athensDateOf(value: string | Date): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(typeof value === 'string' ? value : '');
  if (m && typeof value === 'string' && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) return m[1];
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

/** 'now' as a comparable epoch-ms value (Athens wall-clock strings are re-read as Athens). */
function epochOf(value: string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) return new Date(value).getTime();
  // Wall-clock string without zone → treat as Athens local time.
  return new Date(`${value}-03:00`).getTime();
}

/** Band verdict for "lower is better" metrics (wind, gust, rain). */
export function bandLevel(value: number, band: SprayBandLimit): SprayLevel {
  if (value <= band.good) return 'good';
  if (value <= band.ok) return 'ok';
  return 'bad';
}

/** Band verdict for "inside the range is better" metrics (ΔT). */
export function rangeLevel(
  value: number,
  band: { goodMin: number; goodMax: number; okMin: number; okMax: number },
): SprayLevel {
  if (value >= band.goodMin && value <= band.goodMax) return 'good';
  if (value >= band.okMin && value <= band.okMax) return 'ok';
  return 'bad';
}

/** Temperature is special-cased: both a cold and a hot side message exist. */
function tempVerdict(tempC: number, th: SprayThresholds): SprayFactorVerdict {
  const { goodMin, goodMax, okMin, okMax } = th.tempC;
  const cold = tempC < goodMin;
  const hot = tempC > goodMax;

  if (!cold && !hot) {
    return { level: 'good', messageKey: 'sprayAssist.messages.tempGood', params: { temp: round1(tempC) } };
  }
  if (tempC >= okMin && tempC <= okMax) {
    return {
      level: 'ok',
      messageKey: cold ? 'sprayAssist.messages.tempColdOk' : 'sprayAssist.messages.tempHotOk',
      params: { temp: round1(tempC) },
    };
  }
  return {
    level: 'bad',
    messageKey: cold ? 'sprayAssist.messages.tempColdBad' : 'sprayAssist.messages.tempHotBad',
    params: { temp: round1(tempC) },
  };
}

function windVerdict(windMs: number, gustMs: number, th: SprayThresholds): SprayFactorVerdict {
  const wind = bandLevel(windMs, th.windMs);
  const gust = bandLevel(gustMs, th.gustMs);
  const level = worseLevel(wind, gust);

  const key =
    level === 'good'
      ? 'sprayAssist.messages.windGood'
      : level === 'ok'
        ? 'sprayAssist.messages.windOk'
        : gust === 'bad'
          ? 'sprayAssist.messages.gustBad'
          : 'sprayAssist.messages.windBad';

  return { level, messageKey: key, params: { wind: round1(windMs), gust: round1(gustMs) } };
}

function deltaTVerdict(deltaT: number, th: SprayThresholds): SprayFactorVerdict {
  const level = rangeLevel(deltaT, th.deltaT);
  const key =
    level === 'good'
      ? 'sprayAssist.messages.deltaTGood'
      : level === 'ok'
        ? 'sprayAssist.messages.deltaTOk'
        : 'sprayAssist.messages.deltaTBad';
  return { level, messageKey: key, params: { deltaT: round1(deltaT) } };
}

/**
 * Rain verdict: the worse of the accumulation band and the probability band,
 * so "0 mm but 85 % chance" is not treated as dry.
 */
function rainVerdict(
  rainMm: number,
  rainProb: number,
  band: { mm: SprayBandLimit; prob: SprayBandLimit },
  phase: SprayPhase,
): SprayFactorVerdict {
  const byMm = bandLevel(rainMm, band.mm);
  const byProb = bandLevel(rainProb, band.prob);
  const level = worseLevel(byMm, byProb);

  const key =
    level === 'good'
      ? 'sprayAssist.messages.rainGood'
      : `sprayAssist.messages.rain${phase === 'before' ? 'Before' : phase === 'after' ? 'After' : 'During'}${level === 'ok' ? 'Ok' : 'Bad'}`;

  return { level, messageKey: key, params: { mm: round1(rainMm), prob: Math.round(rainProb) } };
}

function worseLevel(a: SprayLevel, b: SprayLevel): SprayLevel {
  return SPRAY_LEVEL_RANK[a] >= SPRAY_LEVEL_RANK[b] ? a : b;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// 1. Conservative merge of two providers
// ---------------------------------------------------------------------------

const MERGE_FIELDS = ['tempC', 'rainMm', 'rainProb', 'windMs', 'gustMs', 'humidity'] as const;

/** Metrics where a HIGHER value is the more conservative (riskier) pick. */
const CONSERVATIVE_HIGH: ReadonlySet<(typeof MERGE_FIELDS)[number]> = new Set([
  'rainMm',
  'rainProb',
  'windMs',
  'gustMs',
]);
// Temperature and humidity are not monotonic: both extremes are risky, so the
// conservative pick is whichever value is FURTHER from the ideal band centre.
const HUMIDITY_IDEAL = 65;
const TEMP_IDEAL = 19;

function conservativePick(field: (typeof MERGE_FIELDS)[number], a: number, b: number): number {
  if (CONSERVATIVE_HIGH.has(field)) return Math.max(a, b);
  if (field === 'tempC') {
    return Math.abs(a - TEMP_IDEAL) >= Math.abs(b - TEMP_IDEAL) ? a : b;
  }
  return Math.abs(a - HUMIDITY_IDEAL) >= Math.abs(b - HUMIDITY_IDEAL) ? a : b;
}

function metricsFromPoint(point: ForecastPoint): SprayHourMetrics {
  const tempC = point.temperature_2m ?? 18;
  const humidity = point.relative_humidity_2m ?? 60;
  return {
    tempC,
    rainMm: point.precipitation ?? 0,
    rainProb: point.precipitation_probability ?? 0,
    windMs: point.wind_speed_10m ?? 0,
    gustMs: point.wind_gusts_10m ?? point.wind_speed_10m ?? 0,
    windDirDeg: point.wind_direction_10m ?? 0,
    humidity,
    deltaT: computeDeltaT(tempC, humidity) ?? 0,
  };
}

/** Map a raw station row to the same metric shape (wind is stored in Bft). */
export function metricsFromObservation(obs: WeatherMeasurement): SprayHourMetrics | null {
  const tempC = obs.temperature_out;
  const humidity = obs.humidity_out;
  if (tempC === undefined || humidity === undefined) return null;

  const windMs = obs.wind_speed !== undefined ? bftToMsLocal(obs.wind_speed) : 0;
  const gustMs = obs.wind_gust !== undefined ? bftToMsLocal(obs.wind_gust) : windMs;

  return {
    tempC,
    rainMm: obs.rain_rate ?? 0,
    rainProb: obs.rain_rate ? 100 : 0,
    windMs,
    gustMs,
    windDirDeg: obs.wind_direction ?? 0,
    humidity,
    deltaT: computeDeltaT(tempC, humidity) ?? 0,
  };
}

/** Mid-band m/s value of a Beaufort number (local copy to avoid a cycle). */
function bftToMsLocal(bft: number): number {
  const p = Math.pow(bft / 0.836, 2 / 3);
  return Math.round(p * 10) / 10;
}

export interface MergedHour {
  hour: number;
  metrics: SprayHourMetrics;
  confidence: 'high' | 'low';
  sources: { openMeteo: boolean; google: boolean; station: boolean };
}

/**
 * Merge provider series hour-by-hour.
 *
 * Two providers present → conservative pick per metric. When any metric
 * disagrees beyond the configured tolerance the hour is flagged 'low' and
 * downgraded one level later (during evaluation), per the spec.
 */
export function mergeSources(
  sources: SpraySourceForecast[],
  thresholds: SprayThresholds = DEFAULT_SPRAY_THRESHOLDS,
): MergedHour[] {
  const byHour = new Map<number, { name: string; metrics: SprayHourMetrics }[]>();

  for (const source of sources) {
    for (const point of source.points) {
      const hour = athensHourOf(point.time);
      const list = byHour.get(hour) ?? [];
      list.push({ name: source.name, metrics: metricsFromPoint(point) });
      byHour.set(hour, list);
    }
  }

  const hours: MergedHour[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const candidates = byHour.get(hour) ?? [];
    if (candidates.length === 0) {
      // No data for this hour — flag it and let evaluation fail safe.
      hours.push({
        hour,
        metrics: { ...NO_DATA_METRICS },
        confidence: 'low',
        sources: { openMeteo: false, google: false, station: false },
      });
      continue;
    }

    const metrics = { ...candidates[0].metrics };
    let disagree = false;

    for (let i = 1; i < candidates.length; i++) {
      const other = candidates[i].metrics;
      for (const field of MERGE_FIELDS) {
        const a = metrics[field];
        const b = other[field];
        metrics[field] = conservativePick(field, a, b);
        const tolerance =
          field === 'windMs' || field === 'gustMs'
            ? thresholds.disagreement.windMs
            : field === 'tempC'
              ? thresholds.disagreement.tempC
              : field === 'rainMm'
                ? thresholds.disagreement.rainMm
                : // rainProb (%) and humidity (%) — a wide gap means real divergence
                  MERGE_TOLERANCE_PERCENT;
        if (Math.abs(a - b) > tolerance) disagree = true;
      }
      // Direction: keep the first provider's value (not a monotonic quantity).
    }

    metrics.deltaT = computeDeltaT(metrics.tempC, metrics.humidity) ?? 0;

    hours.push({
      hour,
      metrics,
      confidence: disagree ? 'low' : 'high',
      sources: {
        openMeteo: candidates.some((c) => /open-?meteo/i.test(c.name)),
        google: candidates.some((c) => /google/i.test(c.name)),
        station: false,
      },
    });
  }

  return hours;
}

// ---------------------------------------------------------------------------
// 2. Microclimate blending
// ---------------------------------------------------------------------------

/**
 * Linear decay weight for the station correction.
 *
 * The station tells us how wrong the model is RIGHT NOW. That error is fully
 * trusted at the current hour and fades linearly to zero at `decayHours`, so
 * an hour 6 h out carries none of it (the model's own dynamics take over).
 */
export function decayWeight(hoursAhead: number, decayHours: number): number {
  if (decayHours <= 0) return 0;
  if (hoursAhead <= 0) return 1;
  if (hoursAhead >= decayHours) return 0;
  return 1 - hoursAhead / decayHours;
}

export interface BlendContext {
  /** obs − forecast at the current hour, per metric. */
  offset: Partial<SprayHourMetrics>;
  /** Athens hour whose forecast is "now" (correction is anchored here). */
  anchorHour: number;
  decayHours: number;
}

/**
 * Apply the station offset to a forecast hour. Past hours and hours with no
 * forecast are replaced by the station's own observation.
 */
export function blendHour(
  hour: MergedHour,
  ctx: BlendContext | null,
  observation: SprayHourMetrics | null,
  isPast: boolean,
): MergedHour {
  if (isPast) {
    if (!observation) return hour;
    return {
      ...hour,
      metrics: observation,
      sources: { ...hour.sources, station: true },
    };
  }
  if (!ctx) return hour;

  const hoursAhead = hour.hour - ctx.anchorHour;
  const weight = decayWeight(hoursAhead, ctx.decayHours);
  if (weight <= 0) return hour;

  const m = { ...hour.metrics };
  const apply = (field: 'tempC' | 'windMs' | 'gustMs' | 'rainProb' | 'rainMm') => {
    const delta = ctx.offset[field];
    if (delta === undefined) return;
    if (field === 'rainProb') {
      m.rainProb = clamp(m.rainProb + delta * weight, 0, 100);
    } else if (field === 'rainMm' || field === 'windMs' || field === 'gustMs') {
      m[field] = Math.max(0, round1(m[field] + delta * weight));
    } else {
      m.tempC = round1(m.tempC + delta * weight);
    }
  };
  apply('tempC');
  apply('windMs');
  apply('gustMs');
  apply('rainProb');

  // Humidity follows temperature: warmer air (relative to forecast) is drier.
  const tempDelta = ctx.offset.tempC;
  if (tempDelta !== undefined) {
    m.humidity = clamp(Math.round(m.humidity - tempDelta * weight * 3), 1, 100);
  }
  m.deltaT = computeDeltaT(m.tempC, m.humidity) ?? 0;

  return { ...hour, metrics: m, sources: { ...hour.sources, station: true } };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Difference between station and forecast for each metric we correct. */
export function computeBlendOffset(
  forecast: SprayHourMetrics | null | undefined,
  observation: SprayHourMetrics | null | undefined,
): Partial<SprayHourMetrics> | null {
  if (!forecast || !observation) return null;
  const offset: Partial<SprayHourMetrics> = {};
  const keys = ['tempC', 'windMs', 'gustMs', 'rainProb', 'rainMm'] as const;
  for (const key of keys) {
    const f = forecast[key];
    const o = observation[key];
    if (Number.isFinite(f) && Number.isFinite(o)) offset[key] = round1(o - f);
  }
  // Sanity clamp: a 20 °C "correction" means one of the two series is broken.
  if (offset.tempC !== undefined) offset.tempC = clamp(offset.tempC, -8, 8);
  return Object.keys(offset).length > 0 ? offset : null;
}

// ---------------------------------------------------------------------------
// 3. Phase evaluation
// ---------------------------------------------------------------------------

/** Metrics placeholder for an hour with no source data at all. */
const NO_DATA_METRICS: SprayHourMetrics = {
  tempC: 18,
  rainMm: 0,
  rainProb: 0,
  windMs: 0,
  gustMs: 0,
  windDirDeg: 0,
  humidity: 60,
  deltaT: 0,
};

/** True when no provider/station supplied this hour. */
function hasData(hour: MergedHour): boolean {
  return hour.sources.openMeteo || hour.sources.google || hour.sources.station;
}

export interface EvaluateDayOptions {
  durationH: number;
  rainfastH: number;
  thresholds: SprayThresholds;
  /** Slot index of "now"; earlier hours become `past`. */
  currentHour: number;
}

function buildDuring(hours: MergedHour[], start: number, durationH: number, th: SprayThresholds) {
  const during: Partial<Record<SprayFactor, SprayFactorVerdict>> = {};
  // Only hours that actually have data may disqualify the window; a missing
  // hour carries the placeholder metrics and would otherwise read as calm.
  const window = hours.slice(start, Math.min(24, start + durationH)).filter(hasData);
  if (window.length === 0) return during;

  // Worst over the application window: an hour of calm does not rescue a
  // window that has 8 m/s gusts two hours in.
  during.temp = worstOf(window.map((h) => tempVerdict(h.metrics.tempC, th)));
  during.wind = worstOf(window.map((h) => windVerdict(h.metrics.windMs, h.metrics.gustMs, th)));
  during.plant = worstOf(window.map((h) => deltaTVerdict(h.metrics.deltaT, th)));
  during.rain = worstOf(window.map((h) => rainVerdict(h.metrics.rainMm, h.metrics.rainProb, th.rainDuring, 'during')));
  return during;
}

function buildBefore(hours: MergedHour[], start: number, th: SprayThresholds) {
  const before: Partial<Record<SprayFactor, SprayFactorVerdict>> = {};
  const from = Math.max(0, start - th.beforeLookbackH);
  const lookback = hours.slice(from, start);
  const current = hours[start];

  // Wet foliage / recent rain.
  if (lookback.length === 0) {
    before.rain = { level: 'good', messageKey: 'sprayAssist.messages.rainGood', params: { mm: 0, prob: 0 } };
  } else {
    before.rain = worstOf(
      lookback.map((h) => rainVerdict(h.metrics.rainMm, h.metrics.rainProb, th.rainBefore, 'before')),
    );
  }

  // Foliage still wet at the slot itself is a before-application condition.
  if (current && current.metrics.rainMm > th.rainBefore.mm.good) {
    const wet = rainVerdict(current.metrics.rainMm, current.metrics.rainProb, th.rainBefore, 'before');
    before.rain = worseVerdict(before.rain, wet);
  }

  // Frost risk: the coldest temperature in the look-back (or the slot itself).
  const temps = [...lookback, current].filter(Boolean).map((h) => h.metrics.tempC);
  const coldest = temps.length ? Math.min(...temps) : th.frostC.good + 1;
  const frostLevel: SprayLevel =
    coldest <= th.frostC.good ? 'bad' : coldest <= th.frostC.ok ? 'ok' : 'good';
  before.temp = {
    level: frostLevel,
    messageKey:
      frostLevel === 'good'
        ? 'sprayAssist.messages.frostNone'
        : frostLevel === 'ok'
          ? 'sprayAssist.messages.frostOk'
          : 'sprayAssist.messages.frostBad',
    params: { temp: round1(coldest) },
  };

  // No wind/plant requirements before application — spraying has not started.
  return before;
}

function buildAfter(hours: MergedHour[], start: number, durationH: number, rainfastH: number, th: SprayThresholds) {
  const after: Partial<Record<SprayFactor, SprayFactorVerdict>> = {};
  const end = start + durationH; // application ends at this hour index
  const window = hours.slice(end, Math.min(24, end + rainfastH)).filter(hasData);

  if (window.length === 0) {
    after.rain = { level: 'good', messageKey: 'sprayAssist.messages.rainGood', params: { mm: 0, prob: 0 } };
  } else {
    after.rain = worstOf(window.map((h) => rainVerdict(h.metrics.rainMm, h.metrics.rainProb, th.rainAfter, 'after')));
  }
  return after;
}

function worstOf(verdicts: SprayFactorVerdict[]): SprayFactorVerdict {
  return verdicts.reduce((acc, v) => (SPRAY_LEVEL_RANK[v.level] > SPRAY_LEVEL_RANK[acc.level] ? v : acc));
}

function worseVerdict(
  a: SprayFactorVerdict | undefined,
  b: SprayFactorVerdict,
): SprayFactorVerdict {
  if (!a) return b;
  return SPRAY_LEVEL_RANK[b.level] > SPRAY_LEVEL_RANK[a.level] ? b : a;
}

/**
 * Evaluate the three phases for every hour and derive the slot level.
 *
 * The slot level is the WORST level across phases/factors — one disqualifying
 * factor is enough, which is how an agronomist reasons about a window.
 */
export function evaluatePhases(hours: MergedHour[], opts: EvaluateDayOptions): SprayHourSlot[] {
  const { durationH, rainfastH, thresholds, currentHour } = opts;

  return hours.map((hour) => {
    const isPast = hour.hour < currentHour;
    const isNoData = !hasData(hour);
    const assessable = !isPast && !isNoData;
    const phases: SprayHourSlot['phases'] = {
      before: assessable ? buildBefore(hours, hour.hour, thresholds) : {},
      during: assessable ? buildDuring(hours, hour.hour, durationH, thresholds) : {},
      after: assessable ? buildAfter(hours, hour.hour, durationH, rainfastH, thresholds) : {},
    };

    if (isNoData) {
      return {
        hour: hour.hour,
        level: 'noData' as const,
        metrics: hour.metrics,
        phases,
        confidence: 'low' as const,
        worstPhase: null,
        sources: hour.sources,
      };
    }

    if (isPast) {
      return {
        hour: hour.hour,
        level: 'past' as const,
        metrics: hour.metrics,
        phases,
        confidence: hour.confidence,
        worstPhase: null,
        sources: hour.sources,
      };
    }

    let worst: { phase: SprayPhase; factor: SprayFactor; verdict: SprayFactorVerdict } | null = null;
    for (const phase of ['before', 'during', 'after'] as SprayPhase[]) {
      for (const [factor, verdict] of Object.entries(phases[phase])) {
        if (!verdict) continue;
        if (!worst || SPRAY_LEVEL_RANK[verdict.level] > SPRAY_LEVEL_RANK[worst.verdict.level]) {
          worst = { phase, factor: factor as SprayFactor, verdict };
        }
      }
    }

    let level: SprayLevel = worst?.verdict.level ?? 'good';

    // Disagreeing providers → downgrade one level (spec step 1).
    if (hour.confidence === 'low') {
      if (level === 'good') level = 'ok';
      else if (level === 'ok') level = 'bad';
    }

    return {
      hour: hour.hour,
      level,
      metrics: hour.metrics,
      phases,
      confidence: hour.confidence,
      worstPhase: level === 'good' ? null : (worst?.phase ?? null),
      sources: hour.sources,
    };
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Build a full 24-hour assessment for one day.
 *
 * `observations` must cover (at least) the elapsed hours of `date`; providers
 * must return that day's hourly points. Hours with no provider data are
 * flagged low-confidence and treated conservatively by evaluation.
 */
export function buildSprayAssist(input: BuildSprayAssistInput): SprayAssistDay {
  const thresholds = input.thresholds ?? DEFAULT_SPRAY_THRESHOLDS;
  const durationH = Math.max(1, Math.round(input.durationH ?? 1));
  const rainfastH = Math.max(0, Math.round(input.rainfastH ?? 3));

  const nowEpoch = epochOf(input.now);
  const today = athensDateOf(input.now);
  const isToday = today === input.date;

  const merged = mergeSources(input.sources, thresholds);

  // Last elapsed hour of the requested day (inclusive).
  const currentHour = isToday
    ? athensHourOf(input.now)
    : input.date < today
      ? 24 // whole day is in the past
      : -1; // whole day is in the future

  const obsByHour = new Map<number, SprayHourMetrics>();
  for (const obs of input.observations ?? []) {
    const metrics = metricsFromObservation(obs);
    if (metrics) obsByHour.set(athensHourOf(obs.time), metrics);
  }

  // The correction is anchored on "now", so it is only meaningful for today.
  // On another day the caller's current-forecast/observation pair describes a
  // different date and applying it would invent a microclimate offset.
  const offset = isToday
    ? computeBlendOffset(input.currentForecast, input.currentObservation)
    : null;
  const ctx: BlendContext | null = offset
    ? { offset, anchorHour: athensHourOf(input.now), decayHours: thresholds.disagreement.decayHours }
    : null;

  const blended = merged.map((hour) =>
    blendHour(hour, ctx, obsByHour.get(hour.hour) ?? null, isToday && hour.hour < currentHour),
  );

  const slots = evaluatePhases(blended, { durationH, rainfastH, thresholds, currentHour });

  return {
    date: input.date,
    slots,
    updatedAt: input.updatedAt ?? new Date(nowEpoch).toISOString(),
    durationH,
    rainfastH,
    stationId: input.stationId ?? '',
    microclimateApplied: ctx !== null || obsByHour.size > 0,
  };
}

/** Exported for the API layer: earliest hour that still has forecast data. */
export function firstForecastHour(day: SprayAssistDay): number | null {
  const slot = day.slots.find((s) => s.sources.openMeteo || s.sources.google);
  return slot ? slot.hour : null;
}
