from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    result = client.get("/api/health").json()
    assert result["status"] == "ok"
    assert result["data_provider"] == "FastF1"


def test_model_metrics_endpoint_returns_saved_report_without_claiming_unrun_results(monkeypatch):
    from app.evaluation import unavailable_report

    monkeypatch.setattr("app.evaluation.load_report", unavailable_report)
    response = client.get("/api/models/metrics")
    assert response.status_code == 200
    assert response.json()["status"] == "not_run"
    assert response.json()["metrics"] is None
    assert response.json()["advanced_model"]["status"] == "not_evaluated"


def test_seasons_endpoint_tracks_current_supported_season():
    from datetime import datetime

    response = client.get("/api/seasons")
    assert response.status_code == 200
    assert response.json()["seasons"][0] == 2018
    assert response.json()["seasons"][-1] == datetime.now().year


def test_events_endpoint_returns_dynamic_schedule(monkeypatch):
    monkeypatch.setattr("app.data.events", lambda year: [{"name": "Example GP", "round": 1, "sessions": ["Practice 1", "Race"]}])

    response = client.get("/api/events?season=2024")

    assert response.status_code == 200
    assert response.json()["events"][0]["sessions"] == ["Practice 1", "Race"]


def test_events_endpoint_rejects_unsupported_future_season():
    response = client.get("/api/events?season=2099")
    assert response.status_code == 422
    assert "2018" in response.json()["detail"]


def test_events_endpoint_explains_unavailable_source(monkeypatch):
    def unavailable(_year):
        raise RuntimeError("Check your connection or configure F1 account credentials")

    monkeypatch.setattr("app.data.events", unavailable)
    response = client.get("/api/events?season=2024")

    assert response.status_code == 503
    assert "credentials" in response.json()["detail"]


def test_simulation_endpoint():
    response = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["MEDIUM", "HARD"], "pit_laps": [5], "baseline_pace_seconds": 92, "degradation_seconds_per_lap": 0.1, "year": 2024, "event": "Example GP", "session": "R", "driver": "AAA"})
    assert response.status_code == 200
    result = response.json()
    assert result["pit_stops"] == 1
    assert result["strategy"]["pit_laps"] == [5]
    assert len(result["lap_curve"]) == 10
    assert result["stints"][0]["laps"] == 5
    assert result["assumptions"]["data_context"] == {"year": 2024, "event": "Example GP", "session": "R", "driver": "AAA"}
    assert result["delta_vs_baseline_seconds"] == result["total_seconds"] - result["baseline_total_seconds"]


def test_simulation_endpoint_rejects_pit_lap_at_finish_and_unordered_stops():
    at_finish = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["SOFT", "HARD"], "pit_laps": [10]})
    unordered = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["SOFT", "HARD", "MEDIUM"], "pit_laps": [6, 3]})
    assert at_finish.status_code == 422
    assert unordered.status_code == 422


def test_invalid_strategy_has_useful_error():
    response = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["SOFT"], "pit_laps": [5]})
    assert response.status_code == 422
    assert "compound" in str(response.json()["detail"]).lower()


def test_optimisation_endpoint():
    response = client.post("/api/strategies/optimise", json={"race_laps": 20, "max_stops": 1})
    assert response.status_code == 200
    assert response.json()["results"]


def test_optimiser_accepts_same_model_parameters_and_context_as_manual_simulation():
    response = client.post("/api/strategies/optimise", json={"race_laps": 20, "max_stops": 1, "baseline_pace_seconds": 92, "degradation_seconds_per_lap": .1, "baseline_pace_source": "fixture fit", "degradation_source": "fixture fit", "year": 2024, "event": "Example GP", "session": "R", "driver": "AAA"})
    assert response.status_code == 200
    for candidate in response.json()["results"]:
        assert candidate["assumptions"]["baseline_pace_seconds"] == 92
        assert candidate["assumptions"]["data_context"]["driver"] == "AAA"


def test_optimiser_reports_candidate_space_and_supports_three_stops():
    response = client.post("/api/strategies/optimise", json={"race_laps": 30, "max_stops": 3})
    assert response.status_code == 200
    assert response.json()["evaluated"] > len(response.json()["results"])
    result = response.json()
    assert result["minimum_stint_laps"] == 4
    assert result["candidate_space_size"] == result["evaluated"]
    assert result["evaluated"] <= result["candidate_limit"] == 5000
    assert result["max_stops"] == 3
    assert "minimum 4-lap stints" in result["search_description"]
    assert "No season-specific tyre regulation constraints" in result["search_description"]


def test_telemetry_compare_returns_distance_aligned_data(monkeypatch):
    monkeypatch.setattr("app.data.compare_telemetry", lambda **_: {
        "points": [{"distance_m": 0.0, "first_Speed": 100, "second_Speed": 99, "time_delta_seconds": 0.0}],
        "channels": ["Speed"], "coordinate": "distance_m",
        "lap_time_delta_seconds": 1.2,
        "sector_time_deltas_seconds": {"sector_1": .2},
    })
    response = client.post("/api/sessions/telemetry/compare", json={
        "year": 2024, "event": "Example GP", "first_driver": "AAA", "first_lap": 1,
        "second_driver": "BBB", "second_lap": 2,
    })
    assert response.status_code == 200
    assert response.json()["points"][0]["distance_m"] == 0
    assert response.json()["coordinate"] == "distance_m"
    assert response.json()["lap_time_delta_seconds"] == 1.2


def test_unavailable_fastf1_session_explains_optional_auth(monkeypatch):
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("The data you are trying to access has not been loaded yet. See Session.load")

    monkeypatch.setattr("app.data.session_summary", unavailable)
    response = client.get("/api/sessions/2024/Example%20GP/summary")
    assert response.status_code == 503
    assert "F1_USERNAME and F1_PASSWORD" in response.json()["detail"]


def test_strategy_baseline_endpoint_returns_fit_provenance(monkeypatch):
    monkeypatch.setattr("app.data.strategy_baseline", lambda year, event, driver, session: {
        "baseline_pace_seconds": 91.25,
        "degradation_seconds_per_lap": .08,
        "baseline_pace_source": "fixture historical median",
        "degradation_source": "fixture within-stint fit",
        "representative_laps": 18,
        "degradation_pair_slopes": 25,
        "fit_status": "historical pace and degradation fit",
        "limitations": "Descriptive only.",
        "year": year, "event": event, "session": session, "driver": driver,
        "data_source": "FastF1 representative laps",
    })
    response = client.get("/api/sessions/2024/Example%20GP/drivers/AAA/strategy-baseline?session=R")
    assert response.status_code == 200
    assert response.json()["baseline_pace_seconds"] == 91.25
    assert response.json()["data_source"] == "FastF1 representative laps"
