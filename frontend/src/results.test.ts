import { describe, expect, it } from 'vitest';
import { resultCells } from './results';

const row = (status:string|null, time:number|null, laps_behind:number|null = 0) => ({ status, time, points:0, laps_behind });

describe('resultCells', () => {
  it('shows the winner time and lead-lap gaps, including gaps over a minute', () => {
    expect(resultCells(row('Finished', 5504.742), true)).toEqual({ status:'Finished', time:'1:31:44.742', kind:'winner' });
    expect(resultCells(row('Finished', 22.457), false).time).toBe('+22.457 s');
    expect(resultCells(row('Finished', 74.887), false)).toEqual({ status:'Finished', time:'+1:14.887', kind:'gap' });
  });

  it('turns lapped cars into +N LAP(S) from laps completed, ignoring their time column', () => {
    expect(resultCells(row('Lapped', 6.759, 1), false)).toEqual({ status:'Finished', time:'+1 LAP', kind:'lapped' });
    expect(resultCells(row('Lapped', 20.795, 2), false).time).toBe('+2 LAPS');
    expect(resultCells(row('+3 Laps', null, null), false).time).toBe('+3 LAPS');
  });

  it('labels non-finishers DNF, DNS and DSQ', () => {
    expect(resultCells(row('Retired', null, 54), false)).toEqual({ status:'Did not finish', time:'DNF', kind:'dnf' });
    expect(resultCells(row('Engine', null, 20), false)).toEqual({ status:'Did not finish · Engine', time:'DNF', kind:'dnf' });
    expect(resultCells(row('Did not start', null, null), false).time).toBe('DNS');
    expect(resultCells(row('Disqualified', 5600, 0), false).time).toBe('DSQ');
  });
});
