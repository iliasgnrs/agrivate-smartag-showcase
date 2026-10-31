import { describe, expect, it } from 'vitest';
import type { ForecastPoint, WeatherMeasurement } from '../index.js';
import {
  DEFAULT_SPRAY_THRESHOLDS,
  mergeSprayThresholds,
  type SprayThresholds,
} from '../sprayAssist.js';
import {
  bandLevel,
  blendHour,
  buildSprayAssist,
  computeBlendOffset,
  decayWeight,
  evaluatePhases,
  mergeSources,
  metricsFromObservation,
  rangeLevel,
  type MergedHour,
  type SprayHourMetrics,
  type SpraySourceForecast,
} from '../sprayAssistEngine.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One hour point at `hour` on 2026-10-24, Athens wall clock. */
function point(hour: number, overrides: Partial<ForecastPoint> = {}): ForecastPoint {
  const hh = String(hour).padStart(2, '0');
  return {
    time: `2026-10-24T${hh}:00`,
    tenant_id: 't1',
    latitude: 40.6,
    longitude: 22.9,
    temperature_2m: 20,
    relative_humidity_2m: 60,
    precipitation: 0,
    precipitation_probability: 5,
    wind_speed_10m: 2,
    wind_gusts_10m: 4,
    wind_direction_10m: 200,
    model: 'test',
    forecast_hour: hour,
    ...overrides,
  };
}

function day(overrides: (hour: number) => Partial<ForecastPoint> = () => ({})): ForecastPoint[] {
  return Array.from({ length: 24 }, (_, h) => point(h, overrides(h)));
}

function merged(hour: number, metrics: Partial<SprayHourMetrics> = {}): MergedHour {
  return {
    hour,
    metrics: {
      tempC: 20,
      rainMm: 0,
      rainProb: 5,
      windMs: 2,
      gustMs: 4,
      windDirDeg: 200,
      humidity: 60,
      deltaT: 6,
      ...metrics,
    },
    confidence: 'high',
    sources: { openMeteo: true, google: true, station: false },
  };
}

/** Pad sparse hours into a dense 0–23 series, as mergeSources() emits. */
function dense(sparse: MergedHour[]): MergedHour[] {
  const byHour = new Map(sparse.map((h) => [h.hour, h]));
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? merged(hour));
}

const METRICS: SprayHourMetrics = {  tempC: 20,
  rainMm: 0,
  rainProb: 10,
  windMs: 3,
  gustMs: 5,
  windDirDeg: 200,
  humidity: 60,
  deltaT: 6,
};

const OPTS = {
  durationH: 1,
  rainfastH: 3,
  thresholds: DEFAULT_SPRAY_THRESHOLDS,
  currentHour: 0,
};

// ---------------------------------------------------------------------------
// Band / range helpers
// ---------------------------------------------------------------------------

describe('band thresholds', () => {
  it('classifies wind on the good / ok / bad boundaries', () => {
    const band = DEFAULT_SPRAY_THRESHOLDS.windMs; // good <= 3, ok <= 5
    expect(bandLevel(0, band)).toBe('good');
    expect(bandLevel(3, band)).toBe('good');
    expect(bandLevel(3.1, band)).toBe('ok');
    expect(bandLevel(5, band)).toBe('ok');
    expect(bandLevel(5.1, band)).toBe('bad');
  });

  it('uses separate, lower thresholds for gusts than sustained wind', () => {
    const gust = DEFAULT_SPRAY_THRESHOLDS.gustMs; // good <= 5, ok <= 7
    expect(bandLevel(5, gust)).toBe('good');
    expect(bandLevel(6, gust)).toBe('ok');
    expect(bandLevel(7.1, gust)).toBe('bad');
  });

  it('treats a gust above its bad band as bad even when sustained wind is fine', () => {
    const hours = day(() => ({ wind_speed_10m: 1.5, wind_gusts_10m: 9 }));
    const slots = evaluatePhases(mergeSources([{ name: 'open-meteo', points: hours }]), OPTS);
    expect(slots[0].phases.during.wind?.level).toBe('bad');
    expect(slots[0].level).toBe('bad');
  });
});

describe('Delta T', () => {
  it('marks 2–8 °C as good and outside the ok band as bad', () => {
    const band = DEFAULT_SPRAY_THRESHOLDS.deltaT;
    expect(rangeLevel(2, band)).toBe('good');
    expect(rangeLevel(8, band)).toBe('good');
    expect(rangeLevel(9, band)).toBe('ok');
    expect(rangeLevel(11, band)).toBe('bad');
    expect(rangeLevel(0.5, band)).toBe('bad');
  });

  it('flags a saturated, still hour through the plant factor', () => {
    const slots = evaluatePhases([merged(0, { tempC: 20, humidity: 100, deltaT: 0.4 })], OPTS);
    expect(slots[0].phases.during.plant?.messageKey).toBe('sprayAssist.messages.deltaTBad');
    expect(slots[0].level).toBe('bad');
  });
});

// ---------------------------------------------------------------------------
// Conservative merge of the two providers
// ---------------------------------------------------------------------------

describe('mergeSources', () => {
  it('takes the more conservative value per metric', () => {
    const openMeteo: SpraySourceForecast = {
      name: 'open-meteo',
      points: [point(10, { wind_speed_10m: 2, precipitation: 0.2 })],
    };
    const google: SpraySourceForecast = {
      name: 'google',
      points: [point(10, { wind_speed_10m: 4.5, precipitation: 0.9 })],
    };

    const hours = mergeSources([openMeteo, google]);
    expect(hours[10].metrics.windMs).toBe(4.5);
    expect(hours[10].metrics.rainMm).toBe(0.9);
    expect(hours[10].sources.openMeteo).toBe(true);
    expect(hours[10].sources.google).toBe(true);
  });

  it('downgrades the slot and marks low confidence when providers disagree strongly', () => {
    const agree = mergeSources([
      { name: 'open-meteo', points: [point(9)] },
      { name: 'google', points: [point(9, { temperature_2m: 20.5 })] },
    ]);
    expect(agree[9].confidence).toBe('high');

    const disagree = mergeSources([
      { name: 'open-meteo', points: [point(9)] },
      { name: 'google', points: [point(9, { wind_speed_10m: 9 })] },
    ]);
    expect(disagree[9].confidence).toBe('low');
  });

  it('downgrades a good hour to ok when confidence is low', () => {
    const slots = evaluatePhases([merged(0), merged(1)], OPTS);
    const lowConfidence = evaluatePhases(
      [merged(0), merged(1)].map((h) => ({ ...h, confidence: 'low' as const })),
      OPTS,
    );
    expect(slots[0].level).toBe('good');
    expect(lowConfidence[0].level).toBe('ok');
  });

  it('always returns 24 hours, flagging hours without data as low confidence', () => {
    const hours = mergeSources([{ name: 'open-meteo', points: [point(3)] }]);
    expect(hours).toHaveLength(24);
    expect(hours[3].confidence).toBe('high');
    expect(hours[5].confidence).toBe('low');
    expect(hours[5].sources.openMeteo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Microclimate blending
// ---------------------------------------------------------------------------

describe('microclimate blending', () => {
  it('decays the correction linearly to zero', () => {
    expect(decayWeight(0, 6)).toBe(1);
    expect(decayWeight(3, 6)).toBe(0.5);
    expect(decayWeight(6, 6)).toBe(0);
    expect(decayWeight(10, 6)).toBe(0);
    expect(decayWeight(2, 0)).toBe(0);
  });

  it('computes the station offset and clamps extreme temperature corrections', () => {
    const offset = computeBlendOffset(METRICS, { ...METRICS, tempC: 22, windMs: 4 });
    expect(offset?.tempC).toBe(2);
    expect(offset?.windMs).toBe(1);

    const extreme = computeBlendOffset(METRICS, { ...METRICS, tempC: 45 });
    expect(extreme?.tempC).toBe(8);
  });

  it('pulls the current hour fully to the station and fades out by the decay horizon', () => {
    const ctx = { offset: { tempC: 4 }, anchorHour: 12, decayHours: 6 };
    expect(blendHour(merged(12, { tempC: 20 }), ctx, null, false).metrics.tempC).toBe(24);
    expect(blendHour(merged(15, { tempC: 20 }), ctx, null, false).metrics.tempC).toBe(22);
    expect(blendHour(merged(18, { tempC: 20 }), ctx, null, false).metrics.tempC).toBe(20);
  });

  it('uses station observations for past hours', () => {
    const obs: WeatherMeasurement = {
      time: '2026-10-24T08:00',
      station_id: 's1',
      tenant_id: 't1',
      temperature_out: 15,
      humidity_out: 80,
      wind_speed: 3, // stored in Bft
      wind_gust: 4,
      wind_direction: 90,
    };
    const observation = metricsFromObservation(obs);
    expect(observation).not.toBeNull();

    const blended = blendHour(merged(8, { tempC: 30 }), null, observation, true);
    expect(blended.metrics.tempC).toBe(15);
    expect(blended.sources.station).toBe(true);
  });

  it('does not apply the station correction to a day that is not today', () => {
    // Tomorrow: nothing is past, and the anchor offset must not leak in.
    const future = buildSprayAssist({
      date: '2026-10-25',
      now: '2026-10-24T12:00',
      sources: [{ name: 'open-meteo', points: day().map((p) => ({ ...p, time: p.time.replace('2026-10-24', '2026-10-25') })) }],
      currentForecast: { ...METRICS, tempC: 20 },
      currentObservation: { ...METRICS, tempC: 26 },
    });
    expect(future.slots.every((slot) => slot.level !== 'past')).toBe(true);
    expect(future.slots[12].metrics.tempC).toBe(20);
    expect(future.microclimateApplied).toBe(false);
  });

  it('applies the correction on the current day', () => {
    const today = buildSprayAssist({
      date: '2026-10-24',
      now: '2026-10-24T12:00',
      sources: [{ name: 'open-meteo', points: day() }],
      currentForecast: { ...METRICS, tempC: 20 },
      currentObservation: { ...METRICS, tempC: 26 },
    });
    expect(today.slots[12].metrics.tempC).toBe(26);
    expect(today.microclimateApplied).toBe(true);
  });

  it('reports an hour with no source data as noData, never a fake verdict', () => {
    // Only hour 3 exists: every other hour has no forecast and no observation.
    const hours = mergeSources([{ name: 'open-meteo', points: [point(3)] }]);
    const slots = evaluatePhases(hours, OPTS);

    expect(slots[5].level).toBe('noData');
    expect(slots[5].worstPhase).toBeNull();
    expect(slots[5].phases).toEqual({ before: {}, during: {}, after: {} });
    expect(slots[3].level).toBe('good');
  });

  it('never lets a no-data hour disqualify a neighbouring window', () => {
    // Hour 11 has no data; the placeholder metrics must not read as calm wind
    // for hour 10 nor as dry weather for the hour-10 rainfast window.
    const hours = dense([
      merged(10, { windMs: 1, gustMs: 2 }),
      { ...merged(11), sources: { openMeteo: false, google: false, station: false } },
      merged(12, { windMs: 1 }),
    ]);
    const slots = evaluatePhases(hours, { ...OPTS, durationH: 2, rainfastH: 2 });

    expect(slots[10].phases.during.wind?.level).toBe('good');
    expect(slots[10].level).toBe('good');
  });

  it('marks elapsed hours as past and leaves future hours assessed', () => {    const result = buildSprayAssist({
      date: '2026-10-24',
      now: '2026-10-24T12:30',
      sources: [{ name: 'open-meteo', points: day() }],
    });
    expect(result.slots[11].level).toBe('past');
    expect(result.slots[12].level).not.toBe('past');
    expect(result.slots).toHaveLength(24);
  });
});

// ---------------------------------------------------------------------------
// Rainfast window
// ---------------------------------------------------------------------------

describe('rainfast window', () => {
  it('fails the AFTER phase when rain falls inside the rainfast interval', () => {
    const slots = evaluatePhases(dense([merged(10), merged(11), merged(13, { rainMm: 3, rainProb: 90 })]), {
      ...OPTS,
      durationH: 1,
      rainfastH: 3,
    });
    // Application at 10:00 ends at 11:00, so the window covers 11..13.
    expect(slots[10].phases.after.rain?.level).toBe('bad');
    expect(slots[10].level).toBe('bad');
  });

  it('ignores rain beyond the rainfast window', () => {
    const slots = evaluatePhases(dense([merged(10), merged(14, { rainMm: 5, rainProb: 95 })]), {
      ...OPTS,
      durationH: 1,
      rainfastH: 2,
    });
    expect(slots[10].phases.after.rain?.level).toBe('good');
    expect(slots[10].level).toBe('good');
  });

  it('respects a product-specific longer rainfast interval and stricter rain band', () => {
    const thresholds = mergeSprayThresholds(DEFAULT_SPRAY_THRESHOLDS, {
      rainAfter: { mm: { good: 0, ok: 0 } },
    });
    const hours = dense([merged(10), merged(14, { rainMm: 5, rainProb: 95 })]);
    const short = evaluatePhases(hours, { ...OPTS, durationH: 1, rainfastH: 2, thresholds });
    const long = evaluatePhases(hours, { ...OPTS, durationH: 1, rainfastH: 6, thresholds });

    expect(short[10].phases.after.rain?.level).toBe('good');
    expect(long[10].phases.after.rain?.level).toBe('bad');
  });

  it('blocks the BEFORE phase on wet foliage in the look-back window', () => {
    const slots = evaluatePhases(dense([merged(8, { rainMm: 2, rainProb: 90 }), merged(10)]), OPTS);
    expect(slots[10].phases.before.rain?.level).toBe('bad');
  });
});

// ---------------------------------------------------------------------------
// During-window aggregation
// ---------------------------------------------------------------------------

describe('duration window', () => {
  it('fails the whole application when a later hour in it is windy', () => {
    const hours = dense([
      merged(10, { windMs: 1, gustMs: 2 }),
      merged(11, { windMs: 6, gustMs: 8 }),
      merged(12),
    ]);
    const oneHour = evaluatePhases(hours, { ...OPTS, durationH: 1 });
    const threeHours = evaluatePhases(hours, { ...OPTS, durationH: 3 });

    expect(oneHour[10].level).toBe('good');
    expect(threeHours[10].level).toBe('bad');
  });
});

// ---------------------------------------------------------------------------
// Full build
// ---------------------------------------------------------------------------

describe('buildSprayAssist', () => {
  it('produces 24 slots with the echoed parameters', () => {
    const result = buildSprayAssist({
      date: '2026-10-24',
      now: '2026-10-24T00:00',
      sources: [
        { name: 'open-meteo', points: day() },
        { name: 'google', points: day(() => ({ temperature_2m: 21 })) },
      ],
      durationH: 2,
      rainfastH: 4,
      stationId: 'station-1',
    });

    expect(result.slots).toHaveLength(24);
    expect(result.slots.map((s) => s.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(result.durationH).toBe(2);
    expect(result.rainfastH).toBe(4);
    expect(result.stationId).toBe('station-1');
    expect(result.date).toBe('2026-10-24');
  });

  it('treats a day entirely in the past as past', () => {
    const result = buildSprayAssist({
      date: '2026-10-20',
      now: '2026-10-24T10:00',
      sources: [{ name: 'open-meteo', points: day() }],
    });
    expect(result.slots.every((s) => s.level === 'past')).toBe(true);
  });

  it('reports every hour as good for a fully benign day', () => {
    const result = buildSprayAssist({
      date: '2026-10-24',
      now: '2026-10-24T00:00',
      sources: [{ name: 'open-meteo', points: day() }],
    });
    expect(result.slots.every((s) => s.level === 'good')).toBe(true);
    expect(result.slots.every((s) => s.worstPhase === null)).toBe(true);
  });

  it('applies thresholds supplied by the caller', () => {
    const strict: SprayThresholds = mergeSprayThresholds(DEFAULT_SPRAY_THRESHOLDS, {
      windMs: { good: 1, ok: 1.5 },
      gustMs: { good: 1, ok: 1.5 },
    });
    const result = buildSprayAssist({
      date: '2026-10-24',
      now: '2026-10-24T00:00',
      sources: [{ name: 'open-meteo', points: day(() => ({ wind_speed_10m: 2, wind_gusts_10m: 3 })) }],
      thresholds: strict,
    });
    expect(result.slots[0].level).toBe('bad');
    expect(result.slots[0].phases.during.wind?.level).toBe('bad');
  });
});
