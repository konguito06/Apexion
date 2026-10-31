import { describe, expect, it } from 'vitest';
import { driverColors, teamColor } from './teams';

describe('team colours', () => {
  it('resolves current and historical team names', () => {
    expect(teamColor('Red Bull Racing')).toBe('#3671c6');
    expect(teamColor('RB')).toBe('#6692ff');
    expect(teamColor('Kick Sauber')).toBe('#52e252');
    expect(teamColor('Unknown Team')).toBeUndefined();
  });

  it('keeps team-mates visually distinct', () => {
    const colors = driverColors(['VER', 'PER', 'LEC'], { VER: 'Red Bull Racing', PER: 'Red Bull Racing', LEC: 'Ferrari' }, ['#ffffff', '#d7b75b']);
    expect(colors.VER).toBe('#3671c6');
    expect(colors.PER).toBe('#ffffff');
    expect(colors.LEC).toBe('#e8002d');
  });
});
