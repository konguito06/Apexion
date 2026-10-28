import { useEffect, useMemo, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { request } from '../../api';
import { telemetryRegions, type TelemetryPoint } from './transforms';

type Lap = {lap:number;seconds:number|null;sector_1:number|null;sector_2:number|null;sector_3:number|null;compound:string;tyre_life:number|null;pit_in:boolean;pit_out:boolean};
type Comparison = {points:TelemetryPoint[];channels:string[];coordinate:string;lap_time_delta_seconds:number|null;sector_time_deltas_seconds:Record<string,number|null>;data_source:string};
const availableChannels=['Speed','Throttle','Brake','nGear','RPM','DRS'];
const channelUnits:Record<string,string>={Speed:'km/h',Throttle:'%',Brake:'on/off',nGear:'gear',RPM:'rpm',DRS:'state'};
const formatDelta=(value:number|null|undefined)=>value==null?'Unavailable':`${value>0?'+':''}${value.toFixed(3)} s`;

export function TelemetryLab({year,event,session,drivers,driver,setDriver,laps,loading}:{year:number;event:string;session:string;drivers:string[];driver:string;setDriver:(driver:string)=>void;laps:Lap[];loading:boolean}) {
  const [lap,setLap]=useState(1);
  const [compare,setCompare]=useState(false);
  const [secondDriver,setSecondDriver]=useState('');
  const [secondLap,setSecondLap]=useState(1);
  const [secondLaps,setSecondLaps]=useState<Lap[]>([]);
  const [points,setPoints]=useState<TelemetryPoint[]>([]);
  const [channels,setChannels]=useState<string[]>([]);
  const [comparison,setComparison]=useState<Comparison|null>(null);
  const [message,setMessage]=useState('Select a session with loaded lap data to inspect measured telemetry.');
  const [busy,setBusy]=useState(false);
  const selectedKey=`${year}|${event}|${session}|${driver}|${lap}|${compare}|${secondDriver}|${secondLap}`;
  const currentKey=useRef(selectedKey);

  useEffect(()=>{currentKey.current=selectedKey;setBusy(false);setPoints([]);setChannels([]);setComparison(null);setMessage('Selection changed. Load telemetry to display the selected measured data.');},[selectedKey]);
  useEffect(()=>{
    if(laps.length&&!laps.some(row=>row.lap===lap)) setLap(laps[0].lap);
  },[laps,lap]);
  useEffect(()=>{
    const next=drivers.find(candidate=>candidate!==driver)??driver;
    setSecondDriver(current=>drivers.includes(current)?current:next);
    setSecondLaps([]);
  },[drivers,driver,year,event,session]);
  useEffect(()=>{
    if(!compare||!event||!secondDriver) {setSecondLaps([]);return;}
    let active=true;
    request<{laps:Lap[]}>(`/api/sessions/${year}/${encodeURIComponent(event)}/laps?driver=${encodeURIComponent(secondDriver)}&session=${encodeURIComponent(session)}`)
      .then(result=>{if(active){setSecondLaps(result.laps);if(result.laps.length)setSecondLap(current=>result.laps.some(row=>row.lap===current)?current:result.laps[0].lap);}})
      .catch(error=>{if(active){setSecondLaps([]);setMessage(error instanceof Error?error.message:'Could not load the second driver laps');}});
    return()=>{active=false;};
  },[compare,year,event,session,secondDriver]);

  const xKey=compare?'distance_m':'Distance';
  const regions=useMemo(()=>telemetryRegions(points,xKey,compare),[points,xKey,compare]);
  const load=async()=>{
    if(!event||!driver||!Number.isInteger(lap)||lap<1){setMessage('Choose a loaded driver and a valid lap number.');return;}
    if(compare&&(!secondDriver||!Number.isInteger(secondLap)||secondLap<1||(secondDriver===driver&&secondLap===lap))){setMessage('Choose a different compatible driver/lap pair for comparison.');return;}
    const requestKey=selectedKey;
    setBusy(true);setMessage('Loading FastF1 telemetry…');setPoints([]);setComparison(null);
    try {
      if(compare) {
        const result=await request<Comparison>('/api/sessions/telemetry/compare',{method:'POST',body:JSON.stringify({year,event,session,first_driver:driver,first_lap:lap,second_driver:secondDriver,second_lap:secondLap})});
        if(currentKey.current!==requestKey)return;
        setPoints(result.points);setChannels(result.channels);setComparison(result);
        setMessage(result.points.length?`${result.points.length} aligned points · shared track distance · ${result.data_source}`:'These laps have no overlapping distance and channel data to compare.');
      } else {
        const result=await request<{points:TelemetryPoint[];data_source:string}>(`/api/sessions/${year}/${encodeURIComponent(event)}/telemetry?driver=${encodeURIComponent(driver)}&lap=${lap}&session=${encodeURIComponent(session)}`);
        if(currentKey.current!==requestKey)return;
        const measured=availableChannels.filter(channel=>result.points.some(point=>typeof point[channel]==='number'));
        setPoints(result.points);setChannels(measured);setComparison(null);
        setMessage(result.points.length?`${result.points.length} samples · FastF1 lap distance · ${result.data_source}`:'No telemetry samples are available for this lap.');
      }
    } catch(error) {
      if(currentKey.current===requestKey){setPoints([]);setChannels([]);setMessage(error instanceof Error?error.message:'Telemetry is unavailable for this selection.');}
    } finally {if(currentKey.current===requestKey)setBusy(false);}
  };
  const lapOptions=useMemo(()=>laps.filter(row=>row.lap>=1).map(row=>row.lap),[laps]);
  const secondLapOptions=useMemo(()=>secondLaps.filter(row=>row.lap>=1).map(row=>row.lap),[secondLaps]);
  const timeDeltaAvailable=compare&&points.some(point=>typeof point.time_delta_seconds==='number');

  return <>
    <section className="panel telemetry-lab-panel">
      <div className="panel-head"><div><div className="eyebrow">PUBLIC CAR TELEMETRY · MEASURED CHANNELS</div><h2>Telemetry Lab</h2></div><Radio size={18}/></div>
      <div className="telemetry-controls">
        <label>Driver <select value={driver} onChange={e=>setDriver(e.target.value)} disabled={!drivers.length}>{drivers.map(name=><option key={name}>{name}</option>)}</select></label>
        <label>Lap <select aria-label="Lap" value={lapOptions.includes(lap)?lap:(lapOptions[0]??'')} onChange={e=>setLap(Number(e.target.value))} disabled={!lapOptions.length}>{lapOptions.length?lapOptions.map(number=><option key={number} value={number}>Lap {number}</option>):<option value="">No laps</option>}</select></label>
        <label className="check-label"><input type="checkbox" checked={compare} onChange={e=>setCompare(e.target.checked)}/> Compare two laps</label>
        {compare&&<>
          <label>Second driver <select value={secondDriver} onChange={e=>setSecondDriver(e.target.value)} disabled={!drivers.length}>{drivers.map(name=><option key={name}>{name}</option>)}</select></label>
          <label>Second lap <select aria-label="Second lap" value={secondLapOptions.includes(secondLap)?secondLap:(secondLapOptions[0]??'')} onChange={e=>setSecondLap(Number(e.target.value))} disabled={!secondLapOptions.length}>{secondLapOptions.length?secondLapOptions.map(number=><option key={number} value={number}>Lap {number}</option>):<option value="">No laps</option>}</select></label>
        </>}
        <button className="primary" onClick={load} disabled={busy||loading||!lapOptions.length||(compare&&!secondLapOptions.length)}>{busy?'Loading…':'Load telemetry'}</button>
      </div>
      <p className="muted">{message}. FastF1 source channels only; no steering values are inferred. {compare?'Comparison is restricted to this selected season, event and session.':'Change driver or lap to inspect another observation.'}</p>
      {comparison&&<>
        <div className="telemetry-delta-cards"><div><span>LAP TIME · SECOND − FIRST</span><b>{formatDelta(comparison.lap_time_delta_seconds)}</b></div>{(['sector_1','sector_2','sector_3'] as const).map((key,index)=><div key={key}><span>SECTOR {index+1} · SECOND − FIRST</span><b>{formatDelta(comparison.sector_time_deltas_seconds[key])}</b></div>)}</div>
        <p className="telemetry-note">Positive delta means the second lap took longer. Lap and sector deltas use FastF1 lap timing; the curve below is relative elapsed time at equal distance from the start of the shared overlap.</p>
      </>}
    </section>
    {points.length>0&&channels.length>0 ? <>
      <div className="telemetry-channel-grid">{channels.map(channel=>{
        const speed=channel==='Speed';
        const channelRegions=speed?regions:[];
        return <section className="panel telemetry-channel" key={channel}>
          <div className="panel-head"><div><div className="eyebrow">{compare?'ALIGNED COMPARISON':'FASTF1 OBSERVATION'}</div><h2>{channel} <small>· {channelUnits[channel]}</small></h2></div>{speed&&<div className="telemetry-region-legend"><span><i className="braking"/> Brake</span><span><i className="acceleration"/> Acceleration</span></div>}</div>
          <ResponsiveContainer width="100%" height={230}><LineChart data={points} margin={{top:8,right:12,bottom:15,left:0}}>
            <CartesianGrid stroke="#292b30" vertical={false}/><XAxis dataKey={xKey} type="number" domain={['dataMin','dataMax']} stroke="#737780" tickLine={false} label={{value:compare?'TRACK DISTANCE · METRES':'DISTANCE · METRES',position:'insideBottom',offset:-8,fill:'#777'}}/><YAxis stroke="#737780" tickLine={false} unit={channel==='Speed'?' km/h':channel==='Throttle'?' %':''} tickFormatter={value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:channel==='RPM'?0:1})} width={channel==='RPM'?65:55}/><Tooltip contentStyle={{background:'#17191d',border:'1px solid #34363c'}} labelFormatter={value=>`Distance ${Number(value).toFixed(1)} m`} formatter={value=>[value==null?'—':`${Number(value).toFixed(2)} ${channelUnits[channel]}`,channel]}/>
            {channelRegions.map((region,index)=><ReferenceArea key={`${region.kind}-${index}`} x1={region.start} x2={region.end} fill={region.kind==='braking'?'#ef3d42':'#55b8c8'} fillOpacity={region.kind==='braking'?0.12:0.10} strokeOpacity={0}/>) }
            {compare?<><Line dataKey={`first_${channel}`} name={`${driver} · Lap ${lap}`} stroke="#ef3d42" strokeWidth={1.8} dot={false}/><Line dataKey={`second_${channel}`} name={`${secondDriver} · Lap ${secondLap}`} stroke="#55b8c8" strokeWidth={1.8} dot={false}/></>:<Line dataKey={channel} name={`${driver} · Lap ${lap}`} stroke="#ef3d42" strokeWidth={1.8} dot={false}/>}
          </LineChart></ResponsiveContainer>
          {speed&&<div className="telemetry-legend"><span><i className="red"/>{driver} · Lap {lap}</span>{compare&&<span><i className="cyan"/>{secondDriver} · Lap {secondLap}</span>}<small>{channelRegions.length?'Shaded regions are derived from measured brake/throttle/speed channels.':''}</small></div>}
        </section>;
      })}</div>
      {timeDeltaAvailable&&<section className="panel telemetry-channel">
        <div className="panel-head"><div><div className="eyebrow">CALCULATED FROM FASTF1 TELEMETRY TIME</div><h2>Relative time delta <small>· seconds · second − first</small></h2></div></div>
        <ResponsiveContainer width="100%" height={230}><LineChart data={points} margin={{top:8,right:12,bottom:15,left:0}}><CartesianGrid stroke="#292b30" vertical={false}/><XAxis dataKey="distance_m" type="number" domain={['dataMin','dataMax']} stroke="#737780" tickLine={false} label={{value:'TRACK DISTANCE · METRES',position:'insideBottom',offset:-8,fill:'#777'}}/><YAxis stroke="#737780" tickLine={false} unit=" s" tickFormatter={value=>Number(value).toFixed(2)} width={60}/><Tooltip contentStyle={{background:'#17191d',border:'1px solid #34363c'}} labelFormatter={value=>`Distance ${Number(value).toFixed(1)} m`} formatter={value=>[value==null?'—':`${Number(value).toFixed(3)} s`,'Second − first']}/><Line dataKey="time_delta_seconds" name="Second − first" stroke="#d7b75b" dot={false}/></LineChart></ResponsiveContainer>
      </section>}
    </> : <section className="panel"><div className="empty large">{busy?'Loading telemetry…':loading?'Loading the selected session…':channels.length===0&&points.length>0?'No supported telemetry channels are available for these laps.':'Load a supported lap to display available speed, throttle, brake, gear, RPM or DRS channels.'}</div></section>}
    {points.length>0&&<div className="data-provenance"><b>{comparison?.data_source??'FastF1 historical telemetry'}</b><span>{year} · {event} · {session}</span><span>{compare?'Actual distance in metres; shared overlapping distance is plotted.':'FastF1 distance in metres along this lap.'}</span></div>}
  </>;
}
