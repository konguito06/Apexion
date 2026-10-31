/**
 * Timing-screen formatting: durations of a minute or more read as m:ss.sss (h:mm:ss.sss past an hour);
 * shorter values such as sectors, gaps and errors stay in seconds.
 */
export function formatTime(seconds:number|null|undefined, digits = 3, empty = '—'):string {
  if (seconds == null || !Number.isFinite(seconds)) return empty;
  const scale = 10 ** digits;
  // Round once up front so 59.9996 becomes 1:00.000 rather than "60.000".
  const rounded = Math.round(Math.abs(seconds) * scale) / scale;
  const sign = seconds < 0 && rounded > 0 ? '-' : '';
  if (rounded < 60) return `${sign}${rounded.toFixed(digits)} s`;
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = (rounded % 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  return hours ? `${sign}${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${sign}${minutes}:${rest}`;
}

/** Signed difference: "+1.482 s", "-0.322 s", "+1:14.887". */
export function formatDelta(seconds:number|null|undefined, digits = 3, empty = '—'):string {
  if (seconds == null || !Number.isFinite(seconds)) return empty;
  const magnitude = formatTime(Math.abs(seconds), digits);
  return `${seconds > 0 ? '+' : seconds < 0 ? '-' : ''}${magnitude}`;
}

/** Compact chart-axis label without the unit: 98.4 → "1:38.4", 31.2 → "31.2". */
export function formatAxisTime(seconds:number, digits = 1):string {
  return formatTime(seconds, digits).replace(/ s$/, '');
}
