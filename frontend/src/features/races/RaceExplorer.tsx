import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Route } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { request } from '../../api';

type Lap = { lap:number; seconds:number|null; sector_1:number|null; sector_2:number|null; sector_3:number|null; compound:string; tyre_life:number|null; stint?:number|null; pit_in:boolean; pit_out:boolean };
type Classification = { driver:string|null; name:string|null; team:string|null; position:number|null; grid:number|null; status:string|null; points:number|null; time:number|null };
type Summary = { year:number; event:string; session:string; date:string; drivers:string[]; race_laps:number; lap_observations:number; pit_stops:number; compounds:string[]; classification:Classification[]; data_source:string; status:string };
type Stint = { start:number; end:number; laps:number; compound:string };

const colors = ['#ef3d42','#55b8c8','#d7b75b','#a48bd1','#6cad84'];
const noDrivers: string[] = [];
const lapTime = (value:number|null) => value == null ? '—' : `${Math.floor(value/60)}:${(value%60).toFixed(3).padStart(6,'0')}`;

export function RaceExplorer({summary,driver,setDriver,laps,event,year,session,loading,onOpenDriverAnalysis,onOpenSimulator}:{summary:Summary|null;driver:string;setDriver:(driver:string)=>void;laps:Lap[];event:string;year:number;session:string;loading:boolean;onOpenDriverAnalysis:()=>void;onOpenSimulator:()=>void}) {
  const drivers = summary?.drivers ?? noDrivers;
  const [comparedDrivers,setComparedDrivers] = useState<string[]>([]);
  const [addDriver,setAddDriver] = useState('');
  const [lapFrom,setLapFrom] = useState(1);
  const [lapTo,setLapTo] = useState(summary?.race_laps ?? 1);
  const [representativeOnly,setRepresentativeOnly] = useState(false);
  const [series,setSeries] = useState<Record<string,Lap[]>>({});
  const [seriesLoading,setSeriesLoading] = useState(false);
  const [seriesError,setSeriesError] = useState('');

  useEffect(() => {
    setComparedDrivers(driver && drivers.includes(driver) ? [driver] : []);
    setAddDriver(drivers.find(candidate => candidate !== driver) ?? '');
    setLapFrom(1);
    setLapTo(Math.max(1, summary?.race_laps ?? 1));
  }, [year,event,session,summary?.race_laps,drivers,driver]);

  useEffect(() => {
    if (!driver || !comparedDrivers.length) { setSeries({}); return; }
    let active = true;
    setSeriesLoading(true);
    setSeriesError('');
    const others = comparedDrivers.filter(candidate => candidate !== driver);
    Promise.all(others.map(async candidate => {
      try {
        const response = await request<{laps:Lap[]}>(`/api/sessions/${year}/${encodeURIComponent(event)}/laps?driver=${encodeURIComponent(candidate)}&session=${encodeURIComponent(session)}`);
        return [candidate,response.laps] as const;
      } catch (error) {
        if (active) setSeriesError(error instanceof Error ? error.message : `Could not load ${candidate} laps`);
        return [candidate,[]] as const;
      }
    })).then(rows => {
      if (!active) return;
      setSeries({[driver]:laps,...Object.fromEntries(rows)});
    }).finally(() => { if (active) setSeriesLoading(false); });
    setSeries({[driver]:laps});
    return () => { active = false; };
  }, [year,event,session,driver,laps,comparedDrivers]);

  const visibleLaps = useMemo(() => (series[driver] ?? laps).filter(row => row.lap >= lapFrom && row.lap <= lapTo && (!representativeOnly || (row.seconds !== null && !row.pit_in && !row.pit_out))), [series,driver,laps,lapFrom,lapTo,representativeOnly]);
  const stintList = useMemo(() => {
    const ordered = [...(series[driver] ?? laps)].sort((a,b)=>a.lap-b.lap);
    const groups:(Stint & {key:number|null})[] = [];
    for (const row of ordered) {
      const key = row.stint == null ? null : row.stint;
      let last = groups.at(-1);
      const startNew = !last || (key !== null && last.key !== key) || (key === null && (last.key !== null || last.compound !== row.compound)) || row.pit_out;
      if (startNew) {
        last = {start:row.lap,end:row.lap,laps:0,compound:row.compound,key};
        groups.push(last);
      }
      if (!last) continue;
      last.end = row.lap;
      last.laps += 1;
      if (last.compound === 'UNKNOWN' && row.compound !== 'UNKNOWN') last.compound = row.compound;
    }
    return groups;
  }, [series,driver,laps]);
  const chartData = useMemo(() => {
    const byLap = new Map<number,Record<string,number|null>>();
    for (const candidate of comparedDrivers) {
      for (const row of (series[candidate] ?? (candidate === driver ? laps : []))) {
        if (row.lap < lapFrom || row.lap > lapTo || (representativeOnly && (row.seconds === null || row.pit_in || row.pit_out))) continue;
        const point = byLap.get(row.lap) ?? {lap:row.lap};
        point[candidate] = row.seconds;
        byLap.set(row.lap,point);
      }
    }
    return [...byLap.values()].sort((a,b)=>Number(a.lap)-Number(b.lap));
  }, [comparedDrivers,series,driver,laps,lapFrom,lapTo,representativeOnly]);
  const pitLaps = (series[driver] ?? laps).filter(row => row.pit_in || row.pit_out);
  const maxLap = Math.max(1,summary?.race_laps ?? laps.at(-1)?.lap ?? 1);
  const addComparison = () => {
    if (!addDriver || comparedDrivers.includes(addDriver) || comparedDrivers.length >= 5) return;
    setComparedDrivers(current => [...current,addDriver]);
    setAddDriver(drivers.find(candidate => candidate !== driver && !comparedDrivers.includes(candidate) && candidate !== addDriver) ?? '');
  };

  return <>
    <section className="panel race-toolbar">
      <label>Driver <select value={driver} onChange={e=>setDriver(e.target.value)} disabled={!drivers.length}>{drivers.map(d=><option key={d}>{d}</option>)}</select></label>
      <label>Lap from <input aria-label="Lap from" type="number" min="1" max={maxLap} value={lapFrom} onChange={e=>{const next=Math.min(maxLap,Math.max(1,Number(e.target.value)||1));setLapFrom(next);if(next>lapTo)setLapTo(next);}}/></label>
      <label>Lap to <input aria-label="Lap to" type="number" min={lapFrom} max={maxLap} value={lapTo} onChange={e=>setLapTo(Math.min(maxLap,Math.max(lapFrom,Number(e.target.value)||lapFrom)))}/></label>
      <label className="check-label"><input type="checkbox" checked={representativeOnly} onChange={e=>setRepresentativeOnly(e.target.checked)}/> representative laps</label>
      <label>Add comparison <select value={addDriver} onChange={e=>setAddDriver(e.target.value)}><option value="">Select driver</option>{drivers.filter(d=>!comparedDrivers.includes(d)).map(d=><option key={d}>{d}</option>)}</select></label>
      <button className="secondary" onClick={addComparison} disabled={!addDriver||comparedDrivers.length>=5}><Plus size={14}/> Add</button>
      <button className="secondary race-simulator-link" onClick={onOpenSimulator}><Route size={14}/> Simulate this race</button>
    </section>
    {loading&&<div className="empty" role="status">Loading {year} · {event} · {session} historical session…</div>}
    {summary&&<div className="data-provenance"><b>{summary.data_source}</b><span>{year} · {event} · {session}</span><span>{summary.lap_observations} lap observations · {summary.race_laps} completed laps</span></div>}
    {seriesError&&<p className="error-text" role="alert">Some comparison data could not be loaded: {seriesError}</p>}
    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">CLASSIFICATION · {session.toUpperCase()}</div><h2>{event || 'Select a Grand Prix'} · {year}</h2></div><span className="data-badge">{summary?.classification.length ?? 0} classified</span></div>
      {summary?.classification.length ? <div className="classification-table"><div className="class-row race-class-row class-head"><span>POS</span><span>DRIVER</span><span>TEAM</span><span>GRID</span><span>STATUS</span><span>TIME / PTS</span><span/></div>{summary.classification.map((row,index)=><div className="class-row race-class-row" key={`${row.driver}-${index}`}><b>{row.position??'—'}</b><span><strong>{row.driver??'—'}</strong><small>{row.name??''}</small></span><span>{row.team??'—'}</span><span>{row.grid??'—'}</span><span>{row.status??'—'}</span><span>{row.time!==null&&row.time!==undefined?lapTime(row.time):`${row.points??0} pts`}</span><button className="text-link" disabled={!row.driver} onClick={()=>{if(row.driver){setDriver(row.driver);onOpenDriverAnalysis();}}}>Analyze <ArrowRight size={12}/></button></div>)}</div> : <div className="empty">Finishing order is unavailable for this session. FastF1 may provide classification only for completed sessions.</div>}
    </section>
    <section className="panel chart-panel race-pace-panel">
      <div className="panel-head"><div><div className="eyebrow">MEASURED LAP TIMES</div><h2>Driver pace progression</h2></div><span className="muted">{seriesLoading?'Loading comparison laps…':`${chartData.length} laps in selected range`}</span></div>
      <div className="race-legend">{comparedDrivers.map((name,index)=><span key={name}><i style={{background:colors[index%colors.length]}}/>{name}</span>)}</div>
      {chartData.length ? <div className="chart race-chart" role="img" aria-label={`Measured lap-time progression for ${comparedDrivers.join(', ')}. Horizontal axis is lap; vertical axis is lap time in seconds.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#292b30" vertical={false}/><XAxis dataKey="lap" stroke="#737780" tickLine={false} label={{value:'LAP',position:'insideBottom',offset:-5,fill:'#737780'}}/><YAxis unit="s" stroke="#737780" tickLine={false} domain={['dataMin - 1','dataMax + 1']} tickFormatter={value=>Number(value).toFixed(1)} width={50} reversed/><Tooltip contentStyle={{background:'#17191d',border:'1px solid #34363c'}} formatter={(value,name)=>[value==null?'No time':`${Number(value).toFixed(3)} s`,String(name)]} labelFormatter={value=>`Lap ${value}`}/>{comparedDrivers.map((name,index)=><Line key={name} type="monotone" dataKey={name} name={name} stroke={colors[index%colors.length]} strokeWidth={2} dot={false} connectNulls={false}/>) }{pitLaps.map(row=><ReferenceLine key={`pit-${row.lap}`} x={row.lap} stroke="#55b8c8" strokeDasharray="3 3"/> )}</LineChart></ResponsiveContainer></div> : <div className="empty">No measured lap times match this driver and lap range. Select another driver or range.</div>}
      <p className="muted">Pit-in and pit-out laps are shown as cyan vertical markers for the selected driver. Representative-lap filtering removes missing times and pit laps; source observations remain in the table.</p>
    </section>
    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">LAP DETAIL · {driver||'NO DRIVER'}</div><h2>Lap, sector and tyre observations</h2></div><button className="secondary" onClick={onOpenDriverAnalysis} disabled={!driver}>Open driver analysis <ArrowRight size={13}/></button></div>
      {(series[driver]??laps).length ? <div className="lap-detail-list">{visibleLaps.map(row=><div className="lap-detail-row" key={row.lap}><span>Lap {row.lap}{row.pit_in?' · PIT IN':row.pit_out?' · PIT OUT':''}</span><b>{row.seconds?.toFixed(3)??'—'} s</b><span>{[row.sector_1,row.sector_2,row.sector_3].map(value=>value?.toFixed(3)??'—').join(' / ')}</span><span className={`compound ${row.compound.toLowerCase()}`}>{row.compound}</span></div>)}</div> : <div className="empty">Lap observations are unavailable for this driver.</div>}
      <p className="muted">Sector values and pit markers are FastF1 observations. Missing source values are shown as dashes.</p>
    </section>
    <section className="panel">
      <div className="panel-head"><div><div className="eyebrow">TYRE STINTS · {driver||'NO DRIVER'}</div><h2>Stint lengths</h2></div></div>
      {stintList.length ? <div className="race-stints">{stintList.map((stint,index)=><div key={`${stint.start}-${index}`}><span className={`compound ${stint.compound.toLowerCase()}`}>{stint.compound}</span><b>Lap {stint.start}–{stint.end}</b><span>{stint.laps} observed laps</span></div>)}</div> : <div className="empty">Tyre stint data is not available in this session.</div>}
      <p className="muted">Stints use FastF1 stint identifiers when provided, with compound and pit-out transitions as fallback boundaries.</p>
    </section>
  </>;
}
