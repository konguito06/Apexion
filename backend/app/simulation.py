"""Deterministic educational race strategy model.

The defaults are illustrative, not fitted to a particular race or car.
"""
from dataclasses import dataclass
from itertools import combinations, product
from math import isfinite

COMPOUNDS = {"SOFT": 0.0, "MEDIUM": 0.35, "HARD": 0.75}


@dataclass(frozen=True)
class Strategy:
    race_laps: int
    compounds: list[str]
    pit_laps: list[int]
    baseline_pace_seconds: float = 90.0
    pit_loss_seconds: float = 22.0
    degradation_seconds_per_lap: float = 0.075

    def validate(self) -> None:
        if not 1 <= self.race_laps <= 100:
            raise ValueError("Race laps must be between 1 and 100")
        if len(self.compounds) != len(self.pit_laps) + 1:
            raise ValueError("Provide one compound for each stint")
        if any(c not in COMPOUNDS for c in self.compounds):
            raise ValueError("Compounds must be SOFT, MEDIUM, or HARD")
        if any(not 1 <= lap < self.race_laps for lap in self.pit_laps):
            raise ValueError("Pit laps must be between lap 1 and the final lap")
        if self.pit_laps != sorted(set(self.pit_laps)):
            raise ValueError("Pit laps must be strictly increasing")
        bounds = [0, *self.pit_laps, self.race_laps]
        if any(b - a <= 0 for a, b in zip(bounds, bounds[1:])):
            raise ValueError("Every stint must contain at least one lap")
        if not all(isfinite(value) for value in (self.baseline_pace_seconds, self.pit_loss_seconds, self.degradation_seconds_per_lap)):
            raise ValueError("Pace, pit loss, and degradation must be finite numbers")
        if self.baseline_pace_seconds <= 0 or self.pit_loss_seconds < 0 or self.degradation_seconds_per_lap < 0:
            raise ValueError("Pace must be positive and losses/degradation cannot be negative")


def simulate(strategy: Strategy) -> dict:
    strategy.validate()
    total = 0.0
    lap_curve = []
    stints = []
    boundaries = [0, *strategy.pit_laps, strategy.race_laps]
    for index, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
        compound = strategy.compounds[index]
        stint_seconds = 0.0
        for age in range(end - start):
            lap_time = strategy.baseline_pace_seconds + COMPOUNDS[compound] + age * strategy.degradation_seconds_per_lap
            total += lap_time
            stint_seconds += lap_time
            lap_curve.append({"lap": start + age + 1, "seconds": round(lap_time, 3), "compound": compound})
        stints.append({"start_lap": start + 1, "end_lap": end, "laps": end - start, "compound": compound, "estimated_seconds": round(stint_seconds, 3)})
    pit_cost = len(strategy.pit_laps) * strategy.pit_loss_seconds
    total += pit_cost
    return {"total_seconds": round(total, 3), "pit_stops": len(strategy.pit_laps), "pit_loss_seconds": round(pit_cost, 3), "green_flag_seconds": round(total - pit_cost, 3), "stints": stints, "lap_curve": lap_curve, "strategy": {"race_laps": strategy.race_laps, "pit_laps": list(strategy.pit_laps), "compounds": list(strategy.compounds)}, "assumptions": {"baseline_pace_seconds": strategy.baseline_pace_seconds, "compound_adjustments_seconds": COMPOUNDS, "degradation_seconds_per_lap_of_tyre_age": strategy.degradation_seconds_per_lap, "pit_loss_seconds_per_stop": strategy.pit_loss_seconds, "source": "Illustrative deterministic baseline; not fitted to a race."}}


def optimise(race_laps: int, pit_loss_seconds: float = 22.0, max_stops: int = 2) -> list[dict]:
    return optimise_with_metadata(race_laps, pit_loss_seconds, max_stops)["results"]


def optimise_with_metadata(race_laps: int, pit_loss_seconds: float = 22.0, max_stops: int = 2) -> dict:
    if not 1 <= race_laps <= 100 or not 0 <= max_stops <= 3 or not isfinite(pit_loss_seconds) or pit_loss_seconds < 0:
        raise ValueError("Invalid optimisation bounds")
    candidates = []
    evaluated = 0
    for stops in range(max_stops + 1):
        if stops == 0:
            pit_schedules = [()]
        else:
            # Sample a deterministic, bounded set of candidate laps. Enforce a
            # four-lap minimum stint, including the final stint.
            step = max(1, race_laps // 15)
            pit_options = range(4, race_laps - 3, step)
            pit_schedules = [pit for pit in combinations(pit_options, stops)
                             if all(b - a >= 4 for a, b in zip((0, *pit), (*pit, race_laps)))]
        for pits in pit_schedules:
            for compounds in product(sorted(COMPOUNDS), repeat=stops + 1):
                evaluated += 1
                result = simulate(Strategy(race_laps, list(compounds), list(pits), pit_loss_seconds=pit_loss_seconds))
                result["strategy"] = {"pit_laps": list(pits), "compounds": list(compounds)}
                candidates.append(result)
    return {
        "results": sorted(candidates, key=lambda item: item["total_seconds"])[:5],
        "evaluated": evaluated,
        "search_description": "All compound sequences across a deterministic, spaced pit-lap grid; minimum four-lap stints; at most three stops.",
    }
