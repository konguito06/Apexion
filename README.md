# Apexion

**Find the optimal line.** Apexion is an independent F1 race analysis and strategy simulation application. It combines historical session data from [FastF1](https://docs.fastf1.dev/) with a deterministic strategy model that uses an optional race-specific historical pace and tyre-degradation estimate, with documented illustrative fallbacks. It is an educational portfolio project, not a recreation of a team's proprietary tools.

## What works

- Responsive workspace with Overview, Race Explorer, Driver Analysis, Telemetry Lab, Strategy Simulator, Strategy Comparison, Model Insights and Methodology sections.
- Season, event and available-session selection from the FastF1 schedule.
- Recently opened session links saved in the browser for quick return.
- Session summary, historical classification, driver laps, sector times, tyre compounds, pit laps and tyre stint summaries when present in source data.
- Lap pace plot, valid-lap filtering, median representative pace, best valid lap, interquartile range and median sector times.
- Actual telemetry channels returned for a selected lap, plus two-lap/driver comparisons aligned on their shared absolute distance overlap in metres.
- Deterministic, user-configurable strategy evaluation with historical parameter estimation when enough representative laps are available, explicit illustrative fallbacks, per-lap predictions and stint/pit-loss breakdowns.
- Bounded optimisation through three stops with an explicit candidate count and search description.
- Named strategy scenarios persisted in browser local storage, editable configuration, baseline deltas, duplicate/remove actions and CSV export.
- FastF1 cache, graceful source errors, synthetic-data unit tests and a GitHub Actions workflow.

Data coverage depends on the historical session, upstream availability and available channels. Apexion uses FastF1's dynamic event schedule and session loader, caches event schedules in memory and relies on FastF1's disk cache for downloaded session data. The live 2024 schedule loaded successfully with 24 events in this environment. A live Bahrain race load reached FastF1 but returned no timing data because upstream timing endpoints reported that F1 account credentials were unavailable; Apexion returned an actionable 503 instead of inventing historical measurements. If needed, set `F1_USERNAME` and `F1_PASSWORD` in the shell before starting Apexion. When FastF1 returns classification or metadata without timed laps, Apexion marks the session as partial and leaves lap fields empty. The overview's synthetic sample pace series is explicitly labelled and only used when historical laps have not loaded.

## Run locally with one command

Requirements: Python 3.10+ and Node.js 20+.

From the project root, install both frontend and backend dependencies once:

```bash
npm run setup
```

Then launch the frontend and backend together:

```bash
npm run dev
```

Open <http://localhost:5173>. Both services log in the same terminal; press **Ctrl+C** to stop them together. The frontend proxies `/api` to FastAPI on port 8000. API docs are at <http://localhost:8000/docs>. The launcher reports missing dependencies and unexpected service exits, including likely port conflicts.

FastF1 data is cached in `backend/.cache/fastf1`, created automatically and ignored by Git. Schedule requests require internet. Historical timing availability depends on FastF1 and its upstream feed; some current requests may require an F1 account. If needed, export `F1_USERNAME` and `F1_PASSWORD` in the terminal before `npm run dev`. Do not commit credentials. To use another backend origin, set `VITE_API_URL` at frontend build time.

## Run with Docker Compose

With Docker and the Compose plugin installed:

```bash
docker compose up --build
```

Open <http://localhost:8080>. The backend API docs remain at <http://localhost:8000/docs>. Compose stores FastF1 cache data in the `fastf1-cache` volume. If the upstream feed requires credentials, copy `.env.example` to `.env` and add them there. Stop services with `docker compose down`; the named cache volume remains available.

## Verify

```bash
cd backend
.venv/bin/python -m pytest
cd ../frontend
npm test
npm run build
```

Tests use synthetic fixtures and do not need internet or a FastF1 download.

## Data and metric definitions

- Classification, lap times, sector times, tyre compounds, stint ids and available car channels are source observations from FastF1.
- `representative lap` excludes missing lap times and laps with a pit-in or pit-out marker. It does not adjust for traffic, safety cars, fuel, weather, track evolution or tire condition beyond reported tyre age.
- Driver pace uses the median of representative laps. Variability uses the interquartile range (75th percentile minus 25th percentile). Best valid lap is shown separately and is not treated as normal pace. Sector medians use the representative-lap set, omitting missing sector values.
- Paired telemetry is interpolated over the laps' shared absolute distance overlap in metres. Relative time deltas use FastF1's telemetry `Time` samples after aligning elapsed time at the overlap start. Exact lap and sector deltas come from FastF1 lap timing. Only channels present in both traces are shown.
- Braking regions use available Brake signals. Acceleration regions are derived only where measured throttle is at least 80% and measured speed increases between samples. These visual regions are descriptive cues, not calibrated corner annotations.
- Missing data remains missing. Telemetry channels are not fabricated.

## Strategy model

The lap calculation is:

```text
baseline pace + compound offset + tyre age × degradation per lap
```

Tyre age resets at a stop; every stop adds a fixed pit loss. Defaults are 90 seconds baseline pace, SOFT/MEDIUM/HARD offsets of 0.00/0.35/0.75 seconds per lap, 0.075 seconds per tyre-age lap, and 22 seconds per pit stop. Users can change pace, degradation and pit loss in the simulator. Apexion can estimate baseline pace as the median of selected-driver FastF1 representative laps after subtracting the configured compound offsets and estimated tyre-age cost. It estimates degradation as a Theil–Sen median of pairwise slopes within same-compound stints. The degradation fit requires at least 12 representative laps, at least one same-compound stint with a known stint identifier, five or more laps spanning four tyre-age steps, and 20 pairwise slopes; otherwise it uses the illustrative 0.075 s/lap default. Pace requires at least three representative laps with reported tyre age; laps with unknown age are not treated as new tyres. Otherwise it uses the illustrative 90 s/lap default. These historical fits are descriptive and do not control for fuel, traffic, weather, track evolution, neutralisations or changes in car/driver performance. Compound offsets (SOFT 0.00, MEDIUM 0.35, HARD 0.75 seconds) and the 22 second default pit loss remain configurable illustrative assumptions.

Pit convention: a selected pit lap is completed on the old compound. The next numbered lap starts on the next stint's compound with tyre age zero. Every lap, including that in-lap and the next out-lap, uses the same lap-time equation; the configured net pit loss is then added once per stop. There is no separate in-lap or out-lap penalty, preventing double counting. The displayed comparison baseline is a no-stop race on the same starting compound, baseline pace and degradation parameter. The simulator reports this difference and the actual pace, compound, degradation and pit-loss contributions. Outputs are simulated estimates, not actual results or guaranteed forecasts.

### Hand-checkable reference example

Configure 5 laps, SOFT then HARD, pit after lap 2, baseline pace 90.000 s, degradation 0.100 s per tyre-age lap and 22 s pit loss. The lap curve is `[90.000, 90.100, 90.750, 90.850, 90.950]`; green-flag time is 452.650 s, the single pit loss is 22.000 s and total time is **474.650 s**. The no-stop SOFT baseline is 451.000 s, so the modelled difference is +23.650 s. Unit test: `backend/tests/test_simulation.py::test_reference_example_can_be_verified_by_hand`.

The optimiser searches compound sequences across a deterministic, spaced pit-lap grid, requires four-lap minimum stints and supports up to three stops. It reports how many candidates it evaluated. It does not search every possible strategy, apply season-specific tyre regulations, or model traffic, weather evolution, neutralisations, overtaking or rival responses. No machine-learning model or accuracy claim is included.

## Architecture

```text
React + TypeScript + Recharts (Vite / Nginx)
                  │ HTTP JSON (/api)
                  ▼
FastAPI + Pydantic ── strategy simulation / bounded optimiser
                  │
                  └── FastF1 schedule, session loader and local cache
```

The API and data service are intentionally small; routes handle validation and error responses while calculations and FastF1 normalization live in service modules. CORS origins can be configured with `APEXION_CORS_ORIGINS` (comma-separated). The default allows the local Vite and Compose origins.

## Known limitations

This version does not implement safety-car scenarios, weather simulation, regulation-aware strategy constraints, traffic-adjusted or validated pace/degradation prediction, trained machine learning, a circuit map, steering telemetry, authentication, shared/cloud scenario storage or a public deployment. Historical finishing classifications, sectors, stints, and telemetry are shown only where the FastF1 session provides them. Scenarios are saved only in the current browser.
