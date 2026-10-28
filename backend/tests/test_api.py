from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    assert client.get("/api/health").json()["status"] == "ok"


def test_simulation_endpoint():
    response = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["MEDIUM", "HARD"], "pit_laps": [5]})
    assert response.status_code == 200
    assert response.json()["pit_stops"] == 1


def test_invalid_strategy_has_useful_error():
    response = client.post("/api/simulations", json={"race_laps": 10, "compounds": ["SOFT"], "pit_laps": [5]})
    assert response.status_code == 422
    assert "compound" in response.json()["detail"].lower()


def test_optimisation_endpoint():
    response = client.post("/api/strategies/optimise", json={"race_laps": 20, "max_stops": 1})
    assert response.status_code == 200
    assert response.json()["results"]
