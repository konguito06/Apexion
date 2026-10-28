import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator, model_validator

from . import data, evaluation
from .simulation import DEFAULT_BASELINE_PACE_SECONDS, DEFAULT_DEGRADATION_SECONDS_PER_LAP, DEFAULT_PIT_LOSS_SECONDS, Strategy, optimise_with_metadata, simulate

app = FastAPI(title="Apexion API", version="0.1.0", description="Historical F1 data and transparent strategy simulation")
cors_origins = [origin.strip() for origin in os.getenv("APEXION_CORS_ORIGINS", "").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=cors_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


class SimulationRequest(BaseModel):
    race_laps: int = Field(ge=1, le=100)
    compounds: list[str] = Field(min_length=1, max_length=100)
    pit_laps: list[int] = Field(max_length=99)
    baseline_pace_seconds: float = Field(default=DEFAULT_BASELINE_PACE_SECONDS, gt=0, le=200, allow_inf_nan=False)
    pit_loss_seconds: float = Field(default=DEFAULT_PIT_LOSS_SECONDS, ge=0, le=120, allow_inf_nan=False)
    degradation_seconds_per_lap: float = Field(default=DEFAULT_DEGRADATION_SECONDS_PER_LAP, ge=0, le=2, allow_inf_nan=False)
    baseline_pace_source: str = Field(default="Illustrative configurable assumption", min_length=1, max_length=200)
    degradation_source: str = Field(default="Illustrative configurable assumption", min_length=1, max_length=200)
    year: int | None = Field(default=None, ge=2018)
    event: str | None = Field(default=None, max_length=100)
    session: str | None = Field(default=None, max_length=30)
    driver: str | None = Field(default=None, max_length=5)

    @model_validator(mode="after")
    def validate_strategy_shape(self):
        if len(self.compounds) != len(self.pit_laps) + 1:
            raise ValueError("Provide one compound for each stint")
        if self.pit_laps != sorted(set(self.pit_laps)) or any(lap < 1 or lap >= self.race_laps for lap in self.pit_laps):
            raise ValueError("Pit laps must be strictly increasing and between lap 1 and the final lap minus one")
        if any(compound not in {"SOFT", "MEDIUM", "HARD"} for compound in self.compounds):
            raise ValueError("Compounds must be SOFT, MEDIUM, or HARD")
        if not self.baseline_pace_source.strip() or not self.degradation_source.strip():
            raise ValueError("Model parameter sources must be identified")
        return self

    @field_validator("year")
    @classmethod
    def validate_supported_year(cls, value):
        if value is not None and value > max(data.seasons()):
            raise ValueError(f"Season must be between 2018 and {max(data.seasons())}")
        return value


class OptimiseRequest(BaseModel):
    race_laps: int = Field(ge=1, le=100)
    pit_loss_seconds: float = Field(default=DEFAULT_PIT_LOSS_SECONDS, ge=0, le=120, allow_inf_nan=False)
    max_stops: int = Field(default=2, ge=0, le=3)
    baseline_pace_seconds: float = Field(default=DEFAULT_BASELINE_PACE_SECONDS, gt=0, le=200, allow_inf_nan=False)
    degradation_seconds_per_lap: float = Field(default=DEFAULT_DEGRADATION_SECONDS_PER_LAP, ge=0, le=2, allow_inf_nan=False)
    baseline_pace_source: str = Field(default="Illustrative configurable assumption", min_length=1, max_length=200)
    degradation_source: str = Field(default="Illustrative configurable assumption", min_length=1, max_length=200)
    year: int | None = Field(default=None, ge=2018)
    event: str | None = Field(default=None, max_length=100)
    session: str | None = Field(default=None, max_length=30)
    driver: str | None = Field(default=None, max_length=5)

    @field_validator("year")
    @classmethod
    def validate_supported_year(cls, value):
        if value is not None and value > max(data.seasons()):
            raise ValueError(f"Season must be between 2018 and {max(data.seasons())}")
        return value


class SimulationStint(BaseModel):
    start_lap: int
    end_lap: int
    laps: int
    compound: str
    baseline_pace_contribution_seconds: float
    compound_adjustment_seconds: float
    degradation_seconds: float
    green_flag_seconds: float
    pit_loss_after_seconds: float
    estimated_seconds: float


class SimulationLap(BaseModel):
    lap: int
    seconds: float
    compound: str
    tyre_age: int
    compound_adjustment_seconds: float
    degradation_seconds: float


class PitStopDetail(BaseModel):
    stop_number: int
    after_lap: int
    pit_loss_seconds: float
    old_compound: str
    new_compound: str


class SimulationStrategy(BaseModel):
    race_laps: int
    pit_laps: list[int]
    compounds: list[str]
    year: int | None = None
    event: str | None = None
    session: str | None = None
    driver: str | None = None


class SimulationAssumptions(BaseModel):
    model: str
    lap_time_equation: str
    baseline_pace_seconds: float
    baseline_pace_source: str
    compound_adjustments_seconds: dict[str, float]
    degradation_seconds_per_lap_of_tyre_age: float
    degradation_source: str
    pit_loss_seconds_per_stop: float
    pit_loss_convention: str
    in_lap_out_lap_convention: str
    tyre_age_convention: str
    data_context: dict[str, str | int | None]
    known_limitations: str


class SimulationResponse(BaseModel):
    total_seconds: float
    green_flag_seconds: float
    pit_stops: int
    pit_loss_seconds: float
    baseline_total_seconds: float
    baseline_description: str
    delta_vs_baseline_seconds: float
    stints: list[SimulationStint]
    pit_stop_details: list[PitStopDetail]
    lap_curve: list[SimulationLap]
    strategy: SimulationStrategy
    assumptions: SimulationAssumptions
    explanations: list[str]


class OptimiseResponse(BaseModel):
    results: list[SimulationResponse]
    evaluated: int
    candidate_space_size: int
    candidate_limit: int
    pit_lap_grid_step: int
    minimum_stint_laps: int
    max_stops: int
    exhaustive_within_constraints: bool
    regulatory_constraints_applied: list[str]
    search_description: str


class StrategyBaselineResponse(BaseModel):
    baseline_pace_seconds: float
    degradation_seconds_per_lap: float
    baseline_pace_source: str
    degradation_source: str
    representative_laps: int
    degradation_pair_slopes: int
    fit_status: str
    limitations: str
    year: int
    event: str
    session: str
    driver: str
    data_source: str


class ModelEvaluationReport(BaseModel):
    status: str
    model_version: str
    prediction_target: str
    split_methodology: str
    lap_filter: str
    data_source: str
    training_races: list[str]
    test_races: list[str]
    training_metadata: dict[str, object]
    metrics: dict[str, float | int] | None
    baseline_metrics: dict[str, float | int] | None
    per_race_metrics: list[dict[str, object]]
    exclusions: dict[str, int]
    advanced_model: dict[str, object]
    limitations: list[str]
    message: str | None = None
    baseline_comparison: dict[str, object] | None = None
    generated_at: str | None = None


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


@app.get("/api/models/metrics", response_model=ModelEvaluationReport)
def get_model_metrics():
    """Return only a saved, actually executed evaluation report."""
    return evaluation.load_report()


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


@app.get("/api/sessions/{year}/{event}/drivers/{driver}/strategy-baseline", response_model=StrategyBaselineResponse)
def get_strategy_baseline(year: int, event: str, driver: str, session: str = "R"):
    try:
        return data.strategy_baseline(year, event, driver, session)
    except Exception as exc:
        raise HTTPException(503, _source_error("strategy baseline", exc)) from exc


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


@app.post("/api/simulations", response_model=SimulationResponse)
def run_simulation(request: SimulationRequest):
    try:
        return simulate(Strategy(**request.model_dump()))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/strategies/optimise", response_model=OptimiseResponse)
async def run_optimisation(request: OptimiseRequest):
    try:
        return await run_in_threadpool(optimise_with_metadata, **request.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
