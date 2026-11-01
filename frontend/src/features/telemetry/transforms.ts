export type TelemetryPoint = Record<string, number | null>;
export type TelemetryRegion = { start:number; end:number; kind:'braking'|'acceleration' };

function isOn(value:number|null|undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Derive display regions only from measured Brake, Throttle and Speed channels. */
export function telemetryRegions(points:TelemetryPoint[], coordinateKey:string, compared:boolean):TelemetryRegion[] {
  if (points.length < 2) return [];
  const brakeKeys = compared ? ['first_Brake','second_Brake'] : ['Brake'];
  const throttleKeys = compared ? ['first_Throttle','second_Throttle'] : ['Throttle'];
  const speedKeys = compared ? ['first_Speed','second_Speed'] : ['Speed'];
  const hasBrake = brakeKeys.some(key=>points.some(point=>typeof point[key]==='number'));
  const hasAccelChannels = throttleKeys.some(key=>points.some(point=>typeof point[key]==='number')) && speedKeys.some(key=>points.some(point=>typeof point[key]==='number'));
  const regions:TelemetryRegion[]=[];

  const collect = (kind:TelemetryRegion['kind'], activeAt:(index:number)=>boolean) => {
    let start:number|null=null;
    for(let index=0;index<points.length;index++) {
      const coordinate=points[index][coordinateKey];
      if(typeof coordinate!=='number'||!Number.isFinite(coordinate)) continue;
      const active=activeAt(index);
      if(active&&start===null) start=coordinate;
      if(start!==null&&(!active||index===points.length-1)) {
        const end=coordinate;
        if(end>start) regions.push({start,end,kind});
        start=null;
      }
    }
  };

  if(hasBrake) collect('braking',index=>brakeKeys.some(key=>isOn(points[index][key])));
  if(hasAccelChannels) collect('acceleration',index=>{
    if(index===0) return false;
    return throttleKeys.some((throttle,indexOfKey)=>{
      const speed=speedKeys[indexOfKey]??speedKeys[0];
      const currentThrottle=points[index][throttle];
      const currentSpeed=points[index][speed];
      const previousSpeed=points[index-1][speed];
      return typeof currentThrottle==='number'&&currentThrottle>=80&&typeof currentSpeed==='number'&&typeof previousSpeed==='number'&&currentSpeed>previousSpeed;
    });
  });
  return regions;
}

export type MiniSector = { start:number; end:number; winner:'first'|'second'|null; gain:number };

/** Split an aligned comparison into equal-distance mini-sectors and pick who covered each one faster. */
export function miniSectorDominance(points:TelemetryPoint[], count = 24):MiniSector[] {
  const usable = points.filter(point => typeof point.first_elapsed_seconds === 'number' && typeof point.second_elapsed_seconds === 'number');
  if (usable.length < count + 1 || points.length !== usable.length) return [];
  const sectors:MiniSector[] = [];
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * (points.length - 1) / count);
    const end = Math.floor((index + 1) * (points.length - 1) / count);
    const first = (points[end].first_elapsed_seconds as number) - (points[start].first_elapsed_seconds as number);
    const second = (points[end].second_elapsed_seconds as number) - (points[start].second_elapsed_seconds as number);
    const gain = Math.abs(first - second);
    sectors.push({ start, end, winner: gain < 0.0005 ? null : first < second ? 'first' : 'second', gain });
  }
  return sectors;
}

export type DominanceRun = { winner:'first'|'second'; sectors:number[]; gain:number };

/**
 * Merge consecutive mini-sectors won by the same driver into one run with the summed time gained.
 * The lap is a loop, so a run that crosses the start/finish line (last and first mini-sectors) is one run.
 */
export function dominanceRuns(sectors:MiniSector[]):DominanceRun[] {
  const runs:DominanceRun[] = [];
  sectors.forEach((sector, index) => {
    const last = runs.at(-1);
    if (!sector.winner) { runs.push({ winner:'first', sectors:[], gain:0 }); return; }
    if (last && last.winner === sector.winner && last.sectors.length && last.sectors.at(-1) === index - 1) { last.sectors.push(index); last.gain += sector.gain; return; }
    runs.push({ winner:sector.winner, sectors:[index], gain:sector.gain });
  });
  const real = runs.filter(run => run.sectors.length);
  const first = real[0], final = real.at(-1);
  if (real.length > 1 && first && final && first.winner === final.winner && first.sectors[0] === 0 && final.sectors.at(-1) === sectors.length - 1) {
    final.sectors.push(...first.sectors);
    final.gain += first.gain;
    real.shift();
  }
  return real;
}

const speedStops:[number,[number,number,number]][] = [[0,[47,140,255]],[.4,[47,212,119]],[.7,[255,210,63]],[1,[232,16,44]]];

/** Map a speed onto a blue → green → yellow → red scale between the lap's slowest and fastest samples. */
export function speedColor(speed:number, min:number, max:number):string {
  const t = max > min ? Math.min(1, Math.max(0, (speed - min) / (max - min))) : .5;
  const upper = speedStops.findIndex(([stop]) => stop >= t);
  const [stopB, colorB] = speedStops[Math.max(1, upper)];
  const [stopA, colorA] = speedStops[Math.max(1, upper) - 1];
  const local = (t - stopA) / (stopB - stopA || 1);
  const channel = (index:number) => Math.round(colorA[index] + (colorB[index] - colorA[index]) * local);
  return `rgb(${channel(0)},${channel(1)},${channel(2)})`;
}
