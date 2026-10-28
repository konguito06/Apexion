from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    result = client.get("/api/health").json()
    assert result["status"] == "ok"
    assert result["data_provider"] == "FastF1"


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
    response = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["MEDIUM", "HARD"], "pit_laps": [5]})
    assert response.status_code == 200
    assert response.json()["pit_stops"] == 1
    assert response.json()["strategy"]["pit_laps"] == [5]


def test_invalid_strategy_has_useful_error():
    response = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["SOFT"], "pit_laps": [5]})
    assert response.status_code == 422
    assert "compound" in response.json()["detail"].lower()


def test_optimisation_endpoint():
    response = client.post("/api/strategies/optimise", json={"race_laps": 20, "max_stops": 1})
    assert response.status_code == 200
    assert response.json()["results"]


def test_optimiser_reports_candidate_space_and_supports_three_stops():
    response = client.post("/api/strategies/optimise", json={"race_laps": 30, "max_stops": 3})
    assert response.status_code == 200
    assert response.json()["evaluated"] > len(response.json()["results"])
    assert "four-lap" in response.json()["search_description"]


def test_telemetry_compare_returns_distance_aligned_data(monkeypatch):
    monkeypatch.setattr("app.data.compare_telemetry", lambda **_: {
        "points": [{"distance_percent": 0.0, "first_Speed": 100, "second_Speed": 99}],
        "channels": ["Speed"], "coordinate": "lap distance (%)",
    })
    response = client.post("/api/sessions/telemetry/compare", json={
        "year": 2024, "event": "Example GP", "first_driver": "AAA", "first_lap": 1,
        "second_driver": "BBB", "second_lap": 2,
    })
    assert response.status_code == 200
    assert response.json()["points"][0]["distance_percent"] == 0
    assert response.json()["coordinate"] == "lap distance (%)"


def test_unavailable_fastf1_session_explains_optional_auth(monkeypatch):
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("The data you are trying to access has not been loaded yet. See Session.load")

    monkeypatch.setattr("app.data.session_summary", unavailable)
    response = client.get("/api/sessions/2024/Example%20GP/summary")
    assert response.status_code == 503
    assert "F1_USERNAME and F1_PASSWORD" in response.json()["detail"]
