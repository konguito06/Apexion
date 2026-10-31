import { useMemo } from 'react';
import { ChevronDown, Timer } from 'lucide-react';
import { formatTime } from '../time';

type LapOption = { lap:number; seconds:number|null; compound:string; pit_in:boolean; pit_out:boolean };

const lapTime = (seconds:number|null) => formatTime(seconds, 3, 'No time');

/** Lap picker whose options carry lap time and tyre, with a one-click jump to the driver's fastest racing lap. */
export function LapSelect({label, caption = label, laps, value, onChange, disabled = false}:{label:string; caption?:string; laps:LapOption[]; value:number; onChange:(lap:number)=>void; disabled?:boolean}) {
  const fastest = useMemo(() => laps.filter(row => row.seconds !== null && !row.pit_in && !row.pit_out).reduce<LapOption|null>((best, row) => !best || (row.seconds as number) < (best.seconds as number) ? row : best, null), [laps]);
  const selected = laps.find(row => row.lap === value) ?? laps[0];
  const unavailable = disabled || !laps.length;

  return <div className="picker-field lap-select">
    <span className="picker-label">{caption}</span>
    <div className="lap-select-row">
      <div className="lap-select-box">
        <select aria-label={label} value={selected?.lap ?? ''} onChange={event => onChange(Number(event.target.value))} disabled={unavailable}>
          {laps.length ? laps.map(row => <option key={row.lap} value={row.lap}>
            {`Lap ${row.lap} · ${lapTime(row.seconds)} · ${row.compound}${row.lap === fastest?.lap ? ' · FASTEST' : ''}${row.pit_in ? ' · PIT IN' : row.pit_out ? ' · PIT OUT' : ''}`}
          </option>) : <option value="">No laps</option>}
        </select>
        {selected && <span className="lap-select-face" aria-hidden="true">
          <b>LAP {selected.lap}</b>
          <span className={selected.lap === fastest?.lap ? 'timing-fastest' : undefined}>{lapTime(selected.seconds)}</span>
          <i className={`compound ${selected.compound.toLowerCase()}`}>{selected.compound.slice(0, 1)}</i>
        </span>}
        <ChevronDown size={15} aria-hidden="true"/>
      </div>
      <button type="button" className="lap-fastest" disabled={unavailable || !fastest || fastest.lap === selected?.lap} onClick={() => fastest && onChange(fastest.lap)} title={fastest ? `Jump to fastest lap (lap ${fastest.lap}, ${lapTime(fastest.seconds)})` : 'No timed racing laps'}>
        <Timer size={14} aria-hidden="true"/> Fastest
      </button>
    </div>
  </div>;
}
