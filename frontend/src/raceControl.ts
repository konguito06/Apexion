export type PeriodKind = 'yellow'|'safety_car'|'vsc'|'red_flag';
export type TrackPeriod = { kind:PeriodKind; start_lap:number|null; end_lap:number|null; start_seconds:number; end_seconds:number|null };
export type RaceEvent = { kind:string; lap:number|null; sector:number|null; message:string; drivers:string[] };
export type PitStop = { driver:string; lap:number; from_compound:string|null; to_compound:string|null; pit_lane_seconds:number|null; under:string|null };
export type RaceControl = { periods:TrackPeriod[]; events:RaceEvent[]; pit_stops:PitStop[] };

export const EVENT_LABELS:Record<string, { label:string; tone:string }> = {
  safety_car: { label:'SAFETY CAR', tone:'sc' },
  safety_car_end: { label:'SC IN THIS LAP', tone:'sc' },
  vsc: { label:'VIRTUAL SC', tone:'sc' },
  vsc_end: { label:'VSC ENDING', tone:'sc' },
  red_flag: { label:'RED FLAG', tone:'red' },
  yellow: { label:'YELLOW FLAG', tone:'yellow' },
  restart: { label:'RESTART', tone:'green' },
  penalty: { label:'PENALTY', tone:'penalty' },
  investigation: { label:'INVESTIGATION', tone:'muted' },
  warning: { label:'BLACK & WHITE', tone:'bw' },
  lap_deleted: { label:'LAP DELETED', tone:'muted' },
};

export const EVENT_FILTERS:{ id:string; label:string; kinds?:string[] }[] = [
  { id:'all', label:'All' },
  { id:'flags', label:'Safety car & flags', kinds:['safety_car','safety_car_end','vsc','vsc_end','red_flag','yellow','restart'] },
  { id:'penalties', label:'Penalties', kinds:['penalty','investigation','warning'] },
  { id:'limits', label:'Track limits', kinds:['lap_deleted'] },
];

/** Shading for neutralised and flagged periods on lap charts. */
export const PERIOD_STYLE:Record<PeriodKind, { fill:string; opacity:number; label:string }> = {
  safety_car: { fill:'#ffd23f', opacity:.16, label:'SC' },
  vsc: { fill:'#ffd23f', opacity:.09, label:'VSC' },
  red_flag: { fill:'#e10600', opacity:.22, label:'RED' },
  yellow: { fill:'#ffd23f', opacity:.05, label:'' },
};

export const isRaceControl = (value:unknown):value is RaceControl =>
  typeof value === 'object' && value !== null && Array.isArray((value as RaceControl).periods) && Array.isArray((value as RaceControl).events) && Array.isArray((value as RaceControl).pit_stops);
