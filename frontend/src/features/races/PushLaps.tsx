import { useMemo, useState, type CSSProperties } from 'react';
import { Zap } from 'lucide-react';
import { isFlyingLap, SECTORS, timingColor, type TimingBoard, type TimingLap } from '../../timing';
import { useDriverInfo } from '../../drivers';
import { DriverAvatar } from '../../components/DriverAvatar';
import { formatTime } from '../../time';

const sectorText = (value:number|null) => value === null ? '—' : value.toFixed(3);

/** Qualifying timing screen: every push lap per driver, with sectors coloured purple, green or yellow. */
export function PushLapsPanel({laps, board, highlight}:{laps:TimingLap[]; board:TimingBoard; highlight:string[]}) {
  const driverInfo = useDriverInfo();
  const [showDeleted, setShowDeleted] = useState(true);
  const drivers = useMemo(() => {
    const groups:Record<string, TimingLap[]> = {};
    // Deleted laps stay visible (struck through) when they were genuine flying laps.
    for (const lap of laps) if (isFlyingLap(lap, board.drivers[lap.driver]?.lap)) (groups[lap.driver] ??= []).push(lap);
    return Object.entries(groups)
      .map(([driver, rows]) => ({ driver, rows:rows.sort((a, b) => a.lap - b.lap), best:board.drivers[driver]?.lap ?? null }))
      .sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
  }, [laps, board]);
  const pole = drivers[0]?.best ?? null;

  if (!drivers.length) return null;
  return <section className="panel push-laps-panel">
    <div className="panel-head"><div><div className="eyebrow">QUALIFYING · EVERY PUSH LAP</div><h2>Push laps and sectors</h2></div><Zap size={18} aria-hidden="true"/></div>
    <div className="timing-legend">
      <span><i className="timing-purple"/>Session best</span><span><i className="timing-green"/>Personal best</span><span><i className="timing-yellow"/>Slower than personal best</span>
      <label className="check-label"><input type="checkbox" checked={showDeleted} onChange={event => setShowDeleted(event.target.checked)}/> Show deleted laps</label>
    </div>
    <div className="push-grid">
      {drivers.map(({driver, rows, best}, index) => {
        const info = driverInfo(driver);
        return <article key={driver} className={`push-card${highlight.includes(driver) ? ' highlight' : ''}`} style={{'--team':info.color} as CSSProperties}>
          <header>
            <b className="push-position">{index + 1}</b>
            <DriverAvatar info={info} size={30}/>
            <span className="push-name"><b>{driver}</b><small>{info.team ?? ''}</small></span>
            <span className="push-best"><b className={best !== null ? `timing-${timingColor(best, driver, 'lap', board)}` : undefined}>{formatTime(best)}</b><small>{index === 0 || pole === null || best === null ? 'POLE TIME' : `+${(best - pole).toFixed(3)} s`}</small></span>
          </header>
          <div className="push-row push-head"><span>LAP</span><span>S1</span><span>S2</span><span>S3</span><span>TIME</span></div>
          {rows.filter(row => showDeleted || !row.deleted).map(row => <div key={row.lap} className={`push-row${row.deleted ? ' deleted' : ''}`} title={row.deleted ? `Deleted: ${row.deleted_reason ?? 'track limits'}` : undefined}>
            <span>{row.lap}<i className={`compound ${row.compound.toLowerCase()}`}>{row.compound.slice(0, 1)}</i></span>
            {SECTORS.map(key => <span key={key} className={row.deleted ? undefined : `timing-${timingColor(row[key], driver, key, board) ?? 'none'}`}>{sectorText(row[key])}</span>)}
            <b className={row.deleted ? undefined : `timing-${timingColor(row.seconds, driver, 'lap', board) ?? 'none'}`}>{formatTime(row.seconds)}{row.deleted && <em>DELETED</em>}</b>
          </div>)}
        </article>;
      })}
    </div>
    <p className="muted">Push laps are flying laps within 5% of the driver's best; out-laps, in-laps and cool-down laps are left out. Deleted laps (track limits) never set a colour. Purple is the fastest in the session, green a driver's own best.</p>
  </section>;
}
