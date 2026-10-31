import { describe, expect, it } from 'vitest';
import { miniSectorDominance, speedColor, telemetryRegions } from './transforms';

describe('telemetryRegions', () => {
  it('marks brake and acceleration regions from measured channels', () => {
    const points = [
      {Distance:0,Brake:1,Throttle:0,Speed:80},
      {Distance:10,Brake:1,Throttle:0,Speed:70},
      {Distance:20,Brake:0,Throttle:85,Speed:75},
      {Distance:30,Brake:0,Throttle:95,Speed:90},
    ];

    expect(telemetryRegions(points,'Distance',false)).toEqual([
      {start:0,end:20,kind:'braking'},
      {start:20,end:30,kind:'acceleration'},
    ]);
  });

  it('returns no inferred regions when source channels are absent', () => {
    expect(telemetryRegions([{Distance:0,Speed:50},{Distance:10,Speed:60}],'Distance',false)).toEqual([]);
  });

  it('uses only measured first/second channels in a comparison', () => {
    const points = [
      {distance_m:0,first_Brake:1,second_Brake:0,first_Throttle:10,second_Throttle:10,first_Speed:80,second_Speed:70},
      {distance_m:10,first_Brake:0,second_Brake:0,first_Throttle:90,second_Throttle:90,first_Speed:90,second_Speed:80},
    ];
    expect(telemetryRegions(points,'distance_m',true)).toEqual([
      {start:0,end:10,kind:'braking'},
    ]);
  });
});

describe('miniSectorDominance', () => {
  it('awards each mini-sector to the driver who covered it faster', () => {
    // First driver is quicker over the first half, second driver over the second half.
    const points = Array.from({ length: 9 }, (_, index) => ({
      distance_m: index * 100,
      first_elapsed_seconds: index <= 4 ? index : 4 + (index - 4) * 1.5,
      second_elapsed_seconds: index <= 4 ? index * 1.2 : 4.8 + (index - 4),
    }));
    const sectors = miniSectorDominance(points, 4);
    expect(sectors.map(sector => sector.winner)).toEqual(['first', 'first', 'second', 'second']);
    expect(sectors[0].gain).toBeCloseTo(0.4);
  });

  it('returns nothing when elapsed times are missing', () => {
    expect(miniSectorDominance([{ distance_m: 0 }, { distance_m: 1 }], 1)).toEqual([]);
  });
});

describe('speedColor', () => {
  it('runs from blue at the slowest point to red at the fastest', () => {
    expect(speedColor(80, 80, 320)).toBe('rgb(47,140,255)');
    expect(speedColor(320, 80, 320)).toBe('rgb(232,16,44)');
  });
});
