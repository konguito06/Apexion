import pandas as pd

from app import data


class Laps(pd.DataFrame):
    @property
    def _constructor(self):
        return Laps

    def pick_drivers(self, driver):
        return self[self.Driver == driver]


def session_fixture():
    laps = Laps([
        {"Driver": "AAA", "LapNumber": 1, "LapTime": pd.Timedelta(seconds=92), "Sector1Time": pd.Timedelta(seconds=30), "Sector2Time": pd.Timedelta(seconds=31), "Sector3Time": pd.Timedelta(seconds=31), "Compound": "MEDIUM", "TyreLife": 1, "PitInTime": pd.NaT, "PitOutTime": pd.NaT, "Stint": 1},
        {"Driver": "AAA", "LapNumber": 2, "LapTime": pd.Timedelta(seconds=91), "Sector1Time": pd.Timedelta(seconds=30), "Sector2Time": pd.Timedelta(seconds=30), "Sector3Time": pd.Timedelta(seconds=31), "Compound": "MEDIUM", "TyreLife": 2, "PitInTime": pd.NaT, "PitOutTime": pd.NaT, "Stint": 1},
        {"Driver": "AAA", "LapNumber": 3, "LapTime": pd.Timedelta(seconds=99), "Sector1Time": pd.Timedelta(seconds=33), "Sector2Time": pd.Timedelta(seconds=33), "Sector3Time": pd.Timedelta(seconds=33), "Compound": "HARD", "TyreLife": 1, "PitInTime": pd.Timedelta(seconds=1), "PitOutTime": pd.NaT, "Stint": 2},
    ])
    results = pd.DataFrame([{"Abbreviation": "AAA", "FullName": "Driver A", "TeamName": "Team A", "Position": 1, "GridPosition": 2, "Status": "Finished", "Points": 25, "Time": pd.Timedelta(seconds=270)}])
    return type("Session", (), {"laps": laps, "results": results, "date": "2024-01-01", "event": type("Event", (), {"EventName": "Example GP"})()})()


def test_summary_includes_classification_compounds_distance_and_pit_count(monkeypatch):
    monkeypatch.setattr(data, "_load", lambda *_: session_fixture())
    summary = data.session_summary(2024, "Example GP")
    assert summary["race_laps"] == 3
    assert summary["pit_stops"] == 1
    assert summary["compounds"] == ["HARD", "MEDIUM"]
    assert summary["classification"][0]["driver"] == "AAA"
    assert summary["classification"][0]["time"] == 270


def test_driver_analysis_excludes_pit_lap_and_computes_robust_statistics(monkeypatch):
    monkeypatch.setattr(data, "_load", lambda *_: session_fixture())
    result = data.driver_analysis(2024, "Example GP", "AAA")
    assert result["metrics"]["valid_representative_laps"] == 2
    assert result["metrics"]["median_lap_seconds"] == 91.5
    assert result["metrics"]["interquartile_range_seconds"] == .5
    assert result["stints"][1]["compound"] == "HARD"
