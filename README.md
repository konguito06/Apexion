# Apexion

**Find the optimal line.** Apexion is an independent F1 race analysis and strategy simulation MVP. It combines on-demand historical data from [FastF1](https://docs.fastf1.dev/) with an explicitly illustrative, deterministic pit-stop model. It is an educational project, not team strategy software.

## Features

- Dark, responsive interface with Overview, Race Explorer, Driver Analysis, Telemetry Lab, Strategy Simulator, Strategy Comparison, Model Insights and Methodology views.
- FastF1 event schedule, session summary, lap times and car telemetry endpoints. FastF1 caches downloaded session data under `backend/.cache/fastf1`.
- Deterministic strategy estimate with compound adjustments, tyre age degradation and configured pit loss; validation rejects malformed strategies.
- Bounded search over a small, documented set of compound sequences and pit windows.
- Local session strategy comparison with CSV export.
- Backend unit and API tests that need no live data downloads.

Historical-data pages require internet access and the selected event/session data to be available through FastF1. Errors are surfaced in the interface. The overview chart uses a clearly labelled synthetic sample series only when no historical lap series has loaded; it is never labelled as real telemetry. Telemetry charts render only returned channels.

## Run locally

Requirements: Python 3.10+ and Node.js 20+.

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API docs: <http://localhost:8000/docs>. FastF1 cache is written to `backend/.cache/fastf1` (ignored by Git). Session downloads may take time on first load.

### Frontend

In another terminal, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The frontend uses `http://localhost:8000` by default. Set `VITE_API_URL` at build time to point to a different API origin. Development CORS currently allows `http://localhost:5173`; update `backend/app/main.py` for another origin before deployment.

## Verify

```bash
cd backend
.venv/bin/python -m pytest
cd ../frontend
npm test
npm run build
```

Tests use synthetic inputs and do not download race data.

## Simulation assumptions and limitations

For each lap, the model calculates `baseline pace + compound offset + tyre age × degradation`. Tyre age resets after each stop, and each stop adds fixed pit loss. Defaults are 90 seconds baseline pace, SOFT/MEDIUM/HARD offsets of 0.00/0.35/0.75 seconds per lap, 0.075 seconds per tyre-age lap, and 22 seconds per pit stop. These are illustrative defaults, not fitted to a specific circuit, season, or car. Configure a different baseline pace or loss through the API. Results should not be treated as predictions of a real race.

The optimiser enumerates a bounded search of fixed compound patterns (at most three stops and 100 laps accepted) and pit windows. It does not search every legal strategy or encode season-specific regulations. Neither simulation nor optimisation models traffic, weather evolution, neutralisations, overtaking, undercut/overcut interactions, or competitor response. No machine-learning accuracy is claimed.

FastF1 publicly exposes historical data with varying coverage. Some sessions, drivers, laps or telemetry channels may be unavailable; those requests return an explanatory error or omit unavailable channels rather than invent values.

## Architecture

```text
React + TypeScript + Recharts (Vite)
              │ HTTP / JSON
              ▼
FastAPI + Pydantic ── deterministic simulation / bounded optimiser
              │
              └── FastF1 session cache and public historical API
```

## Current scope

This MVP supports schedule discovery, race summary and driver laps, one-driver telemetry-by-lap exploration, manual simulation, bounded strategy search, and local comparison/export. Historical finishing classification, sector-based analysis, paired telemetry comparisons, persistent comparison storage, account support, regulation-aware optimisation, and calibrated model fitting are not implemented yet. There is no production deployment configuration or claim of deployment.
