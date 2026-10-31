// =============================================================================
// Agrivate v2 — Shared TypeScript Interfaces
// =============================================================================

// ---------------------------------------------------------------------------
// Spraying suitability — agronomic decision logic (shared by web + API)
// ---------------------------------------------------------------------------
export * from './spray.js';

// ---------------------------------------------------------------------------
// Spray Assist — day/hour spray-window assessment (shared by web + API)
// ---------------------------------------------------------------------------
export * from './sprayAssist.js';
export * from './sprayAssistEngine.js';

// ---------------------------------------------------------------------------
// Disease risk — canonical engine (shared by web + API; see file header)
// ---------------------------------------------------------------------------
export * from './disease.js';

// ---------------------------------------------------------------------------
// Wind units — Beaufort conversions (shared by web + API + cron worker)
// ---------------------------------------------------------------------------
export * from './wind.js';

// ---------------------------------------------------------------------------
// Tenant & User
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string; // UUID
  slug: string; // unique slug for subdomain / API key prefix
  name: string;
  created_at: string; // ISO 8601
}

export interface User {
  id: string; // UUID
  tenant_id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export interface AuthTokenPayload {
  sub: string; // user_id
  tenant_id: string;
  role: User['role'];
  iat?: number;
  exp?: number;
}

// ---------------------------------------------------------------------------
// Weather Station
// ---------------------------------------------------------------------------

export interface WeatherStation {
  id: string; // UUID
  tenant_id: string;
  name: string;
  provider: 'ecowitt' | 'davis' | 'custom';
  /** MAC address for Ecowitt, device ID for Davis, or free text for custom */
  external_id: string;
  latitude: number;
  longitude: number;
  api_key?: string; // for Davis / custom API auth
  config?: Record<string, unknown>; // provider-specific configuration
  is_active: boolean;
  /** Timestamp when historical data backfill completed */
  backfilled_at?: string | null;
  /** Status of historical data backfill */
  backfill_status?: 'pending' | 'in_progress' | 'completed' | 'failed' | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Weather Measurements (time-series, stored in hypertable)
// ---------------------------------------------------------------------------

export interface WeatherMeasurement {
  time: string; // ISO 8601 (indexed by TimescaleDB hypertable)
  station_id: string;
  tenant_id: string;

  // ── Temperature ──────────────────────────────────────────────────────────
  temperature_out?: number; // °C
  temperature_out_min?: number; // °C — min in time bucket (aggregated queries)
  temperature_out_max?: number; // °C — max in time bucket (aggregated queries)
  temperature_in?: number; // °C
  temperature_in_min?: number; // °C
  temperature_in_max?: number; // °C
  temperature_dew_point?: number; // °C
  temperature_dew_point_min?: number; // °C
  temperature_dew_point_max?: number; // °C
  temperature_wind_chill?: number; // °C
  temperature_heat_index?: number; // °C
  temperature_feels_like?: number; // °C — outdoor feels-like
  temperature_app_temp?: number; // °C — apparent temperature

  // ── Humidity ─────────────────────────────────────────────────────────────
  humidity_out?: number; // %
  humidity_out_min?: number; // % — min in time bucket
  humidity_out_max?: number; // % — max in time bucket
  humidity_in?: number; // %
  humidity_in_min?: number; // %
  humidity_in_max?: number; // %

  // ── Pressure ─────────────────────────────────────────────────────────────
  pressure_absolute?: number; // hPa
  pressure_relative?: number; // hPa

  // ── Wind ─────────────────────────────────────────────────────────────────
  // Stored and exposed in Beaufort (Bft) everywhere. Station APIs report m/s
  // or km/h, so ingestion normalizes to Bft; anything that needs a physical
  // speed (ETo, Windy) converts back with bftToMs().
  wind_speed?: number; // Bft
  wind_speed_min?: number; // Bft — min in time bucket
  wind_speed_max?: number; // Bft — max in time bucket
  wind_gust?: number; // Bft
  wind_gust_min?: number; // Bft — min in time bucket
  wind_gust_max?: number; // Bft — max in time bucket
  wind_direction?: number; // degrees

  // ── Rain ─────────────────────────────────────────────────────────────────
  rain_rate?: number; // mm/h
  rain_daily?: number; // mm
  rain_hourly?: number; // mm — rainfall in last hour
  rain_event?: number; // mm — current rain event total
  rain_weekly?: number; // mm
  rain_monthly?: number; // mm
  rain_yearly?: number; // mm

  // ── Solar ────────────────────────────────────────────────────────────────
  solar_radiation?: number; // W/m²
  solar_radiation_min?: number; // W/m² — min in time bucket
  solar_radiation_max?: number; // W/m² — max in time bucket
  uv_index?: number;
  uv_index_min?: number; // min in time bucket
  uv_index_max?: number; // max in time bucket

  // ── Lightning ────────────────────────────────────────────────────────────
  lightning_distance?: number; // km
  lightning_count?: number; // strikes today

  // ── Indoor CO2 ───────────────────────────────────────────────────────────
  co2?: number; // ppm
  co2_24h_avg?: number; // ppm

  // ── Particulate Matter ───────────────────────────────────────────────────
  pm25?: number; // µg/m³
  pm25_real_time_aqi?: number;
  pm25_24h_aqi?: number;
  pm10?: number; // µg/m³
  pm10_real_time_aqi?: number;
  pm10_24h_aqi?: number;
  pm1?: number; // µg/m³
  pm4?: number; // µg/m³

  // ── Soil (generic / first-channel fallback) ──────────────────────────────
  soil_moisture?: number; // cb or %
  soil_temperature?: number; // °C

  // ── Soil — per-channel (ch1..16) ─────────────────────────────────────────
  soil_moisture_ch1?: number;
  soil_moisture_ch2?: number;
  soil_moisture_ch3?: number;
  soil_moisture_ch4?: number;
  soil_moisture_ch5?: number;
  soil_moisture_ch6?: number;
  soil_moisture_ch7?: number;
  soil_moisture_ch8?: number;
  soil_moisture_ch9?: number;
  soil_moisture_ch10?: number;
  soil_moisture_ch11?: number;
  soil_moisture_ch12?: number;
  soil_moisture_ch13?: number;
  soil_moisture_ch14?: number;
  soil_moisture_ch15?: number;
  soil_moisture_ch16?: number;

  soil_temperature_ch1?: number;
  soil_temperature_ch2?: number;
  soil_temperature_ch3?: number;
  soil_temperature_ch4?: number;
  soil_temperature_ch5?: number;
  soil_temperature_ch6?: number;
  soil_temperature_ch7?: number;
  soil_temperature_ch8?: number;
  soil_temperature_ch9?: number;
  soil_temperature_ch10?: number;
  soil_temperature_ch11?: number;
  soil_temperature_ch12?: number;
  soil_temperature_ch13?: number;
  soil_temperature_ch14?: number;
  soil_temperature_ch15?: number;
  soil_temperature_ch16?: number;

  // ── Leaf wetness ─────────────────────────────────────────────────────────
  leaf_wetness?: number; // minutes or %

  // ── Battery / signal ─────────────────────────────────────────────────────
  battery_mv?: number; // mV
  rssi?: number; // signal strength
  wh65batt?: number; // Ecowitt WH65 battery voltage

  /** Raw Ecowitt / provider API response JSON for debugging */
  raw_payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Forecast (time-series)
// ---------------------------------------------------------------------------

export interface ForecastPoint {
  time: string; // ISO 8601
  tenant_id: string;
  latitude: number;
  longitude: number;
  temperature_2m?: number;
  /** Daily series only: the day's minimum (temperature_2m holds the maximum). */
  temperature_2m_min?: number;
  relative_humidity_2m?: number;
  precipitation_probability?: number;
  precipitation?: number;
  wind_speed_10m?: number;
  wind_gusts_10m?: number;
  wind_direction_10m?: number;
  pressure_msl?: number;
  cloud_cover?: number;
  shortwave_radiation?: number;
  uv_index?: number;
  soil_moisture_0_to_1cm?: number;
  soil_moisture_1_to_3cm?: number;
  soil_moisture_3_to_9cm?: number;
  soil_moisture_9_to_27cm?: number;
  soil_temperature_0cm?: number;
  soil_temperature_6cm?: number;
  evapotranspiration?: number;
  weather_code?: number; // WMO weather code
  model: string; // 'icon-eu' | 'ecmwf' | 'gfs' | 'meteofrance'
  forecast_hour: number; // forecast hour from run time
}

// ---------------------------------------------------------------------------
// Forecast notice (6-hour agricultural conditions)
// ---------------------------------------------------------------------------

export interface ForecastNoticeCondition {
  icon: string;
  text: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'good';
  /** Stable condition code — the frontend maps it to a localized string. */
  code?: string;
  /** Interpolation params for the localized string (e.g. { mm, temp, bft }). */
  params?: Record<string, string | number>;
}

export interface ForecastNotice {
  type: 'critical' | 'danger' | 'warning' | 'success';
  conditions: ForecastNoticeCondition[];
  /** Human-readable local time range, e.g. "14:30 - 20:30" */
  timeRange: string;
  /** ISO timestamp when the notice was generated */
  generatedAt: string;
}

/**
 * Per-station cached hourly forecast, precomputed by the cron-worker so the
 * frontend never calls Open-Meteo directly (respects the 10k calls/day budget).
 */
export interface StationForecastCache {
  station_id: string;
  tenant_id: string;
  /** The next N hours of hybrid forecast points (WeatherNext + legacy backfill) */
  hourly: ForecastPoint[];
  /** ISO timestamp of the last cron refresh (when the row was written) */
  fetched_at: string;
  /**
   * ISO timestamp of when the cron actually received the provider response it
   * stored. This — not `fetched_at` — is what staleness is measured from, so a
   * stalled cron shows an old time instead of looking freshly refreshed.
   */
  captured_at?: string;
}

// ---------------------------------------------------------------------------
// Thermal stress (cumulative hours per day/month/year)
// ---------------------------------------------------------------------------

/** Tenant-configured thermal stress settings (stored in tenant_settings JSON). */
export interface ThermalStressSettings {
  threshold: number; // °C — hours above this count as stress
  recoveryRatio: number; // e.g. 1.0 = 1h recovery per 1h stress
}

/** One stored daily aggregate for a station. */
export interface ThermalStressDaily {
  station_id: string;
  date: string; // YYYY-MM-DD
  stress_hours: number;
  max_temp: number | null;
  threshold: number;
}

/** Per-month cumulative stress hours for the /historical table. */
export interface ThermalStressMonthSummary {
  month: number; // 1-12
  label: string; // Greek month name
  stress_hours: number;
}

/** Year summary served by GET /api/thermal-stress/summary. */
export interface ThermalStressYearSummary {
  year: number;
  threshold: number;
  months: ThermalStressMonthSummary[];
  total_stress_hours: number;
}

// ---------------------------------------------------------------------------
// Settings (per-tenant JSON)
// ---------------------------------------------------------------------------

export interface TenantSettings {
  tenant_id: string;
  data: Record<string, unknown>; // flexible JSON blob
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Crop Stage
// ---------------------------------------------------------------------------

export interface CropStage {
  id: string;
  tenant_id: string;
  name: string;
  start_date: string; // MM-DD (without year)
  end_date: string; // MM-DD
  kc_value?: number; // crop coefficient
}

// ---------------------------------------------------------------------------
// API Responses
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface ErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

// ---------------------------------------------------------------------------
// Disease Models
// ---------------------------------------------------------------------------

export interface DiseaseRiskInput {
  temperature: number; // °C
  humidity: number; // %
  leaf_wetness: number; // hours
  rainfall_24h: number; // mm
  temperature_avg_7d: number; // °C
  crop_stage: string;
}

export interface DiseaseRiskResult {
  disease_name: string;
  risk_level: 'low' | 'moderate' | 'high' | 'severe';
  risk_score: number; // 0-100
  factors: string[];
  recommendation: string;
}

// ---------------------------------------------------------------------------
// AI Chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  tenant_id: string;
  station_id?: string;
  messages: ChatMessage[];
  context?: {
    recent_weather?: WeatherMeasurement[];
    forecast?: ForecastPoint[];
    settings?: TenantSettings;
  };
}

export interface ChatResponse {
  message: ChatMessage;
  sources?: string[];
  token_usage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}
