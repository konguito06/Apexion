import { useMemo, useState, type CSSProperties } from 'react';
import { Flag, Timer } from 'lucide-react';
import { EVENT_FILTERS, EVENT_LABELS, type PitStop, type RaceEvent } from '../../raceControl';
import { useDriverInfo } from '../../drivers';
import { DriverAvatar } from '../../components/DriverAvatar';
import { formatTime } from '../../time';

function DriverTag({code}:{code:string}) {
  const info = useDriverInfo()(code);
  return <span className="driver-tag" style={{'--team':info.color} as CSSProperties}><DriverAvatar info={info} size={20}/>{code}</span>;
}

/** Race control timeline: safety cars, flags, restarts, penalties and deleted laps, grouped by lap. */
export function RaceEventsPanel({events, highlight}:{events:RaceEvent[]; highlight:string[]}) {
  const [filter, setFilter] = useState('all');
  const [onlySelected, setOnlySelected] = useState(false);
  const kinds = EVENT_FILTERS.find(option => option.id === filter)?.kinds;
  const visible = events.filter(event => (!kinds || kinds.includes(event.kind)) && (!onlySelected || !event.drivers.length || event.drivers.some(driver => highlight.includes(driver))));
  const counts = useMemo(() => Object.fromEntries(EVENT_FILTERS.map(option => [option.id, option.kinds ? events.filter(event => option.kinds?.includes(event.kind)).length : events.length])), [events]);

  return <section className="panel race-events-panel">
    <div className="panel-head"><div><div className="eyebrow">RACE CONTROL · FLAGS, SAFETY CARS AND PENALTIES</div><h2>Race events</h2></div><Flag size={18} aria-hidden="true"/></div>
    <div className="event-filters" role="group" aria-label="Filter race events">
      {EVENT_FILTERS.map(option => <button key={option.id} type="button" aria-pressed={filter === option.id} className={filter === option.id ? 'active' : undefined} onClick={() => setFilter(option.id)}>{option.label} <span>{counts[option.id]}</span></button>)}
      <label className="check-label"><input type="checkbox" checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)}/> Only selected drivers</label>
    </div>
    {visible.length ? <ol className="event-list">
      {visible.map((event, index) => {
        const label = EVENT_LABELS[event.kind] ?? { label:event.kind.toUpperCase(), tone:'muted' };
        return <li key={`${event.lap}-${event.kind}-${index}`} className={event.drivers.some(driver => highlight.includes(driver)) ? 'highlight' : undefined}>
          <span className="event-lap">{event.lap ? `LAP ${event.lap}` : '—'}</span>
          <span className={`event-badge ${label.tone}`}>{label.label}{event.sector ? ` · S${event.sector}` : ''}</span>
          <span className="event-message">{event.message}</span>
          <span className="event-drivers">{event.drivers.map(driver => <DriverTag key={driver} code={driver}/>)}</span>
        </li>;
      })}
    </ol> : <div className="empty">{events.length ? 'No race events match this filter.' : 'Race control reported no flags, safety cars or penalties for this session.'}</div>}
  </section>;
}

/** Every pit stop with the tyre change and time spent in the pit lane; the quickest stop is marked purple. */
export function PitStopsPanel({stops, highlight}:{stops:PitStop[]; highlight:string[]}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll || !highlight.length ? stops : stops.filter(stop => highlight.includes(stop.driver));
  const fastest = Math.min(...stops.map(stop => stop.pit_lane_seconds ?? Infinity));

  return <section className="panel pit-stops-panel">
    <div className="panel-head"><div><div className="eyebrow">PIT LANE · ENTRY TO EXIT</div><h2>Pit stops</h2></div><Timer size={18} aria-hidden="true"/></div>
    {highlight.length > 0 && <div className="event-filters" role="group" aria-label="Pit stops to show">
      <button type="button" aria-pressed={!showAll} className={!showAll ? 'active' : undefined} onClick={() => setShowAll(false)}>Selected drivers</button>
      <button type="button" aria-pressed={showAll} className={showAll ? 'active' : undefined} onClick={() => setShowAll(true)}>All drivers <span>{stops.length}</span></button>
    </div>}
    {visible.length ? <div className="pit-table">
      <div className="pit-row pit-head"><span>LAP</span><span>DRIVER</span><span>TYRES</span><span>PIT LANE</span><span/></div>
      {visible.map(stop => <div className="pit-row" key={`${stop.driver}-${stop.lap}`}>
        <b>{stop.lap}</b>
        <DriverTag code={stop.driver}/>
        <span className="pit-tyres">
          {stop.from_compound && <span className={`compound ${stop.from_compound.toLowerCase()}`}>{stop.from_compound}</span>}
          <span aria-hidden="true">→</span>
          {stop.to_compound && <span className={`compound ${stop.to_compound.toLowerCase()}`}>{stop.to_compound}</span>}
        </span>
        <b className={stop.pit_lane_seconds === fastest ? 'timing-fastest' : undefined}>{formatTime(stop.pit_lane_seconds)}</b>
        <span>{stop.under && <span className="event-badge sc">{stop.under === 'vsc' ? 'UNDER VSC' : stop.under === 'red_flag' ? 'RED FLAG' : 'UNDER SC'}</span>}</span>
      </div>)}
    </div> : <div className="empty">{stops.length ? 'The selected drivers did not pit in this session.' : 'No pit stops recorded for this session.'}</div>}
    <p className="muted">Pit lane time runs from pit entry to pit exit, as recorded by FastF1; the stationary time is not published in this data.</p>
  </section>;
}
