/** Focus the pace axis on racing laps; pit and safety-car laps overflow the plot instead of flattening it. */
export function paceDomain(data:Record<string,unknown>[],keys:string[]):[number,number]|['dataMin - 1','dataMax + 1']{
  const values=data.flatMap(row=>keys.map(key=>row[key])).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)).sort((a,b)=>a-b);
  if(values.length<5) return ['dataMin - 1','dataMax + 1'];
  const at=(q:number)=>values[Math.min(values.length-1,Math.floor(q*(values.length-1)))];
  const low=values[0], spread=at(.75)-at(.25);
  const high=Math.min(values[values.length-1],at(.75)+Math.max(1.5,spread*3));
  return [Math.floor((low-.3)*10)/10,Math.ceil((high+.3)*10)/10];
}
