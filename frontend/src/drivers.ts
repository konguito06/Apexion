import { createContext, useContext } from 'react';
import { teamColor } from './teams';

export type DriverInfo = { code:string; name:string|null; team:string|null; number:string|null; headshot:string|null; color:string; country:string|null };
type ClassificationRow = { driver:string|null; name:string|null; team:string|null; number?:string|null; headshot_url?:string|null; team_color?:string|null; country_code?:string|null };

const NEUTRAL = '#6b7080';

/** Index the session classification by driver code so every picker and card can show who the driver is. */
export function buildDriverInfo(rows:ClassificationRow[]):Record<string,DriverInfo> {
  const result:Record<string,DriverInfo> = {};
  for (const row of rows) {
    if (!row.driver) continue;
    result[row.driver] = {
      code: row.driver,
      name: row.name,
      team: row.team,
      number: row.number ?? null,
      headshot: row.headshot_url ?? null,
      color: row.team_color ?? teamColor(row.team) ?? NEUTRAL,
      country: row.country_code ?? null,
    };
  }
  return result;
}

export const DriverInfoContext = createContext<Record<string,DriverInfo>>({});

export function useDriverInfo():(code:string)=>DriverInfo {
  const info = useContext(DriverInfoContext);
  return code => info[code] ?? { code, name:null, team:null, number:null, headshot:null, color:NEUTRAL, country:null };
}
