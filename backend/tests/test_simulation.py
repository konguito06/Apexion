import pytest

from app.simulation import Strategy, optimise, simulate


def test_simulation_splits_stints_and_resets_tyre_age():
    result = simulate(Strategy(10, ["SOFT", "HARD"], [5]))
    assert [x["laps"] for x in result["stints"]] == [5, 5]
    assert result["lap_curve"][0]["seconds"] == 90.0
    assert result["lap_curve"][5]["seconds"] == 90.75
    assert result["pit_loss_seconds"] == 22
    assert result["total_seconds"] == pytest.approx(sum(x["seconds"] for x in result["lap_curve"]) + 22)


@pytest.mark.parametrize("strategy", [
    Strategy(10, ["SOFT"], [5]),
    Strategy(10, ["SOFT", "HARD"], [5, 5]),
    Strategy(10, ["SOFT", "HARD"], [7, 4]),
    Strategy(10, ["SUPER"], []),
    Strategy(10, ["SOFT", "HARD"], [10]),
])
def test_invalid_strategies_are_rejected(strategy):
    with pytest.raises(ValueError):
        simulate(strategy)


def test_optimiser_returns_sorted_valid_candidates():
    results = optimise(20, max_stops=1)
    assert results
    assert results == sorted(results, key=lambda x: x["total_seconds"])
    assert all(len(x["stints"]) == x["pit_stops"] + 1 for x in results)
