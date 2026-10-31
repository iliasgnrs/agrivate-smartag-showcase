# Architecture

This document describes the design of the **production** Agrivate SmartAg platform at the level of detail that is safe to publish. Implementation specifics (schema, endpoints, deployment) are intentionally omitted.

---

## 1. Domain

Agrivate SmartAg ingests measurements from weather stations, LoRaWAN soil probes and third-party agricultural weather APIs, and converts them into decisions:

| Capability | What it answers |
|------------|-----------------|
| Live station dashboard | What is happening in the field right now? |
| Historical analysis | How did this season compare? (charts, tables, CSV/Excel export) |
| Forecast & microclimate | What will happen tomorrow, corrected for this specific plot? |
| Spray Assist | Is there a window today when spraying is agronomically safe? |
| Disease risk | Which fungal models are triggered by the current weather? |
| Chill units / GDD | Has the crop met its cold and heat accumulation requirements? |
| Irrigation | How much water does this block need, and when? |
| AI assistant | Plain-language advice grounded in the tenant's own data |

Every capability follows the same rule: **agronomic logic is pure, hosted in a shared package, and unit-tested** — not scattered across routes and components.

---

## 2. Topology

```
┌──────────────────────┐   ┌────────────────────────┐   ┌────────────────────────┐
│  Weather stations    │   │  LoRaWAN soil probes   │   │  Agricultural APIs     │
│  (HTTP pull)         │   │  (UDP datagrams)       │   │  (forecast ensembles)  │
└──────────┬───────────┘   └───────────┬────────────┘   └───────────┬────────────┘
           │                           │                            │
           ▼                           ▼                            ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │                    Ingestion & scheduling layer                     │
   │   • periodic pullers   • datagram listener   • forecast capture      │
   │   • normalisation      • deduplication       • bias correction       │
   └───────────────────────────────┬─────────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │  Time-series storage      │
                     │  (compressed hypertables) │
                     └─────────────┬─────────────┘
                                   ▼
                     ┌───────────────────────────┐        ┌────────────────────┐
                     │   API / service layer     │◄──────►│  Shared domain     │
                     │   auth · validation ·     │        │  types + pure      │
                     │   orchestration · cache   │        │  agronomic engines │
                     └─────────────┬─────────────┘        └────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │  Client (SPA / PWA /      │
                     │  native wrapper)          │
                     └───────────────────────────┘
```

### Layers

| Layer | Responsibility | Public here? |
|-------|----------------|--------------|
| **Ingestion / scheduling** | Poll providers, decode sensor datagrams, normalise, dedupe, persist | No |
| **Time-series store** | Hypertable storage with compression and rollup policies | No |
| **Service layer** | Multi-tenant auth, request validation, caching, orchestration | No |
| **Shared domain** | Types + pure agronomic engines | ✅ [`packages/shared-types`](../packages/shared-types) |
| **Client** | Responsive SPA, installable PWA, native mobile wrapper | Partially — [design system](../src/styles/design-system.css) & [UI primitives](../src/components/ui) only |

---

## 3. Design decisions worth reviewing

### 3.1 Pure engines instead of service methods

Agronomic rules were extracted from HTTP handlers into functions with **no ambient dependencies**:

```ts
// Every input is explicit: forecast sources, station observations, the
// tenant's thresholds, and a clock reference. Nothing is read implicitly.
const day = buildSprayAssist({
  date,
  now,
  sources: [openMeteo, google],
  observations,
  currentForecast,
  currentObservation,
  thresholds,
});
```

Consequences:
- the entire day's assessment is reproducible in a unit test;
- the same rules run in the API and (for optimistic UI) in the browser;
- the HTTP layer cannot drift from the decision rules.

### 3.2 Conservative multi-source fusion

Two independent forecasts are merged with a tolerance band and an explicit `agreement` verdict; when they disagree the **more restrictive** value wins. A microclimate offset learned from the station decays over the forecast horizon, so a station correction influences the near term without overriding the forecast a day out.

### 3.3 Fail-safe verdicts

For operational advice (spraying, irrigation), an unknown or incomplete input degrades to the **safe** outcome rather than the permissive one. Missing observations never produce a green light.

### 3.4 One type contract, many runtimes

Domain types are published once and consumed by web, API and workers. A change to a measurement shape becomes a compile error everywhere instead of a runtime surprise.

### 3.5 Shared agronomic primitives

VPD and reference evapotranspiration (FAO-56 Penman–Monteith with a temperature-based fallback) exist as a single implementation, so the health snapshot and the agronomic summary endpoints cannot diverge.

---

## 4. Testing strategy

| Level | Scope |
|-------|-------|
| Unit | Pure engines: threshold merging, blend decay, phase verdicts, band boundaries |
| Contract | Shared types compiled in every consumer |
| Integration | Service layer against a seeded time-series database *(private)* |

The public test suite in [`packages/shared-types/src/__tests__`](../packages/shared-types/src/__tests__) covers the decision logic that carries the most agronomic risk.

---

## 5. Scaling & operations (summary)

- Containers per bounded context (client, API, worker) behind a reverse proxy.
- Time-series storage with compression policies and pre-aggregated rollups.
- Upstream API calls guarded by cooldowns and cached forecasts to respect provider quotas.
- Scheduled jobs are idempotent and resumable; long backfills checkpoint their progress.

Details are available in a private walkthrough.
