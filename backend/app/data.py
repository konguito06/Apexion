"""FastF1 adapter with normalized, provenance-preserving response shapes."""
from functools import lru_cache
from pathlib import Path
from typing import Any
from datetime import datetime

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
    # FastF1's supported F1 timing era starts in 2018. Include the current
    # season dynamically so this list does not go stale at the end of a year.
    return list(range(2018, datetime.now().year + 1))


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
    laps = getattr(session, "laps", None)
    results = getattr(session, "results", None)
    has_results = results is not None and not results.empty
    has_laps = laps is not None and not laps.empty
    has_timed_laps = has_laps and "LapTime" in laps and laps["LapTime"].notna().any()
    if not has_laps and not has_results:
        raise RuntimeError(
            "FastF1 returned no classification or lap data for this session. Check upstream availability; "
            "the current F1 timing feed may require F1_USERNAME and F1_PASSWORD."
        )
    # Some sessions expose a classification or event metadata but no lap
    # timings. Keep that useful source data and report the session as partial.
    return session


@lru_cache(maxsize=32)
def _load_laps_for_evaluation(year: int, event: str, session_name: str = "R") -> Any:
    """Load only timing laps for batch evaluation; do not download telemetry."""
    if fastf1 is None:
        raise RuntimeError("FastF1 is not installed")
    session = fastf1.get_session(year, event, session_name)
    session.load(telemetry=False, laps=True, weather=False, messages=False)
    laps = getattr(session, "laps", None)
    if laps is None or laps.empty or "LapTime" not in laps:
        raise RuntimeError("FastF1 returned no race lap timing rows")
    return session


def evaluation_laps(year: int, event: str, session_name: str = "R") -> list[dict]:
    """Return all drivers' normalized race-lap timing and quality fields."""
    session = _load_laps_for_evaluation(year, event, session_name)
    laps = getattr(session, "laps", None)
    if laps is None or laps.empty:
        return []
    result = []
    for _, lap in laps.iterrows():
        lap_number = _number(lap.get("LapNumber"))
        if lap_number is None:
            continue
        accuracy = lap.get("IsAccurate")
        track_status = lap.get("TrackStatus")
        driver = lap.get("Driver")
        result.append({
            "lap": int(lap_number),
            "seconds": _seconds(lap.get("LapTime")),
            "driver": None if _missing(driver) else str(driver),
            "compound": None if _missing(lap.get("Compound")) else str(lap.get("Compound")),
            "tyre_life": _number(lap.get("TyreLife")),
            "stint": _number(lap.get("Stint")),
            "pit_in": not _missing(lap.get("PitInTime")),
            "pit_out": not _missing(lap.get("PitOutTime")),
            "is_accurate": None if _missing(accuracy) else bool(accuracy),
            "track_status": None if _missing(track_status) else str(track_status),
        })
    return result


@lru_cache(maxsize=20)
def events(year: int) -> list[dict]:
    if fastf1 is None:
        raise RuntimeError("FastF1 is not installed; install backend requirements to load historical events")
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        result = []
        for _, row in schedule.iterrows():
            round_value = _number(row.get("RoundNumber"))
            if round_value is None or round_value <= 0:
                continue
            sessions = [str(row.get(f"Session{i}")) for i in range(1, 6) if not _missing(row.get(f"Session{i}"))]
            event_name = row.get("EventName")
            if _missing(event_name) or not sessions:
                continue
            result.append({"name": str(event_name), "round": int(round_value), "sessions": sessions})
        return result
    except Exception as exc:
        raise RuntimeError(
            f"Could not retrieve the {year} event schedule: {exc}. Check your internet connection; "
            "if the upstream timing feed requires authentication, set F1_USERNAME and F1_PASSWORD."
        ) from exc


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
    laps = getattr(session, "laps", None)
    try:
        session_date = str(session.date)
    except Exception as exc:
        if "not been loaded yet" in str(exc).lower():
            raise RuntimeError(
                "FastF1 could not load session metadata or timing data. Check the upstream feed; "
                "the current F1 timing feed may require F1_USERNAME and F1_PASSWORD."
            ) from exc
        raise
    compounds = sorted(str(value) for value in laps["Compound"].dropna().unique()) if laps is not None and "Compound" in laps else []
    pit_stops = int(laps["PitInTime"].notna().sum()) if laps is not None and "PitInTime" in laps else 0
    max_lap = int(laps["LapNumber"].max()) if laps is not None and len(laps) and "LapNumber" in laps else 0
    event_name = str(getattr(getattr(session, "event", {}), "EventName", event))
    drivers = set(str(x) for x in laps["Driver"].dropna().unique()) if laps is not None and "Driver" in laps else set()
    results = getattr(session, "results", None)
    if results is not None and "Abbreviation" in results:
        drivers.update(str(x) for x in results["Abbreviation"].dropna().unique())
    return {
        "year": year, "event": event_name, "session": session_name,
        "date": session_date, "drivers": sorted(drivers),
        "race_laps": max_lap, "lap_observations": int(len(laps)) if laps is not None else 0, "pit_stops": pit_stops,
        "compounds": compounds, "classification": _classification(session),
        "data_source": "FastF1 historical data", "status": "loaded" if laps is not None and not laps.empty and "LapTime" in laps and laps["LapTime"].notna().any() else "partial",
    }


def driver_laps(year: int, event: str, driver: str, session_name: str = "R") -> list[dict]:
    session = _load(year, event, session_name)
    all_laps = getattr(session, "laps", None)
    if all_laps is None or all_laps.empty or "Driver" not in all_laps:
        return []
    laps = all_laps.pick_drivers(driver)
    fields = ("Sector1Time", "Sector2Time", "Sector3Time")
    result = []
    for _, lap in laps.iterrows():
        lap_number = _number(lap.get("LapNumber"))
        if lap_number is None:
            continue
        value = lap.get("LapTime")
        result.append({
            "lap": int(lap_number), "seconds": _seconds(value),
            "sector_1": _seconds(lap.get(fields[0])), "sector_2": _seconds(lap.get(fields[1])),
            "sector_3": _seconds(lap.get(fields[2])),
            "compound": "UNKNOWN" if _missing(lap.get("Compound")) else str(lap.get("Compound")),
            "tyre_life": _number(lap.get("TyreLife")),
            "stint": _number(lap.get("Stint")),
            "pit_in": not _missing(lap.get("PitInTime")),
            "pit_out": not _missing(lap.get("PitOutTime")),
        })
    return result


def driver_analysis(year: int, event: str, driver: str, session_name: str = "R") -> dict:
    session = _load(year, event, session_name)
    all_laps = getattr(session, "laps", None)
    laps = all_laps.pick_drivers(driver) if all_laps is not None and not all_laps.empty and "Driver" in all_laps else pd.DataFrame()
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
    all_laps = getattr(session, "laps", None)
    if all_laps is None or all_laps.empty or "Driver" not in all_laps or "LapNumber" not in all_laps:
        return []
    lap = all_laps.pick_drivers(driver).pick_laps(lap_number)
    if lap.empty:
        return []
    frame = lap.iloc[0].get_telemetry().add_distance()
    fields = [name for name in ("Distance", "Speed", "Throttle", "Brake", "nGear", "RPM", "DRS") if name in frame]
    result = []
    for _, row in frame.iterrows():
        point = {field: _number(row[field]) for field in fields}
        # FastF1's telemetry Time is relative to the selected data slice.
        # Keeping it enables a relative time-delta curve after distance alignment.
        point["time_seconds"] = _seconds(row.get("Time"))
        result.append(point)
    return result


def align_telemetry_points(first: list[dict], second: list[dict], point_count: int = 201) -> dict:
    """Interpolate two lap traces onto their shared absolute distance range."""
    import numpy as np

    if not first or not second:
        return {"points": [], "channels": [], "coordinate": "distance_m"}

    def clean(points: list[dict]) -> tuple[Any, dict[str, tuple[Any, Any]]]:
        usable = [(point, point.get("Distance")) for point in points]
        usable = [(point, float(distance)) for point, distance in usable if distance is not None and np.isfinite(distance)]
        usable.sort(key=lambda pair: pair[1])
        if not usable:
            return np.array([]), {}
        distances = np.array([distance for _, distance in usable], dtype=float)
        unique, indices = np.unique(distances, return_index=True)
        usable_points = [usable[index][0] for index in indices]
        series = {}
        for channel in ("Speed", "Throttle", "Brake", "nGear", "RPM", "DRS", "time_seconds"):
            values = np.array([point.get(channel) if point.get(channel) is not None else np.nan for point in usable_points], dtype=float)
            valid = np.isfinite(values)
            if valid.sum() >= 2:
                series[channel] = (unique[valid], values[valid])
        return unique, series

    first_distance, first_series = clean(first)
    second_distance, second_series = clean(second)
    if len(first_distance) < 2 or len(second_distance) < 2:
        return {"points": [], "channels": [], "coordinate": "distance_m"}
    lower = max(first_distance[0], second_distance[0])
    upper = min(first_distance[-1], second_distance[-1])
    if not np.isfinite(lower) or not np.isfinite(upper) or upper <= lower:
        return {"points": [], "channels": [], "coordinate": "distance_m"}

    channels = [key for key in ("Speed", "Throttle", "Brake", "nGear", "RPM", "DRS") if key in first_series and key in second_series]
    if not channels:
        return {"points": [], "channels": [], "coordinate": "distance_m"}
    grid = np.linspace(lower, upper, max(2, point_count))
    result = []
    first_time = np.interp(grid, *first_series["time_seconds"]) if "time_seconds" in first_series else None
    second_time = np.interp(grid, *second_series["time_seconds"]) if "time_seconds" in second_series else None
    first_time_origin = np.interp(lower, *first_series["time_seconds"]) if "time_seconds" in first_series else None
    second_time_origin = np.interp(lower, *second_series["time_seconds"]) if "time_seconds" in second_series else None
    for index, distance in enumerate(grid):
        row: dict[str, float | None] = {"distance_m": round(float(distance), 3)}
        for label, series in (("first", first_series), ("second", second_series)):
            for channel in channels:
                row[f"{label}_{channel}"] = round(float(np.interp(distance, *series[channel])), 3)
        if first_time is not None and second_time is not None:
            elapsed_first = first_time[index] - first_time_origin
            elapsed_second = second_time[index] - second_time_origin
            row["first_elapsed_seconds"] = round(float(elapsed_first), 3)
            row["second_elapsed_seconds"] = round(float(elapsed_second), 3)
            # Positive means the second trace has taken longer at this distance.
            row["time_delta_seconds"] = round(float(elapsed_second - elapsed_first), 3)
        result.append(row)
    return {"points": result, "channels": channels, "coordinate": "distance_m"}


def compare_telemetry(year: int, event: str, first_driver: str, first_lap: int, second_driver: str, second_lap: int, session_name: str = "R") -> dict:
    """Compare two drivers/laps from the same event on overlapping track distance."""
    first_points = telemetry(year, event, first_driver, first_lap, session_name)
    second_points = telemetry(year, event, second_driver, second_lap, session_name)
    result = align_telemetry_points(first_points, second_points)
    if not result["points"]:
        return {**result, "lap_time_delta_seconds": None, "sector_time_deltas_seconds": {}}

    first_lap_data = next((row for row in driver_laps(year, event, first_driver, session_name) if row["lap"] == first_lap), None)
    second_lap_data = next((row for row in driver_laps(year, event, second_driver, session_name) if row["lap"] == second_lap), None)
    lap_delta = None
    sector_deltas: dict[str, float | None] = {}
    if first_lap_data and second_lap_data:
        if first_lap_data["seconds"] is not None and second_lap_data["seconds"] is not None:
            lap_delta = round(second_lap_data["seconds"] - first_lap_data["seconds"], 3)
        for sector in ("sector_1", "sector_2", "sector_3"):
            first_sector, second_sector = first_lap_data[sector], second_lap_data[sector]
            sector_deltas[sector] = round(second_sector - first_sector, 3) if first_sector is not None and second_sector is not None else None
    return {**result, "lap_time_delta_seconds": lap_delta, "sector_time_deltas_seconds": sector_deltas}


def strategy_baseline(year: int, event: str, driver: str, session_name: str = "R") -> dict:
    """Estimate simulation parameters from one driver's selected session."""
    from .simulation import estimate_parameters

    estimate = estimate_parameters(driver_laps(year, event, driver, session_name))
    return {
        **estimate,
        "year": year,
        "event": event,
        "session": session_name,
        "driver": driver,
        "data_source": "FastF1 representative laps" if estimate["representative_laps"] else "Illustrative assumptions; no representative FastF1 laps available",
    }
