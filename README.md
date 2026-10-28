# Apexion

**Find the optimal line.** Apexion is an independent F1 race analysis and strategy simulation application. It combines historical session data from [FastF1](https://docs.fastf1.dev/) with a deterministic, explicitly illustrative strategy model. It is an educational portfolio project, not a recreation of a team's proprietary tools.

## What works

- Responsive workspace with Overview, Race Explorer, Driver Analysis, Telemetry Lab, Strategy Simulator, Strategy Comparison, Model Insights and Methodology sections.
- Season, event and available-session selection from the FastF1 schedule.
- Recently opened session links saved in the browser for quick return.
- Session summary, historical classification, driver laps, sector times, tyre compounds, pit laps and tyre stint summaries when present in source data.
- Lap pace plot, valid-lap filtering, median representative pace, best valid lap, interquartile range and median sector times.
- Actual telemetry channels returned for a selected lap, plus two-lap/driver channel comparisons interpolated to a shared 0–100% lap-distance axis.
- Deterministic, user-configurable strategy evaluation with tyre compounds, pit laps, race laps, pace, tyre-age degradation and pit loss.
- Bounded optimisation through three stops with an explicit candidate count and search description.
- Named strategy scenarios persisted in browser local storage, editable configuration, baseline deltas, duplicate/remove actions and CSV export.
- FastF1 cache, graceful source errors, synthetic-data unit tests and a GitHub Actions workflow.

Data coverage depends on the historical session, upstream availability and available channels. Event schedule integration was verified live; a live 2024 session request in the development environment returned no lap rows without upstream authentication. Apexion reports that state with setup guidance rather than inventing historical measurements. The overview uses a small labelled synthetic sample pace series only when historical laps have not loaded; sample values are never presented as measurements.

## Run locally

Requirements: Python 3.10+ and Node.js 20+.

### Backend terminal

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

FastAPI docs are at <http://localhost:8000/docs>. FastF1 data is cached in `backend/.cache/fastf1`. The cache is created automatically and is ignored by Git. Schedule requests require internet. Historical timing availability depends on FastF1 and the upstream feed; some current requests may require an F1 account. If needed, export `F1_USERNAME` and `F1_PASSWORD` in the backend terminal before starting the service. Do not commit credentials.

### Frontend terminal

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` to the local backend. To use another backend origin, set `VITE_API_URL` at frontend build time.

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
- Paired telemetry is interpolated to a shared normalized 0–100% lap-distance coordinate. This is a relative lap coordinate, not absolute circuit distance. Only channels present in both traces are shown.
- Missing data remains missing. Telemetry channels are not fabricated.

## Strategy model

The lap calculation is:

```text
baseline pace + compound offset + tyre age × degradation per lap
```

Tyre age resets at a stop; every stop adds a fixed pit loss. Defaults are 90 seconds baseline pace, SOFT/MEDIUM/HARD offsets of 0.00/0.35/0.75 seconds per lap, 0.075 seconds per tyre-age lap, and 22 seconds per pit stop. Users can change pace, degradation and pit loss in the simulator. These assumptions are illustrative and are not fitted to a circuit, car, season or driver. Outputs are simulations, not race forecasts.

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

This version does not implement safety-car scenarios, weather simulation, regulation-aware strategy constraints, calibrated pace/degradation fitting, trained machine learning, a circuit map, steering telemetry, authentication, shared/cloud scenario storage or a public deployment. Historical finishing classifications, sectors, stints, and telemetry are shown only where the FastF1 session provides them. Scenarios are saved only in the current browser.
