"""Small FastF1 adapter. No fixture data is labelled as historical data."""
from functools import lru_cache
from typing import Any

try:
    import fastf1
    fastf1.Cache.enable_cache(".cache/fastf1")
except Exception:  # FastF1 is optional at import time; API remains available.
    fastf1 = None


def seasons() -> list[int]:
    return list(range(2018, 2027))


@lru_cache(maxsize=24)
def _load(year: int, event: str, session_name: str) -> Any:
    if fastf1 is None:
        raise RuntimeError("FastF1 is not installed")
    session = fastf1.get_session(year, event, session_name)
    session.load(telemetry=True, laps=True, weather=False, messages=False)
    return session


def events(year: int) -> list[dict]:
    if fastf1 is None:
        return []
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        return [{"name": str(row.EventName), "round": int(row.RoundNumber)} for _, row in schedule.iterrows() if int(row.RoundNumber) > 0]
    except Exception as exc:
        raise RuntimeError(f"Could not retrieve {year} event schedule: {exc}") from exc


def session_summary(year: int, event: str, session_name: str = "R") -> dict:
    session = _load(year, event, session_name)
    laps = session.laps
    drivers = sorted(str(x) for x in laps["Driver"].dropna().unique())
    return {"year": year, "event": event, "session": session_name, "date": str(session.date), "drivers": drivers, "laps": int(len(laps)), "data_source": "FastF1 historical data", "status": "loaded"}


def driver_laps(year: int, event: str, driver: str, session_name: str = "R") -> list[dict]:
    session = _load(year, event, session_name)
    laps = session.laps.pick_drivers(driver)
    result = []
    for _, lap in laps.iterrows():
        value = lap.get("LapTime")
        result.append({"lap": int(lap["LapNumber"]), "seconds": round(value.total_seconds(), 3) if value is not None and not getattr(value, "isnat", False) else None, "compound": str(lap.get("Compound", "UNKNOWN")), "tyre_life": None if lap.get("TyreLife") is None else (float(lap["TyreLife"]) if str(lap["TyreLife"]) != "nan" else None), "pit_in": bool(lap.get("PitInTime") is not None), "pit_out": bool(lap.get("PitOutTime") is not None)})
    return result


def telemetry(year: int, event: str, driver: str, lap_number: int, session_name: str = "R") -> list[dict]:
    session = _load(year, event, session_name)
    lap = session.laps.pick_drivers(driver).pick_laps(lap_number)
    if lap.empty:
        return []
    data = lap.iloc[0].get_telemetry().add_distance()
    fields = [name for name in ("Distance", "Speed", "Throttle", "Brake", "nGear", "RPM", "DRS") if name in data]
    return [{field: (float(row[field]) if field in fields and str(row[field]) != "nan" else None) for field in fields} for _, row in data.iterrows()]
