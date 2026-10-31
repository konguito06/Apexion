import { formatDelta, formatTime } from './time';

type ResultRow = { status:string|null; time:number|null; points:number|null; laps?:number|null; laps_behind?:number|null };
export type ResultKind = 'winner'|'gap'|'lapped'|'dnf'|'dns'|'dsq'|'unknown';

const lapsDown = (count:number) => `+${count} LAP${count === 1 ? '' : 'S'}`;

/**
 * Timing-screen wording for one classification row: the winner's race time, gaps for the lead lap,
 * "+N LAPS" when laps were lost, and DNF / DNS / DSQ for non-finishers.
 * Laps down comes from laps completed — a gap of over a minute on the lead lap is still a gap.
 */
export function resultCells(row:ResultRow, isWinner:boolean):{status:string; time:string; kind:ResultKind} {
  const status = (row.status ?? '').trim();
  const lower = status.toLowerCase();
  const fromStatus = /^\+(\d+)\s*laps?$/i.exec(status);
  const behind = row.laps_behind ?? (fromStatus ? Number(fromStatus[1]) : null);

  if (lower.includes('disqualified')) return { status:'Disqualified', time:'DSQ', kind:'dsq' };
  if (lower.includes('did not start') || lower.includes('withdrew')) return { status:'Did not start', time:'DNS', kind:'dns' };
  const classifiedFinish = lower === 'finished' || lower === 'lapped' || fromStatus !== null;
  if (!classifiedFinish) {
    if (!status) return { status:'—', time:row.time != null ? formatTime(row.time) : `${row.points ?? 0} pts`, kind:'unknown' };
    // Retired, Accident, Engine, Collision… are all "did not finish"; keep the specific cause when it is one.
    return { status:lower === 'retired' ? 'Did not finish' : `Did not finish · ${status}`, time:'DNF', kind:'dnf' };
  }
  if (behind && behind > 0) return { status:'Finished', time:lapsDown(behind), kind:'lapped' };
  if (isWinner) return { status:'Finished', time:formatTime(row.time), kind:'winner' };
  return { status:'Finished', time:row.time != null ? formatDelta(row.time) : '—', kind:'gap' };
}
