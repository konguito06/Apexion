"""FastF1 adapter with normalized, provenance-preserving response shapes."""
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import fastf1
    import pandas as pd

    cache_dir = Path(__file__).resolve().parents[1] / ".cache" / "fastf1"
    cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.configure(cache_dir=str(cache_dir))
except Exception:  # Keep simulation/API startup available if FastF1 is absent.
    fastf1 = None
    pd = None


def seasons() -> list[int]:
    return list(range(2018, 2027))


def _missing(value: Any) -> bool:
    if value is None:
        return True
    if pd is not None:
        try:
            return bool(pd.isna(value))
        except (TypeError, ValueError):
            pass
    return False


def _number(value: Any) -> float | None:
    return None if _missing(value) else float(value)


def _seconds(value: Any) -> float | None:
    return None if _missing(value) else round(value.total_seconds(), 3)


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
        result = []
        for _, row in schedule.iterrows():
            round_number = int(row.RoundNumber)
            if round_number <= 0:
                continue
            sessions = [str(row.get(f"Session{i}")) for i in range(1, 6) if not _missing(row.get(f"Session{i}"))]
            result.append({"name": str(row.EventName), "round": round_number, "sessions": sessions})
        return result
    except Exception as exc:
        raise RuntimeError(f"Could not retrieve {year} event schedule: {exc}") from exc


def _classification(session: Any) -> list[dict]:
    results = getattr(session, "results", None)
    if results is None or results.empty:
        return []
    columns = {
        "Abbreviation": "driver", "FullName": "name", "TeamName": "team",
        "Position": "position", "GridPosition": "grid", "Status": "status",
        "Points": "points", "Time": "time",
    }
    rows = []
    for _, item in results.iterrows():
        entry = {}
        for source, target in columns.items():
            value = item.get(source)
            if target in ("position", "grid", "points"):
                entry[target] = _number(value)
            elif target == "time":
                entry[target] = _seconds(value)
            else:
                entry[target] = None if _missing(value) else str(value)
        rows.append(entry)
    return rows


def session_summary(year: int, event: str, session_name: str = "R") -> dict:
    session = _load(year, event, session_name)
    laps = session.laps
    compounds = sorted(str(value) for value in laps["Compound"].dropna().unique()) if "Compound" in laps else []
    pit_stops = int(laps["PitInTime"].notna().sum()) if "PitInTime" in laps else 0
    max_lap = int(laps["LapNumber"].max()) if len(laps) and "LapNumber" in laps else 0
    event_name = str(getattr(getattr(session, "event", {}), "EventName", event))
    return {
        "year": year, "event": event_name, "session": session_name,
        "date": str(session.date), "drivers": sorted(str(x) for x in laps["Driver"].dropna().unique()),
        "race_laps": max_lap, "lap_observations": int(len(laps)), "pit_stops": pit_stops,
        "compounds": compounds, "classification": _classification(session),
        "data_source": "FastF1 historical data", "status": "loaded",
    }


def driver_laps(year: int, event: str, driver: str, session_name: str = "R") -> list[dict]:
    session = _load(year, event, session_name)
    laps = session.laps.pick_drivers(driver)
    fields = ("Sector1Time", "Sector2Time", "Sector3Time")
    result = []
    for _, lap in laps.iterrows():
        value = lap.get("LapTime")
        result.append({
            "lap": int(lap["LapNumber"]), "seconds": _seconds(value),
            "sector_1": _seconds(lap.get(fields[0])), "sector_2": _seconds(lap.get(fields[1])),
            "sector_3": _seconds(lap.get(fields[2])),
            "compound": "UNKNOWN" if _missing(lap.get("Compound")) else str(lap.get("Compound")),
            "tyre_life": _number(lap.get("TyreLife")),
            "pit_in": not _missing(lap.get("PitInTime")),
            "pit_out": not _missing(lap.get("PitOutTime")),
        })
    return result


def driver_analysis(year: int, event: str, driver: str, session_name: str = "R") -> dict:
    session = _load(year, event, session_name)
    laps = session.laps.pick_drivers(driver)
    observations = driver_laps(year, event, driver, session_name)
    valid = [lap for lap in observations if lap["seconds"] is not None and not lap["pit_in"] and not lap["pit_out"]]
    times = [lap["seconds"] for lap in valid]
    median = float(pd.Series(times).median()) if times else None
    q1 = float(pd.Series(times).quantile(.25)) if times else None
    q3 = float(pd.Series(times).quantile(.75)) if times else None
    sector_medians = {}
    for sector in ("sector_1", "sector_2", "sector_3"):
        sector_values = [lap[sector] for lap in valid if lap[sector] is not None]
        sector_medians[sector] = round(float(pd.Series(sector_values).median()), 3) if sector_values else None
    stints = []
    if "Stint" in laps:
        for stint_number, group in laps.groupby("Stint", dropna=True):
            compounds = group["Compound"].dropna().unique() if "Compound" in group else []
            stints.append({
                "stint": int(stint_number), "start_lap": int(group["LapNumber"].min()),
                "end_lap": int(group["LapNumber"].max()), "laps": int(len(group)),
                "compound": str(compounds[0]) if len(compounds) else "UNKNOWN",
            })
    return {
        "driver": driver, "data_source": "FastF1 historical data",
        "metrics": {
            "valid_representative_laps": len(valid), "median_lap_seconds": round(median, 3) if median is not None else None,
            "interquartile_range_seconds": round(q3 - q1, 3) if q1 is not None and q3 is not None else None,
            "best_valid_lap_seconds": round(min(times), 3) if times else None,
            "median_sector_seconds": sector_medians,
            "filter": "Laps with missing time and pit-in/pit-out laps excluded; other race conditions are not adjusted.",
        },
        "stints": stints,
    }


def telemetry(year: int, event: str, driver: str, lap_number: int, session_name: str = "R") -> list[dict]:
    session = _load(year, event, session_name)
    lap = session.laps.pick_drivers(driver).pick_laps(lap_number)
    if lap.empty:
        return []
    frame = lap.iloc[0].get_telemetry().add_distance()
    fields = [name for name in ("Distance", "Speed", "Throttle", "Brake", "nGear", "RPM", "DRS") if name in frame]
    return [{field: _number(row[field]) for field in fields} for _, row in frame.iterrows()]


def compare_telemetry(year: int, event: str, first_driver: str, first_lap: int, second_driver: str, second_lap: int, session_name: str = "R") -> dict:
    """Compare compatible laps on a shared normalized distance grid (0–100%)."""
    import numpy as np

    first = telemetry(year, event, first_driver, first_lap, session_name)
    second = telemetry(year, event, second_driver, second_lap, session_name)
    if not first or not second:
        return {"points": [], "channels": [], "coordinate": "lap distance (%)"}
    channels = [key for key in ("Speed", "Throttle", "Brake", "nGear", "RPM", "DRS") if any(key in p and p[key] is not None for p in first) and any(key in p and p[key] is not None for p in second)]
    first_distance = np.array([p["Distance"] for p in first], dtype=float)
    second_distance = np.array([p["Distance"] for p in second], dtype=float)
    first_span = first_distance[-1] - first_distance[0]
    second_span = second_distance[-1] - second_distance[0]
    if first_span <= 0 or second_span <= 0:
        return {"points": [], "channels": channels, "coordinate": "lap distance (%)"}
    grid = np.linspace(0, 100, 201)
    result = []
    for percent in grid:
        row: dict[str, float] = {"distance_percent": round(float(percent), 2)}
        for label, points, distances, span in (("first", first, first_distance, first_span), ("second", second, second_distance, second_span)):
            normalized = (distances - distances[0]) / span * 100
            for channel in channels:
                values = np.array([p[channel] if p[channel] is not None else np.nan for p in points], dtype=float)
                valid = np.isfinite(values)
                row[f"{label}_{channel}"] = round(float(np.interp(percent, normalized[valid], values[valid])), 3) if valid.sum() > 1 else None
        result.append(row)
    return {"points": result, "channels": channels, "coordinate": "lap distance (%)"}
