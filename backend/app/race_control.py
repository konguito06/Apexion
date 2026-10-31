"""Race events, pit stops and session-wide lap timing derived from FastF1 session data.

Everything here reads an already-loaded FastF1 session, so it can be tested with small fixtures.
"""
import re
from typing import Any

from . import data
from .data import _missing, _number, _seconds

# FastF1 track status codes. 7 ("VSC ending") is folded into the VSC period it closes.
TRACK_STATUS = {"2": "yellow", "4": "safety_car", "5": "red_flag", "6": "vsc", "7": "vsc"}
DRIVER_CODE = re.compile(r"\(([A-Z]{3})\)")
PENALTY = re.compile(r"\b(\d+ SECOND (TIME|STOP/GO) PENALTY|DRIVE THROUGH PENALTY|STOP AND GO PENALTY|GRID PENALTY|DISQUALIFIED)\b")


def _lap_at(time_seconds: float, lap_starts: list[tuple[int, float]]) -> int | None:
    """Race lap the leader was on at a session time (laps start in order, first car across starts the lap)."""
    current = None
    for lap, start in lap_starts:
        if start <= time_seconds:
            current = lap
        else:
            break
    return current


def _lap_starts(laps: Any) -> list[tuple[int, float]]:
    if laps is None or laps.empty or "LapStartTime" not in laps:
        return []
    starts = {}
    for _, lap in laps.iterrows():
        number, start = _number(lap.get("LapNumber")), _seconds(lap.get("LapStartTime"))
        if number is None or start is None:
            continue
        starts[int(number)] = min(start, starts.get(int(number), start))
    return sorted(starts.items())


def track_periods(session: Any) -> list[dict]:
    """Safety car, VSC, red flag and yellow periods from the track status timeline, mapped onto lap numbers."""
    status = getattr(session, "track_status", None)
    if status is None or status.empty:
        return []
    lap_starts = _lap_starts(getattr(session, "laps", None))
    rows = [(str(row.get("Status")), _seconds(row.get("Time"))) for _, row in status.iterrows()]
    rows = [(code, time) for code, time in rows if time is not None]
    periods: list[dict] = []
    for index, (code, start) in enumerate(rows):
        kind = TRACK_STATUS.get(code)
        if kind is None:
            continue
        end = rows[index + 1][1] if index + 1 < len(rows) else None
        previous = periods[-1] if periods else None
        if previous and previous["kind"] == kind and previous["end_seconds"] == start:
            previous["end_seconds"] = end
            previous["end_lap"] = _lap_at(end, lap_starts) if end is not None else previous["end_lap"]
            continue
        periods.append({
            "kind": kind,
            "start_seconds": start,
            "end_seconds": end,
            "start_lap": _lap_at(start, lap_starts),
            "end_lap": _lap_at(end, lap_starts) if end is not None else (lap_starts[-1][0] if lap_starts else None),
        })
    return [period for period in periods if period["start_lap"] is not None]


def _classify(category: str, flag: str, message: str) -> str | None:
    upper = message.upper()
    if category == "SafetyCar":
        if "VIRTUAL" in upper:
            return "vsc_end" if "ENDING" in upper else "vsc"
        return "safety_car_end" if "IN THIS LAP" in upper else "safety_car"
    if flag == "RED":
        return "red_flag"
    if flag in ("YELLOW", "DOUBLE YELLOW"):
        return "yellow"
    if flag == "BLACK AND WHITE":
        return "warning"
    if "NO FURTHER ACTION" in upper:
        return None
    if PENALTY.search(upper) and "SERVED" not in upper:
        return "penalty"
    if "UNDER INVESTIGATION" in upper or "WILL BE INVESTIGATED" in upper:
        return "investigation"
    if "DELETED" in upper and "TRACK LIMITS" in upper:
        return "lap_deleted"
    if ("RESUME" in upper or "RESTART" in upper) and "WILL" in upper:
        return "restart"
    return None


def race_events(session: Any) -> list[dict]:
    """Race control messages worth showing: flags, safety cars, penalties, investigations and deleted laps."""
    messages = getattr(session, "race_control_messages", None)
    if messages is None or messages.empty:
        return []
    events = []
    for _, row in messages.iterrows():
        message = "" if _missing(row.get("Message")) else str(row.get("Message"))
        category = "" if _missing(row.get("Category")) else str(row.get("Category"))
        flag = "" if _missing(row.get("Flag")) else str(row.get("Flag"))
        kind = _classify(category, flag, message)
        if kind is None:
            continue
        lap, sector = _number(row.get("Lap")), _number(row.get("Sector"))
        events.append({
            "kind": kind,
            "lap": None if lap is None else int(lap),
            "sector": None if sector is None else int(sector),
            "message": message,
            "drivers": list(dict.fromkeys(DRIVER_CODE.findall(message))),
        })
    return events


def restarts(periods: list[dict]) -> list[dict]:
    """A race restarts on the lap after each safety car or red flag period ends."""
    return [
        {"kind": "restart", "lap": period["end_lap"] + 1, "sector": None, "message": f"Restart after {'red flag' if period['kind'] == 'red_flag' else 'safety car'}", "drivers": []}
        for period in periods if period["kind"] in ("safety_car", "red_flag") and period["end_lap"] is not None
    ]


def pit_stops(session: Any, periods: list[dict] | None = None) -> list[dict]:
    """Every pit stop: in-lap, tyre change and time spent in the pit lane (pit entry to pit exit)."""
    laps = getattr(session, "laps", None)
    if laps is None or laps.empty or "PitInTime" not in laps:
        return []
    neutralised = [period for period in (periods or []) if period["kind"] in ("safety_car", "vsc", "red_flag")]
    stops = []
    for driver, rows in laps.sort_values("LapNumber").groupby("Driver"):
        rows = list(rows.iterrows())
        for index, (_, lap) in enumerate(rows):
            if _missing(lap.get("PitInTime")) or index + 1 >= len(rows):
                continue
            next_lap = rows[index + 1][1]
            entry, exit_ = _seconds(lap.get("PitInTime")), _seconds(next_lap.get("PitOutTime"))
            lap_number = int(lap.get("LapNumber"))
            under = next((period["kind"] for period in neutralised if period["start_lap"] is not None and period["start_lap"] <= lap_number <= (period["end_lap"] or lap_number)), None)
            stops.append({
                "driver": str(driver),
                "lap": lap_number,
                "from_compound": None if _missing(lap.get("Compound")) else str(lap.get("Compound")),
                "to_compound": None if _missing(next_lap.get("Compound")) else str(next_lap.get("Compound")),
                "pit_lane_seconds": round(exit_ - entry, 3) if entry is not None and exit_ is not None and exit_ > entry else None,
                "under": under,
            })
    return sorted(stops, key=lambda stop: (stop["lap"], stop["driver"]))


def session_timing(session: Any) -> list[dict]:
    """All drivers' laps with sectors and the flags needed to colour them like a timing screen."""
    laps = getattr(session, "laps", None)
    if laps is None or laps.empty:
        return []
    result = []
    for _, lap in laps.iterrows():
        number = _number(lap.get("LapNumber"))
        if number is None or _missing(lap.get("Driver")):
            continue
        deleted, personal_best = lap.get("Deleted"), lap.get("IsPersonalBest")
        result.append({
            "driver": str(lap.get("Driver")),
            "lap": int(number),
            "seconds": _seconds(lap.get("LapTime")),
            "sector_1": _seconds(lap.get("Sector1Time")),
            "sector_2": _seconds(lap.get("Sector2Time")),
            "sector_3": _seconds(lap.get("Sector3Time")),
            "compound": "UNKNOWN" if _missing(lap.get("Compound")) else str(lap.get("Compound")),
            "tyre_life": _number(lap.get("TyreLife")),
            "pit_in": not _missing(lap.get("PitInTime")),
            "pit_out": not _missing(lap.get("PitOutTime")),
            "deleted": False if _missing(deleted) else bool(deleted),
            "deleted_reason": None if _missing(lap.get("DeletedReason")) or not str(lap.get("DeletedReason")) else str(lap.get("DeletedReason")),
            "personal_best": False if _missing(personal_best) else bool(personal_best),
        })
    return result


def race_control(year: int, event: str, session_name: str = "R") -> dict:
    session = data._load(year, event, session_name)
    periods = track_periods(session)
    events = sorted(race_events(session) + restarts(periods), key=lambda event: (event["lap"] is None, event["lap"] or 0))
    return {"periods": periods, "events": events, "pit_stops": pit_stops(session, periods)}


def timing(year: int, event: str, session_name: str = "R") -> dict:
    return {"laps": session_timing(data._load(year, event, session_name))}
