import pytest

from app.simulation import Strategy, estimate_parameters, optimise, simulate, stint_boundaries, tyre_age


def test_stint_boundaries_and_tyre_age_are_one_based_laps_with_zero_based_age():
    assert stint_boundaries(10, [3, 7]) == [(1, 3), (4, 7), (8, 10)]
    assert tyre_age(4, 4) == 0
    assert tyre_age(4, 7) == 3
    with pytest.raises(ValueError, match="precede"):
        tyre_age(4, 3)


def test_reference_example_can_be_verified_by_hand():
    # Five laps: SOFT age 0/1, pit loss 22 s, then HARD age 0/1/2.
    result = simulate(Strategy(
        race_laps=5, compounds=["SOFT", "HARD"], pit_laps=[2],
        baseline_pace_seconds=90, pit_loss_seconds=22,
        degradation_seconds_per_lap=.1,
    ))
    assert [lap["seconds"] for lap in result["lap_curve"]] == [90, 90.1, 90.75, 90.85, 90.95]
    assert result["green_flag_seconds"] == pytest.approx(452.65)
    assert result["pit_loss_seconds"] == 22
    assert result["total_seconds"] == pytest.approx(474.65)
    assert result["baseline_total_seconds"] == pytest.approx(451)
    assert result["delta_vs_baseline_seconds"] == pytest.approx(23.65)
    assert [stint["laps"] for stint in result["stints"]] == [2, 3]
    assert result["stints"][0]["pit_loss_after_seconds"] == 22
    assert result["stints"][1]["pit_loss_after_seconds"] == 0
    assert result["pit_stop_details"] == [{"stop_number": 1, "after_lap": 2, "pit_loss_seconds": 22, "old_compound": "SOFT", "new_compound": "HARD"}]


def test_pit_lap_is_counted_once_on_old_tyre_and_new_tyre_starts_next_lap():
    result = simulate(Strategy(3, ["MEDIUM", "HARD"], [1], baseline_pace_seconds=90, pit_loss_seconds=22, degradation_seconds_per_lap=0))
    assert [(lap["lap"], lap["compound"]) for lap in result["lap_curve"]] == [(1, "MEDIUM"), (2, "HARD"), (3, "HARD")]
    assert result["green_flag_seconds"] == pytest.approx(271.85)
    assert result["pit_loss_seconds"] == 22
    assert result["total_seconds"] == pytest.approx(293.85)


def test_single_lap_race_without_stops_is_valid():
    result = simulate(Strategy(1, ["HARD"], []))
    assert result["stints"][0]["start_lap"] == result["stints"][0]["end_lap"] == 1
    assert result["lap_curve"][0]["tyre_age"] == 0


@pytest.mark.parametrize("strategy", [
    Strategy(10, ["SOFT"], [5]),
    Strategy(10, ["SOFT", "HARD"], [5, 5]),
    Strategy(10, ["SOFT", "HARD"], [7, 4]),
    Strategy(10, ["SUPER"], []),
    Strategy(10, ["SOFT", "HARD"], [10]),
    Strategy(10, ["SOFT", "HARD", "MEDIUM"], [2, 2]),
])
def test_invalid_strategies_are_rejected(strategy):
    with pytest.raises(ValueError):
        simulate(strategy)


def test_non_finite_model_parameters_are_rejected():
    with pytest.raises(ValueError, match="finite"):
        simulate(Strategy(10, ["HARD"], [], baseline_pace_seconds=float("nan")))


def test_explanation_components_sum_to_delta_against_baseline():
    result = simulate(Strategy(8, ["SOFT", "HARD"], [4], baseline_pace_seconds=92, degradation_seconds_per_lap=.08))
    explanation_components = [float(message.split("by ")[1].split(" s")[0]) for message in result["explanations"][:2]]
    pit_cost = result["pit_loss_seconds"]
    assert sum(explanation_components) + pit_cost == pytest.approx(result["delta_vs_baseline_seconds"])


def test_historical_parameter_fit_uses_representative_same_stint_laps():
    observations = []
    for compound, offset, stint in (("SOFT", 0, 1), ("HARD", .75, 2)):
        for tyre_life in range(1, 9):
            observations.append({
                "seconds": 90 + offset + (tyre_life - 1) * .1,
                "compound": compound,
                "tyre_life": tyre_life,
                "stint": stint,
                "pit_in": False,
                "pit_out": False,
            })
    observations.extend([
        {"seconds": 200, "compound": "SOFT", "tyre_life": 5, "stint": 1, "pit_in": True, "pit_out": False},
        {"seconds": None, "compound": "SOFT", "tyre_life": 6, "stint": 1, "pit_in": False, "pit_out": False},
    ])

    estimate = estimate_parameters(observations)

    assert estimate["baseline_pace_seconds"] == pytest.approx(90)
    assert estimate["degradation_seconds_per_lap"] == pytest.approx(.1)
    assert estimate["representative_laps"] == 16
    assert estimate["degradation_source"].startswith("Exploratory within-stint")


def test_historical_fit_falls_back_to_explicit_defaults_when_sample_is_small():
    estimate = estimate_parameters([{"seconds":91,"compound":"MEDIUM","tyre_life":1,"pit_in":False,"pit_out":False}])
    assert estimate["baseline_pace_seconds"] == 90
    assert estimate["degradation_seconds_per_lap"] == .075
    assert "Illustrative default" in estimate["baseline_pace_source"]
    assert "Illustrative default" in estimate["degradation_source"]


def test_historical_pace_does_not_silently_treat_missing_tyre_age_as_new():
    rows = [{"seconds": 95 + i, "compound": "SOFT", "tyre_life": None, "stint": 1} for i in range(4)]
    estimate = estimate_parameters(rows)
    assert estimate["baseline_pace_seconds"] == 90
    assert "known tyre age" in estimate["baseline_pace_source"]


def test_optimiser_uses_same_model_inputs_and_returns_sorted_valid_candidates():
    results = optimise(20, max_stops=1, baseline_pace_seconds=92, degradation_seconds_per_lap=.1)
    assert results
    assert results == sorted(results, key=lambda item: item["total_seconds"])
    assert all(len(result["stints"]) == result["pit_stops"] + 1 for result in results)
    assert all(result["assumptions"]["baseline_pace_seconds"] == 92 for result in results)
