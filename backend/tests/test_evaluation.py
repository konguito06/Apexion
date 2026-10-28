import math

import pytest

from app.evaluation import (
    chronological_race_split,
    evaluate_race_holdout,
    fit_training_degradation,
    load_report,
    prepare_observations,
    regression_metrics,
)


def synthetic_races(count=5):
    rows = []
    for round_number in range(1, count + 1):
        race_id = f"2024-R{round_number:02d}"
        race_pace = 90 + round_number
        for lap in range(1, 9):
            rows.append({
                "race_id": race_id,
                "year": 2024,
                "round": round_number,
                "date": f"2024-{round_number:02d}-01",
                "driver": "AAA",
                "lap": lap,
                "seconds": race_pace + (lap - 1) * 0.1,
                "compound": "SOFT",
                "tyre_life": lap,
                "stint": 1,
                "pit_in": False,
                "pit_out": False,
                "is_accurate": True,
                "track_status": "1",
            })
    return rows


def test_regression_metrics_calculate_error_magnitudes_bias_and_percentiles():
    result = regression_metrics([1, 2, 3], [2, 2, 1])
    assert result["n"] == 3
    assert result["mae_seconds"] == 1
    assert result["rmse_seconds"] == pytest.approx(math.sqrt(5 / 3))
    assert result["mean_error_seconds"] == pytest.approx(-1 / 3)
    assert result["median_absolute_error_seconds"] == 1
    assert result["p90_absolute_error_seconds"] == pytest.approx(1.8)


def test_regression_metrics_reject_mismatched_or_non_finite_inputs():
    with pytest.raises(ValueError, match="equal lengths"):
        regression_metrics([1, 2], [1])
    with pytest.raises(ValueError, match="finite"):
        regression_metrics([1], [float("nan")])


def test_chronological_split_keeps_complete_races_on_one_side():
    rows, _ = prepare_observations(synthetic_races())
    split = chronological_race_split(rows, test_fraction=0.2)
    assert split["training_races"] == ["2024-R01", "2024-R02", "2024-R03", "2024-R04"]
    assert split["test_races"] == ["2024-R05"]
    assert set(split["training_races"]).isdisjoint(split["test_races"])


def test_filter_excludes_pit_inaccurate_yellow_missing_and_unusable_laps():
    rows = synthetic_races(1)[:5]
    rows[0]["pit_in"] = True
    rows[1]["is_accurate"] = False
    rows[2]["track_status"] = "2"
    rows[3]["track_status"] = None
    rows[4]["seconds"] = None
    eligible, exclusions = prepare_observations(rows)
    assert eligible == []
    assert exclusions["pit_in_or_out"] == 1
    assert exclusions["inaccurate_lap"] == 1
    assert exclusions["non_green_or_missing_track_status"] == 2
    assert exclusions["missing_or_invalid_time"] == 1


def test_missing_accuracy_flag_is_counted_but_not_treated_as_inaccurate():
    row = synthetic_races(1)[0]
    row["is_accurate"] = None
    eligible, exclusions = prepare_observations([row])
    assert len(eligible) == 1
    assert exclusions["accuracy_flag_missing_but_kept"] == 1


def test_degradation_fit_uses_only_given_training_rows_and_robust_pairwise_slopes():
    rows, _ = prepare_observations(synthetic_races(2))
    fit = fit_training_degradation(rows)
    assert fit["fitted"] is True
    assert fit["degradation_seconds_per_tyre_age_lap"] == pytest.approx(0.1)
    assert fit["within_stint_groups_used"] == 2


def test_race_held_out_model_improves_over_constant_calibration_baseline_on_known_fixture():
    report = evaluate_race_holdout(synthetic_races())
    assert report["status"] == "evaluated"
    assert report["training_races"] == ["2024-R01", "2024-R02", "2024-R03", "2024-R04"]
    assert report["test_races"] == ["2024-R05"]
    assert report["training_metadata"]["training_degradation_fit"]["degradation_seconds_per_tyre_age_lap"] == pytest.approx(0.1)
    assert report["metrics"]["n"] == 5
    assert report["metrics"]["mae_seconds"] == 0
    assert report["baseline_metrics"]["mae_seconds"] == pytest.approx(0.4)
    assert report["baseline_comparison"]["mae_improvement_seconds"] == pytest.approx(0.4)
    assert "2024-R05" not in report["training_races"]
    assert report["advanced_model"]["status"] == "not_evaluated"


def test_insufficient_races_reports_no_metrics_instead_of_fabricating_them():
    report = evaluate_race_holdout(synthetic_races(3))
    assert report["status"] == "insufficient_data"
    assert report["metrics"] is None
    assert "four eligible races" in report["message"]


def test_unavailable_optional_evaluation_report_is_safe(tmp_path):
    report = load_report(tmp_path / "missing.json")
    assert report["status"] == "not_run"
    assert report["metrics"] is None


@pytest.mark.parametrize("fraction", [0, 0.5, 1])
def test_invalid_test_fraction_is_rejected(fraction):
    with pytest.raises(ValueError):
        chronological_race_split([], fraction)
