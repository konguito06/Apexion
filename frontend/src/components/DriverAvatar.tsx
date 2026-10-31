import { useState, type CSSProperties } from 'react';
import type { DriverInfo } from '../drivers';

/** Driver headshot from the timing feed, falling back to the driver code on a team-coloured badge. */
export function DriverAvatar({info, size = 32}:{info:DriverInfo; size?:number}) {
  const [failed, setFailed] = useState<string|null>(null);
  const showPhoto = info.headshot && failed !== info.headshot;
  return <span className="driver-avatar" style={{'--team':info.color, width:size, height:size, fontSize:Math.max(9, size * .3)} as CSSProperties} aria-hidden="true">
    {showPhoto ? <img src={info.headshot as string} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(info.headshot)}/> : <b>{info.code.slice(0, 3)}</b>}
  </span>;
}
