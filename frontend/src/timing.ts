export type TimingLap = { driver:string; lap:number; seconds:number|null; sector_1:number|null; sector_2:number|null; sector_3:number|null; compound:string; tyre_life:number|null; pit_in:boolean; pit_out:boolean; deleted:boolean; deleted_reason:string|null; personal_best:boolean };
export type SectorKey = 'sector_1'|'sector_2'|'sector_3';
/** Timing-screen colours: purple = best in the session, green = driver's personal best, yellow = slower than that. */
export type TimingColor = 'purple'|'green'|'yellow';
export const SECTORS:SectorKey[] = ['sector_1','sector_2','sector_3'];

/** A push lap is a timed flying lap: not an out-lap, not an in-lap, and not deleted. */
export const isPushLap = (lap:TimingLap) => lap.seconds !== null && !lap.pit_in && !lap.pit_out && !lap.deleted;

type Bests = { lap:number|null; sectors:Record<SectorKey, number|null> };
const minimum = (values:(number|null)[]) => { const valid = values.filter((value):value is number => value !== null); return valid.length ? Math.min(...valid) : null; };
const bestsOf = (laps:TimingLap[]):Bests => ({
  lap: minimum(laps.map(lap => lap.seconds)),
  sectors: { sector_1: minimum(laps.map(lap => lap.sector_1)), sector_2: minimum(laps.map(lap => lap.sector_2)), sector_3: minimum(laps.map(lap => lap.sector_3)) },
});

export type TimingBoard = { session:Bests; drivers:Record<string, Bests> };

/** Cool-down and preparation laps are timed too; a flying lap is within this margin of the driver's best. */
export const FLYING_LAP_MARGIN = 1.05;
export const isFlyingLap = (lap:TimingLap, personalBest:number|null|undefined) =>
  lap.seconds !== null && !lap.pit_in && !lap.pit_out && personalBest != null && lap.seconds <= personalBest * FLYING_LAP_MARGIN;

/** Session and per-driver bests over push laps only, so out-laps and deleted laps never set a colour. */
export function timingBoard(laps:TimingLap[]):TimingBoard {
  const push = laps.filter(isPushLap);
  const byDriver:Record<string, TimingLap[]> = {};
  for (const lap of push) (byDriver[lap.driver] ??= []).push(lap);
  return { session: bestsOf(push), drivers: Object.fromEntries(Object.entries(byDriver).map(([driver, rows]) => [driver, bestsOf(rows)])) };
}

export function timingColor(value:number|null, driver:string, key:SectorKey|'lap', board:TimingBoard):TimingColor|null {
  if (value === null) return null;
  const session = key === 'lap' ? board.session.lap : board.session.sectors[key];
  const personal = key === 'lap' ? board.drivers[driver]?.lap : board.drivers[driver]?.sectors[key];
  if (session !== null && value <= session) return 'purple';
  if (personal != null && value <= personal) return 'green';
  return 'yellow';
}
