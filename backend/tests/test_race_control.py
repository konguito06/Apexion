import pandas as pd

from app import race_control


def td(seconds):
    return pd.to_timedelta(seconds, unit="s")


def race_session():
    laps = pd.DataFrame([
        # Lap starts: lap 1 at 0 s, lap 2 at 100 s, lap 3 at 200 s, lap 4 at 330 s, lap 5 at 430 s.
        {"Driver": "AAA", "LapNumber": 1, "LapStartTime": td(0), "LapTime": td(100), "Compound": "MEDIUM", "PitInTime": pd.NaT, "PitOutTime": pd.NaT,
         "Sector1Time": td(30), "Sector2Time": td(35), "Sector3Time": td(35), "Deleted": False, "DeletedReason": "", "IsPersonalBest": True, "TyreLife": 1},
        {"Driver": "AAA", "LapNumber": 2, "LapStartTime": td(100), "LapTime": td(100), "Compound": "MEDIUM", "PitInTime": td(195), "PitOutTime": pd.NaT,
         "Sector1Time": td(30), "Sector2Time": td(35), "Sector3Time": td(35), "Deleted": False, "DeletedReason": "", "IsPersonalBest": False, "TyreLife": 2},
        {"Driver": "AAA", "LapNumber": 3, "LapStartTime": td(200), "LapTime": td(130), "Compound": "HARD", "PitInTime": pd.NaT, "PitOutTime": td(216.5),
         "Sector1Time": td(50), "Sector2Time": td(40), "Sector3Time": td(40), "Deleted": False, "DeletedReason": "", "IsPersonalBest": False, "TyreLife": 1},
        {"Driver": "AAA", "LapNumber": 4, "LapStartTime": td(330), "LapTime": td(100), "Compound": "HARD", "PitInTime": pd.NaT, "PitOutTime": pd.NaT,
         "Sector1Time": td(29), "Sector2Time": td(36), "Sector3Time": td(35), "Deleted": True, "DeletedReason": "TRACK LIMITS AT TURN 4", "IsPersonalBest": False, "TyreLife": 2},
        {"Driver": "AAA", "LapNumber": 5, "LapStartTime": td(430), "LapTime": td(100), "Compound": "HARD", "PitInTime": pd.NaT, "PitOutTime": pd.NaT,
         "Sector1Time": td(30), "Sector2Time": td(35), "Sector3Time": td(35), "Deleted": False, "DeletedReason": "", "IsPersonalBest": False, "TyreLife": 3},
    ])
    track_status = pd.DataFrame([
        {"Time": td(0), "Status": "1"},
        {"Time": td(150), "Status": "2"},
        {"Time": td(160), "Status": "4"},
        {"Time": td(340), "Status": "1"},
    ])
    messages = pd.DataFrame([
        {"Category": "Flag", "Flag": "YELLOW", "Message": "YELLOW IN TRACK SECTOR 15", "Lap": 2, "Sector": 15},
        {"Category": "SafetyCar", "Flag": None, "Message": "SAFETY CAR DEPLOYED", "Lap": 2, "Sector": None},
        {"Category": "Flag", "Flag": "BLUE", "Message": "WAVED BLUE FLAG FOR CAR 2 (SAR)", "Lap": 3, "Sector": None},
        {"Category": "Other", "Flag": None, "Message": "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 11 (PER) - UNSAFE RELEASE", "Lap": 3, "Sector": None},
        {"Category": "Other", "Flag": None, "Message": "FIA STEWARDS: INCIDENT INVOLVING CAR 4 (NOR) NO FURTHER ACTION - JUMP START", "Lap": 3, "Sector": None},
        {"Category": "Other", "Flag": None, "Message": "CAR 20 (MAG) TIME 1:39.463 DELETED - TRACK LIMITS AT TURN 4 LAP 3", "Lap": 4, "Sector": None},
        {"Category": "Other", "Flag": None, "Message": "DRS ENABLED", "Lap": 5, "Sector": None},
    ])
    return type("Session", (), {"laps": laps, "track_status": track_status, "race_control_messages": messages})()


def test_track_periods_map_status_times_to_laps():
    periods = race_control.track_periods(race_session())
    assert [(period["kind"], period["start_lap"], period["end_lap"]) for period in periods] == [("yellow", 2, 2), ("safety_car", 2, 4)]


def test_race_events_keep_flags_safety_cars_penalties_and_deleted_laps_only():
    events = race_control.race_events(race_session())
    assert [event["kind"] for event in events] == ["yellow", "safety_car", "penalty", "lap_deleted"]
    assert events[2]["drivers"] == ["PER"]
    assert events[0]["sector"] == 15


def test_restart_follows_each_safety_car_period():
    restarts = race_control.restarts(race_control.track_periods(race_session()))
    assert restarts == [{"kind": "restart", "lap": 5, "sector": None, "message": "Restart after safety car", "drivers": []}]


def test_pit_stops_measure_pit_lane_time_and_tyre_change():
    session = race_session()
    stops = race_control.pit_stops(session, race_control.track_periods(session))
    assert stops == [{"driver": "AAA", "lap": 2, "from_compound": "MEDIUM", "to_compound": "HARD", "pit_lane_seconds": 21.5, "under": "safety_car"}]


def test_session_timing_carries_sectors_and_lap_flags():
    laps = race_control.session_timing(race_session())
    assert laps[0]["sector_1"] == 30 and laps[0]["personal_best"] is True
    assert laps[3]["deleted"] is True and laps[3]["deleted_reason"] == "TRACK LIMITS AT TURN 4"
    assert laps[2]["pit_out"] is True
