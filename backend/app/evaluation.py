"""Race-held-out evaluation for Apexion's linear tyre-age lap-time model.

The target is the green-flag lap time of eligible laps after a three-lap
within-race calibration period. Tyre degradation is fit only on earlier
training races. No observations from a held-out race are used to fit that
degradation parameter; the first three eligible laps only establish its pace
intercept and are not included in the scored target.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from . import data
from .simulation import COMPOUNDS, DEFAULT_DEGRADATION_SECONDS_PER_LAP

MODEL_VERSION = "apexion-linear-tyre-age-v1"
CALIBRATION_LAPS = 3
DEFAULT_REPORT_PATH = Path(__file__).resolve().parents[1] / "artifacts" / "model_evaluation.json"
PREDICTION_TARGET = "Lap time in seconds for eligible green-flag laps after three eligible calibration laps for the same driver and race."
LAP_FILTER = (
    "Keep finite positive timed laps with a supported dry compound, known tyre life and stint, and TrackStatus exactly green (1). "
    "Exclude missing/invalid times, unknown compounds, missing tyre age/stint, pit-in/out laps, IsAccurate=False, and any non-green or missing TrackStatus. "
    "Missing IsAccurate is retained and counted separately; each excluded row is assigned to its first matching exclusion reason. Other effects such as traffic and fuel are not adjusted."
)
LIMITATIONS = [
    "The evaluation predicts later laps after three eligible laps from the same driver and race have calibrated pace; it is not a cold-start forecast.",
    "The training/test split is chronological by whole race. Training laps never include a held-out race; only its first three eligible calibration laps set that race's pace intercept.",
    "The linear model uses fixed illustrative compound offsets from the simulator and one training-race tyre-age slope; it has no circuit, driver, car, fuel, traffic, weather, track-evolution, or competitor-response features.",
    "FastF1 TrackStatus and IsAccurate coverage can vary. Missing TrackStatus is excluded; the published report includes exclusion counts and race coverage.",
    "No advanced machine-learning model is trained. This evaluation tests the transparent baseline against a constant calibration-lap median comparator.",
]


def _finite_positive(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) and result > 0 else None


def prepare_observations(rows: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Apply documented eligibility rules and return typed numeric features."""
    eligible: list[dict[str, Any]] = []
    exclusions = {
        "input_rows": 0,
        "missing_or_invalid_time": 0,
        "pit_in_or_out": 0,
        "inaccurate_lap": 0,
        "accuracy_flag_missing_but_kept": 0,
        "non_green_or_missing_track_status": 0,
        "unsupported_or_missing_compound": 0,
        "missing_tyre_life_or_stint": 0,
        "missing_race_or_driver_identity": 0,
        "eligible_laps": 0,
    }
    for row in rows:
        exclusions["input_rows"] += 1
        if row.get("pit_in") or row.get("pit_out"):
            exclusions["pit_in_or_out"] += 1
            continue
        accurate = row.get("is_accurate")
        if accurate is not None and not bool(accurate):
            exclusions["inaccurate_lap"] += 1
            continue
        accuracy_missing = accurate is None
        track_status = row.get("track_status")
        is_green = (isinstance(track_status, (int, float)) and not isinstance(track_status, bool) and track_status == 1) or str(track_status or "").strip() == "1"
        if not is_green:
            exclusions["non_green_or_missing_track_status"] += 1
            continue
        seconds = _finite_positive(row.get("seconds"))
        if seconds is None:
            exclusions["missing_or_invalid_time"] += 1
            continue
        compound = str(row.get("compound") or "").strip().upper()
        if compound not in COMPOUNDS:
            exclusions["unsupported_or_missing_compound"] += 1
            continue
        try:
            tyre_life = float(row.get("tyre_life"))
            stint = int(row.get("stint"))
            lap = int(row.get("lap"))
        except (TypeError, ValueError):
            exclusions["missing_tyre_life_or_stint"] += 1
            continue
        if not math.isfinite(tyre_life) or tyre_life < 1 or lap < 1:
            exclusions["missing_tyre_life_or_stint"] += 1
            continue
        race_id = str(row.get("race_id") or "").strip()
        driver = str(row.get("driver") or "").strip()
        if not race_id or not driver:
            exclusions["missing_race_or_driver_identity"] += 1
            continue
        if accuracy_missing:
            exclusions["accuracy_flag_missing_but_kept"] += 1
        eligible.append({
            **row,
            "race_id": race_id,
            "driver": driver,
            "lap": lap,
            "seconds": seconds,
            "compound": compound,
            "age": int(tyre_life) - 1,
            "stint": stint,
        })
    exclusions["eligible_laps"] = len(eligible)
    return eligible, exclusions


def chronological_race_split(rows: list[dict[str, Any]], test_fraction: float = 0.2) -> dict[str, Any]:
    """Split unique race IDs chronologically, keeping every race in one side."""
    if not math.isfinite(test_fraction) or not 0 < test_fraction < 0.5:
        raise ValueError("test_fraction must be greater than 0 and less than 0.5")
    metadata: dict[str, tuple[int, int, str]] = {}
    for row in rows:
        race_id = row["race_id"]
        year = int(row.get("year") or 0)
        round_number = int(row.get("round") or 0)
        date = str(row.get("date") or "")
        metadata[race_id] = (year, round_number, date)
    ordered = sorted(metadata, key=lambda race_id: (*metadata[race_id], race_id))
    if len(ordered) < 4:
        return {"training_races": [], "test_races": [], "ordered_races": ordered, "status": "insufficient_races"}
    test_count = min(max(1, math.ceil(len(ordered) * test_fraction)), len(ordered) - 3)
    train_races = ordered[:-test_count]
    test_races = ordered[-test_count:]
    return {"training_races": train_races, "test_races": test_races, "ordered_races": ordered, "status": "ready"}


def fit_training_degradation(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Fit a robust within-stint tyre-age slope using training races only."""
    grouped: dict[tuple[str, str, int, str], list[dict[str, Any]]] = {}
    for row in rows:
        key = (row["race_id"], row["driver"], row["stint"], row["compound"])
        grouped.setdefault(key, []).append(row)
    slopes: list[float] = []
    groups_used = 0
    for group in grouped.values():
        group.sort(key=lambda row: row["age"])
        if len(group) < 5 or group[-1]["age"] - group[0]["age"] < 4:
            continue
        groups_used += 1
        for left, right in combinations(group, 2):
            age_delta = right["age"] - left["age"]
            if age_delta > 0:
                slopes.append((right["seconds"] - left["seconds"]) / age_delta)
    estimate = median(slopes) if len(rows) >= 12 and len(slopes) >= 20 else None
    if estimate is not None and (not math.isfinite(estimate) or not 0 <= estimate <= 0.5):
        estimate = None
    return {
        "degradation_seconds_per_tyre_age_lap": round(estimate if estimate is not None else DEFAULT_DEGRADATION_SECONDS_PER_LAP, 6),
        "source": "training races: median pairwise same-compound within-stint slopes" if estimate is not None else "illustrative fallback: training races did not meet fit support thresholds",
        "fitted": estimate is not None,
        "training_rows": len(rows),
        "within_stint_groups_used": groups_used,
        "pairwise_slopes": len(slopes),
        "support_thresholds": {"eligible_laps": 12, "pairwise_slopes": 20, "stint_laps": 5, "tyre_age_span": 4},
    }


def regression_metrics(actual: Iterable[float], predicted: Iterable[float]) -> dict[str, float | int]:
    """Calculate regression errors with interpolated absolute-error percentiles."""
    actual_values = list(actual)
    predicted_values = list(predicted)
    if len(actual_values) != len(predicted_values):
        raise ValueError("Actual and predicted arrays must have equal lengths")
    pairs = [(float(a), float(p)) for a, p in zip(actual_values, predicted_values)]
    if any(not math.isfinite(a) or not math.isfinite(p) for a, p in pairs):
        raise ValueError("Actual and predicted values must be finite")
    if not pairs:
        raise ValueError("At least one actual/predicted pair is required")
    errors = [pred - observed for observed, pred in pairs]
    absolute = sorted(abs(error) for error in errors)

    def percentile(fraction: float) -> float:
        position = (len(absolute) - 1) * fraction
        low = math.floor(position)
        high = math.ceil(position)
        if low == high:
            return absolute[low]
        return absolute[low] + (absolute[high] - absolute[low]) * (position - low)

    return {
        "n": len(pairs),
        "mae_seconds": round(sum(absolute) / len(absolute), 6),
        "rmse_seconds": round(math.sqrt(sum(error * error for error in errors) / len(errors)), 6),
        "mean_error_seconds": round(sum(errors) / len(errors), 6),
        "median_absolute_error_seconds": round(percentile(0.5), 6),
        "p90_absolute_error_seconds": round(percentile(0.9), 6),
        "p95_absolute_error_seconds": round(percentile(0.95), 6),
        "max_absolute_error_seconds": round(absolute[-1], 6),
    }


def evaluate_race_holdout(
    observations: Iterable[dict[str, Any]],
    *,
    test_fraction: float = 0.2,
    calibration_laps: int = CALIBRATION_LAPS,
) -> dict[str, Any]:
    """Evaluate chronological race-held-out lap predictions and comparator."""
    if not isinstance(calibration_laps, int) or isinstance(calibration_laps, bool) or calibration_laps < 1:
        raise ValueError("calibration_laps must be a positive integer")
    eligible, exclusions = prepare_observations(observations)
    split = chronological_race_split(eligible, test_fraction)
    base_report: dict[str, Any] = {
        "status": "insufficient_data",
        "model_version": MODEL_VERSION,
        "prediction_target": PREDICTION_TARGET,
        "split_methodology": f"Chronological whole-race holdout: the last {test_fraction:.0%} of race IDs are test races. Training races are strictly earlier. For each held-out driver/race, the first {calibration_laps} eligible laps calibrate pace and are excluded from scoring.",
        "lap_filter": LAP_FILTER,
        "data_source": "FastF1 historical race lap timing",
        "training_races": split["training_races"],
        "test_races": split["test_races"],
        "training_metadata": {},
        "metrics": None,
        "baseline_metrics": None,
        "per_race_metrics": [],
        "exclusions": exclusions,
        "advanced_model": {"status": "not_evaluated", "reason": "The interpretable baseline is evaluated first; no advanced estimator is added without a validated, leakage-safe feature set and sufficient race-held-out evidence."},
        "limitations": LIMITATIONS,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    if split["status"] != "ready":
        base_report["training_metadata"] = {"eligible_race_count": len(split["ordered_races"])}
        base_report["message"] = "At least four eligible races are required to retain three or more training races and one held-out test race."
        return base_report

    training_ids = set(split["training_races"])
    test_ids = set(split["test_races"])
    train_rows = [row for row in eligible if row["race_id"] in training_ids]
    test_rows = [row for row in eligible if row["race_id"] in test_ids]
    degradation = fit_training_degradation(train_rows)
    model_actual: list[float] = []
    model_predictions: list[float] = []
    baseline_predictions: list[float] = []
    per_race: list[dict[str, Any]] = []
    scored_laps = 0
    calibrated_drivers = 0
    for race_id in split["test_races"]:
        race_rows = [row for row in test_rows if row["race_id"] == race_id]
        race_actual: list[float] = []
        race_model: list[float] = []
        race_baseline: list[float] = []
        for driver in sorted({row["driver"] for row in race_rows}):
            driver_rows = sorted((row for row in race_rows if row["driver"] == driver), key=lambda row: row["lap"])
            if len(driver_rows) <= calibration_laps:
                continue
            calibration = driver_rows[:calibration_laps]
            score_rows = driver_rows[calibration_laps:]
            calibrated_drivers += 1
            pace = median(
                row["seconds"] - COMPOUNDS[row["compound"]] - row["age"] * degradation["degradation_seconds_per_tyre_age_lap"]
                for row in calibration
            )
            constant_pace = median(row["seconds"] for row in calibration)
            for row in score_rows:
                prediction = pace + COMPOUNDS[row["compound"]] + row["age"] * degradation["degradation_seconds_per_tyre_age_lap"]
                model_actual.append(row["seconds"])
                model_predictions.append(prediction)
                baseline_predictions.append(constant_pace)
                race_actual.append(row["seconds"])
                race_model.append(prediction)
                race_baseline.append(constant_pace)
        if race_actual:
            per_race.append({"race_id": race_id, "scored_laps": len(race_actual), "model": regression_metrics(race_actual, race_model), "constant_calibration_baseline": regression_metrics(race_actual, race_baseline)})
            scored_laps += len(race_actual)

    base_report["training_metadata"] = {
        "training_race_count": len(training_ids),
        "test_race_count": len(test_ids),
        "eligible_training_laps": len(train_rows),
        "eligible_test_race_laps_including_calibration": len(test_rows),
        "calibration_laps_per_driver_race": calibration_laps,
        "calibrated_test_driver_races": calibrated_drivers,
        "training_degradation_fit": degradation,
        "fixed_compound_offsets_seconds": COMPOUNDS,
        "random_seed": None,
        "training_method": "Deterministic robust median slope fit; no stochastic estimator",
        "target_leakage_controls": "Held-out race IDs are excluded from degradation fit. Held-out race's first calibration laps are not scored. No test target lap participates in model fitting or pace calibration.",
    }
    base_report["per_race_metrics"] = per_race
    if not model_actual:
        base_report["message"] = "No held-out driver-race had enough eligible laps after the calibration window to score. No accuracy metrics are reported."
        return base_report
    base_report["status"] = "evaluated"
    base_report["metrics"] = regression_metrics(model_actual, model_predictions)
    base_report["baseline_metrics"] = regression_metrics(model_actual, baseline_predictions)
    baseline_mae = float(base_report["baseline_metrics"]["mae_seconds"])
    model_mae = float(base_report["metrics"]["mae_seconds"])
    base_report["baseline_comparison"] = {
        "baseline": "Constant median lap time from the same three calibration laps",
        "mae_improvement_seconds": round(baseline_mae - model_mae, 6),
        "mae_improvement_percent": round((baseline_mae - model_mae) / baseline_mae * 100, 3) if baseline_mae else 0.0,
        "interpretation": "Positive improvement means the tyre-age/compound model has lower MAE on these held-out laps; it is not evidence of future-race accuracy beyond this test set.",
    }
    return base_report


def unavailable_report() -> dict[str, Any]:
    return {
        "status": "not_run",
        "model_version": MODEL_VERSION,
        "prediction_target": PREDICTION_TARGET,
        "split_methodology": "Chronological whole-race holdout with three eligible calibration laps per driver/race; see evaluation protocol in README.",
        "lap_filter": LAP_FILTER,
        "data_source": "FastF1 historical race lap timing",
        "training_races": [], "test_races": [], "training_metadata": {},
        "metrics": None, "baseline_metrics": None, "per_race_metrics": [], "exclusions": {},
        "advanced_model": {"status": "not_evaluated", "reason": "The transparent baseline must be measured before considering a more complex estimator."},
        "limitations": LIMITATIONS,
        "message": "No evaluation report has been generated. Run `cd backend && .venv/bin/python -m app.evaluation --years 2022 2023 2024` to retrieve the documented FastF1 sample and produce verified metrics.",
        "generated_at": None,
    }


def load_report(path: Path | None = None) -> dict[str, Any]:
    report_path = path or Path(os.getenv("APEXION_MODEL_EVALUATION_REPORT", str(DEFAULT_REPORT_PATH)))
    try:
        with report_path.open(encoding="utf-8") as source:
            return json.load(source)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return unavailable_report()


def collect_fastf1_observations(years: list[int], max_events_per_season: int | None = 6) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    loaded: list[str] = []
    skipped: list[dict[str, str]] = []
    for year in years:
        try:
            season_events = data.events(year)
        except Exception as exc:
            skipped.append({"race_id": f"{year}-schedule", "error": str(exc)[:500]})
            print(f"Skipping {year} schedule: {exc}", file=sys.stderr)
            continue
        if max_events_per_season is not None:
            season_events = season_events[:max_events_per_season]
        for event in season_events:
            race_id = f"{year}-R{event['round']:02d}-{event['name']}"
            try:
                rows = data.evaluation_laps(year, event["name"])
            except Exception as exc:  # Keep a usable partial evaluation when individual events are unavailable.
                skipped.append({"race_id": race_id, "error": str(exc)[:500]})
                print(f"Skipping {race_id}: {exc}", file=sys.stderr)
                continue
            loaded.append(race_id)
            for row in rows:
                observations.append({
                    **row,
                    "race_id": race_id,
                    "year": year,
                    "round": event["round"],
                    "event": event["name"],
                })
            print(f"Loaded {race_id}: {len(rows)} lap rows", file=sys.stderr)
    return observations, {"loaded_races": loaded, "skipped_races": skipped, "years": years, "max_events_per_season": max_events_per_season}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a race-held-out evaluation report for Apexion's lap-time baseline.")
    parser.add_argument("--years", nargs="+", type=int, default=[2022, 2023, 2024], help="FastF1 seasons to retrieve")
    parser.add_argument("--max-events-per-season", type=int, default=6, help="Maximum chronologically earliest race events per season; use 0 for all")
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT_PATH, help="JSON output path")
    args = parser.parse_args()
    if args.max_events_per_season < 0:
        parser.error("--max-events-per-season must be 0 or greater")
    limit = args.max_events_per_season or None
    observations, retrieval = collect_fastf1_observations(args.years, limit)
    report = evaluate_race_holdout(observations)
    report["training_metadata"]["retrieval"] = retrieval
    report["training_metadata"]["evaluation_command"] = f"python -m app.evaluation --years {' '.join(str(year) for year in args.years)} --max-events-per-season {args.max_events_per_season}"
    if not observations:
        report["message"] = "No race lap rows were retrieved from FastF1. No evaluation metrics are reported; inspect training_metadata.retrieval.skipped_races for source errors."
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "training_races": len(report["training_races"]), "test_races": len(report["test_races"]), "metrics": report["metrics"], "baseline_metrics": report["baseline_metrics"], "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
