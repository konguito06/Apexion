from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import data
from .simulation import Strategy, optimise, simulate

app = FastAPI(title="Apexion API", version="0.1.0", description="Historical F1 data and transparent strategy simulation")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])


class SimulationRequest(BaseModel):
    race_laps: int = Field(ge=1, le=100)
    compounds: list[str]
    pit_laps: list[int]
    baseline_pace_seconds: float = Field(default=90.0, gt=0)
    pit_loss_seconds: float = Field(default=22.0, ge=0, le=120)
    degradation_seconds_per_lap: float = Field(default=0.075, ge=0, le=2)


class OptimiseRequest(BaseModel):
    race_laps: int = Field(ge=1, le=100)
    pit_loss_seconds: float = Field(default=22.0, ge=0, le=120)
    max_stops: int = Field(default=2, ge=0, le=3)


@app.get("/api/health")
def health():
    return {"status": "ok", "data_provider": "FastF1" if data.fastf1 else "unavailable"}


@app.get("/api/seasons")
def get_seasons():
    return {"seasons": data.seasons()}


@app.get("/api/events")
def get_events(season: int = Query(ge=2018, le=2026)):
    try:
        return {"season": season, "events": data.events(season)}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/sessions/{year}/{event}/summary")
def get_summary(year: int, event: str, session: str = "R"):
    try:
        return data.session_summary(year, event, session)
    except Exception as exc:
        raise HTTPException(503, f"Session data unavailable: {exc}") from exc


@app.get("/api/sessions/{year}/{event}/laps")
def get_laps(year: int, event: str, driver: str, session: str = "R"):
    try:
        return {"laps": data.driver_laps(year, event, driver, session), "data_source": "FastF1 historical data"}
    except Exception as exc:
        raise HTTPException(503, f"Lap data unavailable: {exc}") from exc


@app.get("/api/sessions/{year}/{event}/telemetry")
def get_telemetry(year: int, event: str, driver: str, lap: int = Query(ge=1), session: str = "R"):
    try:
        points = data.telemetry(year, event, driver, lap, session)
        if not points:
            raise HTTPException(404, "No telemetry available for that driver and lap")
        return {"points": points, "data_source": "FastF1 historical telemetry"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, f"Telemetry unavailable: {exc}") from exc


@app.post("/api/simulations")
def run_simulation(request: SimulationRequest):
    try:
        return simulate(Strategy(**request.model_dump()))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/strategies/optimise")
def run_optimisation(request: OptimiseRequest):
    try:
        return {"results": optimise(**request.model_dump()), "evaluated_limit": "Bounded search over fixed compound patterns and pit windows"}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
