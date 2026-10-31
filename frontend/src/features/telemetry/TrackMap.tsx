import { useMemo } from 'react';
import { miniSectorDominance, speedColor, type TelemetryPoint } from './transforms';

type Driver = { label:string; color:string };
type Coordinate = { x:number; y:number };

const MINI_SECTORS = 24;
const VIEW = 1000;

/** Fit FastF1 track coordinates into a square SVG viewBox, keeping the circuit's aspect ratio. */
function project(points:TelemetryPoint[], xKey:string, yKey:string):(Coordinate|null)[] {
  const raw = points.map(point => typeof point[xKey] === 'number' && typeof point[yKey] === 'number' ? { x:point[xKey] as number, y:point[yKey] as number } : null);
  const valid = raw.filter((value):value is Coordinate => value !== null);
  if (valid.length < 10) return [];
  const xs = valid.map(value => value.x), ys = valid.map(value => value.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = (VIEW * .9) / Math.max(maxX - minX, maxY - minY, 1);
  const offsetX = (VIEW - (maxX - minX) * scale) / 2, offsetY = (VIEW - (maxY - minY) * scale) / 2;
  // SVG y grows downwards; FastF1 y grows upwards.
  return raw.map(value => value && { x:offsetX + (value.x - minX) * scale, y:VIEW - offsetY - (value.y - minY) * scale });
}

const path = (coordinates:(Coordinate|null)[]) => coordinates.filter((value):value is Coordinate => value !== null).map(value => `${value.x.toFixed(1)},${value.y.toFixed(1)}`).join(' ');

export function TrackMap({points, compare, first, second}:{points:TelemetryPoint[]; compare:boolean; first:Driver; second:Driver}) {
  const coordinates = useMemo(() => compare ? project(points, 'x', 'y') : project(points, 'X', 'Y'), [points, compare]);
  const sectors = useMemo(() => compare ? miniSectorDominance(points, MINI_SECTORS) : [], [points, compare]);
  const speeds = useMemo(() => points.map(point => point[compare ? 'first_Speed' : 'Speed']).filter((value):value is number => typeof value === 'number'), [points, compare]);
  if (!coordinates.length) return null;

  const minSpeed = speeds.length ? Math.min(...speeds) : 0, maxSpeed = speeds.length ? Math.max(...speeds) : 0;
  const wins = { first: sectors.filter(sector => sector.winner === 'first').length, second: sectors.filter(sector => sector.winner === 'second').length };
  const gains = { first: sectors.filter(sector => sector.winner === 'first').reduce((sum, sector) => sum + sector.gain, 0), second: sectors.filter(sector => sector.winner === 'second').reduce((sum, sector) => sum + sector.gain, 0) };
  const start = coordinates.find(Boolean);

  return <section className="panel track-map-panel">
    <div className="panel-head"><div><div className="eyebrow">{compare ? `TRACK DOMINANCE · ${MINI_SECTORS} MINI-SECTORS` : 'TRACK MAP · SPEED'}</div><h2>{compare ? 'Who is faster where' : 'Speed around the lap'}</h2></div></div>
    <div className="track-map-body">
      <svg className="track-map" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={compare ? `Track map: ${first.label} fastest in ${wins.first} and ${second.label} fastest in ${wins.second} of ${MINI_SECTORS} mini-sectors` : `Track map coloured by speed from ${Math.round(minSpeed)} to ${Math.round(maxSpeed)} km/h`}>
        <polyline points={path(coordinates)} className="track-outline"/>
        {compare
          ? sectors.map((sector, index) => <polyline key={index} points={path(coordinates.slice(sector.start, sector.end + 1))} stroke={sector.winner === 'first' ? first.color : sector.winner === 'second' ? second.color : '#6b7080'} className="track-segment"><title>{`Mini-sector ${index + 1}: ${sector.winner ? `${sector.winner === 'first' ? first.label : second.label} faster by ${sector.gain.toFixed(3)} s` : 'equal'}`}</title></polyline>)
          : coordinates.slice(1).map((coordinate, index) => {
              const previous = coordinates[index], speed = points[index + 1][compare ? 'first_Speed' : 'Speed'];
              return previous && coordinate && typeof speed === 'number' ? <line key={index} x1={previous.x} y1={previous.y} x2={coordinate.x} y2={coordinate.y} stroke={speedColor(speed, minSpeed, maxSpeed)} className="track-segment"/> : null;
            })}
        {start && <><circle cx={start.x} cy={start.y} r={16} className="track-start"/><text x={start.x + 24} y={start.y + 8} className="track-start-label">START</text></>}
      </svg>
      <div className="track-map-legend">
        {compare ? <>
          {([['first', first], ['second', second]] as const).map(([key, driver]) => <div key={key} className="track-driver">
            <i style={{background:driver.color}}/>
            <div><b>{driver.label}</b><small>Faster in {wins[key]} of {MINI_SECTORS} mini-sectors · gains {gains[key].toFixed(3)} s there</small></div>
            <strong>{wins[key]}</strong>
          </div>)}
          <div className="track-share" aria-hidden="true"><span style={{flex:wins.first || .001, background:first.color}}/><span style={{flex:wins.second || .001, background:second.color}}/></div>
          <p className="muted">Each mini-sector is coloured by the driver who covered it in less time, from FastF1 telemetry time at equal track distance.</p>
        </> : <>
          <div className="speed-scale"><span/><div><small>{Math.round(minSpeed)} km/h</small><small>{Math.round(maxSpeed)} km/h</small></div></div>
          <p className="muted">Colour shows measured speed along {first.label}. Turn on “Compare two laps” to see which driver is faster in each part of the track.</p>
        </>}
      </div>
    </div>
  </section>;
}
