import { useEffect, useState } from 'react';
import { request } from '../../api';

type Metrics = {
  n: number;
  mae_seconds: number;
  rmse_seconds: number;
  mean_error_seconds: number;
  median_absolute_error_seconds: number;
  p90_absolute_error_seconds: number;
  p95_absolute_error_seconds: number;
  max_absolute_error_seconds: number;
};

type RaceMetrics = {
  race_id: string;
  scored_laps: number;
  model: Metrics;
  constant_calibration_baseline: Metrics;
};

type EvaluationReport = {
  status: string;
  model_version: string;
  prediction_target: string;
  split_methodology: string;
  lap_filter: string;
  data_source: string;
  training_races: string[];
  test_races: string[];
  training_metadata: Record<string, unknown>;
  metrics: Metrics | null;
  baseline_metrics: Metrics | null;
  per_race_metrics: RaceMetrics[];
  exclusions: Record<string, number>;
  advanced_model: { status: string; reason: string };
  limitations: string[];
  message?: string | null;
  baseline_comparison?: {
    baseline: string;
    mae_improvement_seconds: number;
    mae_improvement_percent: number;
    interpretation: string;
  } | null;
  generated_at?: string | null;
};

export function ModelInsights() {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    request<EvaluationReport>('/api/models/metrics')
      .then(value => { if (active) setReport(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load evaluation report'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <>
    <section className="panel model-evaluation">
      <div className="panel-head">
        <div><div className="eyebrow">MEASURED MODEL EVALUATION</div><h2>Lap-time prediction</h2></div>
        <span className={`evaluation-status ${report?.status === 'evaluated' ? 'verified' : ''}`}>
          {loading ? 'Loading report…' : report?.status === 'evaluated' ? 'EVALUATED' : report?.status === 'insufficient_data' ? 'INSUFFICIENT DATA' : 'NOT RUN'}
        </span>
      </div>
      {error && <div className="simulation-error" role="alert">{error}</div>}
      {report && <>
        <p className="evaluation-target"><b>Prediction target</b> · {report.prediction_target}</p>
        <div className="evaluation-meta">
          <span>Model version</span><b>{report.model_version}</b>
          <span>Data source</span><b>{report.data_source}</b>
          <span>Generated</span><b>{report.generated_at ? new Date(report.generated_at).toLocaleString() : '—'}</b>
          <span>Training races</span><b>{report.training_races.length ? report.training_races.join(', ') : '—'}</b>
          <span>Test races</span><b>{report.test_races.length ? report.test_races.join(', ') : '—'}</b>
        </div>
        {report.status === 'evaluated' && report.metrics && report.baseline_metrics ? <>
          <div className="model-metric-columns">
            <div><h3>Tyre-age and compound model</h3><MetricTable metrics={report.metrics}/></div>
            <div><h3>Simple baseline</h3><p className="muted">{report.baseline_comparison?.baseline}</p><MetricTable metrics={report.baseline_metrics}/></div>
          </div>
          {report.baseline_comparison && <p className="baseline-comparison">
            MAE change versus baseline: <b>{report.baseline_comparison.mae_improvement_seconds > 0 ? '+' : ''}{report.baseline_comparison.mae_improvement_seconds.toFixed(3)} s ({report.baseline_comparison.mae_improvement_percent.toFixed(1)}%)</b>. {report.baseline_comparison.interpretation}
          </p>}
        </> : <div className="empty evaluation-empty">{report.message ?? 'No verified evaluation metrics are available yet.'}</div>}
        <details className="evaluation-details">
          <summary>Evaluation protocol and exclusions</summary>
          <p><b>Race split</b> · {report.split_methodology}</p>
          <p><b>Eligible laps</b> · {report.lap_filter}</p>
          <div className="exclusion-counts">{Object.entries(report.exclusions).map(([name, count]) => <span key={name}>{name.replaceAll('_', ' ')} <b>{count}</b></span>)}</div>
        </details>
      </>}
    </section>

    {report?.status === 'evaluated' && <>
      <section className="panel">
        <div className="eyebrow">RACE-LEVEL ERROR DISTRIBUTION</div><h2>Held-out race results</h2>
        <div className="evaluation-race-head"><span>TEST RACE</span><span>LAPS</span><span>MODEL MAE</span><span>BASELINE MAE</span><span>MODEL RMSE</span><span>BASELINE RMSE</span></div>
        {report.per_race_metrics.map(race => <div className="evaluation-race-row" key={race.race_id}>
          <b>{race.race_id}</b><span>{race.scored_laps}</span><span>{race.model.mae_seconds.toFixed(3)} s</span><span>{race.constant_calibration_baseline.mae_seconds.toFixed(3)} s</span><span>{race.model.rmse_seconds.toFixed(3)} s</span><span>{race.constant_calibration_baseline.rmse_seconds.toFixed(3)} s</span>
        </div>)}
      </section>
      <section className="panel"><div className="eyebrow">ADVANCED MODEL CHECK</div><h2>Complexity decision</h2><p>Advanced machine learning status: <b>{report.advanced_model.status.replaceAll('_', ' ')}</b>. {report.advanced_model.reason}</p></section>
    </>}

    <div className="grid two">
      <section className="panel"><div className="eyebrow">TRAINING AND TEST DESIGN</div><h2>Leakage controls</h2>
        <p>Whole races are assigned chronologically, so laps from a race never appear in both the degradation fit and test targets. For each test driver/race, the first three eligible laps calibrate only that race's pace intercept; those calibration laps are excluded from scoring. Tyre degradation is estimated from earlier training races only.</p>
        <pre className="eval-json">{JSON.stringify(report?.training_metadata ?? {}, null, 2)}</pre>
      </section>
      <section className="panel"><div className="eyebrow">LIMITATIONS</div><h2>What this evaluation does not establish</h2>
        <ul className="model-limitations">{(report?.limitations ?? []).map(item => <li key={item}>{item}</li>)}</ul>
        <p>These results describe this historical sample. They do not validate future-race strategy forecasts, and Apexion does not reproduce a team's proprietary model.</p>
      </section>
    </div>
    <section className="panel"><div className="eyebrow">STRATEGY SIMULATOR ASSUMPTIONS</div><h2>Simulation is not an ML prediction</h2>
      <div className="assumption-list"><span>Model</span><b>Deterministic linear tyre-age lap-time estimate</b><span>Lap equation</span><b>Baseline pace + compound offset + tyre age × degradation</b><span>Illustrative compound offsets</span><b>SOFT 0.000 · MEDIUM 0.350 · HARD 0.750 s/lap</b><span>Fallback degradation</span><b>0.075 s per tyre-age lap</b><span>Default pit loss</span><b>22.000 s / stop</b><span>Model output</span><b>Simulated estimate only</b></div>
      <p>Historical race-specific pace/degradation fits or user edits can replace fallback values. Inputs and provenance appear with simulator results.</p>
    </section>
  </>;
}

function MetricTable({ metrics }: { metrics: Metrics }) {
  const rows: [string, number, string][] = [
    ['MAE', metrics.mae_seconds, 'Mean absolute error'],
    ['RMSE', metrics.rmse_seconds, 'Root mean squared error'],
    ['Median absolute error', metrics.median_absolute_error_seconds, '50th percentile absolute error'],
    ['90th percentile absolute error', metrics.p90_absolute_error_seconds, 'Tail error'],
    ['Mean error', metrics.mean_error_seconds, 'Signed bias'],
    ['Scored laps', metrics.n, 'Held-out laps'],
  ];
  return <div className="evaluation-metric-table">{rows.map(([name, value, description]) => <div key={name}>
    <span>{name}<small>{description}</small></span><b>{name === 'Scored laps' ? value : `${value.toFixed(3)} s`}</b>
  </div>)}</div>;
}
