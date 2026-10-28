import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from . import data
from .simulation import Strategy, optimise_with_metadata, simulate

app = FastAPI(title="Apexion API", version="0.1.0", description="Historical F1 data and transparent strategy simulation")
cors_origins = [origin.strip() for origin in os.getenv("APEXION_CORS_ORIGINS", "http://localhost:5173,http://localhost:8080").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


class SimulationRequest(BaseModel):
    race_laps: int = Field(ge=1, le=100)
    compounds: list[str]
    pit_laps: list[int]
    baseline_pace_seconds: float = Field(default=90.0, gt=0)
    pit_loss_seconds: float = Field(default=22.0, ge=0, le=120)
    degradation_seconds_per_lap: float = Field(default=0.075, ge=0, le=2)

    @field_validator("compounds")
    @classmethod
    def validate_compound_count(cls, value, info):
        pit_laps = info.data.get("pit_laps")
        if pit_laps is not None and len(value) != len(pit_laps) + 1:
            raise ValueError("Provide one compound for each stint")
        return value


class OptimiseRequest(BaseModel):
    race_laps: int = Field(ge=1, le=100)
    pit_loss_seconds: float = Field(default=22.0, ge=0, le=120)
    max_stops: int = Field(default=2, ge=0, le=3)


class TelemetryCompareRequest(BaseModel):
    year: int = Field(ge=2018)
    event: str = Field(min_length=1, max_length=100)
    first_driver: str = Field(min_length=1, max_length=5)
    first_lap: int = Field(ge=1, le=100)
    second_driver: str = Field(min_length=1, max_length=5)
    second_lap: int = Field(ge=1, le=100)
    session: str = Field(default="R", max_length=20)

    @field_validator("year")
    @classmethod
    def validate_supported_season(cls, value):
        if value > max(data.seasons()):
            raise ValueError(f"Season must be between 2018 and {max(data.seasons())}")
        return value


def _source_error(feature: str, exc: Exception) -> str:
    if "not been loaded yet" in str(exc).lower() or "datanotloaded" in type(exc).__name__.lower():
        return f"FastF1 could not load {feature}. Check upstream availability; the current F1 timing feed may require F1_USERNAME and F1_PASSWORD."
    return f"{feature} unavailable: {exc}"


@app.get("/api/health")
def health():
    return {"status": "ok", "data_provider": "FastF1" if data.fastf1 else "unavailable"}


@app.get("/api/seasons")
def get_seasons():
    return {"seasons": data.seasons()}


@app.get("/api/events")
def get_events(season: int = Query(ge=2018)):
    if season not in data.seasons():
        raise HTTPException(422, f"Season must be between 2018 and {max(data.seasons())}")
    try:
        return {"season": season, "events": data.events(season)}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/sessions/{year}/{event}/drivers")
def get_drivers(year: int, event: str, session: str = "R"):
    try:
        summary = data.session_summary(year, event, session)
        return {"drivers": summary["drivers"], "data_source": summary["data_source"]}
    except Exception as exc:
        raise HTTPException(503, _source_error("driver list", exc)) from exc


@app.get("/api/sessions/{year}/{event}/summary")
def get_summary(year: int, event: str, session: str = "R"):
    try:
        return data.session_summary(year, event, session)
    except Exception as exc:
        raise HTTPException(503, _source_error("session data", exc)) from exc


@app.get("/api/sessions/{year}/{event}/laps")
def get_laps(year: int, event: str, driver: str, session: str = "R"):
    try:
        return {"laps": data.driver_laps(year, event, driver, session), "data_source": "FastF1 historical data"}
    except Exception as exc:
        raise HTTPException(503, _source_error("lap data", exc)) from exc


@app.get("/api/sessions/{year}/{event}/drivers/{driver}/analysis")
def get_driver_analysis(year: int, event: str, driver: str, session: str = "R"):
    try:
        return data.driver_analysis(year, event, driver, session)
    except Exception as exc:
        raise HTTPException(503, _source_error("driver analysis", exc)) from exc


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
        raise HTTPException(503, _source_error("telemetry", exc)) from exc


@app.post("/api/sessions/telemetry/compare")
def compare_telemetry(request: TelemetryCompareRequest):
    try:
        result = data.compare_telemetry(**request.model_dump())
        if not result["points"]:
            raise HTTPException(404, "Compatible telemetry is unavailable for both selected laps")
        return {**result, "data_source": "FastF1 historical telemetry"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, _source_error("telemetry comparison", exc)) from exc


@app.post("/api/simulations")
def run_simulation(request: SimulationRequest):
    try:
        return simulate(Strategy(**request.model_dump()))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/strategies/optimise")
def run_optimisation(request: OptimiseRequest):
    try:
        return optimise_with_metadata(**request.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
