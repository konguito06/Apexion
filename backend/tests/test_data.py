import pandas as pd
import pytest
from datetime import datetime

from app import data


class Laps(pd.DataFrame):
    @property
    def _constructor(self):
        return Laps

    def pick_drivers(self, driver):
        return self[self.Driver == driver]


def seconds(value):
    return pd.to_timedelta(value, unit="s")


def session_fixture():
    laps = Laps([
        {"Driver": "AAA", "LapNumber": 1, "LapTime": seconds(92), "Sector1Time": seconds(30), "Sector2Time": seconds(31), "Sector3Time": seconds(31), "Compound": "MEDIUM", "TyreLife": 1, "PitInTime": pd.NaT, "PitOutTime": pd.NaT, "Stint": 1},
        {"Driver": "AAA", "LapNumber": 2, "LapTime": seconds(91), "Sector1Time": seconds(30), "Sector2Time": seconds(30), "Sector3Time": seconds(31), "Compound": "MEDIUM", "TyreLife": 2, "PitInTime": pd.NaT, "PitOutTime": pd.NaT, "Stint": 1},
        {"Driver": "AAA", "LapNumber": 3, "LapTime": seconds(99), "Sector1Time": seconds(33), "Sector2Time": seconds(33), "Sector3Time": seconds(33), "Compound": "HARD", "TyreLife": 1, "PitInTime": seconds(1), "PitOutTime": pd.NaT, "Stint": 2},
    ])
    results = pd.DataFrame([{"Abbreviation": "AAA", "FullName": "Driver A", "TeamName": "Team A", "Position": 1, "GridPosition": 2, "Status": "Finished", "Points": 25, "Time": seconds(270)}])
    return type("Session", (), {"laps": laps, "results": results, "date": "2024-01-01", "event": type("Event", (), {"EventName": "Example GP"})()})()


def test_summary_includes_classification_compounds_distance_and_pit_count(monkeypatch):
    monkeypatch.setattr(data, "_load", lambda *_: session_fixture())
    summary = data.session_summary(2024, "Example GP")
    assert summary["race_laps"] == 3
    assert summary["pit_stops"] == 1
    assert summary["compounds"] == ["HARD", "MEDIUM"]
    assert summary["classification"][0]["driver"] == "AAA"
    assert summary["classification"][0]["time"] == 270
    assert summary["status"] == "loaded"


def test_seasons_follow_current_calendar_year():
    assert data.seasons()[0] == 2018
    assert data.seasons()[-1] == datetime.now().year


def test_event_schedule_is_cached_and_normalized(monkeypatch):
    calls = []
    schedule = pd.DataFrame([
        {"RoundNumber": 1, "EventName": "Opening GP", "Session1": "Practice 1", "Session2": "Race"},
        {"RoundNumber": 0, "EventName": "Pre-season test", "Session1": "Practice 1"},
    ])
    provider = type("FastF1", (), {"get_event_schedule": staticmethod(lambda year, **kwargs: calls.append((year, kwargs)) or schedule)})
    monkeypatch.setattr(data, "fastf1", provider)
    data.events.cache_clear()

    first = data.events(2024)
    second = data.events(2024)

    assert first == [{"name": "Opening GP", "round": 1, "sessions": ["Practice 1", "Race"]}]
    assert second == first
    assert calls == [(2024, {"include_testing": False})]
    data.events.cache_clear()


def test_session_loader_caches_loaded_session(monkeypatch):
    calls = []
    session = session_fixture()
    session.load = lambda **_: None
    provider = type("FastF1", (), {"get_session": staticmethod(lambda *args: calls.append(args) or session)})
    monkeypatch.setattr(data, "fastf1", provider)
    data._load.cache_clear()

    first = data._load(2024, "Example GP", "Race")
    second = data._load(2024, "Example GP", "Race")

    assert first is second is session
    assert calls == [(2024, "Example GP", "Race")]
    data._load.cache_clear()


def test_evaluation_lap_loader_requests_timing_without_telemetry_and_normalizes_quality(monkeypatch):
    session = session_fixture()
    session.laps["TrackStatus"] = ["1", "1", "4"]
    session.laps["IsAccurate"] = [True, False, True]
    calls = []
    session.load = lambda **kwargs: calls.append(kwargs)
    provider = type("FastF1", (), {"get_session": staticmethod(lambda *args: session)})
    monkeypatch.setattr(data, "fastf1", provider)
    data._load_laps_for_evaluation.cache_clear()

    observations = data.evaluation_laps(2024, "Example GP")

    assert calls == [{"telemetry": False, "laps": True, "weather": False, "messages": False}]
    assert observations[0]["seconds"] == 92
    assert observations[0]["track_status"] == "1"
    assert observations[0]["is_accurate"] is True
    assert observations[2]["track_status"] == "4"
    assert observations[2]["pit_in"] is True
    data._load_laps_for_evaluation.cache_clear()


def test_partial_session_keeps_classification_without_inventing_laps(monkeypatch):
    session = session_fixture()
    session.laps = Laps(columns=["Driver", "LapNumber", "LapTime", "Compound", "PitInTime"])
    monkeypatch.setattr(data, "_load", lambda *_: session)

    summary = data.session_summary(2024, "Example GP")

    assert summary["status"] == "partial"
    assert summary["lap_observations"] == 0
    assert summary["race_laps"] == 0
    assert summary["drivers"] == ["AAA"]
    assert summary["classification"][0]["driver"] == "AAA"


def test_driver_analysis_excludes_pit_lap_and_computes_robust_statistics(monkeypatch):
    monkeypatch.setattr(data, "_load", lambda *_: session_fixture())
    result = data.driver_analysis(2024, "Example GP", "AAA")
    assert result["metrics"]["valid_representative_laps"] == 2
    assert result["metrics"]["median_lap_seconds"] == 91.5
    assert result["metrics"]["interquartile_range_seconds"] == .5
    assert result["stints"][1]["compound"] == "HARD"


def test_telemetry_alignment_uses_shared_absolute_distance_and_elapsed_time():
    first = [
        {"Distance": 0, "Speed": 100, "Throttle": 20, "Brake": 1, "time_seconds": 0},
        {"Distance": 100, "Speed": 200, "Throttle": 80, "Brake": 0, "time_seconds": 10},
        {"Distance": 200, "Speed": 300, "Throttle": 100, "Brake": 0, "time_seconds": 20},
    ]
    second = [
        {"Distance": 0, "Speed": 90, "Throttle": 20, "Brake": 1, "time_seconds": 0},
        {"Distance": 100, "Speed": 180, "Throttle": 80, "Brake": 0, "time_seconds": 12},
        {"Distance": 200, "Speed": 270, "Throttle": 100, "Brake": 0, "time_seconds": 24},
    ]

    result = data.align_telemetry_points(first, second)

    assert result["coordinate"] == "distance_m"
    assert result["channels"] == ["Speed", "Throttle", "Brake"]
    assert len(result["points"]) == 201
    assert result["points"][100]["distance_m"] == 100
    assert result["points"][100]["first_Speed"] == 200
    assert result["points"][100]["time_delta_seconds"] == 2


def test_telemetry_alignment_handles_non_overlapping_or_missing_channels():
    result = data.align_telemetry_points(
        [{"Distance": 0, "Speed": 1}, {"Distance": 1, "Speed": 2}],
        [{"Distance": 2, "Throttle": 10}, {"Distance": 3, "Throttle": 20}],
    )
    assert result["points"] == []
    assert result["channels"] == []


def test_compare_telemetry_includes_exact_lap_and_sector_deltas(monkeypatch):
    points = [
        {"Distance": 0, "Speed": 100, "time_seconds": 0},
        {"Distance": 100, "Speed": 200, "time_seconds": 10},
    ]
    monkeypatch.setattr(data, "telemetry", lambda *_: points)
    monkeypatch.setattr(data, "driver_laps", lambda *_args: [
        {"lap": 1, "seconds": 90.0, "sector_1": 30.0, "sector_2": 30.0, "sector_3": 30.0},
        {"lap": 2, "seconds": 91.2, "sector_1": 30.4, "sector_2": 30.1, "sector_3": 30.7},
    ])

    result = data.compare_telemetry(2024, "Example GP", "AAA", 1, "BBB", 2)

    assert result["lap_time_delta_seconds"] == 1.2
    assert result["sector_time_deltas_seconds"] == {"sector_1": .4, "sector_2": .1, "sector_3": .7}


def test_empty_upstream_session_returns_actionable_error(monkeypatch):
    class EmptySession:
        laps = pd.DataFrame()

        def load(self, **_):
            return None

    provider = type("FastF1", (), {"get_session": staticmethod(lambda *_: EmptySession())})
    monkeypatch.setattr(data, "fastf1", provider)
    data._load.cache_clear()
    with pytest.raises(RuntimeError, match="F1_USERNAME and F1_PASSWORD"):
        data._load(2000, "Unavailable", "Race")
    data._load.cache_clear()


def test_unloaded_session_metadata_error_gets_credentials_guidance(monkeypatch):
    class UnloadedSession:
        laps = Laps([{"Driver": "AAA", "LapNumber": 1, "LapTime": pd.NaT, "Compound": "MEDIUM"}])
        results = pd.DataFrame()

        @property
        def date(self):
            raise RuntimeError("The data you are trying to access has not been loaded yet. See Session.load")

    monkeypatch.setattr(data, "_load", lambda *_: UnloadedSession())
    with pytest.raises(RuntimeError, match="F1_USERNAME and F1_PASSWORD"):
        data.session_summary(2024, "Example GP")
