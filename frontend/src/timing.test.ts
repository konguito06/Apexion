import { describe, expect, it } from 'vitest';
import { isFlyingLap, isPushLap, timingBoard, timingColor, type TimingLap } from './timing';

const lap = (driver:string, number:number, sectors:[number, number, number], extra:Partial<TimingLap> = {}):TimingLap => ({
  driver, lap:number, seconds:sectors[0] + sectors[1] + sectors[2], sector_1:sectors[0], sector_2:sectors[1], sector_3:sectors[2],
  compound:'SOFT', tyre_life:number, pit_in:false, pit_out:false, deleted:false, deleted_reason:null, personal_best:false, ...extra,
});

describe('timing colours', () => {
  const laps = [
    lap('VER', 1, [40, 40, 40], { pit_out:true }),      // out-lap: never counts
    lap('VER', 2, [30.0, 28.1, 28.4]),
    lap('VER', 3, [29.9, 28.3, 28.6]),
    lap('LEC', 2, [30.2, 28.0, 28.5]),
    lap('LEC', 3, [29.0, 27.0, 27.0], { deleted:true }), // deleted: never counts
  ];
  const board = timingBoard(laps);

  it('only counts push laps', () => {
    expect(laps.filter(isPushLap).map(row => `${row.driver}${row.lap}`)).toEqual(['VER2', 'VER3', 'LEC2']);
    expect(board.session.sectors.sector_1).toBe(29.9);
  });

  it('colours purple for session best, green for personal best, yellow otherwise', () => {
    expect(timingColor(29.9, 'VER', 'sector_1', board)).toBe('purple');
    expect(timingColor(28.1, 'VER', 'sector_2', board)).toBe('green');
    expect(timingColor(28.0, 'LEC', 'sector_2', board)).toBe('purple');
    expect(timingColor(28.6, 'VER', 'sector_3', board)).toBe('yellow');
    expect(timingColor(86.5, 'VER', 'lap', board)).toBe('purple');
    expect(timingColor(null, 'VER', 'lap', board)).toBeNull();
  });

  it('treats cool-down laps as not flying, but keeps deleted flying laps', () => {
    expect(isFlyingLap(lap('LEC', 3, [49, 34.5, 38.3]), 87.8)).toBe(false);
    expect(isFlyingLap(lap('LEC', 4, [32.2, 28.1, 28.3]), 87.8)).toBe(true);
    expect(isFlyingLap(lap('LEC', 5, [32.0, 28.0, 28.0], { deleted:true }), 87.8)).toBe(true);
    expect(isFlyingLap(lap('LEC', 6, [32.0, 28.0, 28.0], { pit_in:true }), 87.8)).toBe(false);
  });
});
