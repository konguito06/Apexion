import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModelInsights } from './ModelInsights';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Model Insights', () => {
  it('clearly distinguishes a missing evaluation from measured model quality', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'not_run', model_version: 'apexion-linear-tyre-age-v1', prediction_target: 'Held-out later lap time',
      split_methodology: 'Whole-race chronological split', lap_filter: 'Green flag laps only', data_source: 'FastF1',
      training_races: [], test_races: [], training_metadata: {}, metrics: null, baseline_metrics: null,
      per_race_metrics: [], exclusions: {}, advanced_model: { status: 'not_evaluated', reason: 'Baseline first.' },
      limitations: [], message: 'No evaluation report has been generated.', generated_at: null,
    }), { status: 200 })));

    render(<ModelInsights/>);

    expect(await screen.findByText('NOT RUN')).toBeTruthy();
    expect(await screen.findByText('No evaluation report has been generated.')).toBeTruthy();
    expect(screen.queryByText(/MAE change versus baseline/)).toBeNull();
  });

  it('shows only reported metrics and the held-out races from a saved report', async () => {
    const metrics = { n: 12, mae_seconds: .24, rmse_seconds: .3, mean_error_seconds: .02, median_absolute_error_seconds: .2, p90_absolute_error_seconds: .4, p95_absolute_error_seconds: .45, max_absolute_error_seconds: .5 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'evaluated', model_version: 'apexion-linear-tyre-age-v1', prediction_target: 'Held-out later lap time',
      split_methodology: 'Whole-race chronological split', lap_filter: 'Green flag laps only', data_source: 'FastF1',
      training_races: ['R1', 'R2', 'R3'], test_races: ['R4'], training_metadata: {}, metrics,
      baseline_metrics: { ...metrics, mae_seconds: .4 },
      per_race_metrics: [{ race_id: 'R4', scored_laps: 12, model: metrics, constant_calibration_baseline: { ...metrics, mae_seconds: .4 } }],
      exclusions: { eligible_laps: 12 }, advanced_model: { status: 'not_evaluated', reason: 'Baseline first.' },
      limitations: ['Historical sample only.'], baseline_comparison: { baseline: 'Constant median', mae_improvement_seconds: .16, mae_improvement_percent: 40, interpretation: 'Test set only.' },
      generated_at: '2026-10-01T00:00:00Z',
    }), { status: 200 })));

    render(<ModelInsights/>);

    expect(await screen.findByText('EVALUATED')).toBeTruthy();
    expect(screen.getAllByText('0.240 s').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R4').length).toBeGreaterThan(0);
    expect(screen.getByText(/MAE change versus baseline/)).toBeTruthy();
  });
});
