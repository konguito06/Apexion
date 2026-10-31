// Constructor colours as used on public timing graphics; matched by name so renamed teams still resolve.
const teamPalette: [RegExp, string][] = [
  [/red bull/i, '#3671c6'],
  [/ferrari/i, '#e8002d'],
  [/mercedes/i, '#27f4d2'],
  [/mclaren/i, '#ff8000'],
  [/aston martin|racing point|force india/i, '#229971'],
  [/alpine|renault/i, '#0093cc'],
  [/williams/i, '#64c4ff'],
  [/rb\b|racing bulls|alphatauri|toro rosso/i, '#6692ff'],
  [/sauber|alfa romeo|kick|audi/i, '#52e252'],
  [/haas/i, '#b6babd'],
  [/cadillac/i, '#c8a96a'],
];

export function teamColor(team?: string | null): string | undefined {
  if (!team) return undefined;
  return teamPalette.find(([pattern]) => pattern.test(team))?.[1];
}

/** Assign each driver its team colour; team-mates and unknown teams fall back to distinct palette colours. */
export function driverColors(drivers: string[], teamOf: Record<string, string | null | undefined>, fallback: string[]): Record<string, string> {
  const used = new Set<string>();
  const result: Record<string, string> = {};
  let next = 0;
  for (const driver of drivers) {
    let color = teamColor(teamOf[driver]);
    if (!color || used.has(color)) {
      while (used.has(fallback[next % fallback.length]) && next < fallback.length * 2) next += 1;
      color = fallback[next % fallback.length];
      next += 1;
    }
    used.add(color);
    result[driver] = color;
  }
  return result;
}
