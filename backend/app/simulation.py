"""Explainable, deterministic race-time model and bounded strategy search.

Each configured pit lap is completed on the old tyre. The next lap starts the
new stint. In-laps and out-laps use the same pace/degradation equation as other
laps; ``pit_loss_seconds`` is the single net additional loss per stop versus a
green-flag lap, so pit time is never added to a lap twice.
"""
from dataclasses import dataclass
from itertools import combinations, product
from math import isfinite
from statistics import median
from typing import Any, Iterable

DEFAULT_BASELINE_PACE_SECONDS = 90.0
DEFAULT_DEGRADATION_SECONDS_PER_LAP = 0.075
DEFAULT_PIT_LOSS_SECONDS = 22.0
COMPOUNDS = {"SOFT": 0.0, "MEDIUM": 0.35, "HARD": 0.75}
MAX_RACE_LAPS = 100
MAX_OPTIMISER_CANDIDATES = 5_000
MIN_OPTIMISER_STINT_LAPS = 4


@dataclass(frozen=True)
class Strategy:
    race_laps: int
    compounds: list[str]
    pit_laps: list[int]
    baseline_pace_seconds: float = DEFAULT_BASELINE_PACE_SECONDS
    pit_loss_seconds: float = DEFAULT_PIT_LOSS_SECONDS
    degradation_seconds_per_lap: float = DEFAULT_DEGRADATION_SECONDS_PER_LAP
    baseline_pace_source: str = "Illustrative configurable assumption"
    degradation_source: str = "Illustrative configurable assumption"
    year: int | None = None
    event: str | None = None
    session: str | None = None
    driver: str | None = None

    def validate(self) -> None:
        if not 1 <= self.race_laps <= MAX_RACE_LAPS:
            raise ValueError(f"Race laps must be between 1 and {MAX_RACE_LAPS}")
        if len(self.compounds) != len(self.pit_laps) + 1:
            raise ValueError("Provide one compound for the starting stint and each stint after a pit stop")
        if any(not isinstance(compound, str) or compound not in COMPOUNDS for compound in self.compounds):
            raise ValueError("Compounds must be SOFT, MEDIUM, or HARD")
        if any(not isinstance(lap, int) or isinstance(lap, bool) or not 1 <= lap < self.race_laps for lap in self.pit_laps):
            raise ValueError("Pit laps mean the completed in-lap; each must be between lap 1 and the final lap minus one")
        if self.pit_laps != sorted(set(self.pit_laps)):
            raise ValueError("Pit laps must be strictly increasing with no duplicates")
        if not all(isfinite(value) for value in (self.baseline_pace_seconds, self.pit_loss_seconds, self.degradation_seconds_per_lap)):
            raise ValueError("Pace, pit loss, and degradation must be finite numbers")
        if self.baseline_pace_seconds <= 0 or self.pit_loss_seconds < 0 or self.degradation_seconds_per_lap < 0:
            raise ValueError("Pace must be positive and losses/degradation cannot be negative")
        if not self.baseline_pace_source.strip() or not self.degradation_source.strip():
            raise ValueError("Model parameter sources must be identified")


def stint_boundaries(race_laps: int, pit_laps: Iterable[int]) -> list[tuple[int, int]]:
    """Return inclusive, one-based lap boundaries for every stint."""
    boundaries = [0, *pit_laps, race_laps]
    return [(start + 1, end) for start, end in zip(boundaries, boundaries[1:])]


def tyre_age(stint_start_lap: int, lap_number: int) -> int:
    """Model tyre age as zero on a stint's first lap, then increment by lap."""
    if lap_number < stint_start_lap:
        raise ValueError("Lap number cannot precede the tyre stint start")
    return lap_number - stint_start_lap


def estimated_lap_time(
    baseline_pace_seconds: float,
    compound: str,
    age: int,
    degradation_seconds_per_lap: float,
) -> tuple[float, float, float]:
    """Return total, compound, and tyre-age contributions for one lap."""
    if compound not in COMPOUNDS:
        raise ValueError(f"Unknown tyre compound: {compound}")
    compound_adjustment = COMPOUNDS[compound]
    degradation = age * degradation_seconds_per_lap
    return baseline_pace_seconds + compound_adjustment + degradation, compound_adjustment, degradation


def estimate_parameters(observations: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Estimate a driver baseline and within-stint degradation when supported.

    Uses representative timed laps only (missing times and pit-in/out laps are
    excluded). Tyre-age degradation uses a Theil–Sen median of within-stint,
    same-compound pair slopes; it needs at least 12 observations, a four-lap age
    span and 20 pair slopes. This remains a rough race-specific estimate that
    cannot remove traffic, fuel, weather, track evolution or neutralisation
    effects. Otherwise the documented illustrative degradation default is used.
    """
    rows = []
    for row in observations:
        seconds = row.get("seconds")
        compound = row.get("compound")
        if seconds is None or row.get("pit_in") or row.get("pit_out") or compound not in COMPOUNDS:
            continue
        try:
            seconds = float(seconds)
        except (TypeError, ValueError):
            continue
        if not isfinite(seconds) or seconds <= 0:
            continue
        raw_life = row.get("tyre_life")
        age = None
        if raw_life is not None:
            try:
                life = float(raw_life)
                if isfinite(life) and life >= 1:
                    age = int(life) - 1
            except (TypeError, ValueError):
                pass
        rows.append({"seconds": seconds, "compound": compound, "age": age, "stint": row.get("stint")})

    grouped: dict[tuple[str, Any], list[dict[str, Any]]] = {}
    for row in rows:
        if row["age"] is not None and row["stint"] is not None:
            grouped.setdefault((row["compound"], row["stint"]), []).append(row)

    slopes = []
    for group in grouped.values():
        group.sort(key=lambda item: item["age"])
        if len(group) < 5 or group[-1]["age"] - group[0]["age"] < 4:
            continue
        for left_index, left in enumerate(group):
            for right in group[left_index + 1:]:
                age_delta = right["age"] - left["age"]
                if age_delta > 0:
                    slopes.append((right["seconds"] - left["seconds"]) / age_delta)

    fitted_degradation = len(rows) >= 12 and len(slopes) >= 20
    degradation = median(slopes) if fitted_degradation else DEFAULT_DEGRADATION_SECONDS_PER_LAP
    if fitted_degradation and not 0 <= degradation <= 0.5:
        fitted_degradation = False
        degradation = DEFAULT_DEGRADATION_SECONDS_PER_LAP

    # Do not silently treat missing tyre age as a new tyre. If age metadata is
    # absent, use the explicitly labelled illustrative pace fallback instead.
    pace_candidates = [
        row["seconds"] - COMPOUNDS[row["compound"]] - row["age"] * degradation
        for row in rows if row["age"] is not None
    ]
    fitted_pace = len(pace_candidates) >= 3
    baseline_pace = median(pace_candidates) if fitted_pace else DEFAULT_BASELINE_PACE_SECONDS
    return {
        "baseline_pace_seconds": round(baseline_pace, 3),
        "degradation_seconds_per_lap": round(degradation, 5),
        "baseline_pace_source": "Median of FastF1 representative laps adjusted for configured compound offsets and reported tyre age" if fitted_pace else "Illustrative default; fewer than three representative laps with known tyre age were available",
        "degradation_source": "Exploratory within-stint Theil–Sen fit from FastF1 representative laps" if fitted_degradation else "Illustrative default; historical laps did not meet the fit sample, stint, and age-span requirements",
        "representative_laps": len(rows),
        "degradation_pair_slopes": len(slopes) if fitted_degradation else 0,
        "fit_status": "historical pace and degradation fit" if fitted_pace and fitted_degradation else "partial historical fit with illustrative fallback",
        "limitations": "Descriptive race observations are not adjusted for traffic, fuel, weather, track evolution, safety cars or driver/car changes.",
    }


def _simulate_green_laps(strategy: Strategy) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, float]]:
    lap_curve = []
    stints = []
    totals = {"baseline_pace_seconds": 0.0, "compound_adjustment_seconds": 0.0, "degradation_seconds": 0.0}
    for index, (start_lap, end_lap) in enumerate(stint_boundaries(strategy.race_laps, strategy.pit_laps)):
        compound = strategy.compounds[index]
        stint_totals = {"baseline_pace_seconds": 0.0, "compound_adjustment_seconds": 0.0, "degradation_seconds": 0.0}
        for lap_number in range(start_lap, end_lap + 1):
            age = tyre_age(start_lap, lap_number)
            seconds, compound_adjustment, degradation = estimated_lap_time(
                strategy.baseline_pace_seconds, compound, age, strategy.degradation_seconds_per_lap
            )
            lap_curve.append({
                "lap": lap_number, "seconds": round(seconds, 3), "compound": compound,
                "tyre_age": age, "compound_adjustment_seconds": round(compound_adjustment, 3),
                "degradation_seconds": round(degradation, 3),
            })
            stint_totals["baseline_pace_seconds"] += strategy.baseline_pace_seconds
            stint_totals["compound_adjustment_seconds"] += compound_adjustment
            stint_totals["degradation_seconds"] += degradation
        for component in totals:
            totals[component] += stint_totals[component]
        stint_green = sum(stint_totals.values())
        pit_after = strategy.pit_loss_seconds if index < len(strategy.pit_laps) else 0.0
        stints.append({
            "start_lap": start_lap, "end_lap": end_lap, "laps": end_lap - start_lap + 1,
            "compound": compound,
            "baseline_pace_contribution_seconds": round(stint_totals["baseline_pace_seconds"], 3),
            "compound_adjustment_seconds": round(stint_totals["compound_adjustment_seconds"], 3),
            "degradation_seconds": round(stint_totals["degradation_seconds"], 3),
            "green_flag_seconds": round(stint_green, 3),
            "pit_loss_after_seconds": round(pit_after, 3),
            "estimated_seconds": round(stint_green + pit_after, 3),
        })
    return lap_curve, stints, totals


def _green_components(strategy: Strategy) -> dict[str, float]:
    _, _, totals = _simulate_green_laps(strategy)
    return totals


def simulate(strategy: Strategy) -> dict[str, Any]:
    """Run one deterministic strategy and return a complete model breakdown."""
    strategy.validate()
    lap_curve, stints, components = _simulate_green_laps(strategy)
    pit_cost = len(strategy.pit_laps) * strategy.pit_loss_seconds
    green_seconds = sum(components.values())
    total = green_seconds + pit_cost

    baseline = Strategy(
        race_laps=strategy.race_laps,
        compounds=[strategy.compounds[0]],
        pit_laps=[],
        baseline_pace_seconds=strategy.baseline_pace_seconds,
        pit_loss_seconds=strategy.pit_loss_seconds,
        degradation_seconds_per_lap=strategy.degradation_seconds_per_lap,
    )
    baseline_components = _green_components(baseline)
    baseline_total = sum(baseline_components.values())
    compound_delta = components["compound_adjustment_seconds"] - baseline_components["compound_adjustment_seconds"]
    degradation_delta = components["degradation_seconds"] - baseline_components["degradation_seconds"]
    delta = total - baseline_total
    pit_details = [
        {"stop_number": index + 1, "after_lap": pit_lap, "pit_loss_seconds": round(strategy.pit_loss_seconds, 3), "old_compound": strategy.compounds[index], "new_compound": strategy.compounds[index + 1]}
        for index, pit_lap in enumerate(strategy.pit_laps)
    ]
    return {
        "total_seconds": round(total, 3),
        "green_flag_seconds": round(green_seconds, 3),
        "pit_stops": len(strategy.pit_laps),
        "pit_loss_seconds": round(pit_cost, 3),
        "baseline_total_seconds": round(baseline_total, 3),
        "baseline_description": f"No-stop baseline on {strategy.compounds[0]} with the same pace and degradation parameters",
        "delta_vs_baseline_seconds": round(delta, 3),
        "stints": stints,
        "pit_stop_details": pit_details,
        "lap_curve": lap_curve,
        "strategy": {
            "race_laps": strategy.race_laps, "pit_laps": list(strategy.pit_laps),
            "compounds": list(strategy.compounds), "year": strategy.year,
            "event": strategy.event, "session": strategy.session, "driver": strategy.driver,
        },
        "assumptions": {
            "model": "Deterministic linear tyre-age race-time model",
            "lap_time_equation": "baseline pace + compound adjustment + tyre age × degradation",
            "baseline_pace_seconds": strategy.baseline_pace_seconds,
            "baseline_pace_source": strategy.baseline_pace_source,
            "compound_adjustments_seconds": COMPOUNDS,
            "degradation_seconds_per_lap_of_tyre_age": strategy.degradation_seconds_per_lap,
            "degradation_source": strategy.degradation_source,
            "pit_loss_seconds_per_stop": strategy.pit_loss_seconds,
            "pit_loss_convention": "Net additional pit detour loss per stop; added once after the completed in-lap.",
            "in_lap_out_lap_convention": "The pit lap is the final lap on the old compound; the next lap starts the new stint. Neither lap receives an extra in/out penalty beyond the single pit-loss term.",
            "tyre_age_convention": "Tyre age is zero on the first modelled lap of each stint and increments by one per subsequent lap.",
            "data_context": {"year": strategy.year, "event": strategy.event, "session": strategy.session, "driver": strategy.driver},
            "known_limitations": "No traffic, fuel, weather, track evolution, neutralisation, competitor response, or car-specific effects are modelled.",
        },
        "explanations": [
            f"Compound choices changed modelled lap pace by {compound_delta:+.3f} s versus the no-stop {strategy.compounds[0]} baseline.",
            f"Stint resets changed tyre-age degradation by {degradation_delta:+.3f} s versus that baseline.",
            f"{len(strategy.pit_laps)} pit stop(s) add {pit_cost:.3f} s at {strategy.pit_loss_seconds:.3f} s each.",
            f"Estimated total is {delta:+.3f} s versus the no-stop baseline ({baseline_total:.3f} s).",
        ],
    }


def optimise(race_laps: int, pit_loss_seconds: float = DEFAULT_PIT_LOSS_SECONDS, max_stops: int = 2, baseline_pace_seconds: float = DEFAULT_BASELINE_PACE_SECONDS, degradation_seconds_per_lap: float = DEFAULT_DEGRADATION_SECONDS_PER_LAP) -> list[dict]:
    return optimise_with_metadata(race_laps, pit_loss_seconds, max_stops, baseline_pace_seconds, degradation_seconds_per_lap)["results"]


def generate_candidate_strategies(
    race_laps: int,
    max_stops: int = 2,
    minimum_stint_laps: int = MIN_OPTIMISER_STINT_LAPS,
    max_candidates: int = MAX_OPTIMISER_CANDIDATES,
) -> dict[str, Any]:
    """Build a deterministic compound/pit grid under a strict candidate cap.

    When the full one-lap pit grid would exceed the cap, the spacing is
    increased until the generated compound-sequence space fits. Every returned
    pit schedule is checked for ordered laps and positive minimum stint length.
    """
    if not isinstance(race_laps, int) or isinstance(race_laps, bool) or not 1 <= race_laps <= MAX_RACE_LAPS:
        raise ValueError(f"Race laps must be between 1 and {MAX_RACE_LAPS}")
    if not isinstance(max_stops, int) or isinstance(max_stops, bool) or not 0 <= max_stops <= 3:
        raise ValueError("Maximum stops must be between 0 and 3")
    if not isinstance(minimum_stint_laps, int) or isinstance(minimum_stint_laps, bool) or minimum_stint_laps < 1:
        raise ValueError("Minimum stint length must be a positive integer")
    if not isinstance(max_candidates, int) or isinstance(max_candidates, bool) or not len(COMPOUNDS) <= max_candidates <= MAX_OPTIMISER_CANDIDATES:
        raise ValueError(f"Candidate limit must be between {len(COMPOUNDS)} and {MAX_OPTIMISER_CANDIDATES}")

    def schedules_for_step(step: int) -> list[list[tuple[int, ...]]]:
        by_stops: list[list[tuple[int, ...]]] = [[()]]
        options = range(minimum_stint_laps, race_laps - minimum_stint_laps + 1, step)
        for stops in range(1, max_stops + 1):
            by_stops.append([
                pits for pits in combinations(options, stops)
                if all(end - start >= minimum_stint_laps for start, end in zip((0, *pits), (*pits, race_laps)))
            ])
        return by_stops

    grid_step = max(1, race_laps // 15)
    while True:
        schedules = schedules_for_step(grid_step)
        count = sum(len(pits) * len(COMPOUNDS) ** (stops + 1) for stops, pits in enumerate(schedules))
        if count <= max_candidates or grid_step >= race_laps:
            break
        grid_step += 1

    candidates = []
    for stops, schedules in enumerate(schedules):
        for pits in schedules:
            for compounds in product(sorted(COMPOUNDS), repeat=stops + 1):
                candidates.append({"pit_laps": list(pits), "compounds": list(compounds)})
    return {
        "candidates": candidates,
        "candidate_space_size": len(candidates),
        "pit_lap_grid_step": grid_step,
        "minimum_stint_laps": minimum_stint_laps,
        "candidate_limit": max_candidates,
        "full_pit_lap_grid": grid_step == 1,
    }


def optimise_with_metadata(
    race_laps: int,
    pit_loss_seconds: float = DEFAULT_PIT_LOSS_SECONDS,
    max_stops: int = 2,
    baseline_pace_seconds: float = DEFAULT_BASELINE_PACE_SECONDS,
    degradation_seconds_per_lap: float = DEFAULT_DEGRADATION_SECONDS_PER_LAP,
    baseline_pace_source: str = "Illustrative configurable assumption",
    degradation_source: str = "Illustrative configurable assumption",
    year: int | None = None,
    event: str | None = None,
    session: str | None = None,
    driver: str | None = None,
) -> dict[str, Any]:
    values = (pit_loss_seconds, baseline_pace_seconds, degradation_seconds_per_lap)
    if not 1 <= race_laps <= MAX_RACE_LAPS or not 0 <= max_stops <= 3 or not all(isfinite(value) for value in values):
        raise ValueError("Invalid optimisation bounds or non-finite model parameters")
    if pit_loss_seconds < 0 or baseline_pace_seconds <= 0 or degradation_seconds_per_lap < 0:
        raise ValueError("Optimisation pace must be positive and losses/degradation cannot be negative")
    search = generate_candidate_strategies(race_laps, max_stops)
    candidates = []
    for candidate in search["candidates"]:
        strategy = Strategy(
            race_laps=race_laps,
            compounds=candidate["compounds"],
            pit_laps=candidate["pit_laps"],
            baseline_pace_seconds=baseline_pace_seconds,
            pit_loss_seconds=pit_loss_seconds,
            degradation_seconds_per_lap=degradation_seconds_per_lap,
            baseline_pace_source=baseline_pace_source,
            degradation_source=degradation_source,
            year=year, event=event, session=session, driver=driver,
        )
        strategy.validate()
        candidates.append(simulate(strategy))
    evaluated = len(candidates)
    candidates.sort(key=lambda item: (
        item["total_seconds"], item["pit_stops"],
        tuple(item["strategy"]["pit_laps"]), tuple(item["strategy"]["compounds"]),
    ))
    max_feasible_stops = max(0, race_laps // MIN_OPTIMISER_STINT_LAPS - 1)
    exhaustive = search["full_pit_lap_grid"] and max_stops >= max_feasible_stops
    search_description = (
        f"Evaluated {evaluated} candidates with a deterministic pit-lap grid every {search['pit_lap_grid_step']} lap(s), "
        f"minimum {search['minimum_stint_laps']}-lap stints, up to {max_stops} stops, and a hard limit of {search['candidate_limit']} candidates. "
        + ("The bounded candidate space was exhaustively enumerated." if exhaustive else "This is a bounded grid search, not a global optimum; other pit laps and/or stop counts were not searched.")
        + " No season-specific tyre regulation constraints were applied because this application has no verified regulation dataset."
    )
    return {
        "results": candidates[:5],
        "evaluated": evaluated,
        "candidate_space_size": search["candidate_space_size"],
        "candidate_limit": search["candidate_limit"],
        "pit_lap_grid_step": search["pit_lap_grid_step"],
        "minimum_stint_laps": search["minimum_stint_laps"],
        "max_stops": max_stops,
        "exhaustive_within_constraints": exhaustive,
        "regulatory_constraints_applied": [],
        "search_description": search_description,
    }
