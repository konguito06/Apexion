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
