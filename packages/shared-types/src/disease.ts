// =============================================================================
// Agrivate v2 — Disease Risk Engine (CANONICAL, shared by web + API)
// =============================================================================
// Single source of truth for disease risk. Previously three implementations
// existed and disagreed:
//
//   1. src/utils/diseaseRiskCalculator.ts   (frontend, Diseases page)
//   2. daily-report.ts evaluateTenantDisease (backend, emailed report)
//   3. services/disease-risk.ts             (backend, 5 built-in models)
//
// Engines 1 and 2 were hand-maintained copies; engine 3 used a completely
// different algorithm (leaf-wetness scoring) and a different level vocabulary,
// so the Diseases page and the chatbot could not agree on the same day's risk.
//
// CANONICAL SPEC (agreed 2026-09-26):
//   • Diseases are USER-DEFINED per tenant (min/max temperature, min/max humidity).
//   • A day matches when its AVERAGE temperature and humidity both fall inside
//     the configured windows (a missing/absent window is not a constraint).
//   • Risk is decided by how many of the LAST 4 DAYS matched.
//   • Levels: low | moderate | high | severe.
//   • Leaf wetness is NOT used. Most stations have no leaf-wetness sensor, and
//     `null` there means "no sensor", not "dry leaves" — so it must never be
//     treated as evidence. Prediction rests on past-4-day temperature + humidity.
// =============================================================================

/** Canonical risk vocabulary. */
export type DiseaseRiskLevel = 'low' | 'moderate' | 'high' | 'severe';

/** Window used to judge risk. Exported so surfaces can label it consistently. */
export const DISEASE_WINDOW_DAYS = 4;

/**
 * A disease as configured by the tenant.
 * `threshold_settings` is the persisted shape; the flat fields are the resolved
 * form used by the engine.
 */
export interface DiseaseThresholds {
  name: string;
  temperatureMin?: number;
  temperatureMax?: number;
  humidityMin?: number;
  humidityMax?: number;
}

/** One day of aggregated weather. Either field may be null when unsensed. */
export interface DiseaseDayAggregate {
  /** ISO date (YYYY-MM-DD) in the station's local day. */
  date: string;
  avgTemperature: number | null;
  avgHumidity: number | null;
}

export interface DiseaseRiskResult {
  riskLevel: DiseaseRiskLevel;
  /** How many of the last 4 days matched both windows. */
  matchingDays: number;
  /** Number of days considered (<= DISEASE_WINDOW_DAYS). */
  daysEvaluated: number;
  /** Consecutive matching days ending on the most recent day. */
  consecutiveDays: number;
  /** Per-condition verdicts, for the detail UI. */
  conditions: { temperature: boolean; humidity: boolean };
  /** Human-readable reasons (Greek), for tooltips and chatbot grounding. */
  notes: string[];
}

/** Map a matching-day count to a risk level. Thresholds live here only. */
export function riskFromMatchingDays(matchingDays: number): DiseaseRiskLevel {
  if (matchingDays >= 4) return 'severe';
  if (matchingDays >= 3) return 'high';
  if (matchingDays >= 2) return 'moderate';
  return 'low';
}

/** Uppercase the level for report/prompt contexts. */
export function formatRiskLevel(level: DiseaseRiskLevel): string {
  return level.toUpperCase();
}

/**
 * Greek display label for a risk level, matching the web UI's `disease.<level>`
 * translation keys. Use this whenever a risk level is rendered into Greek prose
 * (chatbot grounding, emailed report) so the English machine tokens
 * (LOW/MODERATE/HIGH/SEVERE) never leak into Greek text.
 */
export const GREEK_RISK_LABELS: Record<DiseaseRiskLevel, string> = {
  low: 'Χαμηλός Κίνδυνος',
  moderate: 'Μέτριος Κίνδυνος',
  high: 'Υψηλός Κίνδυνος',
  severe: 'Σοβαρός Κίνδυνος',
};

/** Greek label for a risk level (for Greek prose). */
export function greekRiskLabel(level: DiseaseRiskLevel): string {
  return GREEK_RISK_LABELS[level];
}

/**
 * Replace any standalone English risk tokens (LOW/MODERATE/HIGH/SEVERE) in a
 * Greek string with their Greek labels. Deterministic backstop for LLM output
 * that copies the machine token verbatim into the farmer-facing text.
 */
export function localizeRiskTokens(text: string): string {
  if (!text) return '';
  return text.replace(/\b(LOW|MODERATE|HIGH|SEVERE)\b/g, (token) => {
    const level = token.toLowerCase() as DiseaseRiskLevel;
    return GREEK_RISK_LABELS[level] ?? token;
  });
}

/** i18n key for a level (UI translates `disease.<level>` — e.g. `disease.severe`). */
export function diseaseRiskI18nKey(level: DiseaseRiskLevel): string {
  return `disease.${level}`;
}

/**
 * Does this day's weather fall inside the disease's windows?
 *
 * A window that is not configured is not a constraint. A null measurement on a
 * CONFIGURED window fails the day — we cannot claim conditions were favourable
 * when the value is unknown.
 */
function evaluateDay(
  day: DiseaseDayAggregate,
  d: DiseaseThresholds,
): { tempMatch: boolean; humMatch: boolean; matched: boolean } {
  const noTemp = d.temperatureMin === undefined && d.temperatureMax === undefined;
  const noHum = d.humidityMin === undefined && d.humidityMax === undefined;

  let tempMatch = true;
  if (!noTemp) {
    const t = day.avgTemperature;
    if (t === null) tempMatch = false;
    else {
      if (d.temperatureMin !== undefined && t < d.temperatureMin) tempMatch = false;
      if (d.temperatureMax !== undefined && t > d.temperatureMax) tempMatch = false;
    }
  }

  let humMatch = true;
  if (!noHum) {
    const h = day.avgHumidity;
    if (h === null) humMatch = false;
    else {
      if (d.humidityMin !== undefined && h < d.humidityMin) humMatch = false;
      if (d.humidityMax !== undefined && h > d.humidityMax) humMatch = false;
    }
  }

  return { tempMatch, humMatch, matched: tempMatch && humMatch };
}

/**
 * Evaluate disease risk over the last `DISEASE_WINDOW_DAYS` days.
 *
 * `days` must be ascending by date; the trailing N are used.
 */
export function evaluateDiseaseRisk(
  disease: DiseaseThresholds,
  days: DiseaseDayAggregate[],
): DiseaseRiskResult {
  const window = days.slice(-DISEASE_WINDOW_DAYS);

  if (window.length === 0) {
    return {
      riskLevel: 'low',
      matchingDays: 0,
      daysEvaluated: 0,
      consecutiveDays: 0,
      conditions: { temperature: false, humidity: false },
      notes: ['Δεν υπάρχουν δεδομένα για τις τελευταίες ημέρες.'],
    };
  }

  const dayMatches: boolean[] = [];
  let tempMatches = 0;
  let humMatches = 0;

  for (const day of window) {
    const { tempMatch, humMatch, matched } = evaluateDay(day, disease);
    if (tempMatch) tempMatches++;
    if (humMatch) humMatches++;
    dayMatches.push(matched);
  }

  const matchingDays = dayMatches.filter(Boolean).length;

  // Consecutive matching days ending on the most recent day.
  let consecutiveDays = 0;
  for (let i = dayMatches.length - 1; i >= 0 && dayMatches[i]; i--) consecutiveDays++;

  const notes: string[] = [];
  if (tempMatches >= 3) {
    notes.push(
      `Θερμοκρασία εντός ορίων (${disease.temperatureMin ?? '—'}–${disease.temperatureMax ?? '—'}°C) για ≥3 ημέρες`,
    );
  }
  if (humMatches >= 3) {
    notes.push(
      `Υγρασία εντός ορίων (${disease.humidityMin ?? '—'}–${disease.humidityMax ?? '—'}%) για ≥3 ημέρες`,
    );
  }
  if (notes.length === 0) {
    notes.push(`Καμία ημέρα εντός ευνοϊκών συνθηκών τις τελευταίες ${window.length} ημέρες.`);
  }

  return {
    riskLevel: riskFromMatchingDays(matchingDays),
    matchingDays,
    daysEvaluated: window.length,
    consecutiveDays,
    conditions: { temperature: tempMatches >= 3, humidity: humMatches >= 3 },
    notes,
  };
}

/**
 * Evaluator factory for text-recommendation contexts (the chatbot).
 * Keeps the advice phrasing out of the engine itself.
 */
export function describeDiseaseRisk(
  name: string,
  result: DiseaseRiskResult,
): string {
  const advice: Record<DiseaseRiskLevel, string> = {
    low: 'Παρακολούθηση· δεν απαιτείται άμεση ενέργεια.',
    moderate: 'Προληπτική παρακολούθηση και ετοιμότητα για επέμβαση.',
    high: 'Συνιστάται προστατευτική επέμβαση εντός 24–48 ωρών.',
    severe: 'Άμεση επέμβαση· επανάληψη ανά 7–10 ημέρες αν συνεχιστούν οι συνθήκες.',
  };
  return `${name}: ${formatRiskLevel(result.riskLevel)} (${result.matchingDays}/${result.daysEvaluated} ημέρες εντός ορίων). ${advice[result.riskLevel]}`;
}
